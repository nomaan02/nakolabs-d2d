/**
 * Stage 5b — from traversal legs to a committable route.
 *
 * Builds route_steps rows with the fixed instruction vocabulary, the route
 * LineString, and the reordered uprn_snapshot: every door snaps to its nearest
 * clipped segment, is assigned to the pass that works its side, and is ordered
 * by distance along the route. Doors more than 40 m from every clipped
 * segment are stranded — never dropped, appended at the end, counted.
 *
 * Pure: same inputs, same rotation, same output. See docs/ROUTE-DESIGN.md.
 */

import type { Rotation } from "@/lib/geo/rotation";
import {
  buildRouteGraph,
  displayStreet,
  halfEdgeLonLat,
  nearestNode,
  type LonLat,
  type RouteGraph,
  type RouteInputs,
  type XY,
} from "@/lib/geo/route-graph";
import { traverse, type Leg, type TraversalResult } from "@/lib/geo/route-traverse";

/** A door further than this from every clipped segment has no honest route position. */
export const STRANDED_THRESHOLD_M = 40;
/** Turns inside this band read as "continue", not "Left into" / "Right into". */
const CONTINUE_BAND_RAD = (30 * Math.PI) / 180;

export type RouteStepRow = {
  step_index: number;
  segment_id: number | null;
  street_name: string | null;
  instruction: string;
  is_spur: boolean;
  cumulative_m: number;
  wkt: string;
};

export type SnappedDoor = {
  uprn: number;
  segmentId: number;
  halfEdge: number;
  /** Planar metres from the door to the nearest clipped segment. */
  distanceM: number;
  /** Metres along the route at which this door is worked. */
  routePositionM: number;
  stranded: boolean;
};

export type RoutePlan = {
  steps: RouteStepRow[];
  routeWkt: string;
  routeLengthM: number;
  snapshot: number[];
  strandedCount: number;
  doors: SnappedDoor[];
  traversal: TraversalResult;
  graph: RouteGraph;
  entryNodeId: number;
  /** Working steps only (segment_id not null), for tests. */
  workingSteps: number;
  /** Wall-clock split, measured around the phases; never read inside them. */
  phaseMs: { traversalMs: number; snapOrderMs: number };
};

