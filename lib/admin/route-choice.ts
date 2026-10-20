/**
 * RT-START P1 (owner 2026-10-19; Figma S1-S3, section 239:5199). The admin's
 * side of choosing a visit's route: the prop's saved routes as options
 * (Add visit, before the visit exists), and the words on the Route rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { startStreet, type RouteSummary } from "@/lib/admin/draw-copy";
import { defaultRouteKey, routeRank, type RouteOption } from "@/lib/geo/walk/route-options";
import { loadTerritoryRouteModel } from "@/lib/map/route-load";
import type { RoutePaintModel } from "@/lib/map/route-layers";
import type { Database } from "@/lib/supabase/types";

export type PropRouteChoice = {
  /** Every saved route, in route order. Empty when the prop has none yet (they are made on allocate). */
  options: RouteOption[];
  /** What the visit gets if nobody picks: by turns, a finished drawn route first. */
  defaultKey: string;
  model: RoutePaintModel;
};

export type PropRouteChoiceResult = { ok: true; choice: PropRouteChoice } | { ok: false; message: string };

/** The saved routes as options. Before allocation every one is offered; the freeze refuses a misfit. */
export function optionsFromSummaries(summaries: readonly RouteSummary[]): RouteOption[] {
  return summaries
    .map((summary) => ({
      key: summary.key,
      totalM: Number(summary.total_m),
      hand: summary.hand,
      start: null,
      startStreet: startStreet(summary),
      usable: true,
    }))
    .sort((a, b) => routeRank(a.key) - routeRank(b.key));
}

/** Add visit: the prop's saved routes and the default for its next visit. Admin session. */
export async function loadPropRouteChoice(
  supabase: SupabaseClient<Database>,
  territoryId: string,
  visitNumber: number,
): Promise<PropRouteChoiceResult> {
  const [loaded, prop, drawn] = await Promise.all([
    loadTerritoryRouteModel(supabase, territoryId),
    supabase.from("territories").select("route_mode").eq("id", territoryId).maybeSingle(),
    supabase.from("territory_manual_routes").select("status").eq("territory_id", territoryId).maybeSingle(),
  ]);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  const options = optionsFromSummaries(loaded.summaries);
  const drawnReady =
    prop.data?.route_mode === "manual" && drawn.data?.status === "ready" && options.some((option) => option.key === "manual");
  return { ok: true, choice: { options, defaultKey: defaultRouteKey(visitNumber, drawnReady), model: loaded.model } };
}
