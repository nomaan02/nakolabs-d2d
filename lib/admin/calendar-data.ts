import type { SupabaseClient } from "@supabase/supabase-js";

import { gridSpan, type CalendarKnock, type CalendarLead, type CalendarVisit } from "@/lib/admin/calendar";
import { addDays, firstName } from "@/lib/admin/props";
import { readAll, TooManyRows } from "@/lib/admin/read-all";
import type { TeamMember } from "@/lib/admin/today";
import type { Slot } from "@/lib/geo/rotation";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F4b (owner A38-A46; no migration, owner 2026-10-08). One month of
 * Calendar, read on the server with the admin's own session (RLS:
 * assignments_all_admin, assignment_members_all_admin, profiles_select_admin,
 * knock_events_select_admin, the admin lead read; views are
 * security_invoker).
 *
 * Knocks are `v_latest_knock` rows (latest outcome per door per visit), read
 * through `admin_latest_knocks` (F6d, FU-1), for the grid's span plus a day either side (London days are worked out in
 * `buildCalendar`), read 1,000 at a time. Rows carry door ids and outcomes
 * only: no address, no note, no name.
 */

export type CalendarData =
  | {
      ok: true;
      knocks: CalendarKnock[];
      visits: CalendarVisit[];
      leads: CalendarLead[];
      /** Canvasser id → first name. */
      names: Record<string, string>;
    }
  | { ok: false; message: string; detail?: string };

function asSlot(value: string | null): Slot | null {
  return value === "early" || value === "mid" || value === "late" ? value : null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const VISIT_COLUMNS = "id, territory_id, visit_number, work_date, slot, started_at, closed_at";

export async function loadCalendarMonth(supabase: SupabaseClient<Database>, month: string): Promise<CalendarData> {
  if (!MONTH.test(month)) return { ok: false, message: "That month could not be read. Open Calendar again." };
  const span = gridSpan(month);
  const fromAt = `${addDays(span.from, -1)}T00:00:00Z`;
  const toAt = `${addDays(span.to, 2)}T00:00:00Z`;
  try {
    const [knockRows, planned, people] = await Promise.all([
      readAll((from, to) =>
        supabase
          .rpc("admin_latest_knocks", { p_from: fromAt, p_to: toAt })
          .order("assignment_id", { ascending: true })
          .order("uprn", { ascending: true })
          .range(from, to),
      ),
      supabase.from("assignments").select(VISIT_COLUMNS).gte("work_date", span.from).lte("work_date", span.to),
      supabase.from("profiles").select("id, full_name"),
    ]);
    if (planned.error) throw new Error(planned.error.message);
    if (people.error) throw new Error(people.error.message);

    // Offset paging while phones sync can return a row twice: one row per door per visit.
    const seen = new Set<string>();
    const knocks: CalendarKnock[] = [];
    for (const row of knockRows) {
      if (!row.assignment_id || row.uprn === null || !row.outcome || !row.canvasser_id || !row.occurred_at) continue;
      const key = `${row.assignment_id}|${row.uprn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      knocks.push({
        assignmentId: row.assignment_id,
        uprn: row.uprn,
        outcome: row.outcome,
        canvasserId: row.canvasser_id,
        occurredAt: row.occurred_at,
      });
    }

    const assignments = [...(planned.data ?? [])];
    const have = new Set(assignments.map((row) => row.id));
    const missing = [...new Set(knocks.map((knock) => knock.assignmentId))].filter((id) => !have.has(id));
    if (missing.length > 0) {
      const extra = await supabase.from("assignments").select(VISIT_COLUMNS).in("id", missing);
      if (extra.error) throw new Error(extra.error.message);
      assignments.push(...(extra.data ?? []));
    }

    const ids = assignments.map((row) => row.id);
    const propIds = [...new Set(assignments.map((row) => row.territory_id))];
    const none = { data: [], error: null };
    const [members, territories, completion, leadRows] = await Promise.all([
      ids.length > 0 ? supabase.from("assignment_members").select("assignment_id, canvasser_id, left_at").in("assignment_id", ids) : none,
      propIds.length > 0 ? supabase.from("territories").select("id, name").in("id", propIds) : none,
      ids.length > 0 ? supabase.from("v_prop_completion").select("assignment_id, remaining, worked").in("assignment_id", ids) : none,
      ids.length > 0
        ? supabase.from("leads").select("status, knock_events!inner(assignment_id, occurred_at)").in("knock_events.assignment_id", ids)
        : none,
    ]);
    if (members.error) throw new Error(members.error.message);
    if (territories.error) throw new Error(territories.error.message);
    if (completion.error) throw new Error(completion.error.message);
    if (leadRows.error) throw new Error(leadRows.error.message);

    const names: Record<string, string> = {};
    for (const row of people.data ?? []) names[row.id] = firstName(row.full_name);
    const propNames = new Map((territories.data ?? []).map((row) => [row.id, row.name] as const));
    const completionById = new Map((completion.data ?? []).map((row) => [row.assignment_id ?? "", row] as const));
    const teams = new Map<string, TeamMember[]>();
    for (const row of members.data ?? []) {
      const team = teams.get(row.assignment_id) ?? [];
      team.push({ id: row.canvasser_id, name: names[row.canvasser_id] ?? "Unnamed", left: row.left_at !== null });
      teams.set(row.assignment_id, team);
    }

    const visits: CalendarVisit[] = assignments.map((row) => {
      const done = completionById.get(row.id);
      const left = done?.remaining;
      return {
        id: row.id,
        propId: row.territory_id,
        propName: propNames.get(row.territory_id) ?? "Prop",
        visitNumber: row.visit_number,
        workDate: row.work_date,
        slot: asSlot(row.slot),
        startedAt: row.started_at,
        closedAt: row.closed_at,
        remaining: left === undefined || left === null ? null : Math.max(0, left),
        worked: done?.worked ?? null,
        team: teams.get(row.id) ?? [],
      };
    });

    const leads: CalendarLead[] = [];
    for (const row of leadRows.data ?? []) {
      const knock = Array.isArray(row.knock_events) ? row.knock_events[0] : row.knock_events;
      if (!knock?.assignment_id || !knock.occurred_at) continue;
      leads.push({ assignmentId: knock.assignment_id, occurredAt: knock.occurred_at, status: row.status });
    }

    return { ok: true, knocks, visits, leads, names };
  } catch (caught) {
    return {
      ok: false,
      message:
        caught instanceof TooManyRows
          ? "This month has too many knocks to show at once."
          : "Calendar didn't load. Check your signal, then try again.",
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
