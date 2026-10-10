import type { SupabaseClient } from "@supabase/supabase-js";

import type { CalendarKnock } from "@/lib/admin/calendar";
import { dedupeKnocks, loadPeople } from "@/lib/admin/lookups";
import { firstName } from "@/lib/admin/props";
import { readAll, TooManyRows } from "@/lib/admin/read-all";
import { queryBounds, type PeriodWindow, type TeamLead, type TeamPerson } from "@/lib/admin/team";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F5b (owner A9, A34; no migration, owner 2026-10-09). Team and the
 * canvasser profile, read on the server with the admin's own session (RLS:
 * profiles_select_admin, knock_events_select_admin,
 * leads_select_office_admin; views are security_invoker).
 *
 * Knocks are `v_latest_knock` rows (latest outcome per door per visit),
 * read through `admin_latest_knocks` (F6d, FU-1) 1,000 at a time, a day wider than the period each side (London days are
 * worked out in `lib/admin/team.ts`). Leads carry their status and their
 * knock's time and visit only: no notes, no CRM reference. Nothing here is
 * sent to the browser as rows; the pages reduce it first.
 */

export type TeamData =
  | { ok: true; people: TeamPerson[]; knocks: CalendarKnock[]; leads: TeamLead[] }
  | { ok: false; message: string; detail?: string };

const LEAD_COLUMNS = "id, uprn, status, canvasser_id, knock_events!inner(occurred_at, assignment_id)";

type LeadRow = {
  id: string;
  uprn: number;
  status: string;
  canvasser_id: string;
  knock_events: { occurred_at: string; assignment_id: string } | { occurred_at: string; assignment_id: string }[] | null;
};

function toLeads(rows: LeadRow[]): TeamLead[] {
  const seen = new Set<string>();
  const leads: TeamLead[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const knock = Array.isArray(row.knock_events) ? row.knock_events[0] : row.knock_events;
    if (!knock?.occurred_at || !knock.assignment_id) continue;
    leads.push({ id: row.id, canvasserId: row.canvasser_id, occurredAt: knock.occurred_at, status: row.status, uprn: row.uprn, assignmentId: knock.assignment_id });
  }
  return leads;
}

function failed(caught: unknown, what: string): { ok: false; message: string; detail?: string } {
  return {
    ok: false,
    message: caught instanceof TooManyRows ? `${what} has too many knocks to show at once. Pick a shorter period.` : `${what} didn't load. Check your signal, then try again.`,
    detail: caught instanceof Error ? caught.message : String(caught),
  };
}

function toPeople(rows: Awaited<ReturnType<typeof loadPeople>>): TeamPerson[] {
  return rows.map((row) => ({ id: row.id, name: row.name, active: row.active, canvasser: row.role === "canvasser" }));
}

/** Every knock and lead in the period, and everyone who could be on the list. */
export async function loadTeam(supabase: SupabaseClient<Database>, window: PeriodWindow): Promise<TeamData> {
  const { fromAt, toAt } = queryBounds(window);
  try {
    const [people, knockRows, leadRows] = await Promise.all([
      loadPeople(supabase),
      readAll((from, to) =>
        supabase
          .rpc("admin_latest_knocks", { p_from: fromAt ?? undefined, p_to: toAt })
          .order("assignment_id", { ascending: true })
          .order("uprn", { ascending: true })
          .range(from, to),
      ),
      readAll<LeadRow>((from, to) => {
        let query = supabase.from("leads").select(LEAD_COLUMNS).lt("knock_events.occurred_at", toAt);
        if (fromAt) query = query.gte("knock_events.occurred_at", fromAt);
        return query.order("id", { ascending: true }).range(from, to);
      }),
    ]);
    return { ok: true, people: toPeople(people), knocks: dedupeKnocks(knockRows), leads: toLeads(leadRows) };
  } catch (caught) {
    return failed(caught, "Team");
  }
}

export type CanvasserData =
  | { ok: true; person: TeamPerson; knocks: CalendarKnock[]; leads: TeamLead[] }
  | { ok: false; missing: true }
  | { ok: false; missing?: false; message: string; detail?: string };

/** One person's every knock and lead (all time: the profile compares the period with all time). */
export async function loadCanvasser(supabase: SupabaseClient<Database>, id: string): Promise<CanvasserData> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, missing: true };
  try {
    const { data: profile, error } = await supabase.from("profiles").select("id, full_name, role, active").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile) return { ok: false, missing: true };
    const [knockRows, leadRows] = await Promise.all([
      readAll((from, to) =>
        supabase
          .rpc("admin_latest_knocks", { p_canvasser_id: id })
          .order("assignment_id", { ascending: true })
          .order("uprn", { ascending: true })
          .range(from, to),
      ),
      readAll<LeadRow>((from, to) => supabase.from("leads").select(LEAD_COLUMNS).eq("canvasser_id", id).order("id", { ascending: true }).range(from, to)),
    ]);
    const [person] = toPeople([{ id: profile.id, name: firstName(profile.full_name), role: profile.role, active: profile.active }]);
    return { ok: true, person: person!, knocks: dedupeKnocks(knockRows), leads: toLeads(leadRows) };
  } catch (caught) {
    return failed(caught, "This profile");
  }
}
