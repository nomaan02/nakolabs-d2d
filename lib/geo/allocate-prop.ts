import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { Slot, SweepDirection } from "@/lib/geo/rotation";

export type Allocation = {
  id: string;
  visitNumber: number;
  entryVertexIndex: number;
  sweepDirection: SweepDirection;
  slot: Slot;
  knockableDoors: number;
};

export type AllocateFailureCode =
  | "not_admin"
  | "missing_territory"
  | "missing_date"
  | "empty_team"
  | "not_canvasser"
  | "archived_prop"
  | "degenerate_polygon"
  | "no_knockable_doors"
  | "already_allocated"
  | "duplicate_member"
  | "team_too_large"
  | "canvasser_double_booked"
  | "unavailable";

export type AllocateResult =
  | { ok: true; allocation: Allocation }
  | { ok: false; code: AllocateFailureCode; message: string; detail?: string };

const SERVER_HINTS = new Set<string>([
  "not_admin",
  "missing_territory",
  "missing_date",
  "empty_team",
  "not_canvasser",
  "archived_prop",
  "degenerate_polygon",
  "no_knockable_doors",
  "already_allocated",
  "duplicate_member",
  "team_too_large",
  "canvasser_double_booked",
]);

function isSweep(value: string): value is SweepDirection {
  return value === "cw" || value === "ccw";
}

function isSlot(value: string): value is Slot {
  return value === "early" || value === "mid" || value === "late";
}

/**
 * Turns a PostgREST error into something the allocate form can display.
 * Known failures keep the British English message written in the migration.
 */
export function mapAllocateRpcError(error: PostgrestError): Extract<AllocateResult, { ok: false }> {
  const hint = error.hint ?? "";

  if (SERVER_HINTS.has(hint)) {
    return {
      ok: false,
      code: hint as AllocateFailureCode,
      message: error.message,
      detail: error.details ?? undefined,
    };
  }

  if (error.code === "42501") {
    return {
      ok: false,
      code: "not_admin",
      message: "Only an admin can allocate a prop.",
      detail: error.message,
    };
  }

  return {
    ok: false,
    code: "unavailable",
    message: "That allocation could not be saved. Try again.",
    detail: [error.code, error.hint, error.message, error.details].filter(Boolean).join(" | "),
  };
}

/**
 * Allocates a prop to a team for one date. The RPC does rotation, the
 * interim geometric snapshot, and both inserts in one statement.
 *
 * `supabase` must carry the admin's own session, not the service role.
 */
export async function allocateProp(
  supabase: SupabaseClient<Database>,
  input: { territoryId: string; workDate: string; canvasserIds: string[] },
): Promise<AllocateResult> {
  if (!input.territoryId) {
    return { ok: false, code: "missing_territory", message: "Pick a prop to allocate." };
  }
  if (!input.workDate) {
    return { ok: false, code: "missing_date", message: "Pick a date for this allocation." };
  }
  if (input.canvasserIds.length === 0) {
    return { ok: false, code: "empty_team", message: "Pick at least one canvasser." };
  }

  const { data, error } = await supabase.rpc("allocate_prop", {
    territory_id: input.territoryId,
    work_date: input.workDate,
    canvasser_ids: input.canvasserIds,
  });

  if (error) {
    return mapAllocateRpcError(error);
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0];
  if (!row || !isSweep(row.sweep_direction) || !isSlot(row.slot)) {
    return {
      ok: false,
      code: "unavailable",
      message: "That allocation could not be saved. Try again.",
      detail: "allocate_prop returned no row",
    };
  }

  return {
    ok: true,
    allocation: {
      id: row.id,
      visitNumber: row.visit_number,
      entryVertexIndex: row.entry_vertex_index,
      sweepDirection: row.sweep_direction,
      slot: row.slot,
      knockableDoors: row.knockable_doors,
    },
  };
}
