/**
 * Stage 5b (R2) — freeze one saved variant onto an assignment.
 *
 * One RPC, `assignment_route_freeze` (020), in one transaction under the
 * ADMIN'S OWN SESSION: refuses a worked assignment (any knock_events),
 * verifies the variant orders exactly the frozen doors, replaces
 * route_steps and sets route_geom / uprn_snapshot / route_variant_key.
 *
 * `variantKey` omitted → the function picks by visit_number parity: odd →
 * best, even → best_reversed. RT (040, 041): a prop in manual mode whose
 * drawing fits the visit takes manual / manual_reversed the same way.
 *
 * RT-START (043, owner 2026-10-19): an explicit `variantKey` is recorded as
 * the visit's choice (`assignments.route_choice`), and a later call with no
 * key keeps it while the same saved route is still there. A canvasser on the
 * visit may call it too, with a key, for an open visit dated today.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { VariantKey } from "@/lib/geo/walk/types";

export type FreezeFailureCode =
  | "not_admin"
  | "missing_assignment"
  | "frozen"
  | "missing_variant"
  | "snapshot_mismatch"
  | "stale_variant"
  | "manual_unfinished"
  | "closed"
  | "not_today"
  | "freeze_rejected"
  | "unavailable";

export type FreezeSummary = {
  assignmentId: string;
  variantKey: VariantKey;
  hand: "left" | "right";
  routeId: string;
  steps: number;
  routeLengthM: number;
  doors: number;
  strandedCount: number;
  /** RT-START: the visit walks a route someone chose (now, or kept from before). */
  chosen: boolean;
  /** RT-START: a recorded choice was dropped (its route was regenerated or no longer fits). */
  choiceCleared: boolean;
};

export type FreezeResult =
  | { ok: true; summary: FreezeSummary }
  | { ok: false; code: FreezeFailureCode; message: string; detail?: string };

const SERVER_HINTS: Record<string, FreezeFailureCode> = {
  not_admin: "not_admin",
  missing_assignment: "missing_assignment",
  frozen: "frozen",
  missing_variant: "missing_variant",
  snapshot_mismatch: "snapshot_mismatch",
  stale_variant: "stale_variant",
  manual_unfinished: "manual_unfinished",
  closed: "closed",
  not_today: "not_today",
  bad_variant: "freeze_rejected",
  duplicate_uprn: "freeze_rejected",
  bad_stranded_count: "freeze_rejected",
  bad_steps: "freeze_rejected",
  bad_route: "freeze_rejected",
};

function describe(error: PostgrestError): string {
  return [error.code, error.hint, error.message, error.details].filter(Boolean).join(" | ");
}

export function mapFreezeRpcError(error: PostgrestError): Extract<FreezeResult, { ok: false }> {
  const code = SERVER_HINTS[error.hint ?? ""];
  if (code) return { ok: false, code, message: error.message, detail: error.details ?? undefined };
  if (error.code === "42501") {
    return { ok: false, code: "not_admin", message: "Only an admin, or someone on this visit, can change its route.", detail: error.message };
  }
  return { ok: false, code: "unavailable", message: "The route could not be frozen.", detail: describe(error) };
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The key `assignment_route_freeze` uses when `p_variant_key` is omitted, for
 * a prop on automatic routes. Odd visit → best, even visit → best_reversed. A
 * prop in manual mode whose drawing fits the visit uses manual /
 * manual_reversed by the same parity (decided in SQL, migration 041).
 */
export function defaultVariantKey(visitNumber: number): "best" | "best_reversed" {
  return visitNumber % 2 === 0 ? "best_reversed" : "best";
}

/** Never throws. `supabase` must carry the caller's own session (an admin, or a canvasser on the visit with a key). */
export async function freezeAssignmentRoute(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  variantKey?: VariantKey | null,
): Promise<FreezeResult> {
  try {
    const { data, error } = await supabase.rpc("assignment_route_freeze", {
      p_assignment_id: assignmentId,
      ...(variantKey ? { p_variant_key: variantKey } : {}),
    });
    if (error) return mapFreezeRpcError(error);

    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      summary: {
        assignmentId,
        variantKey: String(row.variant_key ?? "") as VariantKey,
        hand: row.hand === "left" ? "left" : "right",
        routeId: String(row.route_id ?? ""),
        steps: asNumber(row.steps),
        routeLengthM: asNumber(row.route_length_m),
        doors: asNumber(row.doors),
        strandedCount: asNumber(row.stranded_count),
        chosen: row.chosen === true,
        choiceCleared: row.choice_cleared === true,
      },
    };
  } catch (err) {
    return {
      ok: false,
      code: "unavailable",
      message: "The route could not be frozen.",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
