import type { SupabaseClient } from "@supabase/supabase-js";

import { crmWindowBounds, parseCrmInsights, type CrmInsights, type CrmWindow } from "@/lib/admin/crm-insights";
import { parseCrmDoors, parseHeatCells, type CrmDoor, type HeatCell } from "@/lib/admin/crm-map";
import type { SyncRun } from "@/lib/crm/schedule";
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

/** CRM-6 C: `window` limits the squares to leads booked in it (Coverage's Days chip); none = all CRM history. */
export async function loadCrmHeat(supabase: SupabaseClient<Database>, window?: CrmWindow): Promise<Loaded<HeatCell[]>> {
  const { data, error } = await supabase.rpc("crm_heat_grid", window ? crmWindowBounds(window) : {});
  if (error) return { ok: false, message: "The CRM heat map didn't load.", detail: error.message };
  return { ok: true, data: parseHeatCells(data) };
}

/**
 * About 5,000 rows: PostgREST's 1,000-row cap applies to RPCs too, so read in pages.
 * CRM-6 C: `window` limits doors, counts and latest outcome to leads booked in it; none = all CRM history (Props).
 */
export async function loadCrmDoors(supabase: SupabaseClient<Database>, window?: CrmWindow): Promise<Loaded<CrmDoor[]>> {
  const bounds = window ? crmWindowBounds(window) : {};
  const PAGE = 1000;
  const out: CrmDoor[] = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await supabase.rpc("crm_door_history", bounds).order("uprn", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { ok: false, message: "CRM doors didn't load.", detail: error.message };
    const rows = parseCrmDoors(data);
    out.push(...rows);
    if ((data ?? []).length < PAGE) break;
  }
  return { ok: true, data: out };
}

/** CRM-4 A: the latest sync runs, for the "CRM updated 14:30" line. Admin and office can read them (032). */
export async function loadCrmSyncRuns(supabase: SupabaseClient<Database>): Promise<SyncRun[]> {
  const { data, error } = await supabase
    .from("crm_sync_runs")
    .select("started_at, finished_at, max_modified_seen, error")
    .order("started_at", { ascending: false })
    .limit(20);
  return error ? [] : (data ?? []);
}
