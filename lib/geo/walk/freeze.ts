/**
 * Stage 5b (R2) — freeze one saved variant onto an assignment.
 *
 * One RPC, `assignment_route_freeze` (020), in one transaction under the
 * ADMIN'S OWN SESSION: refuses a worked assignment (any knock_events),
 * verifies the variant orders exactly the frozen doors, replaces
 * route_steps and sets route_geom / uprn_snapshot / route_variant_key.
 *
 * `variantKey` omitted → the function picks by visit_number parity: odd →
 * best, even → best_reversed.
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
    return { ok: false, code: "not_admin", message: "Only an admin can freeze a route.", detail: error.message };
  }
  return { ok: false, code: "unavailable", message: "The route could not be frozen.", detail: describe(error) };
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The key `assignment_route_freeze` uses when `p_variant_key` is omitted.
 * Odd visit → best, even visit → best_reversed.
 */
export function defaultVariantKey(visitNumber: number): "best" | "best_reversed" {
  return visitNumber % 2 === 0 ? "best_reversed" : "best";
}

/** Never throws. `supabase` must carry the admin's own session. */
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
