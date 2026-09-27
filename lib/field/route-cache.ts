import type { SupabaseClient } from "@supabase/supabase-js";

import { fieldDb, type CachedRoute, type CachedRouteStep } from "@/lib/field/db";
import type { FieldRoute, FieldRouteStep } from "@/lib/field/route-display";
import type { Database } from "@/lib/supabase/types";

/**
 * Route geometry and steps for the open prop.
 *
 * Fetched on prop open. A later online open compares `route_fp` with the
 * minimum `route_steps.id` and refetches when they differ. Offline, or when
 * that read errors or times out, the cache is used as stored. A missing
 * store, a failed fetch, or `has_route: false` means the logger keeps the
 * interim-sweep banner. Fail open.
 */

/** Same length as the service worker's network-first timeout. */
export const ROUTE_FINGERPRINT_TIMEOUT_MS = 3_000;

function metaKey(assignmentId: string): `route_for:${string}` {
  return `route_for:${assignmentId}`;
}

function fpKey(assignmentId: string): `route_fp:${string}` {
  return `route_fp:${assignmentId}`;
}

function browserIsOnline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine;
}

function fingerprintFromId(id: number | string | null | undefined): string {
  if (id === null || id === undefined || id === "") return "steps:none";
  return `steps:${id}`;
}

function minStepFingerprint(ids: readonly (number | string | null | undefined)[]): string {
  let min: bigint | null = null;
  let text = "";
  for (const id of ids) {
    if (id === null || id === undefined || id === "") continue;
    let value: bigint;
    try {
      value = BigInt(id);
    } catch {
      continue;
    }
    if (min === null || value < min) {
      min = value;
      text = String(id);
    }
  }
  return min === null ? "steps:none" : `steps:${text}`;
}

/**
 * `steps:<min id>`, `steps:none` when the assignment has no steps, or null
 * when the read errors or exceeds ROUTE_FINGERPRINT_TIMEOUT_MS.
 */
async function readServerFingerprint(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = supabase
      .from("route_steps")
      .select("id")
      .eq("assignment_id", assignmentId)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    const result = await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("route fingerprint timeout")), ROUTE_FINGERPRINT_TIMEOUT_MS);
      }),
    ]);
    if (result.error) return null;
    if (!result.data) return "steps:none";
    return fingerprintFromId(result.data.id);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asLine(value: unknown): { type: "LineString"; coordinates: [number, number][] } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { type?: string; coordinates?: unknown };
  if (row.type !== "LineString" || !Array.isArray(row.coordinates)) return null;
  const coordinates: [number, number][] = [];
  for (const pair of row.coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    coordinates.push([lon, lat]);
  }
  if (coordinates.length < 2) return null;
  return { type: "LineString", coordinates };
}

function stepId(assignmentId: string, stepIndex: number): string {
  return `${assignmentId}:${stepIndex}`;
}

function asKind(value: unknown): "work" | "cross" | "walk" | null {
  if (value === "work" || value === "cross" || value === "walk") return value;
  return null;
}

function asSide(value: unknown): "left" | "right" | null {
  if (value === "left" || value === "right") return value;
  return null;
}

/**
 * A version-5 row has no `kind` key. A version-6 row always has the key,
 * even when the server value is null (an old-engine freeze).
 */
function cacheHasKind(steps: CachedRouteStep[]): boolean {
  if (steps.length === 0) return true;
  return steps.some((step) => Object.prototype.hasOwnProperty.call(step, "kind"));
}

/**
 * Fetch and cache the route unless this assignment is already cached and,
 * when online, its fingerprint still matches. Returns true when a full
 * fetch was written. Never throws: a failure leaves the meta key unset so
 * the next open tries again. A fingerprint error or timeout keeps the cache.
 */
