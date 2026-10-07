import type { SupabaseClient } from "@supabase/supabase-js";

import { latestLeadPerDoor, type LeadPin } from "@/lib/admin/props";
import type { Database } from "@/lib/supabase/types";

const PAGE = 1000;
/** A safety stop, far above a season of leads. */
const MAX_PAGES = 20;

/**
 * UI-10 F2b (owner A22). Lead pins for the Props map: one per door, coloured
 * by the office's status. Read with the admin's own session
 * (`leads_select_office_admin`). Only the door, the status and two
 * timestamps are selected: no notes, no CRM reference, nothing about the
 * resident. Admin never writes a lead status (office only).
 */
export async function loadLeadPins(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; pins: Map<number, LeadPin> } | { ok: false; message: string }> {
  const rows: { uprn: number; status: string; status_set_at: string | null; booked_for: string | null }[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from("leads")
      .select("uprn, status, status_set_at, booked_for")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, message: "Lead pins could not be loaded." };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return { ok: true, pins: latestLeadPerDoor(rows) };
}
