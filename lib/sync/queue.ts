import type { SupabaseClient } from "@supabase/supabase-js";

import { fieldDb, type OutboxError, type OutboxRow } from "@/lib/field/db";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import { delayMs } from "@/lib/sync/backoff";
import { classify, type SendClass } from "@/lib/sync/classify";
import { validateOp, type SyncOp } from "@/lib/sync/ops";

/**
 * The only write path from the field app.
 *
 * Rows go into the Dexie `outbox` with the client_event_id the caller
 * generated, and are sent strictly in `seq` order within each assignment.
 * Nothing here generates ids, nothing here is called from a service worker,
 * and nothing under app/(field) inserts into Supabase directly.
 *
 * Cross-tab exclusivity is a Web Lock (auto-released when a tab dies), so a
 * mid-flush kill leaves rows `pending`, never stuck. There is no in_flight
 * status on purpose.
 */

export type QueueState = "idle" | "syncing" | "backoff" | "offline" | "auth_required";

export type FlushReason =
  | "mount"
  | "online"
  | "visible"
  | "focus"
  | "pageshow"
  | "enqueue"
  | "timer"
  | "manual"
  | "retry";

/** In-memory part of the status. Counts come from Dexie via liveQuery. */
export type QueueRuntime = {
  state: QueueState;
  /** Pending rows whose canvasser_id is not the signed-in user. Not sent, not failed. */
  held: number;
  nextAttemptAt: number | null;
  lastFlushAt: string | null;
  lastReason: FlushReason | null;
};

export type EnqueueResult =
  | { queued: true; seq: number }
  | { queued: false; reason: "already_queued" };

export type SendOutcome = "ok" | SendClass;

export type SendResult = {
  outcome: SendOutcome;
  step: "knock" | "lead" | "observation";
  error: OutboxError | null;
};

type Client = SupabaseClient<Database>;

export const LOCK_NAME = "d2d-outbox-flush";
export const REQUEST_TIMEOUT_MS = 10_000;

const EXTERNAL_TRIGGERS: ReadonlySet<FlushReason> = new Set<FlushReason>([
  "mount",
  "online",
  "visible",
  "focus",
  "pageshow",
  "enqueue",
  "manual",
]);

let runtime: QueueRuntime = {
  state: "idle",
  held: 0,
  nextAttemptAt: null,
  lastFlushAt: null,
  lastReason: null,
};
const listeners = new Set<() => void>();

let consecutiveFailures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let waitingForLock = false;
let localLockHeld = false;
let rerunRequested = false;
let client: Client | null = null;

function getClient(): Client {
  if (!client) client = createClient();
  return client;
}

function setRuntime(patch: Partial<QueueRuntime>) {
  runtime = { ...runtime, ...patch };
  for (const listener of listeners) listener();
}

export function getStatus(): QueueRuntime {
  return runtime;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "ConstraintError"
  );
}

/**
 * Store one op. Idempotent on client_event_id: the unique index makes a
 * second enqueue of the same id a no-op rather than a second row.
 */
export async function enqueue(op: SyncOp): Promise<EnqueueResult> {
  const problem = validateOp(op);
  if (problem) throw new Error(`Refusing to queue ${op.kind}: ${problem}`);

  const row: OutboxRow = {
    client_event_id: op.client_event_id,
    kind: op.kind,
    assignment_id: op.assignment_id,
    canvasser_id: op.canvasser_id,
    payload: op.payload,
    status: "pending",
    attempts: 0,
    created_at: new Date().toISOString(),
    synced_at: null,
    last_error: null,
  };

  const db = fieldDb();
  let outcome: EnqueueResult;
  try {
    // Check-then-add inside one readwrite transaction: IndexedDB serialises
    // these per store, so a double-tap cannot slip two rows in. The unique
    // index still backs this up if it ever did.
    outcome = await db.transaction("rw", db.outbox, async () => {
      const existing = await db.outbox.where("client_event_id").equals(op.client_event_id).first();
      if (existing) return { queued: false, reason: "already_queued" } as const;
      const seq = await db.outbox.add(row);
      return { queued: true, seq: seq as number } as const;
    });
  } catch (error) {
    if (isConstraintError(error)) return { queued: false, reason: "already_queued" };
    throw error;
  }

  if (outcome.queued) {
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      void flush("enqueue");
    } else {
      setRuntime({ state: "offline" });
    }
  }
  return outcome;
}

