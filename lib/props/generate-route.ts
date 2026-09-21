"use server";

import { revalidatePath } from "next/cache";
import { generateRoute, type RouteFailureCode, type RouteSummary } from "@/lib/geo/route-generate";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RouteActionResult =
  | { ok: true; summary: RouteSummary; totalMs: number }
  | { ok: false; code: RouteFailureCode; message: string };

/**
 * Stage 5b. Draws the route for an allocation that has already been saved.
 * Runs under the admin's own session so RLS governs every read and write.
 *
 * Fails open: a failure here never undoes the allocation. The caller shows
 * the message as a notice; the assignment keeps its interim door order.
 */
export async function generateRouteAction(assignmentId: string): Promise<RouteActionResult> {
  const id = assignmentId.trim();
  if (!UUID.test(id)) {
    return { ok: false, code: "missing_assignment", message: "That assignment could not be found." };
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

  const result = await generateRoute(supabase, id);
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/allocate");
  return { ok: true, summary: result.summary, totalMs: Math.round(result.timings.totalMs) };
}
