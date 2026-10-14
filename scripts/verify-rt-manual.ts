/**
 * RT (owner 2026-10-13): browser- and database-free checks for manual routes.
 * A small synthetic street network (no real doors) is built in memory; the
 * drawn chains below exercise every way two doors can follow each other.
 *
 *   npm run verify:rt
 */
import {
  canRedoRoute,
  canUndoRoute,
  doorsAlongStroke,
  drawnRouteLine,
  eraseDoor,
  leftOutDoors,
  linkDoors,
  reconcileDrawing,
  redoRoute,
  routeCountLine,
  routeSaveLines,
  routeToolbarHint,
  startRouteDraw,
  undoRoute,
} from "../lib/admin/route-draw";
import { routeDoorStates } from "../lib/map/route-draw-layers";
import { buildRouteGraph, type LonLat, type RouteDoor, type RouteInputs } from "../lib/geo/route-graph";
import { buildDemand } from "../lib/geo/walk/demand";
import { ARC_POINTS } from "../lib/geo/walk/geometry";
import { buildManualVariant, buildManualVariants, handOf } from "../lib/geo/walk/manual";
import { variantForStorage } from "../lib/geo/walk/save";
import type { WalkVariant } from "../lib/geo/walk/types";
import { validateVariant } from "../lib/geo/walk/validate";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Synthetic network, in metres around a Bristol origin
// ---------------------------------------------------------------------------

const ORIGIN: LonLat = [-2.6, 51.45];
const M_LAT = 1 / 111195;
const M_LON = 1 / (111195 * Math.cos((ORIGIN[1] * Math.PI) / 180));
const ll = (x: number, y: number): LonLat => [ORIGIN[0] + x * M_LON, ORIGIN[1] + y * M_LAT];

//   N1(0,0) — Main Road — N2(100,0) — Main Road — N3(200,0)
//                           |                       \ Curve Lane (bends)
//                      Side Street (dead end)        N5(260,-60)
//                           |                       /
//                         N4(100,-120) — Back Lane — N6(200,-120)
const NODES: [number, number, number][] = [
  [1, 0, 0],
  [2, 100, 0],
  [3, 200, 0],
  [4, 100, -120],
  [5, 260, -60],
  [6, 200, -120],
  [7, 100, -200],
];
const SEGMENTS: { id: number; way: number; from: number; to: number; name: string | null; xy: [number, number][] }[] = [
  { id: 11, way: 1, from: 1, to: 2, name: "Main Road", xy: [[0, 0], [100, 0]] },
  { id: 12, way: 1, from: 2, to: 3, name: "Main Road", xy: [[100, 0], [200, 0]] },
  { id: 13, way: 2, from: 2, to: 4, name: "Side Street", xy: [[100, 0], [100, -120]] },
  { id: 14, way: 3, from: 3, to: 5, name: "Curve Lane", xy: [[200, 0], [235, -15], [255, -35], [260, -60]] },
  { id: 15, way: 4, from: 4, to: 6, name: "Back Lane", xy: [[100, -120], [200, -120]] },
  { id: 16, way: 5, from: 6, to: 5, name: "Back Lane", xy: [[200, -120], [240, -100], [260, -60]] },
  { id: 17, way: 6, from: 4, to: 7, name: "Dead End Close", xy: [[100, -120], [100, -200]] },
];
const lenM = (xy: [number, number][]) => xy.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - xy[i][0], p[1] - xy[i][1]), 0);

// Doors: 12 m off the centreline, every 10 m. UPRN = street code * 1000 + side * 100 + index.
const doors: RouteDoor[] = [];
function row(code: number, side: 0 | 1, pts: [number, number][]): number[] {
  const out: number[] = [];
  pts.forEach(([x, y], i) => {
    const uprn = code * 1000 + side * 100 + i;
    const [lon, lat] = ll(x, y);
    doors.push({ uprn, lon, lat });
    out.push(uprn);
  });
  return out;
}
const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let v = a; step > 0 ? v <= b : v >= b; v += step) out.push(v);
  return out;
};
const mainNorth = row(1, 0, range(5, 195, 10).map((x) => [x, 12] as [number, number]));
const mainSouth = row(1, 1, range(5, 195, 10).filter((x) => Math.abs(x - 100) > 14).map((x) => [x, -12] as [number, number]));
const sideWest = row(2, 0, range(-20, -110, -10).map((y) => [88, y] as [number, number]));
const sideEast = row(2, 1, range(-20, -110, -10).map((y) => [112, y] as [number, number]));
const backNorth = row(3, 0, range(115, 185, 10).map((x) => [x, -108] as [number, number]));
const closeWest = row(4, 0, range(-130, -195, -10).map((y) => [88, y] as [number, number]));
const closeEast = row(4, 1, range(-130, -195, -10).map((y) => [112, y] as [number, number]));