export async function hasPending(): Promise<boolean> {
  const count = await fieldDb().outbox.where("status").equals("pending").count();
  return count > 0;
}

/** Put a parked row back in the queue and try again now. */
export async function retryFailed(clientEventId: string): Promise<void> {
  const db = fieldDb();
  const row = await db.outbox.where("client_event_id").equals(clientEventId).first();
  if (!row || row.status !== "failed") return;
  await db.outbox.update(row.seq as number, { status: "pending", last_error: null });
  void flush("manual");
}

/** Drop a parked row for good. Only rows the server has permanently rejected. */
export async function discardFailed(clientEventId: string): Promise<void> {
  const db = fieldDb();
  const row = await db.outbox.where("client_event_id").equals(clientEventId).first();
  if (!row || row.status !== "failed") return;
  await db.outbox.delete(row.seq as number);
}

function clearRetryTimer() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(ms: number) {
  clearRetryTimer();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush("retry");
  }, ms);
}

/**
 * Try to send everything pending. Safe to call from anywhere, any number of
 * times: at most one flush runs per origin at once, and a call that arrives
 * while one is running queues a single re-run behind it.
 */
export async function flush(reason: FlushReason): Promise<void> {
  if (typeof window === "undefined") return;

  // A backoff retry is already scheduled; the 30 s timer must not pile on.
  if (reason === "timer" && retryTimer !== null) return;

  // External signals mean conditions changed. Forget the backoff.
  if (EXTERNAL_TRIGGERS.has(reason)) {
    clearRetryTimer();
    consecutiveFailures = 0;
  }

  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks && typeof locks.request === "function") {
    await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        // Someone (this tab or another) is flushing. Queue exactly one re-run
        // behind them so rows added during their pass are not left waiting.
        if (!waitingForLock) {
          waitingForLock = true;
          void locks.request(LOCK_NAME, async () => {
            waitingForLock = false;
            await runGuarded(reason);
          });
        }
        return;
      }
      await runGuarded(reason);
    });
    return;
  }

  // No Web Locks: in-memory flag, single tab assumed.
  if (localLockHeld) {
    rerunRequested = true;
    return;
  }
  localLockHeld = true;
  try {
    do {
      rerunRequested = false;
      await runGuarded(reason);
    } while (rerunRequested);
  } finally {
    localLockHeld = false;
  }
}

async function runGuarded(reason: FlushReason) {
  try {
    await runFlush(reason);
  } catch (error) {
    // Dexie or unexpected failure: never leave the UI on "syncing".
    const wait = delayMs(consecutiveFailures);
    consecutiveFailures += 1;
    scheduleRetry(wait);
    setRuntime({
      state: "backoff",
      nextAttemptAt: Date.now() + wait,
      lastReason: reason,
    });
    if (process.env.NODE_ENV === "development") console.error("[sync] flush failed", error);
  }
}

function isRetryableAuthError(error: { name?: string; status?: number } | null): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  return error.status === 0 || error.status === undefined;
}

