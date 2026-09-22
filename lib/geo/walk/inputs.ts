/**
 * Stage 5b (R1) — inputs for the walking-pattern generator.
 *
 * `route_walk_inputs(territory)` (migration 019) returns the prop ring and
 * centroid, every road segment within 250 m of the polygon, their nodes and
 * every knockable door. Validation and id-sorting reuse `parseRouteInputs`
 * from 5b-a: it checks exactly these arrays under the same field names. The
 * assignment header it also expects has no meaning here and is filled with
 * fixed placeholders — a walk belongs to a prop, not an assignment.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { parseRouteInputs, type RouteInputs } from "@/lib/geo/route-graph";

export type WalkInputs = {
  territoryId: string;
  name: string;
  bufferM: number;
  /** Ring, centroid, nodes, segments and doors — sorted on id / uprn. */
  route: RouteInputs;
};

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWalkInputs(raw: unknown): WalkInputs {
  if (!isRecord(raw)) throw new Error("walk inputs: document is not an object");
  const doors = Array.isArray(raw.doors) ? raw.doors : [];
  const route = parseRouteInputs({
    ...raw,
    // Placeholder header. Only ring, centroid, nodes, segments, doors are used.
    assignment_id: "",
    territory_id: raw.territory_id ?? "",
    visit_number: 0,
    entry_vertex_index: 0,
    sweep_direction: "cw",
    knock_count: 0,
    has_route: false,
    snapshot_count: doors.length,
  });
  const bufferRaw = raw.buffer_m;
  const bufferM = typeof bufferRaw === "number" ? bufferRaw : Number(bufferRaw ?? 250);
  return {
    territoryId: String(raw.territory_id ?? ""),
    name: typeof raw.name === "string" ? raw.name : "",
    bufferM: Number.isFinite(bufferM) ? bufferM : 250,
    route,
  };
}

export type FetchWalkInputsResult =
  | { ok: true; inputs: WalkInputs; raw: unknown }
  | { ok: false; code: "not_admin" | "missing_territory" | "unavailable"; message: string; detail?: string };

function describe(error: PostgrestError): string {
  return [error.code, error.hint, error.message, error.details].filter(Boolean).join(" | ");
}

/** The read. Runs under the caller's own session; RLS and the admin check apply. */
export async function fetchWalkInputs(
  supabase: SupabaseClient<Database>,
  territoryId: string,
): Promise<FetchWalkInputsResult> {
  const { data, error } = await supabase.rpc("route_walk_inputs", { p_territory_id: territoryId });
  if (error) {
    if (error.hint === "not_admin" || error.code === "42501") {
      return { ok: false, code: "not_admin", message: "Only an admin can generate a route.", detail: describe(error) };
    }
    return { ok: false, code: "unavailable", message: "The road network could not be read.", detail: describe(error) };
  }
  if (data === null || data === undefined) {
    return { ok: false, code: "missing_territory", message: "That prop could not be found." };
  }
  try {
    return { ok: true, inputs: parseWalkInputs(data), raw: data };
  } catch (err) {
    return {
      ok: false,
      code: "unavailable",
      message: "The road network could not be read.",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