const inputs: RouteInputs = {
  assignmentId: "",
  territoryId: "synthetic",
  visitNumber: 0,
  entryVertexIndex: 0,
  sweepDirection: "cw",
  knockCount: 0,
  hasRoute: false,
  snapshotCount: doors.length,
  centroid: ll(130, -80),
  ring: [ll(-10, 30), ll(280, 30), ll(280, -210), ll(-10, -210)],
  nodes: NODES.map(([id, x, y]) => ({ id, lon: ll(x, y)[0], lat: ll(x, y)[1] })),
  segments: SEGMENTS.map((s) => ({
    id: s.id,
    osmWayId: s.way,
    fromNode: s.from,
    toNode: s.to,
    name: s.name,
    highway: "residential",
    lengthM: lenM(s.xy),
    coords: s.xy.map(([x, y]) => ll(x, y)),
  })),
  doors: [...doors].sort((a, b) => a.uprn - b.uprn),
};
const graph = buildRouteGraph(inputs);
const demand = buildDemand(graph, inputs.doors);
const C = inputs.centroid;

function build(chain: number[]): WalkVariant {
  const r = buildManualVariant(graph, demand, chain, "manual", C);
  if (!r.ok) throw new Error(`build failed: ${r.code}`);
  return r.variant;
}

/** Every door is knocked by exactly one work step, in chain order, on the step's own road. */
function doorsCovered(v: WalkVariant): boolean {
  let next = 0;
  for (const s of v.steps) {
    if (s.kind !== "work") {
      if (s.first_seq !== null || s.last_seq !== null) return false;
      continue;
    }
    if (s.first_seq !== next || s.last_seq === null || s.last_seq < s.first_seq) return false;
    for (let k = s.first_seq; k <= s.last_seq; k += 1) {
      const snap = demand.doors.find((d) => d.uprn === v.door_order[k]);
      if (!snap || graph.segments[snap.segment].id !== s.segment_id) return false;
    }
    next = s.last_seq + 1;
  }
  return next === v.door_order.length;
}

/** Mirrors the per-step checks `territory_manual_route_save` runs (migration 040). */
function storable(v: WalkVariant): boolean {
  if (v.steps.length === 0 || v.stranded_count !== 0) return false;
  return v.steps.every(
    (s) =>
      ["work", "cross", "walk"].includes(s.kind) &&
      (s.side === "left" || s.side === "right") &&
      s.instruction !== "" &&
      s.centreline.length >= 2 &&
      s.walkline.length >= 2 &&
      s.length_m >= 0 &&
      Number.isFinite(s.from_node) &&
      Number.isFinite(s.to_node) &&
      (s.first_seq === null) === (s.last_seq === null) &&
      (s.first_seq === null || (s.kind === "work" && s.first_seq >= 0 && (s.last_seq as number) < v.door_order.length && s.first_seq <= (s.last_seq as number))),
  );
}

const kinds = (v: WalkVariant) => v.steps.map((s) => s.kind).join(",");
const crosses = (v: WalkVariant) => v.steps.filter((s) => s.kind === "cross");

console.log("\nRT manual routes — synthetic network");
console.log(`  ${doors.length} doors, ${graph.segments.length} segments`);

console.log("\n1. One street, out on one side and back on the other (U-turn)");
{
  const chain = [...mainNorth.slice(10), ...[...mainSouth.slice(9)].reverse()];
  const v = build(chain);
  const cross = crosses(v);
  check("door order is the drawn order", JSON.stringify(v.door_order) === JSON.stringify(chain));
  check("one crossing, drawn as the 9-point U-turn arc", cross.length === 1 && cross[0].walkline.length === ARC_POINTS, kinds(v));
  check("the walk after the U-turn says come back", v.steps.some((s) => s.instruction.startsWith("Come back down Main Road")));
  check("every door knocked once, on its own road", doorsCovered(v));
  check("geometry checks V1–V6 pass", validateVariant(v).length === 0, JSON.stringify(validateVariant(v).slice(0, 3)));
  check("nothing stranded, no warnings", v.stranded_count === 0 && v.warnings.length === 0);
}

