import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  RING_PROBLEM_MESSAGES,
  ringProblem,
  ringToEwkt,
  type Ring,
} from "@/lib/geo/prop-polygon";
import { mapPropRpcError, type PropFailureResult } from "@/lib/geo/rpc-error";

export type KnockableCount = {
  total: number;
  knockable: number;
  /** Flats in buildings of 3+ units, outside No Cold Calling Zones (UI-5 A3b). */
  multiUnit: number;
  /** Doors inside a No Cold Calling Zone (UI-5 A3b). */
  nccz: number;
  /** multiUnit + nccz. Kept for existing readers. */
  excluded: number;
};

export type CountResult = { ok: true; count: KnockableCount } | PropFailureResult;

/**
 * Counts the doors inside a drawn prop. The count is computed in Postgres
 * against every property row; nothing is fetched to the client to be
 * counted here.
 *
 * UI-5 A3b (2026-10-04): reads `count_door_eligibility` (migration 026), so
 * the draw page can say how many doors are flats and how many are in a No
 * Cold Calling Zone. total = knockable + multiUnit + nccz.
 *
 * `supabase` must carry the caller's own session, not the service role: the
 * RPC is SECURITY INVOKER, so `properties` RLS and the admin check both
 * evaluate against the signed-in user.
 */
export async function countKnockable(
  supabase: SupabaseClient<Database>,
  ring: Ring,
): Promise<CountResult> {
  const problem = ringProblem(ring);
  if (problem) {
    return { ok: false, code: problem, message: RING_PROBLEM_MESSAGES[problem] };
  }

  const { data, error } = await supabase.rpc("count_door_eligibility", {
    poly: ringToEwkt(ring),
  });

  if (error) return mapPropRpcError(error);

  const row = data?.[0];
  if (!row) {
    return {
      ok: false,
      code: "unavailable",
      message: "The door count is unavailable. Check your connection and try again.",
      detail: "count_door_eligibility returned no rows",
    };
  }

  return {
    ok: true,
    count: {
      total: row.total,
      knockable: row.knockable,
      multiUnit: row.multi_unit,
      nccz: row.nccz,
      excluded: row.multi_unit + row.nccz,
    },
  };
}
