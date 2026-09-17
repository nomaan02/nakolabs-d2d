import type { SupabaseClient } from "@supabase/supabase-js";

import { fieldDb, type CachedAddress } from "@/lib/field/db";
import type { Database } from "@/lib/supabase/types";

/**
 * Display labels for the doors in a prop.
 *
 * The only read path is `addresses_for_assignment`, which resolves through
 * `v_door_label` and so already applies invariant 3: a canvasser-supplied
 * number beats the public data. Nothing in the field reads
 * `property_addresses` directly, and no query here can return
 * `sub_building` — the view does not expose it.
 *
 * The RPC runs ONCE, on prop open, straight into the Dexie `addresses` store.
 * Every label read afterwards is a Dexie read. A 2,000-door prop measured
 * 748 ms cold server-side: fine once a day, not fine per door.
 *
 * Fail open throughout. No labels is the normal state for roughly 40% of
 * Bristol doors and the correct state for a device that has never been
 * online; a missing store must not stop the logger working.
 */

export type DoorLabels = Map<number, CachedAddress>;

function metaKey(assignmentId: string): `addresses_for:${string}` {
  return `addresses_for:${assignmentId}`;
}

/**
 * Fetch and cache labels for this assignment unless it has already been
 * done. Returns true if the network was used.
 */
export async function ensureAddresses(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
): Promise<boolean> {
  const db = fieldDb();

  const already = await db.sync_meta.get(metaKey(assignmentId)).catch(() => undefined);
  if (already) return false;

  const { data, error } = await supabase.rpc("addresses_for_assignment", {
    p_assignment_id: assignmentId,
  });
  if (error || !data) return false;

  const rows: CachedAddress[] = data.map((row) => ({
    uprn: row.uprn,
    house_number: row.house_number,
    building_name: row.building_name,
    street_name: row.street_name,
  }));

  await db.transaction("rw", db.addresses, db.sync_meta, async () => {
    if (rows.length > 0) await db.addresses.bulkPut(rows);
    await db.sync_meta.put({ key: metaKey(assignmentId), value: new Date().toISOString() });
  });

  return true;
}

/** Every cached label for the given doors. Absent uprns are simply missing. */
export async function readLabels(uprns: number[]): Promise<DoorLabels> {
  const map: DoorLabels = new Map();
  if (uprns.length === 0) return map;
  try {
    const rows = await fieldDb().addresses.bulkGet(uprns);
    for (const row of rows) {
      if (row) map.set(row.uprn, row);
    }
  } catch {
    // No store, no labels. Dots still render; see the fail-open note above.
  }
  return map;
}

/**
 * Apply a canvasser's own house number locally, so the label on screen
 * changes the moment they type it rather than on the next prop open. The
 * authoritative resolution is still `v_door_label`, which will return the
 * same value once the observation syncs.
 */
export async function applyLocalHouseNumber(uprn: number, houseNumber: string): Promise<void> {
  const db = fieldDb();
  const existing = await db.addresses.get(uprn).catch(() => undefined);
  await db.addresses.put({
    uprn,
    house_number: houseNumber,
    building_name: existing?.building_name ?? null,
    street_name: existing?.street_name ?? null,
  });
}

// ---------------------------------------------------------------------------
// The display ladder
// ---------------------------------------------------------------------------

/**
 * Logger ladder (Stage 8b): `"38"` → `"St. Giles Court"` → `"—"`.
 *
 * The em dash is the correct, expected state for roughly 69% of doors. It is
 * never "Unknown" and never an error.
 */
export function doorPlate(label: CachedAddress | undefined): string {
  const number = label?.house_number?.trim();
  if (number) return number;
  const building = label?.building_name?.trim();
  if (building) return building;
  return "—";
}

/** True when the plate is the placeholder, so the ✎ can invite a correction. */
export function plateIsPlaceholder(label: CachedAddress | undefined): boolean {
  return doorPlate(label) === "—";
}

/**
 * Map ladder (Stage 6 amendment): `"9 Small Street"` →
 * `"St. Giles Court, Small Street"` → `"Small Street"` → nothing at all.
 */
export function mapLabel(label: CachedAddress | undefined): string | null {
  const number = label?.house_number?.trim();
  const building = label?.building_name?.trim();
  const street = label?.street_name?.trim();

  if (number && street) return `${number} ${street}`;
  if (number) return number;
  if (building && street) return `${building}, ${street}`;
  if (building) return building;
  if (street) return street;
  return null;
}

/**
 * List ladder: as the map, with `"Door {n}"` as the final rung. The list
 * never renders an empty row.
 */
export function listLabel(label: CachedAddress | undefined, humanPosition: number): string {
  return mapLabel(label) ?? `Door ${humanPosition}`;
}