console.log("\n2. Crossing mid-street and carrying on (forward cross)");
{
  const chain = [...mainNorth.slice(0, 4), ...mainSouth.slice(4, 8)];
  const v = build(chain);
  const cross = crosses(v);
  check("one crossing, a straight line (2 points)", cross.length === 1 && cross[0].walkline.length === 2, kinds(v));
  check("no 'come back' after a forward cross; it says cross the road", !v.steps.some((s) => s.instruction.startsWith("Come back")) && cross[0]?.instruction === "Cross Main Road");
  check("every door knocked once", doorsCovered(v));
  check("geometry checks pass", validateVariant(v).length === 0, JSON.stringify(validateVariant(v).slice(0, 3)));
}

console.log("\n3. Turning the corner on the same hand (no crossing)");
{
  // Main Road south side walking west to the junction, then Side Street east side walking south: both on the left.
  const chain = [...[...mainSouth.slice(9)].reverse(), ...sideEast];
  const v = build(chain);
  check("no crossing", crosses(v).length === 0, kinds(v));
  check("a turn into Side Street", v.steps.some((s) => /^Turn (left|right) into Side Street/.test(s.instruction)), v.steps.map((s) => s.instruction).join(" | "));
  check("doors stay on the walker's left", v.steps.filter((s) => s.kind === "work").every((s) => s.side === "left"));
  check("every door knocked once", doorsCovered(v));
  check("geometry checks pass", validateVariant(v).length === 0, JSON.stringify(validateVariant(v).slice(0, 3)));
}

console.log("\n4. A street change that needs the other hand (follow the roads, cross where they join the next road)");
{
  // Main Road south side walking east (doors on the right), then Back Lane north side walking east (on the left).
  const chain = [...mainSouth.slice(0, 5), ...backNorth];
  const v = build(chain);
  check("one straight crossing, on Back Lane", crosses(v).length === 1 && crosses(v)[0].walkline.length === 2 && crosses(v)[0].street_name === "Back Lane", kinds(v));
  check("the leg follows the road graph (walk steps on real segments)", v.steps.some((s) => s.kind === "walk" && s.segment_id !== null));
  check("no straight-line transfer", v.straight_transfers === 0);
  check("every door knocked once", doorsCovered(v));
  check("geometry checks pass", validateVariant(v).length === 0, JSON.stringify(validateVariant(v).slice(0, 3)));
}

console.log("\n5. The whole network, both variants");
{
  const chain = [
    ...mainNorth,
    ...[...mainSouth].reverse().filter((u) => mainSouth.indexOf(u) >= 8),
    ...sideEast,
    ...closeEast,
    ...[...closeWest].reverse(),
    ...[...sideWest].reverse(),
    ...[...mainSouth.slice(0, 8)].reverse(),
  ];
  const r = buildManualVariants(graph, demand, chain, C);
  check("both variants build", r.ok);
  if (r.ok) {
    check("keys manual and manual_reversed", r.manual.key === "manual" && r.reversed.key === "manual_reversed");
    check("reversed door order is the drawn order backwards", JSON.stringify(r.reversed.door_order) === JSON.stringify([...chain].reverse()));
    check("every door knocked once (both)", doorsCovered(r.manual) && doorsCovered(r.reversed));
    check("geometry checks pass (both)", validateVariant(r.manual).length + validateVariant(r.reversed).length === 0,
      JSON.stringify([...validateVariant(r.manual), ...validateVariant(r.reversed)].slice(0, 3)));
    check("storable: the SQL step checks pass (both)", storable(r.manual) && storable(r.reversed));
    check("the dead end is a U-turn arc", crosses(r.manual).some((s) => s.walkline.length === ARC_POINTS && s.street_name === "Dead End Close"));
    check("last instruction finishes at the last door", r.manual.steps[r.manual.steps.length - 1].instruction.endsWith("— finish at the last door"));
    check("storage document drops the verification aids", (() => {
      const doc = variantForStorage(r.manual) as Record<string, unknown>;
      return !("tree" in doc) && !("walk_meta" in doc) && Array.isArray(doc.steps);
    })());
    const again = buildManualVariants(graph, demand, chain, C);
    check("deterministic: the same chain gives the same documents", again.ok && JSON.stringify(again) === JSON.stringify(r));
  }
}

