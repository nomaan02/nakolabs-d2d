/**
 * RT (owner 2026-10-13) — a manual route: the admin's drawing turned into the
 * same WalkVariant document the automatic generator produces, so saving,
 * freezing, the field walkline and the Logger order are unchanged.
 *
 * Input is the drawn chain of UPRNs. The drawn order IS the door order: no
 * door is reordered, added or stranded. Between two consecutive doors:
 *
 *   - Same road segment, same pavement: one work leg along the road.
 *   - Same road segment, other pavement: a crossing right after the first
 *     door. Turning back → the U-turn arc the automatic routes draw; carrying
 *     on → a straight line across.
 *   - Different segments: the shortest way along the road graph, walked on
 *     the pavement the walker is on (turning corners keeps the hand of
 *     travel). Turning off a road away from that pavement crosses the road
 *     being left, at the junction. Otherwise, when the next door is on the
 *     other hand, they cross straight over where the leg joins its road.
 *   - A route with no length (one door, or every door at one spot) is
 *     refused: it could not be frozen onto a visit.
 *   - No road path at all (a disconnected graph): a straight transfer.
 *
 * Geometry reuses the automatic generator's pieces (`sliceAlong`,
 * `offsetRunAdaptive`, `uTurnArc`, `shortestPath`); the automatic code path
 * itself is not touched. Deterministic: no clock, no randomness, no Map or
 * Set iteration (lookups only), fixed tie-breaks. The same chain always
 * gives the same document.
 */

import {
  bearing,
  displayStreet,
  haversineM,
  planarDistance,
  wrapTurn,
  type GraphSegment,
  type LonLat,
  type RouteGraph,
  type XY,
} from "@/lib/geo/route-graph";
import { STRANDED_THRESHOLD_M, type Demand, type DoorSnap, type Side } from "@/lib/geo/walk/demand";
import {
  CROSS_M,
  PAVEMENT_OFFSET_M,
  directionAlong,
  makeUnproject,
  pointAlong,
  round2,
  roundCoord,
  sliceAlong,
  uTurnArc,
} from "@/lib/geo/walk/geometry";
import { shortestPath } from "@/lib/geo/walk/shortest-path";
import { offsetRunAdaptive } from "@/lib/geo/walk/steps";
import { STRAIGHT_RAD } from "@/lib/geo/walk/traverse";
import type { Hand, StepKind, WalkStep, WalkVariant } from "@/lib/geo/walk/types";

export type ManualKey = "manual" | "manual_reversed";

export type ManualRouteFailureCode = "no_doors" | "duplicate_door" | "unknown_door" | "no_roads" | "too_short";

export type ManualVariantResult =
  | { ok: true; variant: WalkVariant }
  | { ok: false; code: ManualRouteFailureCode; message: string };

export type ManualVariantsResult =
  | { ok: true; manual: WalkVariant; reversed: WalkVariant }
  | { ok: false; code: ManualRouteFailureCode; message: string };

/** Two distances along a segment closer than this are the same place. */
const SAME_M = 0.01;
/** A path cost this much shorter wins; anything closer keeps the earlier option (fixed order). */
const COST_TIE_M = 1e-6;

type RoadPiece = {
  kind: "road";
  seg: number;
  dir: 1 | -1;
  /** Planar metres from the segment's from_node, in walking order (from → to). */
  from: number;
  to: number;
  pav: Side;
  /** Chain indexes knocked on this piece, in order. */
  doors: number[];
};

type CrossPiece = { kind: "cross"; seg: number; at: number; dirIn: 1 | -1; fromPav: Side; uturn: boolean };

type StraightPiece = { kind: "straight"; fromNode: number; toNode: number };

type Piece = RoadPiece | CrossPiece | StraightPiece;

type Leg = { exitDir: 1 | -1; entryDir: 1 | -1; halves: number[] };

/** The walker's hand when walking `dir` on pavement `pav` (0 = left of from_node → to_node). */
export function handOf(dir: 1 | -1, pav: Side): Hand {
  return (dir === 1) === (pav === 0) ? "left" : "right";
}

