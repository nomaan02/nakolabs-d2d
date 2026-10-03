import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import type { Slot, SweepDirection } from "@/lib/geo/rotation";

export type DoorProperties = { uprn: number; sequence: number; knockable?: boolean };

export type DoorCollection = GeoJSON.FeatureCollection<GeoJSON.Point, DoorProperties>;

export type TodaysAssignment = {
  assignment_id: string;
  territory_id: string;
  territory_name: string;
  work_date: string;
  visit_number: number;
  sweep_direction: SweepDirection;
  slot: Slot;
  entry_vertex_index: number;
  entry_compass: string;
  door_count: number;
  doors: DoorCollection;
};

export type TodaysAssignmentResult =
  | { ok: true; assignment: TodaysAssignment }
  | { ok: true; assignment: null }
  | { ok: false; message: string; detail?: string };

function isSweep(value: unknown): value is SweepDirection {
  return value === "cw" || value === "ccw";
}

function isSlot(value: unknown): value is Slot {
  return value === "early" || value === "mid" || value === "late";
}

function isPointFeature(value: unknown): value is GeoJSON.Feature<GeoJSON.Point, DoorProperties> {
  if (!value || typeof value !== "object") return false;
  const feature = value as GeoJSON.Feature;
  if (feature.type !== "Feature") return false;
  if (!feature.geometry || feature.geometry.type !== "Point") return false;
  if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) {
    return false;
  }
  const props = feature.properties as DoorProperties | null;
  if (!props || typeof props.uprn !== "number" || typeof props.sequence !== "number") {
    return false;
  }
  return true;
}

/**
 * Parses the RPC jsonb. Returns null for JSON null (no assignment today)
 * and throws if the document is the wrong shape.
 */
export function parseTodaysAssignment(data: Json | null): TodaysAssignment | null {
  if (data === null) return null;
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error("todays_assignment did not return an object");
  }

  const row = data as Record<string, Json | undefined>;
  const doors = row.doors;
  if (!doors || typeof doors !== "object" || Array.isArray(doors)) {
    throw new Error("todays_assignment missing doors FeatureCollection");
  }
  const collection = doors as Record<string, Json | undefined>;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("todays_assignment doors is not a FeatureCollection");
  }
  if (!collection.features.every(isPointFeature)) {
    throw new Error("todays_assignment doors contains a malformed feature");
  }
  if (typeof row.assignment_id !== "string" || typeof row.territory_id !== "string") {
    throw new Error("todays_assignment missing ids");
  }
  if (typeof row.territory_name !== "string" || typeof row.work_date !== "string") {
    throw new Error("todays_assignment missing territory or date");
  }
  if (typeof row.visit_number !== "number" || typeof row.entry_vertex_index !== "number") {
    throw new Error("todays_assignment missing visit fields");
  }
  if (!isSweep(row.sweep_direction) || !isSlot(row.slot)) {
    throw new Error("todays_assignment has an unknown rotation");
  }
  if (typeof row.entry_compass !== "string" || typeof row.door_count !== "number") {
    throw new Error("todays_assignment missing compass or door count");
  }

  return {
    assignment_id: row.assignment_id,
    territory_id: row.territory_id,
    territory_name: row.territory_name,
    work_date: row.work_date,
    visit_number: row.visit_number,
    sweep_direction: row.sweep_direction,
    slot: row.slot,
    entry_vertex_index: row.entry_vertex_index,
    entry_compass: row.entry_compass,
    door_count: row.door_count,
    doors: {
      type: "FeatureCollection",
      features: collection.features as unknown as GeoJSON.Feature<GeoJSON.Point, DoorProperties>[],
    },
  };
}

/**
 * Fallback header when the assignment has no new-engine route. Visit, slot
 * and door count are stored facts. The withdrawn sweep wording is not shown.
 */
export function formatAssignmentHeader(assignment: TodaysAssignment): string {
  return [
    `Visit ${assignment.visit_number}`,
    assignment.slot,
    `${assignment.door_count.toLocaleString("en-GB")} doors`,
  ].join(" · ");
}

/**
 * Reads today's assignment for the signed-in user. `supabase` must carry
 * their session, not the service role. JSON null is an empty result.
 */
export async function fetchTodaysAssignment(
  supabase: SupabaseClient<Database>,
): Promise<TodaysAssignmentResult> {
  const { data, error } = await supabase.rpc("todays_assignment");

  if (error) {
    return {
      ok: false,
      message: "Today's prop could not be loaded. Check your connection and try again.",
      detail: [error.code, error.hint, error.message].filter(Boolean).join(" | "),
    };
  }

  try {
    const assignment = parseTodaysAssignment(data);
    return { ok: true, assignment };
  } catch (caught) {
    return {
      ok: false,
      message: "Today's prop could not be read. Try again.",
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
}
