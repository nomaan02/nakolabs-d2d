import type { SupabaseClient } from "@supabase/supabase-js";

import type { VisitStats } from "@/lib/admin/props";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F2b. Per-visit figures for prop detail (frame 05), read with the
 * admin's own session. Worked and remaining come from `v_prop_completion`
 * (one row per visit). Contacts, leads, rented and not-in are counted from
 * `v_latest_knock` (latest outcome per door per visit), as head-only counts,
 * so no door row ever leaves the database.
 *
 * Contacts are bookable answers only (`outcome = 'answered'`, owner
 * 2026-09-28), never the broad "answered" rule.
 */

type Outcome = "answered" | "lead" | "no_opportunity" | "no_answer";

export type VisitStatsResult = { ok: true; stats: Map<string, VisitStats> } | { ok: false; message: string };

async function countOutcome(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  outcome: Outcome,
): Promise<number> {
  const { count, error } = await supabase
    .from("v_latest_knock")
    .select("uprn", { count: "exact", head: true })
    .eq("assignment_id", assignmentId)
    .eq("outcome", outcome);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * `full` is the visit shown in the card (all four outcome counts); every
 * other visit only needs its leads for the history row.
 */
export async function loadVisitStats(
  supabase: SupabaseClient<Database>,
  propId: string,
  visitIds: string[],
  full: string | null,
): Promise<VisitStatsResult> {
  if (visitIds.length === 0) return { ok: true, stats: new Map() };
  try {
    const completion = await supabase
      .from("v_prop_completion")
      .select("assignment_id, worked, remaining")
      .eq("territory_id", propId);
    if (completion.error) throw new Error(completion.error.message);
    const byVisit = new Map((completion.data ?? []).map((row) => [row.assignment_id ?? "", row] as const));

    const entries = await Promise.all(
      visitIds.map(async (id) => {
        const wantsAll = id === full;
        const [leads, contacts, rented, notIn] = await Promise.all([
          countOutcome(supabase, id, "lead"),
          wantsAll ? countOutcome(supabase, id, "answered") : Promise.resolve(0),
          wantsAll ? countOutcome(supabase, id, "no_opportunity") : Promise.resolve(0),
          wantsAll ? countOutcome(supabase, id, "no_answer") : Promise.resolve(0),
        ]);
        const row = byVisit.get(id);
        const stats: VisitStats = {
          worked: row?.worked ?? 0,
          remaining: Math.max(0, row?.remaining ?? 0),
          contacts,
          leads,
          rented,
          notIn,
        };
        return [id, stats] as const;
      }),
    );
    return { ok: true, stats: new Map(entries) };
  } catch {
    return { ok: false, message: "Visit figures could not be loaded. Check your connection, then open the prop again." };
  }
}
