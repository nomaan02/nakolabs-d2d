import Dexie, { type EntityTable } from "dexie";
import type { TodaysAssignment } from "@/lib/geo/todays-assignment";
import type { SyncOp, SyncOpKind } from "@/lib/sync/ops";

/**
 * The Dexie row is the RPC document plus a cache timestamp. Primary key is
 * the assignment, with work_date and canvasser_id indexed so airplane-mode
 * reopen can find today's row for this user without a network call.
 *
 * Version 2 adds canvasser_id so a shared phone cannot show someone else's
 * cached prop. Version 1 had this table only.
 *
 * Version 3 (Stage 7) adds `outbox` and `sync_meta`. `assignments` is
 * unchanged and is NOT cleared on this upgrade.
 */
export type CachedAssignment = {
  assignment_id: string;
  canvasser_id: string;
  work_date: string;
  cached_at: string;
  payload: TodaysAssignment;
};

export type OutboxStatus = "pending" | "synced" | "failed";

export type OutboxError = {
  status?: number;
  code?: string;
  message: string;
};

/**
 * One queued write. `seq` is the auto-increment primary key and therefore the
 * insertion order on this device; `client_event_id` is a unique index, which
 * makes a second enqueue of the same id a ConstraintError the queue treats as
 * "already queued". Rows flip to `synced` rather than being deleted so the
 * device keeps a local record of today's knocks.
 */
export type OutboxRow = {
  seq?: number;
  client_event_id: string;
  kind: SyncOpKind;
  assignment_id: string;
  canvasser_id: string;
  payload: SyncOp["payload"];
  status: OutboxStatus;
  attempts: number;
  created_at: string;
  synced_at: string | null;
  last_error: OutboxError | null;
};

export type SyncMetaKey = "last_sync_at" | "last_canvasser_id";

export type SyncMetaRow = {
  key: SyncMetaKey;
  value: string;
};

export type FieldDatabase = Dexie & {
  assignments: EntityTable<CachedAssignment, "assignment_id">;
  outbox: EntityTable<OutboxRow, "seq">;
  sync_meta: EntityTable<SyncMetaRow, "key">;
};

let instance: FieldDatabase | null = null;

export const FIELD_DB_NAME = "nakolabs-d2d-field";

export function fieldDb(): FieldDatabase {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is only available in the browser");
  }
  if (!instance) {
    // cache: "disabled" — Dexie 4.4.6's liveQuery cache middleware keeps a
    // null optimistic op after a failed add() (ConstraintError), and every
    // later re-query throws inside applyOptimisticOps, killing the
    // observable. The tables here are tiny; going to IndexedDB each time is
    // cheaper than a frozen status line.
    instance = new Dexie(FIELD_DB_NAME, { cache: "disabled" }) as FieldDatabase;
    instance.version(1).stores({
      assignments: "assignment_id, work_date",
    });
    instance.version(2).stores({
      assignments: "assignment_id, work_date, canvasser_id",
    }).upgrade((tx) => tx.table("assignments").clear());
    instance.version(3).stores({
      assignments: "assignment_id, work_date, canvasser_id",
      outbox:
        "++seq, &client_event_id, assignment_id, canvasser_id, status, [assignment_id+seq], [status+assignment_id]",
      sync_meta: "key",
    });
  }
  return instance;
}