console.log("\n6. Doors left out, one door, and refusals");
{
  const v = build(mainNorth.filter((_, i) => i % 3 === 0));
  check("a chain with gaps orders only the drawn doors", v.door_order.length === 7 && doorsCovered(v));
  const one = buildManualVariant(graph, demand, [sideEast[3]], "manual", C);
  check("one door is refused (too_short): it could never be frozen", !one.ok && one.code === "too_short");
  const opposite = build([mainNorth[2], mainSouth[2]]);
  check("two doors opposite each other make a route (the crossing has length)", opposite.total_m > 0 && doorsCovered(opposite) && storable(opposite));
  const firstCross = build([mainNorth[2], mainSouth[2], mainSouth[3]]);
  check("crossing straight after the first door keeps it on its own pavement", doorsCovered(firstCross) && validateVariant(firstCross).length === 0, kinds(firstCross));
  const empty = buildManualVariant(graph, demand, [], "manual", C);
  check("empty chain refused (no_doors)", !empty.ok && empty.code === "no_doors");
  const dup = buildManualVariant(graph, demand, [mainNorth[0], mainNorth[0]], "manual", C);
  check("duplicate refused (duplicate_door)", !dup.ok && dup.code === "duplicate_door");
  const unknown = buildManualVariant(graph, demand, [mainNorth[0], 999999], "manual", C);
  check("unknown door refused (unknown_door)", !unknown.ok && unknown.code === "unknown_door");
}

console.log("\n6b. Zigzag up a street, both ways");
{
  // Opposite pairs, walking west: S8, N8, S7, N7, S6 (and its reverse).
  const chain = [mainSouth[7], mainNorth[7], mainSouth[6], mainNorth[6], mainSouth[5]];
  const r = buildManualVariants(graph, demand, chain, C);
  check("both variants build", r.ok);
  if (r.ok) {
    for (const v of [r.manual, r.reversed]) {
      check(`${v.key}: forward crossings only, no U-turn arcs`, crosses(v).every((s) => s.walkline.length === 2) && !v.steps.some((s) => s.instruction.startsWith("Come back")), kinds(v));
      check(`${v.key}: geometry checks pass`, validateVariant(v).length === 0, JSON.stringify(validateVariant(v).slice(0, 3)));
      check(`${v.key}: every door knocked once`, doorsCovered(v));
    }
    check("starts with the first door's hand (walking west, south side = left)", r.manual.steps[0].instruction === "Start on Main Road, doors on your left", r.manual.steps[0].instruction);
  }
}

console.log("\n6c. Turning off a road away from the pavement crosses the road being left");
{
  // North pavement of Main Road walking east (left hand), then right into Side Street.
  for (const [label, next] of [["west side (other hand)", sideWest], ["east side (same hand)", sideEast]] as const) {
    const v = build([...mainNorth.slice(6, 9), ...next.slice(0, 4)]);
    const cross = crosses(v);
    check(`${label}: one crossing, of Main Road`, cross.length === 1 && cross[0].instruction === "Cross Main Road", v.steps.map((s) => s.instruction).join(" | "));
    check(`${label}: every door knocked once; geometry checks pass`, doorsCovered(v) && validateVariant(v).length === 0, JSON.stringify(validateVariant(v).slice(0, 3)));
  }
  // South pavement walking west (left hand), then left into Side Street, east side: no crossing at all.
  const v = build([...[...mainSouth.slice(9, 12)].reverse(), ...sideEast.slice(0, 3)]);
  check("turning towards the pavement: no crossing", crosses(v).length === 0, kinds(v));
}

console.log("\n7. Hands");
check("handOf: forward on side 0 is left, backward on side 0 is right", handOf(1, 0) === "left" && handOf(-1, 0) === "right" && handOf(1, 1) === "right" && handOf(-1, 1) === "left");

