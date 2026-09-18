import type { SupabaseClient } from "@supabase/supabase-js";

import { ANSWERED_SQL } from "@/lib/admin/answered";
import type { Database } from "@/lib/supabase/types";

/**
 * Per-assignment completion from `v_prop_completion`.
 *
 * Three numbers, never a percentage: worked, answered, remaining.
 * Answered uses the canonical rule in `ANSWERED_SQL` / Stage 14b.
 */
export type PropCompletion = {
  assignment_id: string;
  territory_id: string;
  territory_name: string;
  visit_number: number;
  work_date: string;
  knockable: number;
  worked: number;
  answered: number;
  remaining: number;
};

export type PropCompletionResult =
  | { ok: true; row: PropCompletion | null }
  | { ok: false; message: string; detail?: string };

export type PropCompletionListResult =
  | { ok: true; rows: PropCompletion[] }
  | { ok: false; message: string; detail?: string };

export { ANSWERED_SQL };

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

export function parsePropCompletion(value: unknown): PropCompletion | null {
  const row = asRecord(value);
  if (!row) return null;
  const assignment_id = asString(row.assignment_id);
  const territory_id = asString(row.territory_id);
  const territory_name = asString(row.territory_name);
  const visit_number = asNumber(row.visit_number);
  const work_date = asString(row.work_date);
  const knockable = asNumber(row.knockable);
  const worked = asNumber(row.worked);
  const answered = asNumber(row.answered);
  const remaining = asNumber(row.remaining);
  if (
    !assignment_id ||
    !territory_id ||
    !territory_name ||
    visit_number === null ||
    !work_date ||
    knockable === null ||
    worked === null ||
    answered === null ||
    remaining === null
  ) {
    return null;
  }
  return {
    assignment_id,
    territory_id,
    territory_name,
    visit_number,
    work_date,
    knockable,
    worked,
    answered,
    remaining,
  };
}

const SELECT =
  "assignment_id, territory_id, territory_name, visit_number, work_date, knockable, worked, answered, remaining";

/**
 * One assignment. Field uses this for today's prop only.
 * RLS on the underlying tables decides whether the row is visible.
 */
export async function fetchAssignmentCompletion(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
): Promise<PropCompletionResult> {
  const { data, error } = await supabase
    .from("v_prop_completion")
    .select(SELECT)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: "Today's counts could not be loaded. Check your connection and try again.",
      detail: [error.code, error.hint, error.message].filter(Boolean).join(" | "),
    };
  }
  if (!data) return { ok: true, row: null };
  const row = parsePropCompletion(data);
  if (!row) {
    return { ok: false, message: "Today's counts could not be read. Try again." };
  }
  return { ok: true, row };
}

/**
 * Every assignment the caller can see. Admin RLS returns all; a canvasser
 * JWT only returns assignments they belong to.
 */
export async function fetchPropCompletions(
  supabase: SupabaseClient<Database>,
): Promise<PropCompletionListResult> {
  const { data, error } = await supabase
    .from("v_prop_completion")
    .select(SELECT)
    .order("work_date", { ascending: false })
    .order("territory_name", { ascending: true });

  if (error) {
    return {
      ok: false,
      message: "Prop completion could not be loaded. Check your connection and try again.",
      detail: [error.code, error.hint, error.message].filter(Boolean).join(" | "),
    };
  }

  const rows = (data ?? []).map(parsePropCompletion);
  if (rows.some((row) => row === null)) {
    return { ok: false, message: "Prop completion could not be read. Try again." };
  }
  return { ok: true, rows: rows as PropCompletion[] };
}
