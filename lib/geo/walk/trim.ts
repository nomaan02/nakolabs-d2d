/**
 * Stage 5b (open paths, 2026-09-25) — which part of each road record is
 * actually walked. docs/ROUTE-DESIGN-v2.md, "Design change — open paths".
 *
 * Every road record gets one canonical interval [lo, hi] in planar metres
 * from its segment's from_node. Two rules narrow it:
 *
 *   - route ends: the first work record starts at its first door, the last
 *     work record ends at its last door;
 *   - turns: at a street's far end both passes stop level with the furthest
 *     door either of them knocks. Nothing is walked past it.
 *
 * The rank (traverse.ts) and the geometry (steps.ts) both read these
 * intervals, so what is charged is what is drawn.
 */

import type { RouteGraph, XY } from "@/lib/geo/route-graph";
import type { Demand } from "@/lib/geo/walk/demand";
import { CROSS_M, pointAlong, round2 } from "@/lib/geo/walk/geometry";
import type { Rec } from "@/lib/geo/walk/traverse";

/** A kept span shorter than this is widened to it, so every line keeps two distinct points. */
export const MIN_SPAN_M = 1;

export type Interval = readonly [number, number];

/**
 * The far end of a street as walked: a record, an optional cross, then the
 * reverse half-edge in the same chain. A street knocked to its end and left
 * by a transfer back along the same segment (or walked up by a transfer and
 * knocked back) is the same turn without a cross. Found from the records
 * alone, so `best_reversed` finds the same turns mirrored.
 */
export type Turn = {
  /** Record walked into the turn. */
  into: number;
  /** The cross between the passes; -1 when the street is one-sided and the walker turns on the same pavement. */
  cross: number;
  /** Record walked away from the turn. */
  outOf: number;
  segment: number;
  /** Direction of travel into the turn along the segment: 1 = from_node → to_node. */
  dir: 1 | -1;
  /** Planar metres from from_node of the furthest door either pass knocks on this segment. */
  alongM: number;
};

export function findTurns(graph: RouteGraph, demand: Demand, records: Rec[]): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    if (r.kind === "cross" || r.half === -1) continue;
    let j = i + 1;
    let cross = -1;
    if (j < records.length && records[j].kind === "cross") {
      cross = j;
      j += 1;
    }
    const b = records[j];
    if (!b || b.kind === "cross" || b.half !== graph.halfEdges[r.half].reverse) continue;
    const sameChain = r.chain !== -1 && b.chain === r.chain;
    const viaTransfer = cross === -1 && (r.chain === -1) !== (b.chain === -1);
    if (!sameChain && !viaTransfer) continue;
    const h = graph.halfEdges[r.half];
    const seg = graph.segments[h.segment];
    let alongM = h.dir === 1 ? -Infinity : Infinity;
    for (const rec of [r, b]) {
      if (rec.kind !== "work" || rec.side === -1) continue;
      const doors = demand.sideDoors[h.segment][rec.side];
      if (doors.length === 0) continue;
      alongM = h.dir === 1 ? Math.max(alongM, doors[doors.length - 1].alongM) : Math.min(alongM, doors[0].alongM);
    }
    if (!Number.isFinite(alongM)) alongM = h.dir === 1 ? seg.planarLengthM : 0;
    turns.push({ into: i, cross, outOf: j, segment: h.segment, dir: h.dir, alongM });
  }
  return turns;
}

/** One interval per record; null on a cross and on a straight-line transfer. */
export function keepIntervals(graph: RouteGraph, demand: Demand, records: Rec[], turns: Turn[]): (Interval | null)[] {
  const lo: number[] = [];
  const hi: number[] = [];
  const road: boolean[] = [];
  for (const r of records) {
    const isRoad = r.kind !== "cross" && r.half !== -1;
    road.push(isRoad);
    lo.push(0);
    hi.push(isRoad ? graph.segments[graph.halfEdges[r.half].segment].planarLengthM : 0);
  }

  for (const t of turns) {
    for (const k of [t.into, t.outOf]) {
      if (t.dir === 1) hi[k] = Math.min(hi[k], t.alongM);
      else lo[k] = Math.max(lo[k], t.alongM);
    }
  }

  let first = -1;
  let last = -1;
  for (let i = 0; i < records.length; i += 1) {
    if (records[i].kind !== "work") continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first !== -1) {
    const bound = (k: number, atStart: boolean) => {
      const r = records[k];
      if (r.side === -1) return;
      const h = graph.halfEdges[r.half];
      const doors = demand.sideDoors[h.segment][r.side];
      if (doors.length === 0) return;
      // Walking from_node → to_node the first door is the lowest alongM; walking back it is the highest.
      const lowEnd = (h.dir === 1) === atStart;
      if (lowEnd) lo[k] = Math.max(lo[k], doors[0].alongM);
      else hi[k] = Math.min(hi[k], doors[doors.length - 1].alongM);
    };
    bound(first, true);
    bound(last, false);
  }

  return records.map((r, i) => {
    if (!road[i]) return null;
    const L = graph.segments[graph.halfEdges[r.half].segment].planarLengthM;
    let a = lo[i];
    let b = hi[i];
    if (b - a < MIN_SPAN_M) {
      if (L <= MIN_SPAN_M) return [0, L] as const;
      const c = (a + b) / 2;
      a = c - MIN_SPAN_M / 2;
      b = c + MIN_SPAN_M / 2;
      if (a < 0) {
        a = 0;
        b = MIN_SPAN_M;
      } else if (b > L) {
        b = L;
        a = L - MIN_SPAN_M;
      }
    }
    return [a, b] as const;
  });
}

/** length_m of the walked part: road metres scaled by the kept planar span; the crossing distance on a cross. */
export function keptLengthM(graph: RouteGraph, r: Rec, interval: Interval | null): number {
  if (r.kind === "cross") return round2(CROSS_M);
  if (r.half === -1 || interval === null) return round2(r.lengthM);
  const seg = graph.segments[graph.halfEdges[r.half].segment];
  const span = interval[1] - interval[0];
  if (span >= seg.planarLengthM || seg.planarLengthM === 0) return round2(seg.lengthM);
  return round2((seg.lengthM * span) / seg.planarLengthM);
}

/** Centreline feet of the route's first and last doors. Null when the route knocks nothing. */
export function doorFeet(graph: RouteGraph, demand: Demand, records: Rec[]): { first: XY; last: XY } | null {
  const foot = (r: Rec, atStart: boolean): XY | null => {
    if (r.side === -1) return null;
    const h = graph.halfEdges[r.half];
    const doors = demand.sideDoors[h.segment][r.side];
    if (doors.length === 0) return null;
    const lowEnd = (h.dir === 1) === atStart;
    return pointAlong(graph.segments[h.segment], lowEnd ? doors[0].alongM : doors[doors.length - 1].alongM);
  };
  const works = records.filter((r) => r.kind === "work");
  if (works.length === 0) return null;
  const first = foot(works[0], true);
  const last = foot(works[works.length - 1], false);
  return first && last ? { first, last } : null;
}
