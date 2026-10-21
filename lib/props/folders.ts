"use server";

import { revalidatePath } from "next/cache";

import { cleanFolderName, FOLDER_NAME_MAX } from "@/lib/admin/props";
import { createClient } from "@/lib/supabase/server";

/**
 * PP-1 (owner 2026-10-21). Props in folders the admin names: create a
 * folder, rename it, and move a prop into a folder (or out to "No folder").
 *
 * Every write runs with the admin's own session: `prop_folders_insert_admin`,
 * `prop_folders_update_admin` and `territories_update_admin` decide whether it
 * lands. No service role, no RPC. There is no delete (owner 2026-10-21:
 * parked), so a folder can never take props with it.
 */

export type FolderResult = { ok: true; id: string } | { ok: false; message: string; detail?: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres unique_violation: a folder with that name already exists. */
const TAKEN = "23505";

function revalidate(): void {
  revalidatePath("/admin/props");
  revalidatePath("/admin/coverage");
}

function nameProblem(raw: string): string | null {
  if (!raw.trim()) return "A folder needs a name.";
  if (!cleanFolderName(raw)) return `Keep the name under ${FOLDER_NAME_MAX} characters.`;
  return null;
}

export async function createFolder(input: { name: string }): Promise<FolderResult> {
  const problem = nameProblem(input.name);
  const name = cleanFolderName(input.name);
  if (problem || !name) return { ok: false, message: problem ?? "A folder needs a name." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("prop_folders").insert({ name }).select("id").single();
  if (error || !data) {
    return {
      ok: false,
      message: error?.code === TAKEN ? `There is already a folder called “${name}”.` : "The folder could not be made. Try again.",
      detail: error?.message,
    };
  }
  revalidate();
  return { ok: true, id: data.id };
}

export async function renameFolder(input: { id: string; name: string }): Promise<FolderResult> {
  if (!ID.test(input.id)) return { ok: false, message: "That folder could not be found." };
  const problem = nameProblem(input.name);
  const name = cleanFolderName(input.name);
  if (problem || !name) return { ok: false, message: problem ?? "A folder needs a name." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("prop_folders").update({ name }).eq("id", input.id).select("id").maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      message: error?.code === TAKEN ? `There is already a folder called “${name}”.` : "The new name could not be saved. Try again.",
      detail: error?.message,
    };
  }
  revalidate();
  return { ok: true, id: data.id };
}

/** `folderId: null` moves the prop out to "No folder". */
export async function movePropToFolder(input: { propId: string; folderId: string | null }): Promise<FolderResult> {
  if (!ID.test(input.propId)) return { ok: false, message: "That prop could not be found." };
  if (input.folderId !== null && !ID.test(input.folderId)) return { ok: false, message: "That folder could not be found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("territories")
    .update({ folder_id: input.folderId })
    .eq("id", input.propId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: "The prop could not be moved. Try again.", detail: error?.message };
  }
  revalidate();
  return { ok: true, id: data.id };
}
