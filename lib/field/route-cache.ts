import type { SupabaseClient } from "@supabase/supabase-js";

import { fieldDb, type CachedRoute, type CachedRouteStep } from "@/lib/field/db";
import type { FieldRoute, FieldRouteStep } from "@/lib/field/route-display";
import type { Database } from "@/lib/supabase/types";

/**
 * Route geometry and steps for the open prop.
 *
 * Fetched ONCE, on prop open, the same way address labels are. Every later
 * read is Dexie. A missing store, a failed fetch, or `has_route: false`
 * means the logger keeps the interim-sweep banner. Fail open.
 */

function metaKey(assignmentId: string): `route_for:${string}` {
  return `route_for:${assignmentId}`;
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

/**
 * Fetch and cache the route unless this assignment was already fetched.
 * Returns true when the network was used. Never throws: a failure leaves
 * the meta key unset so the next open tries again.
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
  if (already) return false;

  const assignment = await supabase
    .from("assignments")
    .select("route_geom, route_stranded_count")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignment.error || !assignment.data) return false;

  const line = asLine(assignment.data.route_geom);
  const hasRoute = line !== null;
  const stranded = asNumber(assignment.data.route_stranded_count) ?? 0;

  let steps: CachedRouteStep[] = [];
  if (hasRoute) {
    const loaded = await supabase
      .from("route_steps")
      .select("step_index, segment_id, street_name, instruction, is_spur, cumulative_m, geom")
      .eq("assignment_id", assignmentId)
      .order("step_index");
    if (loaded.error || !loaded.data) return false;
    steps = [];
    for (const row of loaded.data) {
      const coordinates = asLine(row.geom)?.coordinates;
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
      });
    }
  }

  const route: CachedRoute = {
    assignment_id: assignmentId,
    has_route: hasRoute,
    stranded_count: stranded,
    line,
  };

  await db.transaction("rw", db.routes, db.route_steps, db.sync_meta, async () => {
    await db.route_steps.where("assignment_id").equals(assignmentId).delete();
    await db.routes.put(route);
    if (steps.length > 0) await db.route_steps.bulkPut(steps);
    await db.sync_meta.put({ key: metaKey(assignmentId), value: new Date().toISOString() });
  });

  return true;
}

/** The cached route, or null when the store is absent or this prop was never fetched. */
export async function readRoute(assignmentId: string): Promise<FieldRoute | null> {
  try {
    const db = fieldDb();
    const row = await db.routes.get(assignmentId);
    if (!row) return null;
    const steps = await db.route_steps.where("assignment_id").equals(assignmentId).sortBy("step_index");
    const fieldSteps: FieldRouteStep[] = steps.map((step) => ({
      step_index: step.step_index,
      segment_id: step.segment_id,
      street_name: step.street_name,
      instruction: step.instruction,
      is_spur: step.is_spur,
      cumulative_m: step.cumulative_m,
      coordinates: step.coordinates,
    }));
    return {
      hasRoute: row.has_route,
      strandedCount: row.stranded_count,
      line: row.line,
      steps: fieldSteps,
    };
  } catch {
    return null;
  }
}
