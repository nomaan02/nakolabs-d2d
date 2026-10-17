/**
 * RT-5 (owner 2026-10-17). What a drawing stroke means: "this side of this
 * road". Pure: no React, no map, no network. Checked by `npm run verify:rt`.
 *
 * Everything is worked out in the prop's planar metres (the same projection
 * the route engine uses), so it behaves the same at any zoom. Each door is
 * already on a pavement — a road segment and a side of it — by
 * `buildDemand`; a finger point is put on a pavement the same way.
 *
 *   1. Pavement. Each stroke sample goes on the nearest road within reach;
 *      its side is the side of the centre line the finger is on. Once on a
 *      side the stroke keeps it until the finger is clearly over the centre
 *      line (SIDE_SWITCH_PX), so a stroke drawn near the middle of a narrow
 *      road never flips between the rows.
 *   2. Sweep. Moving along the pavement links every door the finger passes
 *      (its position along the road), in the direction of the stroke. The
 *      finger does not need to touch the dot, so a missed door in a row is
 *      still linked. A sweep only counts while the stroke runs roughly along
 *      the road (within ALIGN_DEG); crossing a road or turning at a junction
 *      sweeps nothing.
 *   3. Direct hit. The nearest door within the tap reach is linked too, but
 *      only from its own side of its road: a finger can never reach across
 *      the centre line for the door opposite.
 *   4. Gap fill. Two doors linked one after the other on the same pavement,
 *      no more than GAP_FILL_M apart along it, bring every door between them
 *      (in order). 25 m: on 18 Bristol props (5,482 gaps between neighbouring
 *      knockable doors on one pavement, 2026-10-17) the median gap is 5.5 m,
 *      the 90th percentile 12.7 m; two caught doors with one missed door
 *      between are ≤ 25 m apart 93% of the time.
 *
 * Samples are taken every SAMPLE_PX screen pixels between pointer events, so
 * a fast stroke skips no door.
 */

import type { RouteGraph, XY } from "@/lib/geo/route-graph";
import type { Demand, Side, SideDoor } from "@/lib/geo/walk/demand";

/** Reach from the finger to a road's centre line, in screen pixels. */
export const STROKE_REACH_PX = { touch: 32, mouse: 22 } as const;
/** Reach from the finger to a door for a tap or a direct hit, in screen pixels. */
export const STROKE_TAP_PX = { touch: 28, mouse: 18 } as const;
/** Missed doors are filled in between two linked doors at most this far apart along one pavement. */
export const GAP_FILL_M = 25;
/** Below this zoom the toolbar says a stroke follows the nearest pavement. Drawing still works. */
export const ZOOMED_OUT_HINT_ZOOM = 16;

/** The finger must be this far over the centre line (px) to change sides mid-stroke. */
const SIDE_SWITCH_PX = 8;
const SIDE_SWITCH_MIN_M = 1.5;
/** Pavement reach, metres, whatever the zoom: doors are never more than 40 m from their road. */
const REACH_MIN_M = 40;
const REACH_MAX_M = 80;
/** A direct hit, metres: never so small a finger misses, never so big it jumps a house. */
const TAP_MIN_M = 4;
const TAP_MAX_M = 25;
/** Sample spacing along a stroke (px). */
const SAMPLE_PX = 3;
/** A sweep counts while the stroke runs within this angle of the road. */
const ALIGN_DEG = 40;
const ALIGN = Math.cos((ALIGN_DEG * Math.PI) / 180);
/** Movement (px) that has to line up with the road before it sweeps; misaligned movement is dropped after it. */
const ALIGN_WINDOW_PX = 14;
const GRID_M = 30;
/** A stroke's first sweep on a pavement reaches this far back (m), so a stroke started level with a door takes it. */
const ENTRY_SLACK_M = 3;

type Pavement = { segment: number; side: Side };
type DoorPlace = { uprn: number; xy: XY; segment: number; side: Side; alongM: number; onRoad: boolean };
type Edge = { segment: number; i: number };

export type StrokeModel = {
  graph: RouteGraph;
  sideDoors: SideDoor[][][];
  doors: Map<number, DoorPlace>;
  edgeGrid: Map<string, Edge[]>;
  doorGrid: Map<string, number[]>;
};

export type StrokeInput = {
  /** Metres per screen pixel at the stroke's zoom. */
  metresPerPx: number;
  pointer: "touch" | "mouse";
};

export type StrokeTracker = {
  /** Feeds the next pointer position (planar metres); returns the doors newly reached, in order. */
  moveTo: (p: XY) => number[];
  /** The pavement the stroke is following, or null. */
  pavement: () => Pavement | null;
};

const cellKey = (cx: number, cy: number) => `${cx}:${cy}`;