export async function ensureRoute(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
): Promise<boolean> {
  let db: ReturnType<typeof fieldDb>;
  try {
    db = fieldDb();
  } catch {
    return false;
  }

  const already = await db.sync_meta.get(metaKey(assignmentId)).catch(() => undefined);
  if (already) {
    const cached = await db.route_steps.where("assignment_id").equals(assignmentId).toArray().catch(() => []);
    if (cacheHasKind(cached)) {
      if (!browserIsOnline()) return false;
      const serverFp = await readServerFingerprint(supabase, assignmentId);
      if (serverFp === null) return false;
      const storedFp = await db.sync_meta.get(fpKey(assignmentId)).catch(() => undefined);
      if (storedFp?.value === serverFp) return false;
    }
  }

  const assignment = await supabase
    .from("assignments")
    .select("route_geom, route_stranded_count, route_variant_key")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignment.error || !assignment.data) return false;

  const line = asLine(assignment.data.route_geom);
  const hasRoute = line !== null;
  const stranded = asNumber(assignment.data.route_stranded_count) ?? 0;

  let steps: CachedRouteStep[] = [];
  let fingerprint = "steps:none";
  if (hasRoute) {
    const loaded = await supabase
      .from("route_steps")
      .select(
        "id, step_index, segment_id, street_name, instruction, is_spur, cumulative_m, geom, kind, side, walk_geom, first_seq, last_seq, is_dead_end",
      )
      .eq("assignment_id", assignmentId)
      .order("step_index");
    if (loaded.error || !loaded.data) return false;
    fingerprint = minStepFingerprint(loaded.data.map((row) => row.id));
    steps = [];
    for (const row of loaded.data) {
      const coordinates = asLine(row.geom)?.coordinates ?? asLine(row.walk_geom)?.coordinates;
      const cumulative = asNumber(row.cumulative_m);
      if (!coordinates || cumulative === null) continue;
      steps.push({
        id: stepId(assignmentId, row.step_index),
        assignment_id: assignmentId,
        step_index: row.step_index,
        segment_id: row.segment_id,
        street_name: row.street_name,
        instruction: row.instruction,
        is_spur: row.is_spur,
        cumulative_m: cumulative,
        coordinates,
        kind: asKind(row.kind),
        side: asSide(row.side),
        walk: asLine(row.walk_geom)?.coordinates ?? null,
        first_seq: asNumber(row.first_seq),
        last_seq: asNumber(row.last_seq),
        is_dead_end: row.is_dead_end === true,
      });
    }
  }

  const route: CachedRoute = {
    assignment_id: assignmentId,
    has_route: hasRoute,
    stranded_count: stranded,
    line,
    variant_key: assignment.data.route_variant_key,
  };

  await db.transaction("rw", db.routes, db.route_steps, db.sync_meta, async () => {
    await db.route_steps.where("assignment_id").equals(assignmentId).delete();
    await db.routes.put(route);
    if (steps.length > 0) await db.route_steps.bulkPut(steps);
    await db.sync_meta.put({ key: metaKey(assignmentId), value: new Date().toISOString() });
    await db.sync_meta.put({ key: fpKey(assignmentId), value: fingerprint });
  });

  return true;
}

/**
 * Turns a Dexie row into the field route. Missing version-6 keys become
 * null. Never throws on an old-shaped row.
 */
export function fieldRouteFromCache(
  row: CachedRoute,
  steps: readonly CachedRouteStep[],
): FieldRoute {
  const fieldSteps: FieldRouteStep[] = steps.map((step) => ({
    step_index: step.step_index,
    segment_id: step.segment_id ?? null,
    street_name: step.street_name ?? null,
    instruction: step.instruction,
    is_spur: step.is_spur === true,
    cumulative_m: asNumber(step.cumulative_m) ?? 0,
    coordinates: Array.isArray(step.coordinates) ? step.coordinates : [],
    kind: asKind(step.kind),
    side: asSide(step.side),
    walk: Array.isArray(step.walk) ? step.walk : null,
    first_seq: asNumber(step.first_seq),
    last_seq: asNumber(step.last_seq),
    is_dead_end: step.is_dead_end === true,
  }));
  return {
    hasRoute: row.has_route,
    strandedCount: asNumber(row.stranded_count) ?? 0,
    line: row.line,
    variantKey: typeof row.variant_key === "string" ? row.variant_key : null,
    steps: fieldSteps,
  };
}

/** The cached route, or null when the store is absent or this prop was never fetched. */
export async function readRoute(assignmentId: string): Promise<FieldRoute | null> {
  try {
    const db = fieldDb();
    const row = await db.routes.get(assignmentId);
    if (!row) return null;
    const steps = await db.route_steps.where("assignment_id").equals(assignmentId).sortBy("step_index");
    return fieldRouteFromCache(row, steps);
  } catch {
    return null;
  }
}