console.log("\n8. Speed (whole network drawn door by door, as the editor rebuilds it)");
{
  const chain = [...mainNorth, ...[...mainSouth].reverse(), ...sideEast, ...[...sideWest].reverse(), ...backNorth];
  const t0 = performance.now();
  for (let n = 2; n <= chain.length; n += 1) build(chain.slice(0, n));
  const per = (performance.now() - t0) / chain.length;
  check(`a rebuild takes under 20 ms on average (${per.toFixed(2)} ms)`, per < 20);
}

console.log("\n9. Drawing: history, erase, left out, reconcile (lib/admin/route-draw.ts)");
{
  let h = startRouteDraw();
  h = linkDoors(h, [5, 6, 6, 7]);
  check("linking skips doors already on the route; one step per door", JSON.stringify(h.present) === "[5,6,7]" && h.past.length === 3);
  h = undoRoute(h);
  check("undo takes off one door", JSON.stringify(h.present) === "[5,6]" && canRedoRoute(h));
  h = redoRoute(h);
  check("redo puts it back", JSON.stringify(h.present) === "[5,6,7]" && !canRedoRoute(h));
  h = eraseDoor(h, 6);
  check("erase re-links the neighbours (one step)", JSON.stringify(h.present) === "[5,7]" && canUndoRoute(h));
  check("erasing a door not on the route changes nothing", eraseDoor(h, 99) === h);
  h = linkDoors(h, [6]);
  check("a door taken off can be linked again, at the end", JSON.stringify(h.present) === "[5,7,6]");
  check("left out = every other door, ascending", JSON.stringify(leftOutDoors([5, 7], [9, 7, 5, 1])) === "[1,9]");
  const r = reconcileDrawing({ chain: [1, 2, 3], leftOut: [4, 5] }, [2, 3, 5, 6, 7]);
  check("reconcile: removed doors drop out; new doors are neither", JSON.stringify(r) === JSON.stringify({ chain: [2, 3], leftOut: [5], newDoors: [6, 7], removed: 2 }));
}
{
  const doors = [
    { uprn: 1, x: 10, y: 10 },
    { uprn: 2, x: 30, y: 10 },
    { uprn: 3, x: 50, y: 10 },
    { uprn: 4, x: 30, y: 40 },
  ];
  check("a stroke links the doors it passes, in order", JSON.stringify(doorsAlongStroke(doors, { x: 0, y: 11 }, { x: 60, y: 11 }, 12)) === "[1,2,3]");
  check("the same stroke backwards gives the reverse order", JSON.stringify(doorsAlongStroke(doors, { x: 60, y: 11 }, { x: 0, y: 11 }, 12)) === "[3,2,1]");
  check("a press links only the nearest door", JSON.stringify(doorsAlongStroke(doors, { x: 29, y: 12 }, { x: 29, y: 12 }, 12)) === "[2]");
  check("a stroke along one row does not pick the row across the street", !doorsAlongStroke(doors, { x: 0, y: 10 }, { x: 60, y: 10 }, 16).includes(4));
  check("nothing within reach: nothing linked", doorsAlongStroke(doors, { x: 0, y: 100 }, { x: 60, y: 100 }, 12).length === 0);
}
{
  const states = routeDoorStates({ chain: [1, 2], left: [3, 1], fresh: [4, 3], showEnd: true });
  check(
    "door states: linked, end on the last, left out, new (linked wins over left out)",
    states.get(1)?.linked === true && states.get(1)?.left === false && states.get(2)?.end === true && states.get(3)?.left === true && states.get(3)?.fresh === false && states.get(4)?.fresh === true,
  );
  check("words: count, hints, save sheet, card", routeCountLine(30, 72) === "30 of 72 doors" &&
    routeToolbarHint({ linked: 0, erasing: false, zoomedOut: false }) === "Start at any door" &&
    routeToolbarHint({ linked: 3, erasing: true, zoomedOut: false }) === "Tap a door to remove" &&
    routeToolbarHint({ linked: 3, erasing: false, zoomedOut: true }) === "Zoom in to draw" &&
    routeSaveLines(61, 72).summary === "61 of 72 doors are on the route." &&
    routeSaveLines(61, 72).leftOut === "11 doors are left out. They won't be knocked on this prop's visits." &&
    routeSaveLines(71, 72).leftOut === "1 door is left out. It won't be knocked on this prop's visits." &&
    routeSaveLines(72, 72).leftOut === null &&
    drawnRouteLine(61, 11) === "61 doors · 11 left out" && drawnRouteLine(72, 0) === "72 doors");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
