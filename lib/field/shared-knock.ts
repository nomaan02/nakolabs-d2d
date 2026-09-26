import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * Two offline knocks on one UPRN both insert. Coverage counts the door once
 * (`v_latest_knock` is one row per assignment + UPRN). This is the flag the
 * canvasser sees after the second copy has synced.
 */

export function sharedKnockMessage(count: number, example: string | null): string {
  if (count <= 0) return "";
  if (count === 1) {
    return example
      ? `You and a teammate both logged ${example}. It still counts once.`
      : "You and a teammate both logged the same door. It still counts once.";
  }
  return example
    ? `${count} doors were logged by more than one of you, including ${example}. Each still counts once.`
    : `${count} doors were logged by more than one of you. Each still counts once.`;
}

/** UPRNs in `uprns` that some other canvasser has already knocked on this assignment. */
export async function uprnsSharedWithTeammate(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  uprns: number[],
  canvasserId: string,
): Promise<Set<number>> {
  const shared = new Set<number>();
  if (uprns.length === 0) return shared;

  for (let offset = 0; offset < uprns.length; offset += 100) {
    const slice = uprns.slice(offset, offset + 100);
    const { data, error } = await supabase
      .from("knock_events")
      .select("uprn, canvasser_id")
      .eq("assignment_id", assignmentId)
      .in("uprn", slice);
    if (error || !data) continue;
    for (const row of data) {
      if (row.canvasser_id !== canvasserId) shared.add(row.uprn);
    }
  }
  return shared;
}
