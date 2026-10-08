import type { SupabaseClient } from "@supabase/supabase-js";

import { parsePropGeometry } from "@/lib/admin/map-fit";
import { firstName } from "@/lib/admin/props";
import { NO_FIGURES, type Canvasser, type TodayVisit, type VisitFigures } from "@/lib/admin/today";
import type { Slot } from "@/lib/geo/rotation";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F3b (owner A17, A26, A27; no migration). Everything Today shows,
 * read on the server with the admin's own session (RLS: assignments_all_admin,
 * assignment_members_all_admin, territories_select_active,
 * profiles_select_admin, knock_events_select_admin; the views are
 * security_invoker).
 *
 * Visits: every open visit (past, today, later) plus today's closed ones.
 * Figures: only for visits that can have knocks (today's, and open past ones
 * for the review). Counts are head-only (`count: exact, head: true`), so no
 * knock or door row leaves the database. Contacts = bookable answers only.
 */

export type TodayProp = { id: string; name: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null };

export type TodayData =
  | {
      ok: true;
      visits: TodayVisit[];
      /** Keyed by visit id. Visits without an entry have no knocks yet. */
      figures: Record<string, VisitFigures>;
      props: Record<string, TodayProp>;
      canvassers: Canvasser[];
    }
  | { ok: false; message: string; detail?: string };

function asSlot(value: string | null): Slot | null {
  return value === "early" || value === "mid" || value === "late" ? value : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function headCount(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function figuresFor(
  supabase: SupabaseClient<Database>,
  visitIds: string[],
  fullIds: ReadonlySet<string>,
): Promise<Record<string, VisitFigures>> {
  if (visitIds.length === 0) return {};
  const completion = await supabase
    .from("v_prop_completion")
    .select("assignment_id, worked, remaining, answered")
    .in("assignment_id", visitIds);
  if (completion.error) throw new Error(completion.error.message);
  const byVisit = new Map((completion.data ?? []).map((row) => [row.assignment_id ?? "", row] as const));

  const outcome = (id: string, value: string) =>
    headCount(
      supabase.from("v_latest_knock").select("uprn", { count: "exact", head: true }).eq("assignment_id", id).eq("outcome", value),
    );

  const entries = await Promise.all(
    visitIds.map(async (id) => {
      const full = fullIds.has(id);
      const [knocks, contacts, leads, rented, notIn, last] = await Promise.all([
        headCount(supabase.from("knock_events").select("id", { count: "exact", head: true }).eq("assignment_id", id)),
        full ? outcome(id, "answered") : Promise.resolve(0),
        full ? outcome(id, "lead") : Promise.resolve(0),
        full ? outcome(id, "no_opportunity") : Promise.resolve(0),
        full ? outcome(id, "no_answer") : Promise.resolve(0),
        full
          ? supabase
              .from("knock_events")
              .select("occurred_at")
              .eq("assignment_id", id)
              .order("occurred_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (last.error) throw new Error(last.error.message);
      const row = byVisit.get(id);
      const figures: VisitFigures = {
        ...NO_FIGURES,
        worked: row?.worked ?? 0,
        remaining: Math.max(0, row?.remaining ?? 0),
        answered: row?.answered ?? 0,
        knocks,
        contacts,
        leads,
        rented,
        notIn,
        lastKnockAt: last.data?.occurred_at ?? null,
      };
      return [id, figures] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function loadToday(supabase: SupabaseClient<Database>, today: string): Promise<TodayData> {
  if (!DATE.test(today)) return { ok: false, message: "Today could not be worked out. Reload the page." };
  try {
    const [assignments, people] = await Promise.all([
      supabase
        .from("assignments")
        .select("id, territory_id, visit_number, work_date, slot, started_at, closed_at, route_variant_key, route_length_m")
        .or(`closed_at.is.null,work_date.eq.${today}`)
        .order("work_date", { ascending: true }),
      supabase.from("profiles").select("id, full_name, role, active"),
    ]);
    if (assignments.error) throw new Error(assignments.error.message);
    if (people.error) throw new Error(people.error.message);

    const rows = assignments.data ?? [];
    const ids = rows.map((row) => row.id);
    const propIds = [...new Set(rows.map((row) => row.territory_id))];
    const [members, territories] = await Promise.all([
      ids.length > 0
        ? supabase.from("assignment_members").select("assignment_id, canvasser_id, left_at").in("assignment_id", ids)
        : Promise.resolve({ data: [], error: null }),
      propIds.length > 0
        ? supabase.from("territories").select("id, name, geom").in("id", propIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (members.error) throw new Error(members.error.message);
    if (territories.error) throw new Error(territories.error.message);

    const names = new Map((people.data ?? []).map((row) => [row.id, firstName(row.full_name)] as const));
    const props: Record<string, TodayProp> = {};
    for (const row of territories.data ?? []) {
      props[row.id] = { id: row.id, name: row.name, geometry: parsePropGeometry(row.geom) };
    }
    const teams = new Map<string, TodayVisit["team"]>();
    for (const row of members.data ?? []) {
      const team = teams.get(row.assignment_id) ?? [];
      team.push({ id: row.canvasser_id, name: names.get(row.canvasser_id) ?? "Unnamed", left: row.left_at !== null });
      teams.set(row.assignment_id, team);
    }

    const visits: TodayVisit[] = rows.map((row) => ({
      id: row.id,
      propId: row.territory_id,
      propName: props[row.territory_id]?.name ?? "Prop",
      visitNumber: row.visit_number,
      workDate: row.work_date,
      slot: asSlot(row.slot),
      startedAt: row.started_at,
      closedAt: row.closed_at,
      routeVariantKey: row.route_variant_key,
      routeLengthM: row.route_length_m === null ? null : Number(row.route_length_m),
      team: teams.get(row.id) ?? [],
    }));

    // Figures only where knocks can exist: today's visits (in full) and open past ones (knock count for the review).
    const todays = new Set(visits.filter((visit) => visit.workDate === today).map((visit) => visit.id));
    const withKnocks = visits.filter((visit) => visit.workDate <= today).map((visit) => visit.id);
    const figures = await figuresFor(supabase, withKnocks, todays);

    const canvassers: Canvasser[] = (people.data ?? [])
      .filter((row) => row.role === "canvasser" && row.active)
      .map((row) => ({ id: row.id, name: firstName(row.full_name) }));

    return { ok: true, visits, figures, props, canvassers };
  } catch (caught) {
    return {
      ok: false,
      message: "Today didn't load. Check your signal, then try again.",
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
