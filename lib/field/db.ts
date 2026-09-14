import Dexie, { type EntityTable } from "dexie";
import type { TodaysAssignment } from "@/lib/geo/todays-assignment";

/**
 * The Dexie row is the RPC document plus a cache timestamp. Primary key is
 * the assignment, with work_date and canvasser_id indexed so airplane-mode
 * reopen can find today's row for this user without a network call.
 *
 * Version 2 adds canvasser_id so a shared phone cannot show someone else's
 * cached prop. Version 1 had this table only. Stage 7 will bump further if
 * it adds a queue table — do not add one here.
 */
export type CachedAssignment = {
  assignment_id: string;
  canvasser_id: string;
  work_date: string;
  cached_at: string;
  payload: TodaysAssignment;
};

export type FieldDatabase = Dexie & {
  assignments: EntityTable<CachedAssignment, "assignment_id">;
};

let instance: FieldDatabase | null = null;

export const FIELD_DB_NAME = "nakolabs-d2d-field";

export function fieldDb(): FieldDatabase {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is only available in the browser");
  }
  if (!instance) {
    instance = new Dexie(FIELD_DB_NAME) as FieldDatabase;
    instance.version(1).stores({
      assignments: "assignment_id, work_date",
    });
    instance.version(2).stores({
      assignments: "assignment_id, work_date, canvasser_id",
    }).upgrade((tx) => tx.table("assignments").clear());
  }
  return instance;
}
