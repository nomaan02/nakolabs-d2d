/**
 * UI item 2, Session M2 — door dots on the pavement walkline.
 *
 *   npm run verify:anchors
 *
 * Pure checks, then one read-only pass on REF - Speedwell's open assignment.
 * SELECT only. No insert, update or delete.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { anchorDoorCollection } from "../lib/map/anchor-doors-collection";
import {
  anchorDoors,
  spread,
  type AnchorDoor,
  type AnchorStep,
} from "../lib/map/door-anchors";
import type { DoorCollection, DoorProperties } from "../lib/geo/todays-assignment";
import type { Database } from "../lib/supabase/types";
import { loadEnvLocal, requiredEnv } from "./lib/env";

loadEnvLocal();

const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

type Client = SupabaseClient<Database>;

const service: Client = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function line(text = "") {
  console.log(text);
}

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  line(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

function near(actual: number[], expected: number[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => Math.abs(value - expected[index]!) < 1e-9)
  );
}

function metres(a: [number, number], b: [number, number]): number {
  const lat0 = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const kx = 111320 * Math.cos(lat0);
  const ky = 110574;
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function asPoint(value: unknown): [number, number] | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  const coordinates = (parsed as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function asLine(value: unknown): [number, number][] | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as { type?: string; coordinates?: unknown };
  if (row.type !== "LineString" || !Array.isArray(row.coordinates)) return null;
  const coordinates: [number, number][] = [];
  for (const pair of row.coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    coordinates.push([lng, lat]);
  }
  return coordinates.length >= 2 ? coordinates : null;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pure(): void {
  line("Door anchors — pure checks");
  check("spread([5,5,5], 0, 10, 2.5) = [2.5, 5, 7.5]", near(spread([5, 5, 5], 0, 10, 2.5), [2.5, 5, 7.5]));
  check("spread([1,2,3,4], 0, 3, 2.5) = [0, 1, 2, 3]", near(spread([1, 2, 3, 4], 0, 3, 2.5), [0, 1, 2, 3]));
  check("spread([], 0, 5, 2.5) = []", near(spread([], 0, 5, 2.5), []));

  const lat = 51.45;
  const lng0 = -2.55;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const at = (east: number): [number, number] => [lng0 + east / kx, lat];
  const walk: [number, number][] = [at(0), at(100)];
  const doors: AnchorDoor[] = [];
  for (let i = 0; i < 10; i++) {
    const stacked = i >= 2 && i <= 5;
    doors.push({
      uprn: 5000 + i,
      sequence: i,
      coordinates: at(stacked ? 40 : 5 + i * 9),
    });
  }
  const placed = anchorDoors(doors, [{ kind: "work", first_seq: 0, last_seq: 9, walk }]);
  const along = placed.map((door) => (door.coordinates[0] - lng0) * kx);
  let minGap = Infinity;
  let ordered = true;
  let inside = true;
  for (let i = 0; i < along.length; i++) {
    const value = along[i]!;
    if (value < 1 - 1e-6 || value > 99 + 1e-6) inside = false;
    if (i === 0) continue;
    const gap = value - along[i - 1]!;
    if (gap < minGap) minGap = gap;
    if (!(gap >= 2.5 - 1e-6)) ordered = false;
  }
  check(
    "100 m walkline, 10 doors, 4 stacked: gap, order, [1, 99] m",
    placed.length === 10 && placed.every((door) => door.anchored) && ordered && inside,
    `minGap ${minGap.toFixed(3)} m`,
  );

  const outsider: AnchorDoor = { uprn: 8, sequence: 99, coordinates: [-2.48, 51.46] };
  const kept = anchorDoors([outsider], [{ kind: "work", first_seq: 0, last_seq: 5, walk }]);
  check(
    "sequence outside every work step stays put",
    kept[0]?.anchored === false &&
      kept[0].coordinates[0] === outsider.coordinates[0] &&
      kept[0].coordinates[1] === outsider.coordinates[1],
  );

  const crossDoor: AnchorDoor = { uprn: 7, sequence: 3, coordinates: [-2.499, 51.4501] };
  const crossWalk: [number, number][] = [
    [-2.5, 51.45],
    [-2.498, 51.45],
  ];
  const crossed = anchorDoors(
    [crossDoor],
    [{ kind: "cross", first_seq: 0, last_seq: 10, walk: crossWalk }],
  );
  check(
    "a cross step is ignored",
    crossed[0]?.anchored === false &&
      crossed[0].coordinates[0] === crossDoor.coordinates[0] &&
      crossed[0].coordinates[1] === crossDoor.coordinates[1],
  );

  const empty: DoorCollection = { type: "FeatureCollection", features: [] };
  check("empty steps returns the same collection", anchorDoorCollection(empty, []) === empty);

  const sample: DoorCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { uprn: 1, sequence: 0 },
        geometry: { type: "Point", coordinates: [-2.5, 51.45] },
      },
    ],
  };
  const wrapped = anchorDoorCollection(sample, [
    { kind: "cross", first_seq: 0, last_seq: 0, walk: crossWalk },
  ]);
  const props = wrapped.features[0]?.properties as (DoorProperties & { anchored: boolean }) | undefined;
  check(
    "collection cross step keeps the point and sets anchored false",
    props?.anchored === false &&
      wrapped.features[0]?.geometry.coordinates[0] === sample.features[0]?.geometry.coordinates[0] &&
      wrapped.features[0]?.geometry.coordinates[1] === sample.features[0]?.geometry.coordinates[1],
  );

  const input = syntheticDoors(2000, 60);
  anchorDoorCollection(input.doors, input.steps);
  const started = performance.now();
  const timed = anchorDoorCollection(input.doors, input.steps);
  const ms = performance.now() - started;
  line(`  2000 doors / 60 steps: ${ms.toFixed(2)} ms`);
  check("2000-door anchorDoorCollection under 30 ms", ms < 30 && timed.features.length === 2000, `${ms.toFixed(2)} ms`);
}

function syntheticDoors(doorCount: number, stepCount: number): { doors: DoorCollection; steps: AnchorStep[] } {
  const lat = 51.45;
  const lng0 = -2.58;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110574;
  const base = Math.floor(doorCount / stepCount);
  const extra = doorCount % stepCount;
  const features: DoorCollection["features"] = [];
  const steps: AnchorStep[] = [];
  let sequence = 0;
  for (let s = 0; s < stepCount; s++) {
    const count = base + (s < extra ? 1 : 0);
    const first = sequence;
    const north = s * 40;
    const lengthM = Math.max((count - 1) * 8, 10);
    const walk: [number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const east = (lengthM * i) / 6;
      walk.push([lng0 + east / kx, lat + north / ky]);
    }
    for (let d = 0; d < count; d++) {
      const stacked = s === 0 && d < 4;
      const east = stacked ? lengthM / 2 : count === 1 ? lengthM / 2 : (d / (count - 1)) * lengthM;
      features.push({
        type: "Feature",
        properties: { uprn: 8_000_000_000 + sequence, sequence },
        geometry: {
          type: "Point",
          coordinates: [lng0 + east / kx, lat + (north + 12) / ky],
        },
      });
      sequence += 1;
    }
    steps.push({ kind: "work", first_seq: first, last_seq: sequence - 1, walk });
  }
  return { doors: { type: "FeatureCollection", features }, steps };
}

async function live(): Promise<void> {
  line("");
  line("REF - Speedwell — read-only");
  const territory = await service.from("territories").select("id").eq("name", "REF - Speedwell").maybeSingle();
  if (territory.error || !territory.data) {
    check("REF - Speedwell territory", false, territory.error?.message ?? "missing");
    return;
  }

  const assignments = await service
    .from("assignments")
    .select("id, visit_number, closed_at, uprn_snapshot")
    .eq("territory_id", territory.data.id)
    .is("closed_at", null);
  if (assignments.error || !assignments.data) {
    check("open assignment", false, assignments.error?.message ?? "query failed");
    return;
  }

  const open = assignments.data;
  const sized = open.filter((row) => row.uprn_snapshot.length === 182);
  const pool = sized.length > 0 ? sized : open;
  const chosen = [...pool].sort((a, b) => b.visit_number - a.visit_number)[0];
  if (!chosen) {
    check("open assignment", false, "none");
    return;
  }
  line(`  assignment ${chosen.id} visit ${chosen.visit_number} snapshot ${chosen.uprn_snapshot.length}`);

  const snapshot = chosen.uprn_snapshot.map((value) => Number(value));
  const coords = new Map<number, [number, number]>();
  for (let i = 0; i < snapshot.length; i += 100) {
    const slice = snapshot.slice(i, i + 100);
    const props = await service.from("properties").select("uprn, geom").in("uprn", slice);
    if (props.error) throw new Error(props.error.message);
    for (const row of props.data ?? []) {
      const point = asPoint(row.geom);
      if (point) coords.set(Number(row.uprn), point);
    }
  }

  const loaded = await service
    .from("route_steps")
    .select("kind, first_seq, last_seq, walk_geom, step_index")
    .eq("assignment_id", chosen.id)
    .order("step_index", { ascending: true });
  if (loaded.error || !loaded.data) {
    check("route_steps", false, loaded.error?.message ?? "missing");
    return;
  }

  const doors: AnchorDoor[] = [];
  let missing = 0;
  snapshot.forEach((uprn, sequence) => {
    const coordinates = coords.get(uprn);
    if (!coordinates) {
      missing += 1;
      return;
    }
    doors.push({ uprn, sequence, coordinates });
  });
  check("property point for every snapshot door", missing === 0, `missing ${missing}`);

  const steps: AnchorStep[] = loaded.data.map((row) => ({
    kind: row.kind,
    first_seq: row.first_seq,
    last_seq: row.last_seq,
    walk: asLine(row.walk_geom),
  }));
  const result = anchorDoors(doors, steps);
  const anchored = result.filter((door) => door.anchored);
  check("anchored count = 182", anchored.length === 182, String(anchored.length));

  let minGap = Infinity;
  for (const step of steps) {
    if (step.kind !== "work" || step.first_seq === null || step.last_seq === null) continue;
    const mine = result
      .filter((door) => door.sequence >= step.first_seq! && door.sequence <= step.last_seq!)
      .sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < mine.length; i++) {
      const gap = metres(mine[i - 1]!.coordinates, mine[i]!.coordinates);
      if (gap < minGap) minGap = gap;
    }
  }
  check("minimum neighbour gap within a step ≥ 2.49 m", minGap >= 2.49, `${minGap.toFixed(3)} m`);

  const moves = result.map((door) => {
    const from = coords.get(door.uprn);
    return from ? metres(from, door.coordinates) : Infinity;
  });
  const minMove = Math.min(...moves);
  const maxMove = Math.max(...moves);
  const medMove = median(moves);
  line(
    `  move m: min ${minMove.toFixed(2)} median ${medMove.toFixed(2)} max ${maxMove.toFixed(2)}`,
  );
  check("maximum move ≤ 30 m", maxMove <= 30, `${maxMove.toFixed(2)} m`);
}

async function main(): Promise<void> {
  pure();
  await live();
  line("");
  if (failures > 0) {
    line(`FAIL  ${failures}`);
    process.exit(1);
  }
  line("PASS");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