function tick(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toWkt(coords: LonLat[]): string {
  return `LINESTRING(${coords.map(([lon, lat]) => `${lon} ${lat}`).join(",")})`;
}

/** Appends coordinates, dropping a point that repeats the one before it. */
function extend(into: LonLat[], coords: LonLat[]): void {
  for (const c of coords) {
    const last = into[into.length - 1];
    if (last && last[0] === c[0] && last[1] === c[1]) continue;
    into.push(c);
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function nextWorkingStreet(graph: RouteGraph, legs: Leg[], from: number): string {
  for (let i = from; i < legs.length; i += 1) {
    const leg = legs[i];
    if (leg.kind === "work") {
      return displayStreet(graph.segments[graph.halfEdges[leg.halfEdge].segment]);
    }
  }
  return "unnamed road";
}

function buildSteps(
  graph: RouteGraph,
  traversal: TraversalResult,
): { steps: RouteStepRow[]; routeCoords: LonLat[]; routeLengthM: number } {
  const steps: RouteStepRow[] = [];
  const routeCoords: LonLat[] = [];
  let cumulative = 0;
  let previousName: string | null = null;

  traversal.legs.forEach((leg, i) => {
    if (leg.kind === "work") {
      const h = graph.halfEdges[leg.halfEdge];
      const seg = graph.segments[h.segment];
      const street = displayStreet(seg);
      const coords = halfEdgeLonLat(graph, h);
      cumulative += seg.lengthM;

      let instruction: string;
      if (leg.first) {
        instruction = `Start on ${street}`;
      } else if (leg.uturn) {
        instruction = "Cross to the far side and work back";
      } else if (h.headsToDeadEnd) {
        instruction = `Spur — ${street}, return the way you came`;
      } else if (
        leg.afterTransfer ||
        leg.turn === null ||
        (seg.name !== null && seg.name === previousName) ||
        Math.abs(leg.turn) < CONTINUE_BAND_RAD
      ) {
        instruction = `${street} — continue to the end`;
      } else if (leg.turn < 0) {
        instruction = `Left into ${street}`;
      } else {
        instruction = `Right into ${street}`;
      }

      steps.push({
        step_index: steps.length,
        segment_id: seg.id,
        street_name: seg.name,
        instruction,
        is_spur: seg.isSpur,
        cumulative_m: round2(cumulative),
        wkt: toWkt(coords),
      });
      extend(routeCoords, coords);
      previousName = seg.name;
      return;
    }

    if (leg.kind === "backtrack") {
      const coords: LonLat[] = [];
      for (const hi of leg.path) extend(coords, halfEdgeLonLat(graph, graph.halfEdges[hi]));
      cumulative += leg.lengthM;
      steps.push({
        step_index: steps.length,
        segment_id: null,
        street_name: null,
        instruction: `Transfer to ${nextWorkingStreet(graph, traversal.legs, i + 1)}`,
        is_spur: false,
        cumulative_m: round2(cumulative),
        wkt: toWkt(coords),
      });
      extend(routeCoords, coords);
      return;
    }

    // transfer between components — a straight line. Two coincident nodes
    // would make a degenerate line; there is nothing to walk, so no step.
    const a = graph.nodes[leg.fromNode].lonLat;
    const b = graph.nodes[leg.toNode].lonLat;
    if (a[0] === b[0] && a[1] === b[1]) return;
    cumulative += leg.lengthM;
    steps.push({
      step_index: steps.length,
      segment_id: null,
      street_name: null,
      instruction: `Transfer to ${nextWorkingStreet(graph, traversal.legs, i + 1)}`,
      is_spur: false,
      cumulative_m: round2(cumulative),
      wkt: toWkt([a, b]),
    });
    extend(routeCoords, [a, b]);
  });

  const routeLengthM = steps.length > 0 ? steps[steps.length - 1].cumulative_m : 0;
  return { steps, routeCoords, routeLengthM };
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

type Snap = {
  segment: number;
  distanceSq: number;
  /** Planar metres along the segment from its from_node. */
  alongM: number;
  /** > 0 left of from→to, < 0 right, 0 on the line (treated as left). */
  cross: number;
};

/** Nearest clipped segment by planar distance; ties → the lower segment id (first in order). */
function snapToSegments(graph: RouteGraph, p: XY): Snap {
  let best: Snap | null = null;
  for (const seg of graph.segments) {
    const xy = seg.xy;
    for (let i = 1; i < xy.length; i += 1) {
      const a = xy[i - 1];
      const b = xy[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      let u = 0;
      if (lenSq > 0) {
        u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
        if (u < 0) u = 0;
        else if (u > 1) u = 1;
      }
      const qx = a.x + u * dx;
      const qy = a.y + u * dy;
      const ex = p.x - qx;
      const ey = p.y - qy;
      const distanceSq = ex * ex + ey * ey;
      if (best === null || distanceSq < best.distanceSq) {
        best = {
          segment: seg.index,
          distanceSq,
          alongM: seg.cumXY[i - 1] + u * Math.sqrt(lenSq),
          cross: dx * (p.y - a.y) - dy * (p.x - a.x),
        };
      }
    }
  }
  if (best === null) throw new Error("route plan: no clipped segments to snap to");
  return best;
}

function snapDoors(
  graph: RouteGraph,
  inputs: RouteInputs,
  traversal: TraversalResult,
  sweep: Rotation["sweepDirection"],
): SnappedDoor[] {
  return inputs.doors.map((door) => {
    const p = graph.project([door.lon, door.lat]);
    const snap = snapToSegments(graph, p);
    const seg = graph.segments[snap.segment];
    const leftOfForward = snap.cross >= 0;
    // cw works the walker's left; ccw the walker's right. A door left of
    // from→to is on the walker's left on the + pass and right on the − pass.
    const forwardPass = sweep === "cw" ? leftOfForward : !leftOfForward;
    const halfEdgeIndex = forwardPass ? seg.forwardHalfEdge : seg.backwardHalfEdge;
    const fraction = seg.planarLengthM > 0 ? snap.alongM / seg.planarLengthM : 0;
    const alongTravel = (forwardPass ? fraction : 1 - fraction) * seg.lengthM;
    const start = traversal.workStartM[halfEdgeIndex];
    const distanceM = Math.sqrt(snap.distanceSq);
    return {
      uprn: door.uprn,
      segmentId: seg.id,
      halfEdge: halfEdgeIndex,
      distanceM,
      routePositionM: start < 0 ? Number.POSITIVE_INFINITY : start + alongTravel,
      stranded: distanceM > STRANDED_THRESHOLD_M,
    };
  });
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Builds the whole route for an assignment's inputs under a rotation.
 * `rotation.entryVertexIndex` picks the polygon corner; the entry node is the
 * clipped node nearest that corner. Throws on structurally bad inputs (no
 * segments, entry vertex out of range); the caller fails open.
 */
export function buildRoutePlan(inputs: RouteInputs, rotation: Rotation): RoutePlan {
  if (inputs.segments.length === 0) {
    throw new Error("route plan: no clipped segments");
  }
  const vertex = inputs.ring[rotation.entryVertexIndex];
  if (!vertex) {
    throw new Error(`route plan: entry vertex ${rotation.entryVertexIndex} is outside the ring`);
  }

  const t0 = tick();
  const graph = buildRouteGraph(inputs);
  const entry = nearestNode(graph, graph.project(vertex));
  const traversal = traverse(graph, rotation.sweepDirection, entry.index);
  const { steps, routeCoords, routeLengthM } = buildSteps(graph, traversal);
  const t1 = tick();
  const doors = snapDoors(graph, inputs, traversal, rotation.sweepDirection);

  // Route order: worked doors by position then UPRN; stranded doors appended
  // in the same order among themselves.
  const ordered = [...doors].sort(
    (a, b) =>
      Number(a.stranded) - Number(b.stranded) ||
      a.routePositionM - b.routePositionM ||
      a.uprn - b.uprn,
  );
  const t2 = tick();

  return {
    phaseMs: { traversalMs: t1 - t0, snapOrderMs: t2 - t1 },
    steps,
    routeWkt: toWkt(routeCoords),
    routeLengthM,
    snapshot: ordered.map((d) => d.uprn),
    strandedCount: ordered.filter((d) => d.stranded).length,
    doors: ordered,
    traversal,
    graph,
    entryNodeId: entry.id,
    workingSteps: steps.filter((s) => s.segment_id !== null).length,
  };
}
