/**
 * Stage 5b-R3 — read saved steps and hand them to the one route adapter.
 *
 * `territory_route_steps.walkline` and `route_steps.walk_geom` are the only
 * geometries selected. `centreline`, `geom` and `route_geom` are not read.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  emptyRouteModel,
  toRoutePaintModel,
  type RouteEndpointInput,
  type RoutePaintModel,
  type RouteStepInput,
} from "@/lib/map/route-layers";
import type { Database } from "@/lib/supabase/types";

export type LoadedRoute =
  | { ok: true; model: RoutePaintModel; variants: number; steps: number }
  | { ok: false; message: string };

const PAGE = 1000;

async function pages<T>(
  load: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[] } | { error: string }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) return { error: error.message };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows };
  }
}

/** Every saved variant of a prop, for the draw page after Save. */
export async function loadTerritoryRouteModel(
  supabase: SupabaseClient<Database>,
  territoryId: string,
): Promise<LoadedRoute> {
  const routes = await supabase
    .from("territory_routes")
    .select("id, variant_key, start_geom, end_geom")
    .eq("territory_id", territoryId);
  if (routes.error) return { ok: false, message: "The saved routes could not be read." };
  const routeRows = routes.data ?? [];
  if (routeRows.length === 0) return { ok: true, model: emptyRouteModel(), variants: 0, steps: 0 };

  const keyByRoute = new Map(routeRows.map((row) => [row.id, row.variant_key]));
  const loaded = await pages(async (from, to) => {
    const result = await supabase
      .from("territory_route_steps")
      .select("route_id, step_index, kind, walkline, street_name, first_seq, last_seq")
      .in("route_id", [...keyByRoute.keys()])
      .order("step_index", { ascending: true })
      .range(from, to);
    return { data: result.data, error: result.error };
  });
  if ("error" in loaded) return { ok: false, message: "The saved routes could not be read." };

  const steps: RouteStepInput[] = loaded.rows.flatMap((row) => {
    const variantKey = keyByRoute.get(row.route_id);
    if (!variantKey) return [];
    return [
      {
        step_index: row.step_index,
        kind: row.kind,
        walkline: row.walkline,
        variant_key: variantKey,
        street_name: row.street_name,
        first_seq: row.first_seq,
        last_seq: row.last_seq,
      },
    ];
  });
  const endpoints: RouteEndpointInput[] = routeRows.map((row) => ({
    variantKey: row.variant_key,
    start: row.start_geom,
    end: row.end_geom,
  }));
  const model = toRoutePaintModel({ steps, endpoints });
  return { ok: true, model, variants: routeRows.length, steps: model.steps.length };
}

/** The frozen copy on one assignment. `variantKey` is `assignments.route_variant_key`. */
export async function loadAssignmentRouteModel(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  variantKey: string,
): Promise<LoadedRoute> {
  const loaded = await pages(async (from, to) => {
    const result = await supabase
      .from("route_steps")
      .select("step_index, kind, walk_geom, street_name, first_seq, last_seq")
      .eq("assignment_id", assignmentId)
      .order("step_index", { ascending: true })
      .range(from, to);
    return { data: result.data, error: result.error };
  });
  if ("error" in loaded) return { ok: false, message: "The frozen route could not be read." };

  const steps: RouteStepInput[] = loaded.rows.map((row) => ({
    step_index: row.step_index,
    kind: row.kind,
    walk_geom: row.walk_geom,
    variant_key: variantKey,
    street_name: row.street_name,
    first_seq: row.first_seq,
    last_seq: row.last_seq,
  }));
  const model = toRoutePaintModel({ steps, variantKey });
  return { ok: true, model, variants: 1, steps: model.steps.length };
}