function addToGrid<T>(grid: Map<string, T[]>, minX: number, minY: number, maxX: number, maxY: number, value: T): void {
  for (let cx = Math.floor(minX / GRID_M); cx <= Math.floor(maxX / GRID_M); cx += 1) {
    for (let cy = Math.floor(minY / GRID_M); cy <= Math.floor(maxY / GRID_M); cy += 1) {
      const key = cellKey(cx, cy);
      const list = grid.get(key);
      if (list) list.push(value);
      else grid.set(key, [value]);
    }
  }
}

function fromGrid<T>(grid: Map<string, T[]>, p: XY, radius: number, visit: (value: T) => void): void {
  for (let cx = Math.floor((p.x - radius) / GRID_M); cx <= Math.floor((p.x + radius) / GRID_M); cx += 1) {
    for (let cy = Math.floor((p.y - radius) / GRID_M); cy <= Math.floor((p.y + radius) / GRID_M); cy += 1) {
      const list = grid.get(cellKey(cx, cy));
      if (list) for (const value of list) visit(value);
    }
  }
}

/** Built once per loaded prop. */
export function buildStrokeModel(graph: RouteGraph, demand: Demand): StrokeModel {
  const edgeGrid = new Map<string, Edge[]>();
  for (const seg of graph.segments) {
    for (let i = 1; i < seg.xy.length; i += 1) {
      const a = seg.xy[i - 1];
      const b = seg.xy[i];
      addToGrid(edgeGrid, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), { segment: seg.index, i });
    }
  }
  const doors = new Map<number, DoorPlace>();
  const doorGrid = new Map<string, number[]>();
  for (const d of demand.doors) {
    const onRoad = !d.stranded && d.segment >= 0;
    doors.set(d.uprn, { uprn: d.uprn, xy: d.xy, segment: d.segment, side: d.side, alongM: d.alongM, onRoad });
    addToGrid(doorGrid, d.xy.x, d.xy.y, d.xy.x, d.xy.y, d.uprn);
  }
  return { graph, sideDoors: demand.sideDoors, doors, edgeGrid, doorGrid };
}

type Projection = { segment: number; alongM: number; cross: number; distance: number };

function projectOnEdge(model: StrokeModel, edge: Edge, p: XY): Projection {
  const seg = model.graph.segments[edge.segment];
  const a = seg.xy[edge.i - 1];
  const b = seg.xy[edge.i];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let u = lenSq > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0;
  u = Math.max(0, Math.min(1, u));
  const qx = a.x + u * dx;
  const qy = a.y + u * dy;
  return {
    segment: edge.segment,
    alongM: seg.cumXY[edge.i - 1] + u * Math.sqrt(lenSq),
    cross: dx * (p.y - a.y) - dy * (p.x - a.x),
    distance: Math.hypot(p.x - qx, p.y - qy),
  };
}

/** The nearest road to `p` within `reach` metres (ties: lower segment index), as buildDemand snaps doors. */
function nearestRoad(model: StrokeModel, p: XY, reach: number): Projection | null {
  let best: Projection | null = null;
  fromGrid(model.edgeGrid, p, reach, (edge) => {
    const hit = projectOnEdge(model, edge, p);
    if (hit.distance > reach) return;
    if (best === null || hit.distance < best.distance || (hit.distance === best.distance && hit.segment < best.segment)) best = hit;
  });
  return best;
}

/** Where `p` is relative to one segment: along it, which side, how far off. */
function onSegment(model: StrokeModel, segment: number, p: XY): Projection {
  const seg = model.graph.segments[segment];
  let best: Projection | null = null;
  for (let i = 1; i < seg.xy.length; i += 1) {
    const hit = projectOnEdge(model, { segment, i }, p);
    if (best === null || hit.distance < best.distance) best = hit;
  }
  return best as Projection;
}

const sideOf = (cross: number): Side => (cross >= 0 ? 0 : 1);

/**
 * Starts a stroke at `start` (planar metres). Returns the doors a press there
 * reaches (at most one) and the tracker for the rest of the stroke.
 */
