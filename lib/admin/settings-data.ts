import type { SupabaseClient } from "@supabase/supabase-js";

import { firstName } from "@/lib/admin/props";
import { latestOf, parseLoggingDefault, sortAccounts, type CanvasserAccount, type DataStatus, type LoggingDefault } from "@/lib/admin/settings";
import { parseVisitThreshold } from "@/lib/geo/reallocation";
import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F5b (owner A35; frame 23). Everything Settings shows, read on the
 * server with the admin's own session: the rotation setting, the logging
 * default, canvasser accounts (first names, active, planned visits) and
 * data status (counts and dates only).
 */

export type SettingsData = {
  thresholdPct: number;
  /** False when nothing valid is stored and removals use the 50% default. */
  thresholdStored: boolean;
  loggingDefault: LoggingDefault;
  accounts: CanvasserAccount[];
  data: DataStatus;
  /** Sections that could not be read; the page says so in place. */
  failed: Array<"accounts" | "data">;
};

export async function loadSettings(supabase: SupabaseClient<Database>, today: string): Promise<SettingsData> {
  const failed: SettingsData["failed"] = [];

  const [rotation, logging, accounts, data] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", "rotation").maybeSingle(),
    supabase.rpc("logging_default"),
    loadAccounts(supabase, today).catch(() => {
      failed.push("accounts");
      return [] as CanvasserAccount[];
    }),
    loadDataStatus(supabase).catch(() => {
      failed.push("data");
      return { ncczZones: 0, properties: null, addressLabels: null, lastLoadAt: null } satisfies DataStatus;
    }),
  ]);

  const threshold = parseVisitThreshold(rotation.data?.value);
  return {
    thresholdPct: threshold.pct,
    thresholdStored: threshold.source === "setting",
    loggingDefault: parseLoggingDefault(logging.data),
    accounts,
    data,
    failed,
  };
}

/** Canvasser profiles, with how many open visits from today on each is booked on. */
async function loadAccounts(supabase: SupabaseClient<Database>, today: string): Promise<CanvasserAccount[]> {
  const [people, planned] = await Promise.all([
    supabase.from("profiles").select("id, full_name, active").eq("role", "canvasser"),
    supabase
      .from("assignment_members")
      .select("canvasser_id, assignments!inner(work_date, closed_at)")
      .is("left_at", null)
      .gte("assignments.work_date", today)
      .is("assignments.closed_at", null),
  ]);
  if (people.error) throw new Error(people.error.message);
  if (planned.error) throw new Error(planned.error.message);
  const visits = new Map<string, number>();
  for (const row of planned.data ?? []) visits.set(row.canvasser_id, (visits.get(row.canvasser_id) ?? 0) + 1);
  return sortAccounts(
    (people.data ?? []).map((row) => ({ id: row.id, name: firstName(row.full_name), active: row.active, plannedVisits: visits.get(row.id) ?? 0 })),
  );
}

async function loadDataStatus(supabase: SupabaseClient<Database>): Promise<DataStatus> {
  const [zones, latestZone, properties, labels, latestLabel] = await Promise.all([
    supabase.from("nccz_zones").select("id", { count: "exact", head: true }),
    supabase.from("nccz_zones").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("properties").select("uprn", { count: "exact", head: true }),
    supabase.from("property_addresses").select("uprn", { count: "exact", head: true }),
    supabase.from("property_addresses").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (zones.error) throw new Error(zones.error.message);
  return {
    ncczZones: zones.count ?? 0,
    properties: properties.error ? null : properties.count,
    addressLabels: labels.error ? null : labels.count,
    lastLoadAt: latestOf(latestZone.data?.created_at ?? null, latestLabel.data?.updated_at ?? null),
  };
}
