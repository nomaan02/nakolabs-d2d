import type { SupabaseClient } from "@supabase/supabase-js";

import { ANSWERED_SQL } from "@/lib/admin/answered";
import type { Slot } from "@/lib/geo/rotation";
import type { Database, Json } from "@/lib/supabase/types";

export const LEAD_OUTCOME_STATUSES = ["sale", "pm", "blowout", "utc", "btc"] as const;
export type LeadOutcomeStatus = (typeof LEAD_OUTCOME_STATUSES)[number];

export type CoverageCounts = {
  territory_id: string;
  name: string;
  knockable: number;
  worked: number;
  answered: number;
  remaining: number;
};

export type WorkedPerWeek = {
  territory_id: string;
  name: string;
  iso_week: string;
  week_start: string;
  worked: number;
};

export type AnswerBySlot = {
  slot: Slot;
  worked: number;
  answered: number;
};

export type LeadOutcomeRow = {
  status: LeadOutcomeStatus;
  n: number;
};

export type PropLastVisit = {
  territory_id: string;
  name: string;
  last_visited: string | null;
  stale: boolean;
};

export type DashboardPayload = {
  as_of: string;
  stale_weeks: number;
  answered_sql: string;
  coverage: CoverageCounts[];
  worked_per_week: WorkedPerWeek[];
  answer_by_slot: AnswerBySlot[];
  lead_outcomes: LeadOutcomeRow[];
  props_last_visit: PropLastVisit[];
};

export type DashboardResult =
  | { ok: true; payload: DashboardPayload }
  | { ok: false; message: string; detail?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isSlot(value: unknown): value is Slot {
  return value === "early" || value === "mid" || value === "late";
}

function isLeadStatus(value: unknown): value is LeadOutcomeStatus {
  return (
    value === "sale" ||
    value === "pm" ||
    value === "blowout" ||
    value === "utc" ||
    value === "btc"
  );
}

function parseCoverage(value: unknown): CoverageCounts | null {
  const row = asRecord(value);
  if (!row) return null;
  const territory_id = asString(row.territory_id);
  const name = asString(row.name);
  const knockable = asNumber(row.knockable);
  const worked = asNumber(row.worked);
  const answered = asNumber(row.answered);
  if (!territory_id || !name || knockable === null || worked === null || answered === null) {
    return null;
  }
  return {
    territory_id,
    name,
    knockable,
    worked,
    answered,
    remaining: Math.max(0, knockable - worked),
  };
}

function parseWeek(value: unknown): WorkedPerWeek | null {
  const row = asRecord(value);
  if (!row) return null;
  const territory_id = asString(row.territory_id);
  const name = asString(row.name);
  const iso_week = asString(row.iso_week);
  const week_start = asString(row.week_start);
  const worked = asNumber(row.worked);
  if (!territory_id || !name || !iso_week || !week_start || worked === null) return null;
  return { territory_id, name, iso_week, week_start, worked };
}

function parseSlot(value: unknown): AnswerBySlot | null {
  const row = asRecord(value);
  if (!row || !isSlot(row.slot)) return null;
  const worked = asNumber(row.worked);
  const answered = asNumber(row.answered);
  if (worked === null || answered === null) return null;
  return { slot: row.slot, worked, answered };
}

function parseLead(value: unknown): LeadOutcomeRow | null {
  const row = asRecord(value);
  if (!row || !isLeadStatus(row.status)) return null;
  const n = asNumber(row.n);
  if (n === null) return null;
  return { status: row.status, n };
}

function parseLastVisit(value: unknown): PropLastVisit | null {
  const row = asRecord(value);
  if (!row) return null;
  const territory_id = asString(row.territory_id);
  const name = asString(row.name);
  const stale = asBool(row.stale);
  if (!territory_id || !name || stale === null) return null;
  const last = row.last_visited;
  const last_visited = last === null ? null : asString(last);
  if (last !== null && last_visited === null) return null;
  return { territory_id, name, last_visited, stale };
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`admin_dashboard missing ${label}`);
  const rows = value.map(parse);
  if (rows.some((row) => row === null)) {
    throw new Error(`admin_dashboard ${label} contains a malformed row`);
  }
  return rows as T[];
}

export function parseDashboardPayload(data: Json | null): DashboardPayload {
  const root = asRecord(data);
  if (!root) throw new Error("admin_dashboard did not return an object");
  const as_of = asString(root.as_of);
  const stale_weeks = asNumber(root.stale_weeks);
  if (!as_of || stale_weeks === null) throw new Error("admin_dashboard missing as_of");

  return {
    as_of,
    stale_weeks,
    answered_sql: asString(root.answered_sql) ?? ANSWERED_SQL,
    coverage: parseList(root.coverage, parseCoverage, "coverage"),
    worked_per_week: parseList(root.worked_per_week, parseWeek, "worked_per_week"),
    answer_by_slot: parseList(root.answer_by_slot, parseSlot, "answer_by_slot"),
    lead_outcomes: parseList(root.lead_outcomes, parseLead, "lead_outcomes"),
    props_last_visit: parseList(root.props_last_visit, parseLastVisit, "props_last_visit"),
  };
}

export function clampStaleWeeks(raw: string | undefined): number {
  const n = Number(raw ?? 4);
  if (!Number.isFinite(n)) return 4;
  return Math.min(52, Math.max(1, Math.round(n)));
}

export async function fetchAdminDashboard(
  supabase: SupabaseClient<Database>,
  staleWeeks: number,
): Promise<DashboardResult> {
  const { data, error } = await supabase.rpc("admin_dashboard", {
    p_stale_weeks: staleWeeks,
  });
  if (error) {
    return {
      ok: false,
      message: "The dashboard could not be loaded. Check your connection and try again.",
      detail: [error.code, error.hint, error.message].filter(Boolean).join(" | "),
    };
  }
  try {
    return { ok: true, payload: parseDashboardPayload(data) };
  } catch (caught) {
    return {
      ok: false,
      message: "The dashboard could not be read. Try again.",
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
