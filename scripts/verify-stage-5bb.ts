/**
 * Stage 5b-b evidence. Reads the live Northville route and runs the field
 * display rules. Prints counts, instructions and the first ten doors.
 * Does not print geometries.
 *
 *   npx tsx scripts/verify-stage-5bb.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import { collapseSpurRuns, describeRoute, type FieldRoute, type FieldRouteStep } from "../lib/field/route-display";
import { getCurrentStreetLabel, sequenceIsRouteDerived, type SequenceDoor } from "../lib/field/sequence";
import type { Database } from "../lib/supabase/types";

const NORTHVILLE = "97da5711-2911-496b-8787-4e8ce90ebb4a";

function line(text = "") {
  console.log(text);
}

function asLine(value: unknown): [number, number][] | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { type?: string; coordinates?: unknown };
  if (row.type !== "LineString" || !Array.isArray(row.coordinates)) return null;
  const coordinates: [number, number][] = [];
  for (const pair of row.coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    coordinates.push([Number(pair[0]), Number(pair[1])]);
  }
  return coordinates.length >= 2 ? coordinates : null;
}

function point(value: unknown): [number, number] | null {
  if (!value || typeof value !== "object") return null;
  const coordinates = (value as { coordinates?: unknown }).coordinates;
  if (
    Array.isArray(coordinates) &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    return [coordinates[0], coordinates[1]];
  }
  return null;
}

async function main() {
  loadEnvLocal();
  const service = createClient<Database>(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: assignment, error } = await service
    .from("assignments")
    .select("uprn_snapshot, route_stranded_count, route_length_m, route_geom")
    .eq("id", NORTHVILLE)
    .single();
  if (error || !assignment) throw new Error(error?.message ?? "no assignment");

  const { data: stepRows, error: stepError } = await service
    .from("route_steps")
    .select("step_index, segment_id, street_name, instruction, is_spur, cumulative_m, geom")
    .eq("assignment_id", NORTHVILLE)
    .order("step_index");
  if (stepError || !stepRows) throw new Error(stepError?.message ?? "no steps");

  const steps: FieldRouteStep[] = [];
  for (const row of stepRows) {
    const coordinates = asLine(row.geom);
    if (!coordinates) continue;
    steps.push({
      step_index: row.step_index,
      segment_id: row.segment_id,
      street_name: row.street_name,
      instruction: row.instruction,
      is_spur: row.is_spur,
      cumulative_m: Number(row.cumulative_m),
      coordinates,
      kind: null,
      side: null,
      walk: null,
      first_seq: null,
      last_seq: null,
      is_dead_end: false,
    });
  }

  const uprns = assignment.uprn_snapshot;
  const coords = new Map<number, [number, number]>();
  const labels = new Map<number, { house_number: string | null; street_name: string | null }>();
  for (let i = 0; i < uprns.length; i += 150) {
    const slice = uprns.slice(i, i + 150);
    const props = await service.from("properties").select("uprn, geom").in("uprn", slice);
    if (props.error) throw new Error(props.error.message);
    for (const row of props.data ?? []) {
      const coord = point(row.geom);
      if (coord) coords.set(row.uprn, coord);
    }
    const doors = await service
      .from("v_door_label")
      .select("uprn, house_number, street_name")
      .in("uprn", slice);
    if (doors.error) throw new Error(doors.error.message);
    for (const row of doors.data ?? []) {
      if (row.uprn === null) continue;
      labels.set(row.uprn, { house_number: row.house_number, street_name: row.street_name });
    }
  }

  const sequence: SequenceDoor[] = uprns.map((uprn, position) => {
    const lngLat = coords.get(uprn);
    if (!lngLat) throw new Error(`missing coordinates for a snapshot door at ${position}`);
    return { uprn, position, lngLat };
  });

  const lineGeom = asLine(assignment.route_geom);
  const route: FieldRoute = {
    hasRoute: lineGeom !== null,
    strandedCount: assignment.route_stranded_count,
    line: lineGeom ? { type: "LineString", coordinates: lineGeom } : null,
    variantKey: null,
    steps,
  };
  const described = describeRoute(sequence, route, true);
  const collapse = collapseSpurRuns(steps);

  const unrouted = describeRoute(
    sequence,
    { hasRoute: false, strandedCount: 0, line: null, variantKey: null, steps: [] },
    true,
  );
  const notReady = describeRoute(sequence, route, false);

  line(`hasRoute ${described.hasRoute}  steps ${steps.length}  line vertices ${lineGeom?.length ?? 0}`);
  line(`route_length_m ${assignment.route_length_m}  stranded column ${assignment.route_stranded_count}`);
  line(`spur steps ${collapse.spurSteps} -> spur cards ${collapse.spurCards}`);
  line(`sequenceIsRouteDerived(true) ${sequenceIsRouteDerived(true)}  false ${sequenceIsRouteDerived(false)}`);
  line(`unrouted cards ${unrouted.doors.filter((door) => door.cards.length > 0).length}  not-ready hasRoute ${notReady.hasRoute}`);

  const marked = described.doors.filter((door) => door.stranded).length;
  line(`stranded marked ${marked}`);

  let backward = 0;
  let maxJump = 0;
  let prev = -1;
  for (const door of described.doors) {
    if (door.stepIndex === null) continue;
    if (prev >= 0) {
      if (door.stepIndex < prev) backward += 1;
      maxJump = Math.max(maxJump, door.stepIndex - prev);
    }
    prev = door.stepIndex;
  }
  line(`backward step moves ${backward}  max forward jump ${maxJump}`);

  const transferAt = described.doors.findIndex((door) => door.cards.some((card) => card.kind === "transfer"));
  const spurAt = described.doors.findIndex((door) => door.cards.some((card) => card.kind === "spur"));
  const unnamedAt = described.doors.findIndex((door, index) => {
    const label = labels.get(sequence[index]!.uprn);
    const street = getCurrentStreetLabel(
      label
        ? { uprn: sequence[index]!.uprn, house_number: label.house_number, building_name: null, street_name: label.street_name }
        : undefined,
      door.routeStreet,
      true,
    );
    return door.routeStreet === null && street !== null && !door.stranded;
  });
  line(`first transfer door ${transferAt + 1}  first spur door ${spurAt + 1}  first unnamed-street door ${unnamedAt + 1}`);
  if (transferAt >= 0) line(`  transfer: ${described.doors[transferAt]!.cards.map((card) => card.text).join(" | ")}`);
  if (spurAt >= 0) line(`  spur: ${described.doors[spurAt]!.cards.map((card) => card.text).join(" | ")}`);
  if (unnamedAt >= 0) {
    const label = labels.get(sequence[unnamedAt]!.uprn);
    line(`  unnamed fallback plate street ${label?.house_number ?? "—"} ${label?.street_name ?? "—"}`);
  }

  line("first 10:");
  for (let i = 0; i < 10; i += 1) {
    const door = sequence[i]!;
    const view = described.doors[i]!;
    const label = labels.get(door.uprn);
    const street = getCurrentStreetLabel(
      label
        ? { uprn: door.uprn, house_number: label.house_number, building_name: null, street_name: label.street_name }
        : undefined,
      view.routeStreet,
      true,
    );
    const plate = label?.house_number?.trim() || label?.street_name?.trim() || "—";
    line(
      `  ${i + 1}  uprn ${door.uprn}  plate ${plate}  street ${street ?? "—"}  stranded ${view.stranded}  step ${view.stepIndex ?? "—"}  ${view.cards.map((card) => card.text).join(" | ") || "(no card)"}`,
    );
  }

  const transfer = described.doors.flatMap((door) => door.cards).find((card) => card.kind === "transfer");
  line(`transfer example: ${transfer?.text ?? "NONE"}`);

  let fallback: string | null = null;
  let serviceRoadPlates = 0;
  for (let i = 0; i < sequence.length; i += 1) {
    const door = sequence[i]!;
    const view = described.doors[i]!;
    const label = labels.get(door.uprn);
    const street = getCurrentStreetLabel(
      label
        ? { uprn: door.uprn, house_number: label.house_number, building_name: null, street_name: label.street_name }
        : undefined,
      view.routeStreet,
      true,
    );
    if (street?.toLowerCase() === "service road" || street?.toLowerCase() === "unnamed road") {
      serviceRoadPlates += 1;
    }
    if (!fallback && view.routeStreet === null && label?.street_name && street === label.street_name) {
      const plate = label.house_number?.trim() || "—";
      fallback = `${plate} ${label.street_name} (route street unnamed)`;
    }
  }
  line(`service-road plates ${serviceRoadPlates}`);
  line(`unnamed fallback: ${fallback ?? "NONE"}`);

  const examples = new Set<string>();
  for (const door of described.doors) {
    for (const card of door.cards) {
      if (card.kind === "step" || card.kind === "spur") examples.add(card.text);
      if (examples.size >= 3) break;
    }
    if (examples.size >= 3) break;
  }
  line(`instruction examples: ${[...examples].join(" || ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
