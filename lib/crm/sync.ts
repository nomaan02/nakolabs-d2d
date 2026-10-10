/**
 * CRM-1 B. Pull CRM leads into `crm_leads` (Brief Stage 12c).
 *
 * Used by scripts/crm-backfill.ts now and by the daily cron (P3) later.
 * Server-only: needs a service-role Supabase client and an open CrmReader.
 *
 * Rules (12a/12c): read-only on the CRM side; mapping is data
 * (`crm_status_map`); unknown statuses and unplaced leads are counted, never
 * guessed; idempotent (a second run on the same data changes nothing); the
 * run row is written first and finished with counts or an error; the cursor
 * (`max_modified_seen`) is recorded only on success. Street text and house
 * numbers go to the matcher RPC and are never stored.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CRM_PAGE_SIZE, type CrmReader } from "./client";
import {
  CRM_LEAD_FIELDS,
  CrmParseError,
  isoToCrmStamp,
  parseCrmLead,
  type AppCrmStatus,
  type CrmDatetimeZone,
  type CrmLeadRow,
  type ParsedCrmLead,
} from "./parse";

export const MATCH_TIERS = ["exact", "snapped", "interpolated", "street_nearest", "outside_area", "unmatched"] as const;
export type MatchTier = (typeof MATCH_TIERS)[number];

const MATCH_BATCH = 500;
const WRITE_BATCH = 500;
const LINK_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Re-read this much before the cursor: same-second saves, edits during a run, the repeated October hour. */
const CURSOR_OVERLAP_MS = 2 * 60 * 60 * 1000;
const READ_PAGE = 1000;

export type CrmSyncOptions = {
  kind: "backfill" | "daily";
  dryRun: boolean;
  zone: CrmDatetimeZone;
  /** ISO instant; daily runs pass the last successful max_modified_seen. Null = everything. */
  modifiedSince: string | null;
  log: (line: string) => void;
};

export type CrmSyncSummary = {
  runId: string | null;
  rowsSeen: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsSkipped: number;
  statusCounts: Record<string, number>;
  unknownStatuses: Record<string, number>;
  matchCounts: Record<MatchTier, number>;
  appLeadsLinked: number;
  appLeadsAmbiguous: number;
  maxModifiedSeen: string | null;
  newestCreatedRaw: string | null;
  newestModifiedRaw: string | null;
};

type MatchResult = { crm_id: string; uprn: number | null; lon: number | null; lat: number | null; tier: MatchTier };

type CrmLeadRecord = {
  crm_id: string;
  lead_no: string | null;
  status_raw: string | null;
  status: AppCrmStatus | null;
  crm_created_at: string;
  crm_modified_at: string;
  appointment_at: string | null;
  branch: string;
  sale_amount: number | null;
  postcode: string | null;
  postcode_sector: string | null;
  uprn: number | null;
  location: string | null;
  match_tier: MatchTier;
  canvasser_first_name: string | null;
};

const COMPARE_COLUMNS =
  "crm_id, lead_no, status_raw, status, crm_created_at, crm_modified_at, appointment_at, branch, sale_amount, postcode, postcode_sector, uprn, location, match_tier, canvasser_first_name";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

const sameInstant = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));

type StoredRecord = Omit<CrmLeadRecord, "location"> & { location?: unknown };

function pointOf(ewkt: string | null): [number, number] | null {
  const m = ewkt ? /POINT\(([-0-9.e]+) ([-0-9.e]+)\)/.exec(ewkt) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Stored point as PostgREST returns it (GeoJSON). Anything else -> undefined: treated as changed, so a format surprise shows up as updates on a same-data re-run. */
function storedPoint(value: unknown): [number, number] | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "coordinates" in value) {
    const c = (value as { coordinates: unknown }).coordinates;
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") return [c[0], c[1]];
  }
  return undefined;
}