async function runFlush(reason: FlushReason) {
  const db = fieldDb();

  const pendingCount = await db.outbox.where("status").equals("pending").count();
  if (pendingCount === 0) {
    setRuntime({ state: "idle", held: 0, nextAttemptAt: null, lastReason: reason });
    return;
  }

  // Hint only. `false` saves a doomed request; `true` proves nothing.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setRuntime({ state: "offline", nextAttemptAt: null, lastReason: reason });
    return;
  }

  setRuntime({ state: "syncing", nextAttemptAt: null, lastReason: reason });

  const supabase = getClient();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  const uid = session?.user.id;

  if (!uid) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline || isRetryableAuthError(sessionError)) {
      const wait = delayMs(consecutiveFailures);
      consecutiveFailures += 1;
      scheduleRetry(wait);
      setRuntime({ state: offline ? "offline" : "backoff", nextAttemptAt: Date.now() + wait });
      return;
    }
    setRuntime({ state: "auth_required", nextAttemptAt: null });
    return;
  }

  const rows = await db.outbox.where("status").equals("pending").sortBy("seq");

  // Group by assignment, preserving seq order inside each group and the order
  // in which assignments first appear.
  const groups = new Map<string, OutboxRow[]>();
  for (const row of rows) {
    const group = groups.get(row.assignment_id);
    if (group) group.push(row);
    else groups.set(row.assignment_id, [row]);
  }

  let held = 0;
  let sawRetryable = false;

  for (const group of groups.values()) {
    for (const row of group) {
      const seq = row.seq as number;

      if (row.canvasser_id !== uid) {
        held += 1;
        continue;
      }

      const result = await sendOp(supabase, row);
      const now = new Date().toISOString();

      if (result.outcome === "ok" || result.outcome === "duplicate") {
        await db.transaction("rw", db.outbox, db.sync_meta, async () => {
          await db.outbox.update(seq, { status: "synced", synced_at: now, last_error: null });
          await db.sync_meta.put({ key: "last_sync_at", value: now });
        });
        continue;
      }

      if (result.outcome === "permanent") {
        // Park it, surface it, and let later rows through.
        await db.outbox.update(seq, {
          status: "failed",
          attempts: row.attempts + 1,
          last_error: result.error,
        });
        continue;
      }

      if (result.outcome === "auth") {
        await db.outbox.update(seq, { attempts: row.attempts + 1, last_error: result.error });
        setRuntime({ state: "auth_required", held, nextAttemptAt: null });
        return;
      }

      // retryable: head-of-line block for this assignment, move to the next.
      await db.outbox.update(seq, { attempts: row.attempts + 1, last_error: result.error });
      sawRetryable = true;
      break;
    }
  }

  const finishedAt = new Date().toISOString();
  if (sawRetryable) {
    const wait = delayMs(consecutiveFailures);
    consecutiveFailures += 1;
    scheduleRetry(wait);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    setRuntime({
      state: offline ? "offline" : "backoff",
      held,
      nextAttemptAt: Date.now() + wait,
      lastFlushAt: finishedAt,
    });
    return;
  }

  consecutiveFailures = 0;
  setRuntime({ state: "idle", held, nextAttemptAt: null, lastFlushAt: finishedAt });
}

function toFailure(
  error: { message: string; code?: string; name?: string } | null,
  status: number,
): OutboxError {
  return {
    status,
    code: error?.code || undefined,
    message: error?.message ?? `HTTP ${status}`,
  };
}

async function insertWithTimeout<T>(
  run: (signal: AbortSignal) => PromiseLike<{ error: T | null; status: number }>,
  timeoutMs: number,
): Promise<{ error: T | null; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one row. Exported so the Stage 7 harness can drive the real wire path
 * from Node with a real JWT, without Dexie.
 *
 * knock_event: insert the knock, then (if present) the lead. If the lead step
 * fails retryably the row stays pending and the next attempt re-runs step 1,
 * which comes back 23505 → duplicate → carry on to step 2. Identical bytes
 * both times.
 */
export async function sendOp(
  supabase: Client,
  row: Pick<OutboxRow, "kind" | "payload">,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<SendResult> {
  if (row.kind === "knock_event") {
    const payload = row.payload as Extract<SyncOp, { kind: "knock_event" }>["payload"];

    const knock = await insertWithTimeout(
      (signal) => supabase.from("knock_events").insert(payload.knock).abortSignal(signal),
      timeoutMs,
    );
    if (knock.error) {
      const failure = toFailure(knock.error, knock.status);
      const cls = classify({ ...failure, name: knock.error.name });
      if (cls !== "duplicate") return { outcome: cls, step: "knock", error: failure };
      if (!payload.lead) return { outcome: "duplicate", step: "knock", error: null };
    } else if (!payload.lead) {
      return { outcome: "ok", step: "knock", error: null };
    }

    const lead = await insertWithTimeout(
      (signal) => supabase.from("leads").insert(payload.lead!).abortSignal(signal),
      timeoutMs,
    );
    if (lead.error) {
      const failure = toFailure(lead.error, lead.status);
      const cls = classify({ ...failure, name: lead.error.name });
      if (cls === "duplicate") return { outcome: "duplicate", step: "lead", error: null };
      return { outcome: cls, step: "lead", error: failure };
    }
    return { outcome: "ok", step: "lead", error: null };
  }

  const payload = row.payload as Extract<SyncOp, { kind: "property_observation" }>["payload"];
  const observation = await insertWithTimeout(
    (signal) =>
      supabase.from("property_observations").insert(payload.observation).abortSignal(signal),
    timeoutMs,
  );
  if (observation.error) {
    const failure = toFailure(observation.error, observation.status);
    const cls = classify({ ...failure, name: observation.error.name });
    if (cls === "duplicate") return { outcome: "duplicate", step: "observation", error: null };
    return { outcome: cls, step: "observation", error: failure };
  }
  return { outcome: "ok", step: "observation", error: null };
}
