"use server";

import { revalidatePath } from "next/cache";
import {
  RING_PROBLEM_MESSAGES,
  ringProblem,
  ringToEwkt,
  type Ring,
} from "@/lib/geo/prop-polygon";
import { mapPropRpcError } from "@/lib/geo/rpc-error";
import { createClient } from "@/lib/supabase/server";

export type SavePropResult =
  | { ok: true; id: string; name: string }
  | { ok: false; message: string; detail?: string };

/**
 * Writes one prop to `territories`.
 *
 * The insert is made with the admin's own session, so the Stage 2 RLS policy
 * decides whether it lands — there is no service-role shortcut here. The
 * polygon is re-checked through `assert_prop_polygon`, the same guard the count
 * uses, because a save can be reached without a count having just run.
 *
 * A door count over the shift window never blocks this. The warning is advice.
 */
export async function saveProp(input: { name: string; ring: Ring }): Promise<SavePropResult> {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, message: "Give the prop a name before saving it." };
  }

  const problem = ringProblem(input.ring);
  if (problem) {
    return { ok: false, message: RING_PROBLEM_MESSAGES[problem] };
  }

  const poly = ringToEwkt(input.ring);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Your session has ended. Sign in again to save this prop." };
  }

  const { error: guardError } = await supabase.rpc("assert_prop_polygon", { poly });
  if (guardError) {
    const failure = mapPropRpcError(guardError);
    return { ok: false, message: failure.message, detail: failure.detail };
  }

  const { data, error } = await supabase
    .from("territories")
    .insert({ name, geom: poly, created_by: user.id })
    .select("id, name")
    .single();

  if (error) {
    return {
      ok: false,
      message: "That prop could not be saved. Try again.",
      detail: error.message,
    };
  }

  revalidatePath("/admin");
  return { ok: true, id: data.id, name: data.name };
}
