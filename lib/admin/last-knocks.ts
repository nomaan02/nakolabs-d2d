import type { SupabaseClient } from "@supabase/supabase-js";

import { doorLabelLine } from "@/lib/admin/today";
import type { Database } from "@/lib/supabase/types";

export type LastKnock = { at: string; door: string | null };

/**
 * UI-10 F3b (owner A36; frame 15). Each canvasser's latest knock on one
 * visit, with the door's address label (`v_door_label`: property-level,
 * never a resident). Admin session only. One small read per person, made
 * when the live map opens.
 */
export async function loadLastKnocks(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  canvasserIds: string[],
): Promise<Map<string, LastKnock>> {
  const out = new Map<string, LastKnock>();
  await Promise.all(
    canvasserIds.map(async (canvasserId) => {
      const { data } = await supabase
        .from("knock_events")
        .select("uprn, occurred_at")
        .eq("assignment_id", assignmentId)
        .eq("canvasser_id", canvasserId)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return;
      const { data: label } = await supabase
        .from("v_door_label")
        .select("house_number, building_name, street_name")
        .eq("uprn", data.uprn)
        .maybeSingle();
      out.set(canvasserId, { at: data.occurred_at, door: doorLabelLine(label) });
    }),
  );
  return out;
}
