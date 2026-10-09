import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAdminDashboard, type DashboardPayload } from "@/lib/admin/dashboard";
import { readAll } from "@/lib/admin/read-all";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F5b (owner A48; no migration). Insights reads the existing
 * `admin_dashboard` RPC (unchanged) and every lead's office status, so the
 * lead chart shows all eight statuses (the RPC returns five). Admin's own
 * session; statuses only, nothing about the door or the resident.
 */

/** Props not visited in this many weeks are listed (the old dashboard's default). */
export const STALE_WEEKS = 4;

export type InsightsData =
  | { ok: true; payload: DashboardPayload; leadStatuses: string[] }
  | { ok: false; message: string; detail?: string };

export async function loadInsights(supabase: SupabaseClient<Database>): Promise<InsightsData> {
  try {
    const [dashboard, statuses] = await Promise.all([
      fetchAdminDashboard(supabase, STALE_WEEKS),
      readAll((from, to) => supabase.from("leads").select("id, status").order("id", { ascending: true }).range(from, to)),
    ]);
    if (!dashboard.ok) return { ok: false, message: "Insights didn't load. Check your signal, then try again.", detail: dashboard.detail ?? dashboard.message };
    const seen = new Set<string>();
    const leadStatuses: string[] = [];
    for (const row of statuses) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      leadStatuses.push(row.status);
    }
    return { ok: true, payload: dashboard.payload, leadStatuses };
  } catch (caught) {
    return {
      ok: false,
      message: "Insights didn't load. Check your signal, then try again.",
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