export function startStroke(model: StrokeModel, start: XY, input: StrokeInput): { hits: number[]; tracker: StrokeTracker } {
  const mpp = Math.max(input.metresPerPx, 1e-6);
  const reach = Math.min(REACH_MAX_M, Math.max(REACH_MIN_M, STROKE_REACH_PX[input.pointer] * mpp));
  const tapReach = Math.min(TAP_MAX_M, Math.max(TAP_MIN_M, STROKE_TAP_PX[input.pointer] * mpp));
  const switchM = Math.max(SIDE_SWITCH_MIN_M, SIDE_SWITCH_PX * mpp);
  const windowM = ALIGN_WINDOW_PX * mpp;
  const stepM = SAMPLE_PX * mpp;

  let last = start;
  let pavement: Pavement | null = null;
  let sweepFrom = 0;
  let path = 0;
  /** No sweep yet since the stroke came onto this pavement. */
  let firstSweep = true;
  /** Doors reached in this stroke, so each is reported once. */
  const reached = new Set<number>();
  /** Last door reached on each pavement (segment * 2 + side), for the gap fill. */
  const lastOn = new Map<number, number>();

  const doorsBetween = (pv: Pavement, from: number, to: number, inclusiveFrom: boolean): number[] => {
    const list = model.sideDoors[pv.segment]?.[pv.side] ?? [];
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const inside = list.filter((d) => {
      if (d.alongM < lo || d.alongM > hi) return false;
      if (!inclusiveFrom && d.alongM === from) return false;
      return true;
    });
    return to >= from ? inside.map((d) => d.uprn) : inside.reverse().map((d) => d.uprn);
  };

  const reach1 = (uprn: number, out: number[]) => {
    if (reached.has(uprn)) return;
    const place = model.doors.get(uprn);
    if (place && place.onRoad) {
      const key = place.segment * 2 + place.side;
      const prev = lastOn.get(key);
      if (prev !== undefined && Math.abs(place.alongM - prev) <= GAP_FILL_M) {
        for (const between of doorsBetween({ segment: place.segment, side: place.side }, prev, place.alongM, false)) {
          if (between !== uprn && !reached.has(between)) {
            reached.add(between);
            out.push(between);
          }
        }
      }
      lastOn.set(key, place.alongM);
    }
    reached.add(uprn);
    out.push(uprn);
  };

  const directHit = (p: XY): number | null => {
    let best: DoorPlace | null = null;
    let bestD = tapReach;
    fromGrid(model.doorGrid, p, tapReach, (uprn) => {
      const place = model.doors.get(uprn);
      if (!place) return;
      const d = Math.hypot(place.xy.x - p.x, place.xy.y - p.y);
      if (d > bestD || (d === bestD && best !== null && uprn > best.uprn)) return;
      // Never across the centre line: the finger must be on the door's side of its own road.
      if (place.onRoad) {
        const rel = onSegment(model, place.segment, p);
        if (sideOf(rel.cross) !== place.side && rel.distance > 0.5) return;
      }
      best = place;
      bestD = d;
    });
    return best === null ? null : (best as DoorPlace).uprn;
  };

  const sample = (p: XY, moved: number, out: number[]) => {
    const road = nearestRoad(model, p, reach);
    if (road === null) {
      pavement = null;
      path = 0;
    } else {
      let side = sideOf(road.cross);
      if (pavement && pavement.segment === road.segment && side !== pavement.side && road.distance < switchM) side = pavement.side;
      if (!pavement || pavement.segment !== road.segment || pavement.side !== side) {
        pavement = { segment: road.segment, side };
        sweepFrom = road.alongM;
        path = 0;
        firstSweep = true;
      } else {
        path += moved;
        const d = road.alongM - sweepFrom;
        if (d !== 0 && Math.abs(d) >= ALIGN * path) {
          const from = firstSweep ? sweepFrom - Math.sign(d) * ENTRY_SLACK_M : sweepFrom;
          for (const uprn of doorsBetween(pavement, from, road.alongM, firstSweep)) reach1(uprn, out);
          firstSweep = false;
          sweepFrom = road.alongM;
          path = 0;
        } else if (path > windowM) {
          sweepFrom = road.alongM;
          path = 0;
        }
      }
    }
    // A direct hit on the pavement being followed sweeps up to that door, so
    // the doors between keep their order (a hit can be a little ahead of the
    // sweep). Off this pavement (a corner door) it is linked on its own.
    const hit = directHit(p);
    if (hit !== null && !reached.has(hit)) {
      const place = model.doors.get(hit);
      const pv = pavement as Pavement | null;
      if (pv && place && place.onRoad && place.segment === pv.segment && place.side === pv.side) {
        for (const uprn of doorsBetween(pv, sweepFrom, place.alongM, true)) reach1(uprn, out);
        sweepFrom = place.alongM;
        firstSweep = false;
        path = 0;
      }
      reach1(hit, out);
    }
  };

  const first: number[] = [];
  sample(start, 0, first);

  const tracker: StrokeTracker = {
    moveTo: (p) => {
      const out: number[] = [];
      const length = Math.hypot(p.x - last.x, p.y - last.y);
      const n = Math.max(1, Math.ceil(length / stepM));
      for (let k = 1; k <= n; k += 1) {
        const t = k / n;
        sample({ x: last.x + (p.x - last.x) * t, y: last.y + (p.y - last.y) * t }, length / n, out);
      }
      last = p;
      return out;
    },
    pavement: () => pavement,
  };
  return { hits: first, tracker };
}

/** Every door on one pavement, for the "following this pavement" highlight. */
export function pavementDoors(model: StrokeModel, pavement: Pavement): number[] {
  return (model.sideDoors[pavement.segment]?.[pavement.side] ?? []).map((d) => d.uprn);
}
