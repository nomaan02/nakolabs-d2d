"use server";

import { revalidatePath } from "next/cache";

import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

/**
 * UI-10 F2b (owner A22, A47; frames 05-06). Rename, archive and restore a
 * prop, and drop a prop's saved routes after its shape changes.
 *
 * Every write runs with the admin's own session: `territories_update_admin`
 * and `territory_routes_delete_admin` decide whether it lands. No service
 * role, no new RPC. Archiving keeps every visit, knock and lead; the prop
 * just leaves the map and can no longer be allocated.
 */

export type ManageResult = { ok: true } | { ok: false; message: string; detail?: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROP_NAME_MAX = 80;

function revalidate(): void {
  revalidatePath("/admin/props");
  revalidatePath("/admin/allocate");
  revalidatePath("/admin/coverage");
}

export async function renameProp(input: { id: string; name: string }): Promise<ManageResult> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!ID.test(input.id)) return { ok: false, message: "That prop could not be found." };
  if (!name) return { ok: false, message: "A prop needs a name." };
  if (name.length > PROP_NAME_MAX) return { ok: false, message: `Keep the name under ${PROP_NAME_MAX} characters.` };

  const supabase = await createClient();
  const { data, error } = await supabase.from("territories").update({ name }).eq("id", input.id).select("id").maybeSingle();
  if (error || !data) {
    return { ok: false, message: "The new name could not be saved. Try again.", detail: error?.message };
  }
  revalidate();
  return { ok: true };
}

export async function setPropArchived(input: { id: string; archived: boolean }): Promise<ManageResult> {
  if (!ID.test(input.id)) return { ok: false, message: "That prop could not be found." };
  const supabase = await createClient();

  if (input.archived) {
    // A visit today or later still has a team on it. It is ended or deleted
    // from Today first, so archiving never strands anyone.
    const { data: open, error: openError } = await supabase
      .from("assignments")
      .select("id")
      .eq("territory_id", input.id)
      .is("closed_at", null)
      .gte("work_date", londonDate())
      .limit(1);
    if (openError) return { ok: false, message: "That prop could not be checked. Try again.", detail: openError.message };
    if ((open ?? []).length > 0) {
      return { ok: false, message: "This prop has a visit today or planned. End or delete that visit first." };
    }
  }

  const { data, error } = await supabase
    .from("territories")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .eq("id", input.id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      message: input.archived ? "The prop could not be archived. Try again." : "The prop could not be restored. Try again.",
      detail: error?.message,
    };
  }
  revalidate();
  return { ok: true };
}

/**
 * After Edit shape, when new routes could not be made: the old ones no longer
 * match the boundary, so they go. The next allocation makes a fresh set
 * (allocate regenerates when a prop has none). Visits already frozen keep
 * their own copy (`route_source_id` is set null, nothing else changes).
 */
export async function clearPropRoutes(input: { id: string }): Promise<ManageResult> {
  if (!ID.test(input.id)) return { ok: false, message: "That prop could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.from("territory_routes").delete().eq("territory_id", input.id);
  if (error) return { ok: false, message: "The old routes could not be removed.", detail: error.message };
  revalidate();
  return { ok: true };
}
