/**
 * RT (owner 2026-10-13) — reading and saving a prop's manual route.
 *
 *   read   territories.route_mode + territory_manual_routes   (040, RLS: admin)
 *   write  territory_manual_route_save(territory, chain, left_out, variants)
 *          territory_route_mode_set(territory, mode)
 *
 * Runs under the ADMIN'S OWN SESSION. Never the service role. Nothing here
 * freezes a visit: the caller re-freezes unworked visits afterwards.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { WalkVariant } from "@/lib/geo/walk/types";
import { variantForStorage } from "@/lib/geo/walk/save";

export type RouteMode = "auto" | "manual";
export type ManualStatus = "ready" | "needs_finishing";

export type ManualRouteRecord = {
  routeMode: RouteMode;
  /** Null when the prop has never had a drawn route. */
  drawing: { chain: number[]; leftOut: number[]; status: ManualStatus; updatedAt: string } | null;
};

export type ManualSaveFailureCode =
  | "not_admin"
  | "missing_territory"
  | "no_doors"
  | "too_short"
  | "unknown_door"
  | "no_manual_route"
  | "save_rejected"
  | "unavailable";

export type ManualFailure = { ok: false; code: ManualSaveFailureCode; message: string; detail?: string };

export type ManualSaveSummary = {
  territoryId: string;
  status: ManualStatus;
  doors: number;
  leftOut: number;
  newDoors: number;
  steps: number;
};

export type ManualSaveResult = { ok: true; summary: ManualSaveSummary } | ManualFailure;
export type ManualLoadResult = { ok: true; record: ManualRouteRecord } | ManualFailure;
export type RouteModeResult = { ok: true; mode: RouteMode; manualStatus: ManualStatus | null } | ManualFailure;

const SERVER_HINTS: Record<string, ManualSaveFailureCode> = {
  not_admin: "not_admin",
  missing_territory: "missing_territory",
  no_doors: "no_doors",
  no_length: "too_short",
  unknown_door: "unknown_door",
  no_manual_route: "no_manual_route",
  duplicate_uprn: "save_rejected",
  bad_chain: "save_rejected",
  bad_variant: "save_rejected",
  bad_steps: "save_rejected",
  bad_stranded_count: "save_rejected",
  bad_mode: "save_rejected",
};

function describe(error: PostgrestError): string {
  return [error.code, error.hint, error.message, error.details].filter(Boolean).join(" | ");
}

function mapRpcError(error: PostgrestError, fallback: string): ManualFailure {
  const code = SERVER_HINTS[error.hint ?? ""];
  if (code) return { ok: false, code, message: error.message, detail: error.details ?? undefined };
  if (error.code === "42501") return { ok: false, code: "not_admin", message: "Only an admin can change a prop's routes.", detail: error.message };
  return { ok: false, code: "unavailable", message: fallback, detail: describe(error) };
}

function thrown(err: unknown, message: string): ManualFailure {
  return { ok: false, code: "unavailable", message, detail: err instanceof Error ? err.message : String(err) };
}

function asNumbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asStatus(value: unknown): ManualStatus {
  return value === "ready" ? "ready" : "needs_finishing";
}

/** The prop's route mode and its drawing, if any. Never throws. */
export async function loadManualRoute(supabase: SupabaseClient<Database>, territoryId: string): Promise<ManualLoadResult> {
  try {
    const [prop, drawing] = await Promise.all([
      supabase.from("territories").select("route_mode").eq("id", territoryId).maybeSingle(),
      supabase.from("territory_manual_routes").select("chain, left_out, status, updated_at").eq("territory_id", territoryId).maybeSingle(),
    ]);
    if (prop.error) return mapRpcError(prop.error, "The prop's routes could not be read.");
    if (!prop.data) return { ok: false, code: "missing_territory", message: "That prop could not be found." };
    if (drawing.error) return mapRpcError(drawing.error, "The drawn route could not be read.");
    return {
      ok: true,
      record: {
        routeMode: prop.data.route_mode === "manual" ? "manual" : "auto",
        drawing: drawing.data
          ? {
              chain: asNumbers(drawing.data.chain),
              leftOut: asNumbers(drawing.data.left_out),
              status: asStatus(drawing.data.status),
              updatedAt: drawing.data.updated_at,
            }
          : null,
      },
    };
  } catch (err) {
    return thrown(err, "The prop's routes could not be read.");
  }
}

/**
 * Saves the drawing and its two variants in one call, and makes the drawn
 * route the one visits use. Never throws.
 */
export async function saveManualRoute(
  supabase: SupabaseClient<Database>,
  territoryId: string,
  chain: readonly number[],
  leftOut: readonly number[],
  variants: { manual: WalkVariant; reversed: WalkVariant },
): Promise<ManualSaveResult> {
  try {
    const { data, error } = await supabase.rpc("territory_manual_route_save", {
      p_territory_id: territoryId,
      p_chain: [...chain],
      p_left_out: [...leftOut],
      p_variants: [variantForStorage(variants.manual), variantForStorage(variants.reversed)],
    });
    if (error) return mapRpcError(error, "The route could not be saved.");
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      summary: {
        territoryId,
        status: asStatus(row.status),
        doors: asNumber(row.doors),
        leftOut: asNumber(row.left_out),
        newDoors: asNumber(row.new_doors),
        steps: asNumber(row.steps),
      },
    };
  } catch (err) {
    return thrown(err, "The route could not be saved.");
  }
}

/** Switches the prop between automatic routes and the drawn route. Never throws. */
export async function setRouteMode(supabase: SupabaseClient<Database>, territoryId: string, mode: RouteMode): Promise<RouteModeResult> {
  try {
    const { data, error } = await supabase.rpc("territory_route_mode_set", { p_territory_id: territoryId, p_mode: mode });
    if (error) return mapRpcError(error, "The prop's routes could not be changed.");
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      mode: row.route_mode === "manual" ? "manual" : "auto",
      manualStatus: row.manual_status === "ready" || row.manual_status === "needs_finishing" ? row.manual_status : null,
    };
  } catch (err) {
    return thrown(err, "The prop's routes could not be changed.");
  }
}