function pavementFor(dir: 1 | -1, hand: Hand): Side {
  return (dir === 1) === (hand === "left") ? 0 : 1;
}

function metresFactor(seg: GraphSegment): number {
  return seg.planarLengthM > 0 ? seg.lengthM / seg.planarLengthM : 1;
}

/** The node at the end of a segment a walker leaves by going `dir`. */
function endNode(seg: GraphSegment, dir: 1 | -1): number {
  return dir === 1 ? seg.toNode : seg.fromNode;
}

function nearestEndNode(seg: GraphSegment, along: number): number {
  return along <= seg.planarLengthM / 2 ? seg.fromNode : seg.toNode;
}

// ---------------------------------------------------------------------------
// Chain → pieces
// ---------------------------------------------------------------------------

function bestLeg(
  graph: RouteGraph,
  from: { seg: number; along: number; dir: 1 | -1 | 0 },
  to: DoorSnap,
  memo: Map<string, { path: number[]; lengthM: number } | null>,
): Leg | null {
  const a = graph.segments[from.seg];
  const b = graph.segments[to.segment];
  const preferred: 1 | -1 = from.dir === -1 ? -1 : 1;
  const exits: (1 | -1)[] = [preferred, preferred === 1 ? -1 : 1];
  const entries: (1 | -1)[] = [1, -1];
  let best: (Leg & { cost: number }) | null = null;
  for (const exitDir of exits) {
    const exitNode = endNode(a, exitDir);
    const exitM = (exitDir === 1 ? a.planarLengthM - from.along : from.along) * metresFactor(a);
    for (const entryDir of entries) {
      const entryNode = entryDir === 1 ? b.fromNode : b.toNode;
      const entryM = (entryDir === 1 ? to.alongM : b.planarLengthM - to.alongM) * metresFactor(b);
      const key = `${exitNode}:${entryNode}`;
      let found = memo.get(key);
      if (found === undefined) {
        const r = shortestPath(graph, exitNode, (n) => n === entryNode);
        found = r ? { path: r.path, lengthM: r.lengthM } : null;
        memo.set(key, found);
      }
      if (found === null) continue;
      const cost = exitM + found.lengthM + entryM;
      if (best === null || cost < best.cost - COST_TIE_M) best = { exitDir, entryDir, halves: found.path, cost };
    }
  }
  return best;
}

/**
 * Which way the walker goes from door `i` when it is level with the door
 * before it (opposite houses): the way the next door on the same segment
 * that is not level with it leads, on either pavement (a zigzag up a street
 * keeps going), else straight on.
 */
function directionAfter(snaps: DoorSnap[], i: number, dir: 1 | -1 | 0): 1 | -1 {
  const here = snaps[i];
  for (let k = i + 1; k < snaps.length; k += 1) {
    const s = snaps[k];
    if (s.segment !== here.segment) break;
    const d = s.alongM - here.alongM;
    if (Math.abs(d) > SAME_M) return d > 0 ? 1 : -1;
  }
  return dir === 0 ? 1 : dir;
}

/** Arrival bearing at the end of a segment walked in `dir`, and departure bearing of a half-edge. */
function turnAt(graph: RouteGraph, seg: number, dir: 1 | -1, nextHalf: number): number {
  const s = graph.segments[seg];
  const arrive = graph.halfEdges[dir === 1 ? s.forwardHalfEdge : s.backwardHalfEdge].arrivalBearing;
  return wrapTurn(graph.halfEdges[nextHalf].departureBearing - arrive);
}

