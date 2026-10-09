import type { SupabaseClient } from "@supabase/supabase-js";

import { leadsInWindow, type LeadItem } from "@/lib/admin/leads";
import { loadDoorLabels, loadPeople, loadPropNames } from "@/lib/admin/lookups";
import { readAll, TooManyRows } from "@/lib/admin/read-all";
import { queryBounds, type PeriodWindow } from "@/lib/admin/team";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F5b (frame 21; owner 2026-10-09: period chips). Leads for a
 * period, read on the server with the admin's own session
 * (leads_select_office_admin). Selected: the door, the status, who logged
 * it and its knock's time and visit. Never the notes, the booking slot or
 * the CRM reference; never a resident. Read-only: admin has no lead write.
 */

export type LeadsData = { ok: true; items: LeadItem[] } | { ok: false; message: string; detail?: string };

type Row = {
  id: string;
  uprn: number;
  status: string;
  canvasser_id: string;
  knock_events: { occurred_at: string; assignment_id: string } | { occurred_at: string; assignment_id: string }[] | null;
};

export async function loadLeads(supabase: SupabaseClient<Database>, window: PeriodWindow): Promise<LeadsData> {
  const { fromAt, toAt } = queryBounds(window);
  try {
    const [rows, people] = await Promise.all([
      readAll<Row>((from, to) => {
        let query = supabase
          .from("leads")
          .select("id, uprn, status, canvasser_id, knock_events!inner(occurred_at, assignment_id)")
          .lt("knock_events.occurred_at", toAt);
        if (fromAt) query = query.gte("knock_events.occurred_at", fromAt);
        return query.order("id", { ascending: true }).range(from, to);
      }),
      loadPeople(supabase),
    ]);

    const seen = new Set<string>();
    const base: Array<{ id: string; uprn: number; status: string; canvasserId: string; occurredAt: string; assignmentId: string }> = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const knock = Array.isArray(row.knock_events) ? row.knock_events[0] : row.knock_events;
      if (!knock?.occurred_at || !knock.assignment_id) continue;
      base.push({ id: row.id, uprn: row.uprn, status: row.status, canvasserId: row.canvasser_id, occurredAt: knock.occurred_at, assignmentId: knock.assignment_id });
    }
    const inPeriod = leadsInWindow(base, window);

    const [props, doors] = await Promise.all([
      loadPropNames(supabase, inPeriod.map((item) => item.assignmentId)),
      loadDoorLabels(supabase, inPeriod.map((item) => item.uprn)),
    ]);
    const names = new Map(people.map((person) => [person.id, person.name] as const));

    const items: LeadItem[] = inPeriod.map((item) => ({
      id: item.id,
      uprn: item.uprn,
      door: doors.get(item.uprn) ?? null,
      propName: props.get(item.assignmentId) ?? "Prop",
      canvasser: names.get(item.canvasserId) ?? "Unnamed",
      occurredAt: item.occurredAt,
      status: item.status,
    }));
    return { ok: true, items };
  } catch (caught) {
    return {
      ok: false,
      message: caught instanceof TooManyRows ? "There are too many leads to show at once. Pick a shorter period." : "Leads didn't load. Check your signal, then try again.",
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
