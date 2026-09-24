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
 * A large door count never blocks this.
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

const TERRITORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Writes a new ring onto a prop that already exists, so a later
 * `route_walk_inputs` reads the boundary the admin is looking at.
 * Route variants are not touched here.
 */
export async function updatePropRing(input: { id: string; ring: Ring }): Promise<SavePropResult> {
  const id = input.id.trim();
  if (!TERRITORY_ID.test(id)) {
    return { ok: false, message: "That prop could not be found." };
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
    .update({ geom: poly })
    .eq("id", id)
    .select("id, name")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      message: "That boundary could not be saved. Try again.",
      detail: error?.message,
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/allocate");
  return { ok: true, id: data.id, name: data.name };
}