function buildPieces(graph: RouteGraph, snaps: DoorSnap[]): Piece[] {
  const pieces: Piece[] = [];
  const memo = new Map<string, { path: number[]; lengthM: number } | null>();
  const first = snaps[0];
  let seg = first.segment;
  let along = first.alongM;
  let pav: Side = first.side;
  let dir: 1 | -1 | 0 = 0;
  let pending: number[] = [0];
  let lastRoad: RoadPiece | null = null;

  const addRoad = (s: number, d: 1 | -1, fromM: number, toM: number, p: Side) => {
    const piece: RoadPiece = { kind: "road", seg: s, dir: d, from: fromM, to: toM, pav: p, doors: pending };
    pending = [];
    pieces.push(piece);
    lastRoad = piece;
  };
  // A cross must never carry the first door to the other pavement: give it its own (zero-length) piece first.
  const flushPending = (d: 1 | -1) => {
    if (pending.length > 0) addRoad(seg, d, along, along, pav);
  };

  for (let i = 1; i < snaps.length; i += 1) {
    const next = snaps[i];
    if (next.segment === seg) {
      const delta = next.alongM - along;
      const nd: 1 | -1 = Math.abs(delta) <= SAME_M ? directionAfter(snaps, i, dir) : delta > 0 ? 1 : -1;
      if (next.side !== pav) {
        flushPending(dir === 0 ? nd : dir);
        const uturn = dir !== 0 && nd !== dir;
        pieces.push({ kind: "cross", seg, at: along, dirIn: uturn ? dir as 1 | -1 : nd, fromPav: pav, uturn });
        pav = next.side;
      }
      addRoad(seg, nd, along, next.alongM, pav);
      dir = nd;
      along = next.alongM;
    } else {
      const leg = bestLeg(graph, { seg, along, dir }, next, memo);
      if (leg === null) {
        flushPending(dir === 0 ? 1 : dir);
        const fromNode = nearestEndNode(graph.segments[seg], along);
        const nextSeg = graph.segments[next.segment];
        pieces.push({ kind: "straight", fromNode, toNode: nearestEndNode(nextSeg, next.alongM) });
        addRoad(next.segment, 1, next.alongM, next.alongM, next.side);
        dir = 1;
      } else {
        // The leg is walked on the pavement the walker is on. Turning off the
        // road AWAY from that pavement means crossing the road being left,
        // at the junction. Otherwise, when the next door is on the other
        // hand, they cross where the leg joins its road.
        const handOut = handOf(leg.exitDir, pav);
        const handIn = handOf(leg.entryDir, next.side);
        const a = graph.segments[seg];
        const b = graph.segments[next.segment];
        const firstHalf = leg.halves.length > 0 ? leg.halves[0] : leg.entryDir === 1 ? b.forwardHalfEdge : b.backwardHalfEdge;
        const turn = turnAt(graph, seg, leg.exitDir, firstHalf);
        const away = handOut === "left" ? turn > STRAIGHT_RAD : turn < -STRAIGHT_RAD;
        const exitAt = leg.exitDir === 1 ? a.planarLengthM : 0;
        addRoad(seg, leg.exitDir, along, exitAt, pav);
        if (away) pieces.push({ kind: "cross", seg, at: exitAt, dirIn: leg.exitDir, fromPav: pav, uturn: false });
        const legHand = away ? handIn : handOut;
        for (const hi of leg.halves) {
          const h = graph.halfEdges[hi];
          const s = graph.segments[h.segment];
          addRoad(h.segment, h.dir, h.dir === 1 ? 0 : s.planarLengthM, h.dir === 1 ? s.planarLengthM : 0, pavementFor(h.dir, legHand));
        }
        const entryAt = leg.entryDir === 1 ? 0 : b.planarLengthM;
        if (legHand !== handIn) {
          pieces.push({ kind: "cross", seg: next.segment, at: entryAt, dirIn: leg.entryDir, fromPav: pavementFor(leg.entryDir, legHand), uturn: false });
        }
        addRoad(next.segment, leg.entryDir, entryAt, next.alongM, next.side);
        dir = leg.entryDir;
      }
      seg = next.segment;
      along = next.alongM;
      pav = next.side;
    }
    (lastRoad as RoadPiece | null)?.doors.push(i);
  }
  if (pending.length > 0) addRoad(seg, dir === 0 ? 1 : dir, along, along, pav);
  return mergeRoads(pieces);
}