function samePoint(next: string | null, stored: unknown): boolean {
  const a = pointOf(next);
  const b = storedPoint(stored);
  if (b === undefined) return false;
  if (a === null || b === null) return a === b;
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

/** Field-by-field compare of what we would write against what is stored, including the point. */
export function recordUnchanged(next: CrmLeadRecord, stored: StoredRecord): boolean {
  return (
    samePoint(next.location, stored.location) &&
    next.lead_no === stored.lead_no &&
    next.status_raw === stored.status_raw &&
    next.status === stored.status &&
    sameInstant(next.crm_created_at, stored.crm_created_at) &&
    sameInstant(next.crm_modified_at, stored.crm_modified_at) &&
    sameInstant(next.appointment_at, stored.appointment_at) &&
    next.branch === stored.branch &&
    (next.sale_amount ?? null) === (stored.sale_amount === null ? null : Number(stored.sale_amount)) &&
    next.postcode === stored.postcode &&
    next.postcode_sector === stored.postcode_sector &&
    (next.uprn ?? null) === (stored.uprn ?? null) &&
    next.match_tier === stored.match_tier &&
    next.canvasser_first_name === stored.canvasser_first_name
  );
}

async function loadStatusMap(db: SupabaseClient): Promise<Map<string, AppCrmStatus>> {
  const { data, error } = await db.from("crm_status_map").select("crm_value, status");
  if (error) throw new Error(`crm_status_map: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.crm_value as string, r.status as AppCrmStatus]));
}

async function fetchCrmRows(crm: CrmReader, options: CrmSyncOptions): Promise<CrmLeadRow[]> {
  const since = options.modifiedSince ? new Date(Date.parse(options.modifiedSince) - CURSOR_OVERLAP_MS).toISOString() : null;
  const where = since ? ` WHERE modifiedtime >= '${isoToCrmStamp(since, options.zone)}'` : "";
  const [counted] = await crm.query<{ count: string }>(`SELECT count(*) FROM Leads${where};`);
  const expected = Number(counted?.count ?? "0");
  const seen = new Map<string, CrmLeadRow>();
  for (let offset = 0; ; offset += CRM_PAGE_SIZE) {
    // Page by record id: it never changes, so an edit during the run cannot shift rows between pages.
    const page = await crm.query<CrmLeadRow>(
      `SELECT ${CRM_LEAD_FIELDS.join(", ")} FROM Leads${where} ORDER BY id LIMIT ${offset}, ${CRM_PAGE_SIZE};`,
    );
    for (const row of page) seen.set(row.id, row);
    if ((offset / CRM_PAGE_SIZE) % 20 === 0) options.log(`  CRM page ${offset / CRM_PAGE_SIZE + 1}: ${seen.size} leads so far`);
    if (page.length < CRM_PAGE_SIZE) break;
  }
  if (seen.size < expected) {
    throw new Error(`CRM paging returned ${seen.size} leads but the CRM counted ${expected}; nothing was trusted. Run again.`);
  }
  return [...seen.values()];
}

async function matchAll(db: SupabaseClient, leads: readonly ParsedCrmLead[]): Promise<Map<string, MatchResult>> {
  const out = new Map<string, MatchResult>();
  for (const batch of chunk(leads, MATCH_BATCH)) {
    const { data, error } = await db.rpc("crm_match_batch", { p_rows: batch.map((l) => l.match) });
    if (error) throw new Error(`crm_match_batch: ${error.message}`);
    for (const r of (data ?? []) as MatchResult[]) out.set(r.crm_id, r);
  }
  return out;
}

async function loadStored(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, StoredRecord>> {
  const out = new Map<string, StoredRecord>();
  for (const batch of chunk(ids, 100)) {
    const { data, error } = await db.from("crm_leads").select(COMPARE_COLUMNS).in("crm_id", batch);
    if (error) throw new Error(`crm_leads read: ${error.message}`);
    for (const r of (data ?? []) as unknown as StoredRecord[]) out.set(r.crm_id, r);
  }
  return out;
}

function toRecord(lead: ParsedCrmLead, match: MatchResult | undefined): CrmLeadRecord {
  const raw: MatchTier = match?.tier ?? "unmatched";
  const placed = raw !== "outside_area" && raw !== "unmatched" && match?.lon != null && match?.lat != null;
  const tier: MatchTier = placed || raw === "outside_area" ? raw : "unmatched";
  return {
    crm_id: lead.crm_id,
    lead_no: lead.lead_no,
    status_raw: lead.status_raw,
    status: lead.status,
    crm_created_at: lead.crm_created_at,
    crm_modified_at: lead.crm_modified_at,
    appointment_at: lead.appointment_at,
    branch: lead.branch,
    sale_amount: lead.sale_amount,
    postcode: lead.postcode,
    postcode_sector: lead.postcode_sector,
    uprn: tier === "exact" || tier === "snapped" ? (match?.uprn ?? null) : null,
    location: placed ? `SRID=4326;POINT(${match.lon} ${match.lat})` : null,
    match_tier: tier,
    canvasser_first_name: lead.canvasser_first_name,
  };
}

type AppLead = { id: string; uprn: number; knock_event_id: string };

/** Every row of a select, 1,000 at a time in a stable order (PostgREST caps each request). */
async function readAllRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await page(from, from + READ_PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < READ_PAGE) return out;
  }
}

/**
 * App leads with no crm_ref, linked by same door + CRM created within ±1 day of the knock.
 * A link is made only when the app lead fits exactly one CRM lead AND that CRM lead fits
 * exactly one app lead; anything else is counted as ambiguous and left alone.
 */
async function linkAppLeads(db: SupabaseClient, dryRun: boolean): Promise<{ linked: number; ambiguous: number }> {
  const appLeads = await readAllRows<AppLead>(
    (from, to) => db.from("leads").select("id, uprn, knock_event_id").is("crm_ref", null).order("id").range(from, to),
    "leads read",
  );
  if (appLeads.length === 0) return { linked: 0, ambiguous: 0 };

  const used = new Set(
    (
      await readAllRows<{ crm_ref: string }>(
        (from, to) => db.from("leads").select("crm_ref").not("crm_ref", "is", null).order("id").range(from, to),
        "leads read",
      )
    ).map((t) => t.crm_ref),
  );

  const knockTimes = new Map<string, number>();
  for (const batch of chunk(appLeads.map((l) => l.knock_event_id), 100)) {
    const { data, error } = await db.from("knock_events").select("id, occurred_at").in("id", batch);
    if (error) throw new Error(`knock_events read: ${error.message}`);
    for (const k of data ?? []) knockTimes.set(k.id as string, Date.parse(k.occurred_at as string));
  }

  const candidates = new Map<number, { crm_id: string; created: number }[]>();
  for (const batch of chunk([...new Set(appLeads.map((l) => l.uprn))], 100)) {
    const rows = await readAllRows<{ crm_id: string; uprn: number; crm_created_at: string }>(
      (from, to) => db.from("crm_leads").select("crm_id, uprn, crm_created_at").in("uprn", batch).order("crm_id").range(from, to),
      "crm_leads read",
    );
    for (const c of rows) {
      const list = candidates.get(Number(c.uprn)) ?? [];
      list.push({ crm_id: c.crm_id, created: Date.parse(c.crm_created_at) });
      candidates.set(Number(c.uprn), list);
    }
  }

  const fitsByLead = new Map<string, string[]>();
  const leadsByCrm = new Map<string, string[]>();
  for (const lead of appLeads) {
    const at = knockTimes.get(lead.knock_event_id);
    if (at === undefined) continue;
    const fits = (candidates.get(Number(lead.uprn)) ?? [])
      .filter((c) => Math.abs(c.created - at) <= LINK_WINDOW_MS && !used.has(c.crm_id))
      .map((c) => c.crm_id);
    if (fits.length === 0) continue;
    fitsByLead.set(lead.id, fits);
    for (const crmId of fits) leadsByCrm.set(crmId, [...(leadsByCrm.get(crmId) ?? []), lead.id]);
  }

  let linked = 0;
  let ambiguous = 0;
  for (const [leadId, fits] of fitsByLead) {
    const crmId = fits.length === 1 ? fits[0] : undefined;
    if (!crmId || (leadsByCrm.get(crmId) ?? []).length !== 1) {
      ambiguous += 1;
      continue;
    }
    if (!dryRun) {
      const { data, error } = await db
        .from("leads")
        .update({ crm_ref: crmId, crm_last_synced_at: new Date().toISOString() })
        .eq("id", leadId)
        .is("crm_ref", null)
        .select("id");
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          ambiguous += 1;
          continue;
        }
        throw new Error(`leads link: ${error.message}`);
      }
      if ((data ?? []).length === 0) continue;
    }
    linked += 1;
  }
  return { linked, ambiguous };
}

export async function runCrmSync(db: SupabaseClient, crm: CrmReader, options: CrmSyncOptions): Promise<CrmSyncSummary> {
  const { log } = options;
  let runId: string | null = null;

  if (!options.dryRun) {
    const { data, error } = await db
      .from("crm_sync_runs")
      .insert({ kind: options.kind, modified_since: options.modifiedSince })
      .select("id")
      .single();
    if (error) throw new Error(`crm_sync_runs start: ${error.message}`);
    runId = data.id as string;
  }

  try {
    const statusMap = await loadStatusMap(db);
    log("Reading CRM leads (read-only)...");
    const rows = await fetchCrmRows(crm, options);
    log(`  ${rows.length} leads read`);

    const parsed: ParsedCrmLead[] = [];
    let skipped = 0;
    for (const row of rows) {
      try {
        parsed.push(parseCrmLead(row, statusMap, options.zone));
      } catch (err) {
        if (!(err instanceof CrmParseError)) throw err;
        skipped += 1;
      }
    }
    if (skipped > 0) log(`  ${skipped} leads skipped: unreadable created/modified time`);
    log("Placing leads on the map...");
    const matches = await matchAll(db, parsed);
    const records = parsed.map((lead) => toRecord(lead, matches.get(lead.crm_id)));
    const stored = await loadStored(db, records.map((r) => r.crm_id));

    const statusCounts: Record<string, number> = {};
    const unknownStatuses: Record<string, number> = {};
    const matchCounts = Object.fromEntries(MATCH_TIERS.map((t) => [t, 0])) as Record<MatchTier, number>;
    for (const lead of parsed) {
      bump(statusCounts, lead.status ?? (lead.status_unknown ? `unknown: ${lead.status_raw}` : "no outcome"));
      if (lead.status_unknown && lead.status_raw) bump(unknownStatuses, lead.status_raw);
    }
    for (const r of records) matchCounts[r.match_tier] += 1;

    const toWrite: CrmLeadRecord[] = [];
    let inserted = 0;
    let updated = 0;
    for (const r of records) {
      const before = stored.get(r.crm_id);
      if (!before) {
        inserted += 1;
        toWrite.push(r);
      } else if (!recordUnchanged(r, before)) {
        updated += 1;
        toWrite.push(r);
      }
    }

    if (!options.dryRun && toWrite.length > 0) {
      log(`Writing ${toWrite.length} rows to crm_leads...`);
      const now = new Date().toISOString();
      for (const batch of chunk(toWrite, WRITE_BATCH)) {
        const { error } = await db
          .from("crm_leads")
          .upsert(batch.map((r) => ({ ...r, synced_at: now })), { onConflict: "crm_id" });
        if (error) throw new Error(`crm_leads write: ${error.message}`);
      }
    }

    const links = await linkAppLeads(db, options.dryRun);

    const newestModified = parsed.reduce<string | null>(
      (max, l) => (max === null || Date.parse(l.crm_modified_at) > Date.parse(max) ? l.crm_modified_at : max),
      null,
    );
    const byCreated = [...rows].sort((a, b) => (b.createdtime ?? "").localeCompare(a.createdtime ?? ""));
    const byModified = [...rows].sort((a, b) => (b.modifiedtime ?? "").localeCompare(a.modifiedtime ?? ""));

    const summary: CrmSyncSummary = {
      runId,
      rowsSeen: rows.length,
      rowsInserted: inserted,
      rowsUpdated: updated,
      rowsUnchanged: records.length - inserted - updated,
      rowsSkipped: skipped,
      statusCounts,
      unknownStatuses,
      matchCounts,
      appLeadsLinked: links.linked,
      appLeadsAmbiguous: links.ambiguous,
      maxModifiedSeen: newestModified ?? options.modifiedSince,
      newestCreatedRaw: byCreated[0]?.createdtime ?? null,
      newestModifiedRaw: byModified[0]?.modifiedtime ?? null,
    };

    if (runId) {
      const { error } = await db
        .from("crm_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          max_modified_seen: summary.maxModifiedSeen,
          rows_seen: summary.rowsSeen,
          rows_inserted: summary.rowsInserted,
          rows_updated: summary.rowsUpdated,
          rows_unchanged: summary.rowsUnchanged,
          rows_skipped: summary.rowsSkipped,
          unknown_statuses: summary.unknownStatuses,
          match_counts: summary.matchCounts,
          app_leads_linked: summary.appLeadsLinked,
          app_leads_ambiguous: summary.appLeadsAmbiguous,
        })
        .eq("id", runId);
      if (error) throw new Error(`crm_sync_runs finish: ${error.message}`);
    }
    return summary;
  } catch (err) {
    if (runId) {
      await db
        .from("crm_sync_runs")
        .update({ finished_at: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) })
        .eq("id", runId);
    }
    throw err;
  }
}
