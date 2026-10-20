"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { freezeAssignmentRoute, type FreezeFailureCode, type FreezeSummary } from "@/lib/geo/walk/freeze";
import { saveTerritoryRoutes, type SaveRoutesFailureCode } from "@/lib/geo/walk/save";
import type { VariantKey } from "@/lib/geo/walk/types";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANT_KEY = /^(best|best_reversed|alt_[1-9][0-9]*|manual|manual_reversed)$/;

function isVariantKey(key: string): key is VariantKey {
  return VARIANT_KEY.test(key);
}

export type RouteFailureCode = FreezeFailureCode | SaveRoutesFailureCode;

export type RouteSummary = FreezeSummary & {
  /** True when the prop's variant set was (re)generated and saved on this call. */
  regenerated: boolean;
  /** How many variants the prop now has saved, when regenerated. */
  variants: number | null;
};

export type RouteActionResult =
  | { ok: true; summary: RouteSummary; totalMs: number }
  | { ok: false; code: RouteFailureCode; message: string };

/**
 * Freeze-after-miss: the failures where regenerating the prop's saved
 * variants can help. Anything else (frozen, not_admin, a bad assignment id)
 * is reported as it is.
 */
const REGENERATE_ON = new Set<FreezeFailureCode>(["missing_variant", "stale_variant", "snapshot_mismatch"]);
/** RT-START: failures a retry with the default can't help. */
const KEEP_FAILURE = new Set<FreezeFailureCode>(["frozen", "not_admin", "missing_assignment", "closed", "not_today", "unavailable"]);

/**
 * Stage 5b (R2). Puts a route on an allocation that has already been saved:
 *
 *   1. assignment_route_freeze(assignment) — copies the prop's saved variant
 *      chosen by visit_number parity (odd → best, even → best_reversed).
 *   2. If the prop has no saved variants, or they no longer fit (roads
 *      re-ingested, door set changed), generate and save the variant set
 *      with territory_routes_save and freeze once more.
 *
 * Runs under the admin's own session so RLS governs every read and write.
 * Fails open: a failure here never undoes the allocation. The caller shows
 * the message as a notice; the assignment keeps its interim door order.
 *
 * RT-START (owner 2026-10-19): `variantKey` is the route the admin picked on
 * Add visit; it is recorded as the visit's choice. If the pick doesn't fit
 * the visit, or the prop's routes have to be made again first (the picked
 * key may no longer mean the same route), the default by turns is used and
 * `summary.chosen` is false.
 */
export async function generateRouteAction(assignmentId: string, variantKey?: string | null): Promise<RouteActionResult> {
  const started = performance.now();
  const id = assignmentId.trim();
  if (!UUID.test(id)) {
    return { ok: false, code: "missing_assignment", message: "That assignment could not be found." };
  }
  const picked = variantKey?.trim() || null;
  const key = picked !== null && isVariantKey(picked) ? picked : null;
  if (picked !== null && key === null) {
    return { ok: false, code: "missing_variant", message: "That route variant is not one this prop has saved." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: "not_admin",
      message: "Your session has ended. Sign in again to draw this route.",
    };
  }

  let first = await freezeAssignmentRoute(supabase, id, key);
  // The picked route doesn't fit this visit (a drawn route that no longer
  // matches its doors, say): the default by turns instead, before anything
  // is regenerated. The result says chosen: false.
  if (!first.ok && key !== null && !KEEP_FAILURE.has(first.code)) {
    first = await freezeAssignmentRoute(supabase, id);
  }
  if (first.ok) {
    revalidate();
    return {
      ok: true,
      summary: { ...first.summary, regenerated: false, variants: null },
      totalMs: Math.round(performance.now() - started),
    };
  }
  if (!REGENERATE_ON.has(first.code)) {
    return { ok: false, code: first.code, message: first.message };
  }

  const territoryId = await territoryOf(supabase, id);
  if (!territoryId) {
    return { ok: false, code: "missing_assignment", message: "That assignment could not be found." };
  }

  const saved = await saveTerritoryRoutes(supabase, territoryId);
  if (!saved.ok) {
    revalidate();
    return { ok: false, code: saved.code, message: saved.message };
  }

  const second = await freezeAssignmentRoute(supabase, id);
  revalidate();
  if (!second.ok) {
    return { ok: false, code: second.code, message: second.message };
  }
  return {
    ok: true,
    summary: { ...second.summary, regenerated: true, variants: saved.summary.variants },
    totalMs: Math.round(performance.now() - started),
  };
}

async function territoryOf(supabase: SupabaseClient<Database>, assignmentId: string): Promise<string | null> {
  const { data } = await supabase.from("assignments").select("territory_id").eq("id", assignmentId).maybeSingle();
  return data?.territory_id ?? null;
}

function revalidate() {
  revalidatePath("/admin");
  revalidatePath("/admin/allocate");
}
