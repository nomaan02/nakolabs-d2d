import type { SupabaseClient } from "@supabase/supabase-js";

import { crmWindowBounds, parseCrmInsights, type CrmInsights, type CrmWindow } from "@/lib/admin/crm-insights";
import { parseCrmDoors, parseHeatCells, type CrmDoor, type HeatCell } from "@/lib/admin/crm-map";
import type { Database } from "@/lib/supabase/types";

/**
 * CRM-2 B (owner 2026-10-10, P4a). Reads the three migration-034 functions
 * with the signed-in admin's own session (they refuse anyone but admin or
 * office). Takes the client as an argument so the Insights page (server) and
 * the Coverage and Props maps (browser) share one reader each.
 */

type Loaded<T> = { ok: true; data: T } | { ok: false; message: string; detail?: string };

export async function loadCrmInsights(supabase: SupabaseClient<Database>, window: CrmWindow): Promise<Loaded<CrmInsights>> {
  const { data, error } = await supabase.rpc("crm_insights", crmWindowBounds(window));
  if (error) return { ok: false, message: "The CRM figures didn't load. Try again in a moment.", detail: error.message };
  return { ok: true, data: parseCrmInsights(data) };
}

export async function loadCrmHeat(supabase: SupabaseClient<Database>): Promise<Loaded<HeatCell[]>> {
  const { data, error } = await supabase.rpc("crm_heat_grid", {});
  if (error) return { ok: false, message: "The CRM heat map didn't load.", detail: error.message };
  return { ok: true, data: parseHeatCells(data) };
}

/** About 5,000 rows: PostgREST's 1,000-row cap applies to RPCs too, so read in pages. */
export async function loadCrmDoors(supabase: SupabaseClient<Database>): Promise<Loaded<CrmDoor[]>> {
  const PAGE = 1000;
  const out: CrmDoor[] = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await supabase.rpc("crm_door_history").order("uprn", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { ok: false, message: "CRM doors didn't load.", detail: error.message };
    const rows = parseCrmDoors(data);
    out.push(...rows);
    if ((data ?? []).length < PAGE) break;
  }
  return { ok: true, data: out };
}
