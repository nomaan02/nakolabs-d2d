"use client";

import { useEffect, type ReactNode } from "react";

import { getCachedToday } from "@/lib/field/cache";
import { fieldDb, type OutboxRow } from "@/lib/field/db";
import { createClient } from "@/lib/supabase/client";
import { newClientEventId, newRowId, type KnockEventOp } from "@/lib/sync/ops";
import {
  enqueue,
  flush,
  getStatus,
  hasPending,
  promoteDue,
  type QueueRuntime,
} from "@/lib/sync/queue";

const TIMER_MS = 30_000;

/**
 * Mounts once under the field layout and wires every flush trigger:
 * mount, online, visibility → visible, focus, bfcache restore, and a 30 s
 * timer that only fires while the tab is visible and something is pending.
 * No Background Sync — unsupported on iOS, and it would put a second sync
 * path inside the service worker.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Before the first flush: promote any held_undo row whose 60 s window
    // expired while the app was closed. A force-quit inside the undo window
    // must not strand a knock on the device.
    void promoteDue()
      .catch(() => 0)
      .finally(() => void flush("mount"));

    const onOnline = () => void flush("online");
    const onFocus = () => void flush("focus");
    const onVisibility = () => {
      if (document.visibilityState === "visible") void flush("visible");
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void flush("pageshow");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // promoteDue first: a backgrounded tab can have its promotion timer
      // throttled, and hasPending() counts held rows as unsynced work.
      promoteDue()
        .catch(() => 0)
        .then(() => hasPending())
        .then((pending) => {
          if (pending) void flush("timer");
        })
        .catch(() => undefined);
    }, TIMER_MS);

    const uninstallDebug =
      process.env.NODE_ENV === "development" ? installDebugHooks() : undefined;

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
      uninstallDebug?.();
    };
  }, []);

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Development-only harness. Guarded by NODE_ENV so it is tree-shaken from
// production. Drives the real queue against the real cached assignment; it
// does not simulate connectivity — use the browser's own offline switch.
// ---------------------------------------------------------------------------

/** Above the 12-digit OS UPRN range, so the FK fails with 23503. */
const GHOST_UPRN = 999_999_999_999;

type SyntheticOptions = {
  /** Point every knock at a UPRN that does not exist → 23503 → permanent. */
  badUprn?: boolean;
  /** Force one specific client_event_id (for the double-enqueue check). */
  clientEventId?: string;
};

type SyncDebug = {
  enqueueSynthetic(
    n: number,
    opts?: SyntheticOptions,
  ): Promise<{ queued: number; alreadyQueued: number; ids: string[] }>;
  flush(): Promise<void>;
  dump(): Promise<{ pending: number; synced: number; failed: number; rows: OutboxRow[] }>;
  serverCount(): Promise<{ local: number; server: number; missing: string[] }>;
  reset(): Promise<void>;
  status(): QueueRuntime;
};

declare global {
  interface Window {
    __d2dSyncDebug?: SyncDebug;
  }
}

function installDebugHooks(): () => void {
  const debug: SyncDebug = {
    async enqueueSynthetic(n, opts = {}) {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user.id;
      if (!uid) throw new Error("No session — sign in first");
      const cached = await getCachedToday(uid);
      if (!cached) throw new Error("No cached assignment for today — open /field online first");
      const doors = cached.payload.doors.features;
      if (doors.length === 0) throw new Error("Cached assignment has no doors");

      let queued = 0;
      let alreadyQueued = 0;
      const ids: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const door = doors[i % doors.length];
        const clientEventId = opts.clientEventId ?? newClientEventId();
        const op: KnockEventOp = {
          kind: "knock_event",
          client_event_id: clientEventId,
          assignment_id: cached.assignment_id,
          canvasser_id: uid,
          payload: {
            knock: {
              id: newRowId(),
              client_event_id: clientEventId,
              assignment_id: cached.assignment_id,
              canvasser_id: uid,
              uprn: opts.badUprn ? GHOST_UPRN : door.properties.uprn,
              outcome: "no_answer",
              sequence_position: door.properties.sequence,
              occurred_at: new Date().toISOString(),
              notes: null,
            },
          },
        };
        const result = await enqueue(op);
        if (result.queued) queued += 1;
        else alreadyQueued += 1;
        ids.push(clientEventId);
      }
      return { queued, alreadyQueued, ids };
    },

    flush: () => flush("manual"),

    async dump() {
      const rows = await fieldDb().outbox.orderBy("seq").toArray();
      return {
        pending: rows.filter((r) => r.status === "pending").length,
        synced: rows.filter((r) => r.status === "synced").length,
        failed: rows.filter((r) => r.status === "failed").length,
        rows,
      };
    },

    async serverCount() {
      const rows = await fieldDb().outbox.orderBy("seq").toArray();
      const ids = rows.map((r) => r.client_event_id);
      const supabase = createClient();
      const found = new Set<string>();
      let server = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { data, error } = await supabase
          .from("knock_events")
          .select("client_event_id")
          .in("client_event_id", chunk);
        if (error) throw new Error(error.message);
        server += data.length;
        for (const row of data) found.add(row.client_event_id);
      }
      return { local: ids.length, server, missing: ids.filter((id) => !found.has(id)) };
    },

    async reset() {
      await fieldDb().outbox.clear();
    },

    status: () => getStatus(),
  };

  window.__d2dSyncDebug = debug;
  return () => {
    if (window.__d2dSyncDebug === debug) delete window.__d2dSyncDebug;
  };
}
