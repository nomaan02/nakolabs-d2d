"use server";

import { revalidatePath } from "next/cache";

import { freezeAssignmentRoute } from "@/lib/geo/walk/freeze";
import type { VariantKey } from "@/lib/geo/walk/types";
import type { RouteActionResult } from "@/lib/props/generate-route";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANT_KEY = /^(best|best_reversed|alt_[1-9][0-9]*|manual|manual_reversed)$/;

/**
 * Freeze one chosen variant onto an allocation and record it as the visit's
 * choice (RT-START, migration 043). Used by the visit sheet's Route row
 * (Today). Omitting the key — the default by turns — stays on
 * `generateRouteAction`, which this does not call.
 */
export async function freezeVariantAction(assignmentId: string, variantKey: string): Promise<RouteActionResult> {
  const started = performance.now();
  const id = assignmentId.trim();
  const key = variantKey.trim();
  if (!UUID.test(id)) {
    return { ok: false, code: "missing_assignment", message: "That assignment could not be found." };
  }
  if (!VARIANT_KEY.test(key)) {
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
      message: "Your session has ended. Sign in again to freeze this route.",
    };
  }

  const frozen = await freezeAssignmentRoute(supabase, id, key as VariantKey);
  revalidatePath("/admin");
  revalidatePath("/admin/today");
  if (!frozen.ok) return { ok: false, code: frozen.code, message: frozen.message };
  return {
    ok: true,
    summary: { ...frozen.summary, regenerated: false, variants: null },
    totalMs: Math.round(performance.now() - started),
  };
}