/** Consecutive road pieces on the same segment, direction and pavement, end to start, become one. */
function mergeRoads(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (
      p.kind === "road" && prev?.kind === "road" &&
      prev.seg === p.seg && prev.dir === p.dir && prev.pav === p.pav && Math.abs(prev.to - p.from) <= SAME_M
    ) {
      prev.to = p.to;
      prev.doors.push(...p.doors);
      continue;
    }
    out.push(p.kind === "road" ? { ...p, doors: [...p.doors] } : p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pieces → geometry and steps
// ---------------------------------------------------------------------------

type Centre = { xy: XY[]; lonLat: LonLat[] };

function roadCentre(graph: RouteGraph, p: RoadPiece): Centre {
  const seg = graph.segments[p.seg];
  const lo = Math.min(p.from, p.to);
  const hi = Math.max(p.from, p.to);
  const cut = sliceAlong(seg, lo, hi);
  return p.dir === 1 ? cut : { xy: [...cut.xy].reverse(), lonLat: [...cut.lonLat].reverse() };
}

/** The pavement point beside a place on a road: for a road piece too short to offset. */
function pavementPoint(graph: RouteGraph, p: RoadPiece): XY {
  const seg = graph.segments[p.seg];
  const c = pointAlong(seg, p.from);
  const d = directionAlong(seg, p.from, p.dir);
  const ux = d.x * p.dir;
  const uy = d.y * p.dir;
  const hand = handOf(p.dir, p.pav);
  const n = hand === "right" ? { x: uy, y: -ux } : { x: -uy, y: ux };
  return { x: c.x + n.x * PAVEMENT_OFFSET_M, y: c.y + n.y * PAVEMENT_OFFSET_M };
}

function lengthXY(pts: XY[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += planarDistance(pts[i - 1], pts[i]);
  return total;
}

type RoadGeometry = { walk: XY[]; offsetM: number; baseM: number; passed: boolean; run: number; head: number };

/** True when road piece `i` walks back along the pavement the piece before it was walked on. */
function walksBack(pieces: Piece[], i: number): boolean {
  const p = pieces[i];
  const prev = pieces[i - 1];
  return p?.kind === "road" && prev?.kind === "road" && prev.seg === p.seg && prev.pav === p.pav && prev.dir !== p.dir;
}

/**
 * Walklines of every road piece. Neighbouring pieces with no crossing
 * between and the same hand share one offset run; a walk back along the
 * pavement just walked starts a new run (drawn on the same pavement, over
 * the line out). Where two runs meet with no crossing between, the later
 * line starts with a short connector from the earlier one's end.
 */
function roadWalklines(graph: RouteGraph, pieces: Piece[], centres: (Centre | null)[]): (RoadGeometry | null)[] {
  const out: (RoadGeometry | null)[] = new Array(pieces.length).fill(null);
  let run = 0;
  let i = 0;
  while (i < pieces.length) {
    const p = pieces[i];
    if (p.kind !== "road") {
      i += 1;
      continue;
    }
    const hand = handOf(p.dir, p.pav);
    let j = i;
    while (j + 1 < pieces.length) {
      const q = pieces[j + 1];
      if (q.kind !== "road" || handOf(q.dir, q.pav) !== hand || walksBack(pieces, j + 1)) break;
      j += 1;
    }
    const parts: XY[][] = [];
    const kinds: StepKind[] = [];
    for (let k = i; k <= j; k += 1) {
      parts.push((centres[k] as Centre).xy);
      kinds.push((pieces[k] as RoadPiece).doors.length > 0 ? "work" : "walk");
    }
    const totalM = parts.reduce((n, part) => n + lengthXY(part), 0);
    if (totalM <= SAME_M) {
      for (let k = i; k <= j; k += 1) {
        const q = pavementPoint(graph, pieces[k] as RoadPiece);
        out[k] = { walk: [q, { ...q }], offsetM: PAVEMENT_OFFSET_M, baseM: PAVEMENT_OFFSET_M, passed: true, run, head: 0 };
      }
    } else {
      const res = offsetRunAdaptive(parts, kinds, false, hand);
      for (let k = i; k <= j; k += 1) {
        out[k] = { walk: res.offsets[k - i], offsetM: res.offsetUsed, baseM: res.offsetBaseM, passed: res.ladderPassed, run, head: 0 };
      }
    }
    const before = out[i - 1];
    const first = out[i] as RoadGeometry;
    if (before && pieces[i - 1].kind === "road") {
      const end = before.walk[before.walk.length - 1];
      const start = first.walk[0];
      if (end.x !== start.x || end.y !== start.y) {
        first.walk = [end, ...first.walk];
        first.head = 1;
      }
    }
    run += 1;
    i = j + 1;
  }
  return out;
}

function neighbourWalk(roads: (RoadGeometry | null)[], from: number, step: 1 | -1): XY[] | null {
  for (let k = from; k >= 0 && k < roads.length; k += step) {
    const r = roads[k];
    if (r) return r.walk;
  }
  return null;
}

function crossLine(graph: RouteGraph, p: CrossPiece, a: XY, b: XY): XY[] {
  if (!p.uturn) return [a, b];
  const seg = graph.segments[p.seg];
  const d = directionAlong(seg, p.at, p.dirIn);
  const u = { x: d.x * p.dirIn, y: d.y * p.dirIn };
  const foot = pointAlong(seg, p.at);
  const far = graph.nodes[endNode(seg, p.dirIn)].xy;
  const reachM = Math.min(
    p.dirIn === 1 ? seg.planarLengthM - p.at : p.at,
    (far.x - foot.x) * u.x + (far.y - foot.y) * u.y,
  );
  // Built from the pavement on segment side 0 to side 1, as the automatic routes do.
  return p.fromPav === 0 ? uTurnArc(a, b, u, reachM) : uTurnArc(b, a, u, reachM).reverse();
}

function pieceBearings(centre: Centre): { dep: number; arr: number } {
  const xy = centre.xy;
  const a = xy[0];
  const z = xy[xy.length - 1];
  let dep = 0;
  for (let i = 1; i < xy.length; i += 1) {
    if (xy[i].x !== a.x || xy[i].y !== a.y) {
      dep = bearing(a, xy[i]);
      break;
    }
  }
  let arr = dep;
  for (let i = xy.length - 2; i >= 0; i -= 1) {
    if (xy[i].x !== z.x || xy[i].y !== z.y) {
      arr = bearing(xy[i], z);
      break;
    }
  }
  return { dep, arr };
}

function instructions(graph: RouteGraph, pieces: Piece[], centres: (Centre | null)[]): string[] {
  const out: string[] = [];
  let firstWork = true;
  let prevRoad: number = -1;
  let afterUturn = false;
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i];
    if (p.kind === "cross") {
      out.push(p.uturn ? "Cross at the last door" : `Cross ${displayStreet(graph.segments[p.seg])}`);
      if (p.uturn) afterUturn = true;
      continue;
    }
    if (p.kind === "straight") {
      out.push(`Walk to ${nextWorkStreet(graph, pieces, i)} — no doors`);
      prevRoad = -1;
      continue;
    }
    const seg = graph.segments[p.seg];
    const street = displayStreet(seg);
    if (p.doors.length === 0) {
      out.push(`Walk to ${nextWorkStreet(graph, pieces, i)} — no doors`);
    } else if (firstWork) {
      out.push(`Start on ${street}, doors on your ${handOf(p.dir, p.pav)}`);
      firstWork = false;
    } else if (afterUturn || (prevRoad !== -1 && (pieces[prevRoad] as RoadPiece).seg === p.seg && (pieces[prevRoad] as RoadPiece).dir !== p.dir)) {
      out.push(`Come back down ${street}`);
    } else if (prevRoad === -1) {
      out.push(`Carry on along ${street}`);
    } else {
      const prev = pieces[prevRoad] as RoadPiece;
      const prevSeg = graph.segments[prev.seg];
      if (prev.seg === p.seg || (prevSeg.name !== null && prevSeg.name === seg.name)) {
        out.push(`Carry on along ${street}`);
      } else {
        const turn = wrapTurn(pieceBearings(centres[i] as Centre).dep - pieceBearings(centres[prevRoad] as Centre).arr);
        if (Math.abs(turn) <= STRAIGHT_RAD) out.push(`Carry on along ${street}`);
        else out.push(turn > 0 ? `Turn right into ${street}` : `Turn left into ${street}`);
      }
    }
    afterUturn = false;
    prevRoad = i;
  }
  if (out.length > 0) out[out.length - 1] += " — finish at the last door";
  return out;
}

function nextWorkStreet(graph: RouteGraph, pieces: Piece[], from: number): string {
  for (let k = from + 1; k < pieces.length; k += 1) {
    const q = pieces[k];
    if (q.kind === "road" && q.doors.length > 0) return displayStreet(graph.segments[q.seg]);
  }
  return "the last door";
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

function snapsFor(demand: Demand, chain: readonly number[]): { ok: true; snaps: DoorSnap[] } | { ok: false; code: ManualRouteFailureCode; message: string } {
  if (chain.length === 0) return { ok: false, code: "no_doors", message: "The drawn route has no doors." };
  const byUprn = new Map<number, DoorSnap>();
  for (const d of demand.doors) byUprn.set(d.uprn, d);
  const seen = new Set<number>();
  const snaps: DoorSnap[] = [];
  for (const uprn of chain) {
    if (seen.has(uprn)) return { ok: false, code: "duplicate_door", message: "A door appears twice in the drawing." };
    seen.add(uprn);
    const snap = byUprn.get(uprn);
    if (!snap) return { ok: false, code: "unknown_door", message: "A door in the drawing is no longer in this prop." };
    if (snap.segment === -1) return { ok: false, code: "no_roads", message: "There are no roads near this prop to follow." };
    snaps.push(snap);
  }
  return { ok: true, snaps };
}

/** One manual variant from the chain as given (manual) or reversed (manual_reversed). Never throws. */
export function buildManualVariant(
  graph: RouteGraph,
  demand: Demand,
  chainIn: readonly number[],
  key: ManualKey,
  centroid: LonLat,
): ManualVariantResult {
  const chain = key === "manual" ? [...chainIn] : [...chainIn].reverse();
  const found = snapsFor(demand, chain);
  if (!found.ok) return found;
  const snaps = found.snaps;

  const unproject = makeUnproject(graph.project, centroid);
  const toLonLat = (pts: XY[]): LonLat[] => pts.map((p) => roundCoord(unproject(p)));

  const pieces = buildPieces(graph, snaps);
  const centres = pieces.map((p) => (p.kind === "road" ? roadCentre(graph, p) : null));
  const roads = roadWalklines(graph, pieces, centres);
  const words = instructions(graph, pieces, centres);

  let straightTransfers = 0;
  const steps: WalkStep[] = [];
  const walkMeta: WalkVariant["walk_meta"] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i];
    if (p.kind === "road") {
      const seg = graph.segments[p.seg];
      const fromNode = graph.nodes[p.dir === 1 ? seg.fromNode : seg.toNode];
      const toNode = graph.nodes[endNode(seg, p.dir)];
      const geo = roads[i] as RoadGeometry;
      const centre = centres[i] as Centre;
      steps.push({
        kind: p.doors.length > 0 ? "work" : "walk",
        segment_id: seg.id,
        street_name: seg.name,
        side: handOf(p.dir, p.pav),
        from_node: fromNode.id,
        to_node: toNode.id,
        centreline: centre.lonLat.map(roundCoord),
        walkline: toLonLat(geo.walk),
        first_seq: p.doors.length > 0 ? p.doors[0] : null,
        last_seq: p.doors.length > 0 ? p.doors[p.doors.length - 1] : null,
        instruction: words[i],
        is_dead_end: toNode.degree === 1,
        length_m: round2(Math.abs(p.to - p.from) * metresFactor(seg)),
      });
      walkMeta.push({
        offset_m: geo.offsetM,
        offset_base_m: geo.baseM,
        offset_side: handOf(p.dir, p.pav),
        offset_ladder_passed: geo.passed,
        offset_run: geo.run,
        head_arc_points: geo.head,
        tail_arc_points: 0,
      });
      continue;
    }
    const before = neighbourWalk(roads, i - 1, -1);
    const after = neighbourWalk(roads, i + 1, 1);
    const a = before ? before[before.length - 1] : (after as XY[])[0];
    const b = after ? after[0] : a;
    const nextRoad = pieces.slice(i + 1).find((q): q is RoadPiece => q.kind === "road");
    const side: Hand = nextRoad ? handOf(nextRoad.dir, nextRoad.pav) : "left";
    if (p.kind === "cross") {
      const seg = graph.segments[p.seg];
      const node = graph.nodes[nearestEndNode(seg, p.at)];
      const line = toLonLat(crossLine(graph, p, a, b));
      steps.push({
        kind: "cross",
        segment_id: null,
        street_name: seg.name,
        side,
        from_node: node.id,
        to_node: node.id,
        centreline: line,
        walkline: line,
        first_seq: null,
        last_seq: null,
        instruction: words[i],
        is_dead_end: node.degree === 1 && planarDistance(node.xy, pointAlong(seg, p.at)) <= PAVEMENT_OFFSET_M,
        length_m: round2(CROSS_M),
      });
    } else {
      straightTransfers += 1;
      const line = toLonLat([a, b]);
      steps.push({
        kind: "walk",
        segment_id: null,
        street_name: null,
        side,
        from_node: graph.nodes[p.fromNode].id,
        to_node: graph.nodes[p.toNode].id,
        centreline: line,
        walkline: line,
        first_seq: null,
        last_seq: null,
        instruction: words[i],
        is_dead_end: graph.nodes[p.toNode].degree === 1,
        length_m: round2(haversineM(line[0], line[1])),
      });
    }
    walkMeta.push({
      offset_m: null,
      offset_base_m: null,
      offset_side: null,
      offset_ladder_passed: null,
      offset_run: null,
      head_arc_points: 0,
      tail_arc_points: 0,
    });
  }

  let workingM = 0;
  let nonWorkingM = 0;
  for (const s of steps) {
    if (s.kind === "work") workingM += s.length_m;
    else nonWorkingM += s.length_m;
  }
  if (round2(workingM + nonWorkingM) <= 0) {
    return { ok: false, code: "too_short", message: "Draw through at least two doors along a road." };
  }
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];
  const endPoint = lastStep.walkline[lastStep.walkline.length - 1];
  const firstDoor = snaps[0];
  const lastDoor = snaps[snaps.length - 1];
  const feetM = planarDistance(
    pointAlong(graph.segments[firstDoor.segment], firstDoor.alongM),
    pointAlong(graph.segments[lastDoor.segment], lastDoor.alongM),
  );
  const far = snaps.filter((s) => s.distanceM > STRANDED_THRESHOLD_M).length;
  const firstWork = steps.find((s) => s.kind === "work");
  const warnings: string[] = [];
  if (far > 0) warnings.push(`${far} ${far === 1 ? "door is" : "doors are"} more than ${STRANDED_THRESHOLD_M} m from a road`);
  if (straightTransfers > 0) warnings.push(`${straightTransfers} straight ${straightTransfers === 1 ? "line" : "lines"} where no road joins the doors`);

  return {
    ok: true,
    variant: {
      key,
      hand: firstWork?.side ?? "left",
      start: { node_id: firstStep.from_node, lon: firstStep.walkline[0][0], lat: firstStep.walkline[0][1] },
      end: { node_id: lastStep.to_node, lon: endPoint[0], lat: endPoint[1] },
      total_m: round2(workingM + nonWorkingM),
      working_m: round2(workingM),
      non_working_m: round2(nonWorkingM),
      return_m: 0,
      rank_cost_m: round2(nonWorkingM),
      end_to_start_m: round2(feetM),
      stranded_count: 0,
      straight_transfers: straightTransfers,
      door_order: chain,
      steps,
      warnings,
      tree: { step_chain: steps.map(() => -1), chain_parent: [] },
      walk_meta: walkMeta,
    },
  };
}

/** Both manual variants: the chain as drawn and walked backwards. Never throws. */
export function buildManualVariants(
  graph: RouteGraph,
  demand: Demand,
  chain: readonly number[],
  centroid: LonLat,
): ManualVariantsResult {
  const manual = buildManualVariant(graph, demand, chain, "manual", centroid);
  if (!manual.ok) return manual;
  const reversed = buildManualVariant(graph, demand, chain, "manual_reversed", centroid);
  if (!reversed.ok) return reversed;
  return { ok: true, manual: manual.variant, reversed: reversed.variant };
}
