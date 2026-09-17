"use client";

import { liveQuery } from "dexie";
import { useSyncExternalStore } from "react";

import { fieldDb, type OutboxRow } from "@/lib/field/db";
import {
  getStatus,
  subscribe as subscribeRuntime,
  type QueueRuntime,
  type QueueState,
} from "@/lib/sync/queue";

/**
 * Queue depth and last-sync time for the UI. Dexie `liveQuery` supplies the
 * counts and the parked rows; the queue's in-memory emitter supplies the
 * state. Combined behind one `useSyncExternalStore` so React sees a single
 * stable snapshot. No dexie-react-hooks — liveQuery is in Dexie core.
 */
export type SyncStatus = {
  pending: number;
  failed: number;
  failedRows: OutboxRow[];
  held: number;
  lastSyncAt: string | null;
  nextAttemptAt: number | null;
  state: QueueState;
  /** False until the first Dexie read has completed on this device. */
  ready: boolean;
};

type Counts = Pick<SyncStatus, "pending" | "failed" | "failedRows" | "lastSyncAt">;

const INITIAL: SyncStatus = {
  pending: 0,
  failed: 0,
  failedRows: [],
  held: 0,
  lastSyncAt: null,
  nextAttemptAt: null,
  state: "idle",
  ready: false,
};

const RESTART_MS = 1_000;

let counts: Counts | null = null;
let snapshot: SyncStatus = INITIAL;
const listeners = new Set<() => void>();
let unsubscribeLive: (() => void) | null = null;
let unsubscribeRuntime: (() => void) | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

function recompute(runtime: QueueRuntime) {
  snapshot = {
    pending: counts?.pending ?? 0,
    failed: counts?.failed ?? 0,
    failedRows: counts?.failedRows ?? [],
    lastSyncAt: counts?.lastSyncAt ?? null,
    held: runtime.held,
    nextAttemptAt: runtime.nextAttemptAt,
    state: runtime.state,
    ready: counts !== null,
  };
  for (const listener of listeners) listener();
}

/**
 * A liveQuery that errors is dead: Dexie stops re-running it. Rather than
 * leave the header frozen on a stale count, tear down and resubscribe.
 */
function restartLive(why: string, error?: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.error(`[sync-status] liveQuery ${why}; restarting`, error);
  }
  unsubscribeLive?.();
  unsubscribeLive = null;
  if (restartTimer !== null) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (listeners.size > 0 && unsubscribeLive === null) startLive();
  }, RESTART_MS);
}

function startLive() {
  const db = fieldDb();
  const observable = liveQuery(async (): Promise<Counts> => {
    const [sendable, heldUndo, failedRows, lastSync] = await Promise.all([
      db.outbox.where("status").equals("pending").count(),
      // Held rows are logged knocks inside their undo window. They are
      // unsynced work, so the header counts them — same rule as hasPending().
      db.outbox.where("status").equals("held_undo").count(),
      db.outbox.where("status").equals("failed").sortBy("seq"),
      db.sync_meta.get("last_sync_at"),
    ]);
    return {
      pending: sendable + heldUndo,
      failed: failedRows.length,
      failedRows,
      lastSyncAt: lastSync?.value ?? null,
    };
  });
  const sub = observable.subscribe({
    next: (value) => {
      counts = value;
      recompute(getStatus());
    },
    error: (error: unknown) => restartLive("errored", error),
    complete: () => restartLive("completed"),
  });
  unsubscribeLive = () => sub.unsubscribe();
}

function start() {
  startLive();
  unsubscribeRuntime = subscribeRuntime(() => recompute(getStatus()));
}

function stop() {
  if (restartTimer !== null) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  unsubscribeLive?.();
  unsubscribeRuntime?.();
  unsubscribeLive = null;
  unsubscribeRuntime = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getSnapshot(): SyncStatus {
  return snapshot;
}

function getServerSnapshot(): SyncStatus {
  return INITIAL;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
