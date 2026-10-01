import type { SupabaseClient } from "@supabase/supabase-js";

import { fieldDb } from "@/lib/field/db";
import type { Database } from "@/lib/supabase/types";

/**
 * Door slices for the open prop.
 *
 * Same shape as the route cache: fetch while online, keep Dexie when the
 * radio is off or the call fails. An empty collection is a real result —
 * the map simply draws no coloured buildings. Fail open.
 */

const FOOTPRINT_TIMEOUT_MS = 4_000;

function asCollection(value: unknown): GeoJSON.FeatureCollection | null {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as { type?: unknown; features?: unknown };
  if (row.type !== "FeatureCollection" || !Array.isArray(row.features)) return null;
  return parsed as GeoJSON.FeatureCollection;
}

async function readCached(assignmentId: string): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const row = await fieldDb().footprints.get(assignmentId);
    if (!row) return null;
    return asCollection(row.data);
  } catch {
    return null;
  }
}

/**
 * Fetch and cache the slices when `online` is true. Otherwise, or when the
 * RPC errors or exceeds 4 s, return the cached collection or null.
 * Never throws.
 */
export async function ensureFootprints(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  online: boolean,
): Promise<GeoJSON.FeatureCollection | null> {
  if (!online) return readCached(assignmentId);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = supabase.rpc("assignment_door_footprints", { p_assignment: assignmentId });
    const result = await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("footprint timeout")), FOOTPRINT_TIMEOUT_MS);
      }),
    ]);
    if (result.error) return readCached(assignmentId);
    const data = asCollection(result.data);
    if (!data) return readCached(assignmentId);
    await fieldDb().footprints.put({
      assignment_id: assignmentId,
      fetched_at: new Date().toISOString(),
      data,
    });
    return data;
  } catch {
    return readCached(assignmentId);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
