"use server";

import { revalidatePath } from "next/cache";
import { allocateProp, type AllocateResult } from "@/lib/geo/allocate-prop";
import { createClient } from "@/lib/supabase/server";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Allocates a saved prop to a team for one date. The write is the
 * `allocate_prop` RPC — one function, one statement — so a failure cannot
 * leave an assignment with no members. This action does not increment
 * `territories.visit_count`.
 */
export async function allocatePropAction(input: {
  territoryId: string;
  workDate: string;
  canvasserIds: string[];
}): Promise<AllocateResult> {
  const territoryId = input.territoryId.trim();
  const workDate = input.workDate.trim();
  const canvasserIds = [...new Set(input.canvasserIds.filter(Boolean))];

  if (!DATE.test(workDate)) {
    return { ok: false, code: "missing_date", message: "Pick a date for this allocation." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: "not_admin",
      message: "Your session has ended. Sign in again to allocate this prop.",
    };
  }

  const result = await allocateProp(supabase, { territoryId, workDate, canvasserIds });
  if (!result.ok) return result;

  revalidatePath("/admin");
  revalidatePath("/admin/allocate");
  return result;
}
