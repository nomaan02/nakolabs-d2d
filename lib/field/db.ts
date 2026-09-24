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
 *
 * Version 4 (Stage 8b) adds `addresses` and nothing else. The snapshot
 * store's record shape is untouched — field devices have populated caches —
 * and no store is cleared. An absent or empty `addresses` store means labels
 * do not render and everything else works unchanged: fail open.
 *
 * Version 5 (Stage 5b-b) adds `routes` and `route_steps`. The snapshot and
 * addresses stores are repeated verbatim and not reshaped. An absent route
 * store, or a row with `has_route` false, means the out-of-order banner
 * shows and the logger behaves as it did before routes existed.
 *
 * Version 6 (Stage 5b-R4) adds no store and no index. The new route columns
 * (`kind`, `side`, `walk`, `first_seq`, `last_seq`, `is_dead_end`,
 * `variant_key`) are fields on the existing rows. Dexie does not reshape
 * objects, so a route cached before this version simply lacks those keys.
 * Readers treat a missing key as null and do not throw.
 */
export type CachedAssignment = {
  assignment_id: string;
  canvasser_id: string;
  work_date: string;
  cached_at: string;
  payload: TodaysAssignment;
};

/**
 * One door's display label, as resolved by `v_door_label` and delivered by
 * `addresses_for_assignment`. Keyed on uprn: labels are a property of the
 * door, not of the assignment that happened to fetch them.
 *
 * No `sub_building` — admin-only, never reaches the field.
 */
export type CachedAddress = {
  uprn: number;
  house_number: string | null;
  building_name: string | null;
  street_name: string | null;
};

/**
 * `held_undo` is a fourth status, not a fourth sync path. `flush()` selects
 * only `pending`, so a held row is invisible to the wire until its
 * `eligible_at` passes and the promotion timer (or the start-up sweep) moves
 * it to `pending`. Undo deletes the row; nothing reaches Postgres.
 */
export type OutboxStatus = "held_undo" | "pending" | "synced" | "failed";

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
  /**
   * When a `held_undo` row becomes eligible for sending. Absent on rows
   * queued before Stage 8b and on rows queued without an undo window. Not
   * indexed — the sweep reads the handful of held rows and compares in JS.
   */
  eligible_at?: string | null;
  attempts: number;
  created_at: string;
  synced_at: string | null;
  last_error: OutboxError | null;
};

/**
 * `route_geom` for one assignment. `line` is null when the assignment is unrouted.
 * `variant_key` is absent on rows cached before version 6.
 */
export type CachedRoute = {
  assignment_id: string;
  has_route: boolean;
  stranded_count: number;
  line: GeoJSON.LineString | null;
  variant_key?: string | null;
};

/**
 * One `route_steps` row, without the database geometry wrapper.
 * The version-6 fields are optional: a row written by version 5 has none of
 * them, and reading it must not throw.
 */
export type CachedRouteStep = {
  /** `${assignment_id}:${step_index}` so a re-fetch replaces rather than duplicates. */
  id: string;
  assignment_id: string;
  step_index: number;
  segment_id: number | null;
  street_name: string | null;
  instruction: string;
  is_spur: boolean;
  cumulative_m: number;
  coordinates: [number, number][];
  kind?: string | null;
  side?: string | null;
  /** Pavement line. Absent on a version-5 row; null when the server has no walkline. */
  walk?: [number, number][] | null;
  first_seq?: number | null;
  last_seq?: number | null;
  is_dead_end?: boolean;
};

/**
 * `addresses_for:<id>` and `route_for:<id>` record that the one-shot fetch
 * for that assignment has already run. Reopening does not repeat it.
 */
export type SyncMetaKey =
  | "last_sync_at"
  | "last_canvasser_id"
  | `addresses_for:${string}`
  | `route_for:${string}`;

export type SyncMetaRow = {
  key: SyncMetaKey;
  value: string;
};

export type FieldDatabase = Dexie & {
  assignments: EntityTable<CachedAssignment, "assignment_id">;
  outbox: EntityTable<OutboxRow, "seq">;
  sync_meta: EntityTable<SyncMetaRow, "key">;
  addresses: EntityTable<CachedAddress, "uprn">;
  routes: EntityTable<CachedRoute, "assignment_id">;
  route_steps: EntityTable<CachedRouteStep, "id">;
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
    // Stage 8b. Only `addresses` is new; every other store is repeated
    // verbatim because Dexie treats an omitted store in a later version as a
    // drop. No `.upgrade()` — nothing is cleared, nothing is reshaped.
    instance.version(4).stores({
      assignments: "assignment_id, work_date, canvasser_id",
      outbox:
        "++seq, &client_event_id, assignment_id, canvasser_id, status, [assignment_id+seq], [status+assignment_id]",
      sync_meta: "key",
      addresses: "uprn",
    });
    // Stage 5b-b. Only `routes` and `route_steps` are new. Every earlier
    // store is repeated because Dexie treats an omitted store as a drop.
    // No `.upgrade()` — populated snapshot and address caches stay.
    instance.version(5).stores({
      assignments: "assignment_id, work_date, canvasser_id",
      outbox:
        "++seq, &client_event_id, assignment_id, canvasser_id, status, [assignment_id+seq], [status+assignment_id]",
      sync_meta: "key",
      addresses: "uprn",
      routes: "assignment_id",
      route_steps: "id, assignment_id, step_index",
    });
    // Stage 5b-R4. Same stores, same indexes. No `.upgrade()` — a version-5
    // route row stays on disk and is read as the old shape.
    instance.version(6).stores({
      assignments: "assignment_id, work_date, canvasser_id",
      outbox:
        "++seq, &client_event_id, assignment_id, canvasser_id, status, [assignment_id+seq], [status+assignment_id]",
      sync_meta: "key",
      addresses: "uprn",
      routes: "assignment_id",
      route_steps: "id, assignment_id, step_index",
    });
  }
  return instance;
}
