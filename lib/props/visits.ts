"use server";

import { mapReallocationRpcError } from "@/lib/geo/reallocation";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CloseVisitResult = { ok: true } | { ok: false; message: string; detail?: string };

/**
 * UI-10 F3b. Ends a visit and never deletes it: `assignment_close_early`
 * (admin only, the same threshold rule as `assignment_remove`). Used for
 * every visit that has started, because a started visit with no knocks on
 * the server may still have knocks queued on a phone with no signal;
 * deleting it would make those fail to sync (knock_events foreign key).
 * Runs with the admin's own session.
 */
export async function closeVisitAction(assignmentId: string): Promise<CloseVisitResult> {
  const id = assignmentId.trim();
  if (!UUID.test(id)) return { ok: false, message: "That visit could not be found." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Your session has ended. Sign in again to end this visit." };
  const { error } = await supabase.rpc("assignment_close_early", { p_assignment_id: id });
  if (error) {
    const failure = mapReallocationRpcError(error);
    return { ok: false, message: failure.message, detail: failure.detail };
  }
  return { ok: true };
}
