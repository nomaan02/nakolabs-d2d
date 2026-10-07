import type { SupabaseClient } from "@supabase/supabase-js";

import { outerRing, parsePropGeometry } from "@/lib/admin/map-fit";
import { firstName, type PropRow, type PropVisit } from "@/lib/admin/props";
import { countKnockable } from "@/lib/geo/count-knockable";
import type { Slot } from "@/lib/geo/rotation";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F2b. Everything the Props page lists, read once on the server with
 * the admin's own session (RLS: territories, assignments_all_admin,
 * assignment_members_all_admin, profiles_select_admin). Canvasser first
 * names only; nothing about residents.
 */
export type PropsData = { ok: true; rows: PropRow[] } | { ok: false; message: string; detail?: string };

function asSlot(value: string | null): Slot | null {
  return value === "early" || value === "mid" || value === "late" ? value : null;
}

export async function loadPropRows(supabase: SupabaseClient<Database>): Promise<PropsData> {
  const [territories, assignments, members, people] = await Promise.all([
    supabase.from("territories").select("id, name, geom, archived_at, created_at").order("created_at", { ascending: false }),
    supabase
      .from("assignments")
      .select("id, territory_id, visit_number, work_date, slot, started_at, closed_at, counts_for_rotation, route_variant_key")
      .order("work_date", { ascending: true })
      .order("visit_number", { ascending: true }),
    supabase.from("assignment_members").select("assignment_id, canvasser_id"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const failed = territories.error ?? assignments.error ?? members.error ?? people.error;
  if (failed) {
    return { ok: false, message: "Props could not be loaded. Check your connection and try again.", detail: failed.message };
  }

  const names = new Map((people.data ?? []).map((row) => [row.id, firstName(row.full_name)] as const));
  const teams = new Map<string, string[]>();
  for (const row of members.data ?? []) {
    const team = teams.get(row.assignment_id) ?? [];
    team.push(names.get(row.canvasser_id) ?? "Unnamed");
    teams.set(row.assignment_id, team);
  }
  const visits = new Map<string, PropVisit[]>();
  for (const row of assignments.data ?? []) {
    const list = visits.get(row.territory_id) ?? [];
    list.push({
      id: row.id,
      visitNumber: row.visit_number,
      workDate: row.work_date,
      slot: asSlot(row.slot),
      startedAt: row.started_at,
      closedAt: row.closed_at,
      countsForRotation: row.counts_for_rotation,
      routeVariantKey: row.route_variant_key,
      team: teams.get(row.id) ?? [],
    });
    visits.set(row.territory_id, list);
  }

  return {
    ok: true,
    rows: (territories.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      archivedAt: row.archived_at,
      geometry: parsePropGeometry(row.geom),
      visits: visits.get(row.id) ?? [],
    })),
  };
}

/**
 * Doors in each live prop's current shape (`count_door_eligibility`, one
 * call per prop, in parallel). Not awaited by the page: the list renders
 * first and the counts stream in. A prop whose count fails just shows none.
 */
export async function loadDoorCounts(
  supabase: SupabaseClient<Database>,
  rows: PropRow[],
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    rows
      .filter((row) => !row.archivedAt)
      .map(async (row) => {
        const ring = outerRing(row.geometry);
        if (!ring) return null;
        try {
          const counted = await countKnockable(supabase, ring);
          return counted.ok ? ([row.id, counted.count.knockable] as const) : null;
        } catch {
          // Never reject: the page has already rendered and only the count is missing.
          return null;
        }
      }),
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => entry !== null));
}
