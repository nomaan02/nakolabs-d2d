/**
 * Stage 5b (R1) — door-driven street selection.
 *
 * Every knockable door snaps to the nearest buffer segment by planar distance
 * (ties → the lower segment id, as 5b-a) and is classified left or right of
 * that segment's from_node → to_node direction by the cross product at the
 * closest point (z > 0 left, z ≤ 0 right — the documented tie). A door more
 * than 40 m from every segment is stranded: kept, appended to the tail, never
 * dropped. The threshold is `STRANDED_THRESHOLD_M` from route-plan.ts and is
 * never tuned.
 *
 * A WORKING SIDE is a (segment, side) with at least one snapped door. Those
 * must be knocked. Every other buffer segment is walking-only.
 *
 * The snap itself mirrors the private `snapToSegments` in route-plan.ts,
 * which cannot be imported without editing that file.
 */

import { planarDistance, type RouteDoor, type RouteGraph, type XY } from "@/lib/geo/route-graph";
import { STRANDED_THRESHOLD_M } from "@/lib/geo/route-plan";
import type { Hand } from "@/lib/geo/walk/types";

/** 0 = left of from_node → to_node, 1 = right. */
export type Side = 0 | 1;

export type DoorSnap = {
  uprn: number;
  xy: XY;
  /** Segment index in the graph; -1 when no segment exists at all. */
  segment: number;
  side: Side;
  /** Planar metres along the segment from its from_node. */
  alongM: number;
  distanceM: number;
  stranded: boolean;
};

export type SideDoor = { uprn: number; alongM: number };

export type Demand = {
  /** In input (uprn) order. */
  doors: DoorSnap[];
  /** [segment][side] → doors sorted by alongM then uprn. Empty arrays where there is no demand. */
  sideDoors: SideDoor[][][];
  /** working[segment * 2 + side] = 1 when the side has at least one door. */
  working: Uint8Array;
  workingSides: number;
  workingSegments: number;
  twoSidedSegments: number;
  oneSidedSegments: number;
  strandedCount: number;
};

export const SNAP_THRESHOLD_M = STRANDED_THRESHOLD_M;

/**
 * The side of the segment that is on the walker's hand when walking a
 * half-edge in direction `dir`. Walking from_node → to_node (dir 1) the
 * walker's right is the segment's right; walking back it is the left.
 */
export function knockedSide(hand: Hand, dir: 1 | -1): Side {
  if (hand === "right") return dir === 1 ? 1 : 0;
  return dir === 1 ? 0 : 1;
}

export function otherSide(side: Side): Side {
  return side === 0 ? 1 : 0;
}

type Snap = { segment: number; distanceSq: number; alongM: number; cross: number };

function snapToSegments(graph: RouteGraph, p: XY): Snap | null {
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
  return best;
}

export function buildDemand(graph: RouteGraph, doors: RouteDoor[]): Demand {
  const n = graph.segments.length;
  const sideDoors: SideDoor[][][] = graph.segments.map(() => [[], []]);
  const working = new Uint8Array(n * 2);
  const snapped: DoorSnap[] = [];
  let strandedCount = 0;

  for (const door of doors) {
    const xy = graph.project([door.lon, door.lat]);
    const snap = snapToSegments(graph, xy);
    if (snap === null) {
      strandedCount += 1;
      snapped.push({ uprn: door.uprn, xy, segment: -1, side: 0, alongM: 0, distanceM: Infinity, stranded: true });
      continue;
    }
    const distanceM = Math.sqrt(snap.distanceSq);
    const side: Side = snap.cross >= 0 ? 0 : 1;
    const stranded = distanceM > SNAP_THRESHOLD_M;
    if (stranded) strandedCount += 1;
    else sideDoors[snap.segment][side].push({ uprn: door.uprn, alongM: snap.alongM });
    snapped.push({ uprn: door.uprn, xy, segment: snap.segment, side, alongM: snap.alongM, distanceM, stranded });
  }

  let workingSides = 0;
  let workingSegments = 0;
  let twoSidedSegments = 0;
  let oneSidedSegments = 0;
  for (let s = 0; s < n; s += 1) {
    let sides = 0;
    for (const side of [0, 1] as const) {
      const list = sideDoors[s][side];
      list.sort((a, b) => a.alongM - b.alongM || a.uprn - b.uprn);
      if (list.length > 0) {
        working[s * 2 + side] = 1;
        sides += 1;
      }
    }
    workingSides += sides;
    if (sides > 0) workingSegments += 1;
    if (sides === 2) twoSidedSegments += 1;
    if (sides === 1) oneSidedSegments += 1;
  }

  return {
    doors: snapped,
    sideDoors,
    working,
    workingSides,
    workingSegments,
    twoSidedSegments,
    oneSidedSegments,
    strandedCount,
  };
}

/** Planar distance between two doors, for the stranded tail order. */
export function doorDistance(a: DoorSnap, b: DoorSnap): number {
  return planarDistance(a.xy, b.xy);
}
