import type { SupabaseClient } from "@supabase/supabase-js";

import type { CalendarKnock } from "@/lib/admin/calendar";
import { firstName } from "@/lib/admin/props";
import { doorLabelLine } from "@/lib/admin/today";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F5b. Small server-side lookups shared by Team, the canvasser
 * profile and Leads, read with the admin's own session. `.in()` lists are
 * sent 100 ids at a time (a longer list overflows the request URL).
 * Doors are address labels from `v_door_label` (property-level only, never
 * a resident); people are first names only.
 */
export const IN_CHUNK = 100;

export function chunked<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Offset paging while phones sync can return a row twice: one row per door per visit. */
export function dedupeKnocks(
  rows: ReadonlyArray<{ assignment_id: string | null; uprn: number | null; outcome: string | null; canvasser_id: string | null; occurred_at: string | null }>,
): CalendarKnock[] {
  const seen = new Set<string>();
  const knocks: CalendarKnock[] = [];
  for (const row of rows) {
    if (!row.assignment_id || row.uprn === null || !row.outcome || !row.canvasser_id || !row.occurred_at) continue;
    const key = `${row.assignment_id}|${row.uprn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    knocks.push({ assignmentId: row.assignment_id, uprn: row.uprn, outcome: row.outcome, canvasserId: row.canvasser_id, occurredAt: row.occurred_at });
  }
  return knocks;
}

/** Visit id → its prop's name. */
export async function loadPropNames(supabase: SupabaseClient<Database>, assignmentIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(assignmentIds)];
  const propOfVisit = new Map<string, string>();
  for (const part of chunked(ids)) {
    const { data, error } = await supabase.from("assignments").select("id, territory_id").in("id", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) propOfVisit.set(row.id, row.territory_id);
  }
  const names = new Map<string, string>();
  for (const part of chunked([...new Set(propOfVisit.values())])) {
    const { data, error } = await supabase.from("territories").select("id, name").in("id", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) names.set(row.id, row.name);
  }
  const out = new Map<string, string>();
  for (const [visitId, propId] of propOfVisit) out.set(visitId, names.get(propId) ?? "Prop");
  return out;
}

/** UPRN → "41 Bishport Avenue"; doors with no label are left out. */
export async function loadDoorLabels(supabase: SupabaseClient<Database>, uprns: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const part of chunked([...new Set(uprns)])) {
    const { data, error } = await supabase.from("v_door_label").select("uprn, house_number, building_name, street_name").in("uprn", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const line = doorLabelLine(row);
      if (row.uprn !== null && line) out.set(row.uprn, line);
    }
  }
  return out;
}

export type PersonRow = { id: string; name: string; role: string; active: boolean };

/** Every profile with its first name (RLS: profiles_select_admin). */
export async function loadPeople(supabase: SupabaseClient<Database>): Promise<PersonRow[]> {
  const { data, error } = await supabase.from("profiles").select("id, full_name, role, active");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, name: firstName(row.full_name), role: row.role, active: row.active }));
}
