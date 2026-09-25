/**
 * Stage 5b (R1) — turns a traversal into the typed variant: door order,
 * door ranges per work step, instructions from the fixed vocabulary, and
 * centreline / walkline geometry. Since the open-path change (2026-09-25)
 * every road record is cut to its kept interval (trim.ts) before it is
 * offset, and every U-turn is drawn as an arc.
 */

import {
  bearing,
  displayStreet,
  wrapTurn,
  type LonLat,
  type RouteGraph,
  type XY,
} from "@/lib/geo/route-graph";
import { doorDistance, knockedSide, type Demand } from "@/lib/geo/walk/demand";
import {
  ARC_POINTS,
  PAVEMENT_OFFSET_M,
  WALK_BACK_INSET_M,
  directionAlong,
  makeUnproject,
  offsetRun,
  pointAlong,
  round2,
  roundCoord,
  sliceAlong,
  uTurnArc,
} from "@/lib/geo/walk/geometry";
import { STRAIGHT_RAD, type Rec, type Traversal } from "@/lib/geo/walk/traverse";
import { findTurns, keepIntervals, keptLengthM, type Interval, type Turn } from "@/lib/geo/walk/trim";
import type { Hand, VariantKey, WalkStep, WalkVariant } from "@/lib/geo/walk/types";

// ---------------------------------------------------------------------------
// Door order
// ---------------------------------------------------------------------------

export type DoorOrder = {
  order: number[];
  /** [first_seq, last_seq] per record index; null on non-work records. */
  ranges: (readonly [number, number] | null)[];
  strandedCount: number;
};

export function buildDoorOrder(graph: RouteGraph, demand: Demand, records: Rec[]): DoorOrder {
  const order: number[] = [];
  const ranges: (readonly [number, number] | null)[] = [];
  for (const r of records) {
    if (r.kind !== "work" || r.side === -1) {
      ranges.push(null);
      continue;
    }
    const h = graph.halfEdges[r.half];
    const doors = demand.sideDoors[h.segment][r.side];
    const first = order.length;
    if (h.dir === 1) for (const d of doors) order.push(d.uprn);
    else for (let i = doors.length - 1; i >= 0; i -= 1) order.push(doors[i].uprn);
    ranges.push(doors.length > 0 ? [first, order.length - 1] : null);
  }

  // Stranded tail: by the sequence position of the nearest non-stranded door, then UPRN.
  const seqByUprn = new Map<number, number>();
  order.forEach((u, i) => seqByUprn.set(u, i));
  const placed = demand.doors.filter((d) => !d.stranded && seqByUprn.has(d.uprn));
  const stranded = demand.doors
    .filter((d) => d.stranded || !seqByUprn.has(d.uprn))
    .map((d) => {
      let bestSeq = Infinity;
      let bestD = Infinity;
      for (const p of placed) {
        const dist = doorDistance(d, p);
        const seq = seqByUprn.get(p.uprn) as number;
        if (dist < bestD || (dist === bestD && seq < bestSeq)) {
          bestD = dist;
          bestSeq = seq;
        }
      }
      return { uprn: d.uprn, seq: bestSeq };
    })
    .sort((a, b) => a.seq - b.seq || a.uprn - b.uprn);
  for (const s of stranded) order.push(s.uprn);
  return { order, ranges, strandedCount: stranded.length };
}

// ---------------------------------------------------------------------------
// Instructions — the fixed vocabulary, nothing else
// ---------------------------------------------------------------------------

function streetOf(graph: RouteGraph, r: Rec): string {
  if (r.half === -1) return "unnamed road";
  return displayStreet(graph.segments[graph.halfEdges[r.half].segment]);
}

function nameOf(graph: RouteGraph, r: Rec): string | null {
  if (r.half === -1) return null;
  return graph.segments[graph.halfEdges[r.half].segment].name;
}

function departureBearing(graph: RouteGraph, r: Rec): number {
  if (r.half !== -1) return graph.halfEdges[r.half].departureBearing;
  return bearing(graph.nodes[r.fromNode].xy, graph.nodes[r.toNode].xy);
}

function arrivalBearing(graph: RouteGraph, r: Rec): number {
  if (r.half !== -1) return graph.halfEdges[r.half].arrivalBearing;
  return bearing(graph.nodes[r.fromNode].xy, graph.nodes[r.toNode].xy);
}

export function buildInstructions(graph: RouteGraph, records: Rec[], hand: Hand): string[] {
  const out: string[] = [];
  let firstWork = true;
  let prevRoad: Rec | null = null;
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    if (r.kind === "cross") {
      out.push("Cross at the last door");
      continue;
    }
    const street = streetOf(graph, r);
    if (r.kind === "walk") {
      if (r.role === "back") {
        out.push(`Come back down ${street}`);
      } else {
        let target = street;
        for (let j = i + 1; j < records.length; j += 1) {
          if (records[j].kind === "work") {
            target = streetOf(graph, records[j]);
            break;
          }
        }
        out.push(`Walk to ${target} — no doors`);
      }
    } else if (firstWork) {
      out.push(`Start on ${street}, doors on your ${hand}`);
      firstWork = false;
    } else if (r.role === "back") {
      out.push(`Come back down ${street}`);
    } else if (prevRoad !== null && prevRoad.chain === r.chain && prevRoad.role === r.role && prevRoad.chain !== -1) {
      out.push(nameOf(graph, prevRoad) === nameOf(graph, r) ? `Knock ${street} to the end` : `Carry on along ${street}`);
    } else if (prevRoad === null) {
      out.push(`Knock ${street} to the end`);
    } else {
      const turn = wrapTurn(departureBearing(graph, r) - arrivalBearing(graph, prevRoad));
      if (Math.abs(turn) <= STRAIGHT_RAD) out.push(`Carry on along ${street}`);
      else out.push(turn > 0 ? `Turn right into ${street}` : `Turn left into ${street}`);
    }
    prevRoad = r;
  }
  if (out.length > 0) out[out.length - 1] += " — finish at the last door";
  return out;
}

// ---------------------------------------------------------------------------
// Geometry and assembly
// ---------------------------------------------------------------------------

/** A mitre is meaningless once the turn is this close to a U-turn. */
const RUN_BREAK_RAD = (170 * Math.PI) / 180;

type Centre = { xy: XY[]; lonLat: LonLat[] };

/** The walked part of a road record's centreline, in walking direction. Null on a cross. */
function stepCentre(graph: RouteGraph, r: Rec, interval: Interval | null): Centre | null {
  if (r.kind === "cross") return null;
  if (r.half === -1) {
    const a = graph.nodes[r.fromNode];
    const b = graph.nodes[r.toNode];
    return { xy: [a.xy, b.xy], lonLat: [a.lonLat, b.lonLat] };
  }
  const h = graph.halfEdges[r.half];
  const seg = graph.segments[h.segment];
  const [lo, hi] = interval ?? [0, seg.planarLengthM];
  const cut = sliceAlong(seg, lo, hi);
  return h.dir === 1 ? cut : { xy: cut.xy.reverse(), lonLat: cut.lonLat.reverse() };
}

/** Consecutive road steps share a mitre while they meet at a node and do not reverse. */
function continuesRun(graph: RouteGraph, prev: Rec, next: Rec): boolean {
  if (prev.kind === "cross" || next.kind === "cross") return false;
  if (prev.toNode !== next.fromNode) return false;
  if (prev.half !== -1 && next.half !== -1 && next.half === graph.halfEdges[prev.half].reverse) return false;
  const turn = wrapTurn(departureBearing(graph, next) - arrivalBearing(graph, prev));
  return Math.abs(turn) <= RUN_BREAK_RAD;
}

/**
 * A one-sided street's walk back: the walk half of a turn with no cross
 * (the transfer half when neither knocks), plus the walks of the same chain
 * that continue away from the turn. The walker stays on the pavement just
 * knocked, so the strip is drawn there. Returns 1 per record in a strip.
 */
function walkBackStrips(records: Rec[], turns: Turn[]): Uint8Array {
  const inStrip = new Uint8Array(records.length);
  const inTurn = new Uint8Array(records.length);
  for (const t of turns) {
    inTurn[t.into] = 1;
    inTurn[t.outOf] = 1;
  }
  const extends_ = (k: number, chain: number) =>
    k >= 0 && k < records.length && inStrip[k] === 0 && inTurn[k] === 0 &&
    records[k].kind === "walk" && records[k].half !== -1 && records[k].chain === chain;
  for (const t of turns) {
    if (t.cross !== -1) continue;
    const into = records[t.into];
    const outOf = records[t.outOf];
    const walkAfter = outOf.kind === "walk" && (into.kind === "work" || (into.kind === "walk" && outOf.chain === -1));
    const walkBefore = into.kind === "walk" && (outOf.kind === "work" || (outOf.kind === "walk" && into.chain === -1));
    if (walkAfter) {
      inStrip[t.outOf] = 1;
      let k = t.outOf;
      while (extends_(k + 1, outOf.chain) && records[k].toNode === records[k + 1].fromNode) {
        k += 1;
        inStrip[k] = 1;
      }
    } else if (walkBefore) {
      inStrip[t.into] = 1;
      let k = t.into;
      while (extends_(k - 1, into.chain) && records[k - 1].toNode === records[k].fromNode) {
        k -= 1;
        inStrip[k] = 1;
      }
    }
  }
  return inStrip;
}

/**
 * Walkline of every non-cross record, in planar metres. Records in one run
 * are offset together so the shared vertex is a single mitred point. A
 * walk-back strip is its own run, offset onto the knocked pavement (the
 * other side of travel) and inset towards the road.
 */
function walklinesXY(graph: RouteGraph, records: Rec[], centres: (Centre | null)[], inStrip: Uint8Array, hand: Hand): (XY[] | null)[] {
  const out: (XY[] | null)[] = new Array(records.length).fill(null);
  const other: Hand = hand === "left" ? "right" : "left";
  let i = 0;
  while (i < records.length) {
    if (records[i].kind === "cross") {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < records.length && inStrip[j + 1] === inStrip[i] && continuesRun(graph, records[j], records[j + 1])) j += 1;
    const parts: XY[][] = [];
    for (let k = i; k <= j; k += 1) parts.push((centres[k] as Centre).xy);
    const offset = inStrip[i]
      ? offsetRun(parts, PAVEMENT_OFFSET_M - WALK_BACK_INSET_M, other)
      : offsetRun(parts, PAVEMENT_OFFSET_M, hand);
    for (let k = i; k <= j; k += 1) out[k] = offset[k - i];
    i = j + 1;
  }
  return out;
}

function samePoint(a: XY, b: XY): boolean {
  return a.x === b.x && a.y === b.y;
}

function pointToEdgeM(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const s = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * s), p.y - (a.y + dy * s));
}

function edgesCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const side = (p: XY, q: XY, r: XY) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/** Nearest approach, in metres, of the edge a–b to a polyline. */
function edgeToLineM(a: XY, b: XY, line: XY[]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < line.length; k += 1) {
    const c = line[k];
    const d = line[k + 1];
    if (edgesCross(a, b, c, d)) return 0;
    best = Math.min(best, pointToEdgeM(a, c, d), pointToEdgeM(b, c, d), pointToEdgeM(c, a, b), pointToEdgeM(d, a, b));
  }
  if (line.length === 1) best = pointToEdgeM(line[0], a, b);
  return best;
}

/** How close a walk back may run to the line it returns beside. */
const WALK_BACK_CLEARANCE_M = 1;

export function buildVariant(
  graph: RouteGraph,
  demand: Demand,
  t: Traversal,
  key: VariantKey,
  centroid: LonLat,
): WalkVariant {
  const unproject = makeUnproject(graph.project, centroid);
  const toLonLat = (pts: XY[]): LonLat[] => pts.map((p) => roundCoord(unproject(p)));
  const records = t.records;
  const doorOrder = buildDoorOrder(graph, demand, records);
  const instructions = buildInstructions(graph, records, t.hand);
  const turns = findTurns(graph, demand, records);
  const keep = keepIntervals(graph, demand, records, turns);
  const centres = records.map((r, i) => stepCentre(graph, r, keep[i]));
  const inStrip = walkBackStrips(records, turns);
  const walkXY = walklinesXY(graph, records, centres, inStrip, t.hand);
  const originalXY = walkXY.map((w) => (w ? [...w] : null));

  // U-turns: every arc runs between the walkline ends either side of the
  // turn, bulging forward, and is built in one canonical direction so the
  // reversed variant gets the exact reverse.
  const arcXY: (XY[] | null)[] = new Array(records.length).fill(null);
  for (const turn of turns) {
    const intoXY = originalXY[turn.into] as XY[];
    const outXY = originalXY[turn.outOf] as XY[];
    const a = intoXY[intoXY.length - 1];
    const b = outXY[0];
    const seg = graph.segments[turn.segment];
    const ivInto = keep[turn.into] as Interval;
    const ivOut = keep[turn.outOf] as Interval;
    const chordM = turn.dir === 1 ? Math.max(ivInto[1], ivOut[1]) : Math.min(ivInto[0], ivOut[0]);
    const d = directionAlong(seg, turn.alongM, turn.dir);
    const u = { x: d.x * turn.dir, y: d.y * turn.dir };
    // Room ahead of the chord: along the road, and straight ahead where the road bends before the node.
    const foot = pointAlong(seg, chordM);
    const far = graph.nodes[turn.dir === 1 ? seg.toNode : seg.fromNode].xy;
    const reachM = Math.min(
      turn.dir === 1 ? seg.planarLengthM - chordM : chordM,
      (far.x - foot.x) * u.x + (far.y - foot.y) * u.y,
    );
    if (turn.cross !== -1) {
      // From the pavement on segment side 0 to side 1.
      arcXY[turn.cross] = knockedSide(t.hand, turn.dir) === 0 ? uTurnArc(a, b, u, reachM) : uTurnArc(b, a, u, reachM).reverse();
    } else if (inStrip[turn.outOf]) {
      // From the work line to the walk back.
      (walkXY[turn.outOf] as XY[]).splice(0, 1, ...uTurnArc(a, b, u, reachM));
    } else if (inStrip[turn.into]) {
      const w = walkXY[turn.into] as XY[];
      w.splice(w.length - 1, 1, ...uTurnArc(b, a, u, reachM).reverse());
    }
  }
  // Where the line it returns beside bends in towards the road at a junction,
  // the walk back stops short of it and the connecting line below takes over.
  for (const turn of turns) {
    if (turn.cross !== -1) continue;
    const walkAfter = inStrip[turn.outOf] === 1;
    const wIdx = walkAfter ? turn.outOf : turn.into;
    if (!inStrip[wIdx]) continue;
    const beyond = wIdx + (walkAfter ? 1 : -1);
    if (beyond >= 0 && beyond < records.length && inStrip[beyond]) continue;
    const partner = originalXY[walkAfter ? turn.into : turn.outOf] as XY[];
    const w = walkXY[wIdx] as XY[];
    const keepAtLeast = ARC_POINTS + 1;
    if (walkAfter) {
      while (w.length > keepAtLeast && edgeToLineM(w[w.length - 2], w[w.length - 1], partner) < WALK_BACK_CLEARANCE_M) w.pop();
    } else {
      while (w.length > keepAtLeast && edgeToLineM(w[0], w[1], partner) < WALK_BACK_CLEARANCE_M) w.shift();
    }
  }
  // Where a walk-back strip meets a step on the other pavement, the strip
  // carries the connecting line. Between two strips it goes on the lower
  // segment id, so the reversed variant puts it on the same record.
  const arcJoined = new Uint8Array(records.length);
  for (const turn of turns) if (turn.cross === -1) arcJoined[turn.into] = 1;
  for (let i = 0; i + 1 < records.length; i += 1) {
    if (arcJoined[i] || records[i].kind === "cross" || records[i + 1].kind === "cross") continue;
    if (!inStrip[i] && !inStrip[i + 1]) continue;
    const end = (walkXY[i] as XY[])[(walkXY[i] as XY[]).length - 1];
    const start = (walkXY[i + 1] as XY[])[0];
    if (samePoint(end, start)) continue;
    const segOf = (k: number) => graph.segments[graph.halfEdges[records[k].half].segment].id;
    const intoEarlier = inStrip[i] && (!inStrip[i + 1] || segOf(i) <= segOf(i + 1));
    if (intoEarlier) (walkXY[i] as XY[]).push(start);
    else (walkXY[i + 1] as XY[]).unshift(end);
  }

  const steps: WalkStep[] = records.map((r, i) => {
    const range = doorOrder.ranges[i];
    const length_m = keptLengthM(graph, r, keep[i]);
    if (r.kind === "cross") {
      const h = graph.halfEdges[r.half];
      const node = graph.nodes[r.toNode];
      const line = toLonLat(arcXY[i] as XY[]);
      return {
        kind: "cross",
        segment_id: null,
        street_name: graph.segments[h.segment].name,
        side: t.hand,
        from_node: node.id,
        to_node: node.id,
        centreline: line,
        walkline: line,
        first_seq: null,
        last_seq: null,
        instruction: instructions[i],
        is_dead_end: node.degree === 1,
        length_m,
      };
    }
    const centre = centres[i] as Centre;
    if (r.half === -1) {
      const a = graph.nodes[r.fromNode];
      const b = graph.nodes[r.toNode];
      return {
        kind: "walk",
        segment_id: null,
        street_name: null,
        side: t.hand,
        from_node: a.id,
        to_node: b.id,
        centreline: centre.lonLat.map(roundCoord),
        walkline: toLonLat(walkXY[i] as XY[]),
        first_seq: null,
        last_seq: null,
        instruction: instructions[i],
        is_dead_end: b.degree === 1,
        length_m,
      };
    }
    const h = graph.halfEdges[r.half];
    const seg = graph.segments[h.segment];
    return {
      kind: r.kind,
      segment_id: seg.id,
      street_name: seg.name,
      side: t.hand,
      from_node: graph.nodes[h.from].id,
      to_node: graph.nodes[h.to].id,
      centreline: centre.lonLat.map(roundCoord),
      walkline: toLonLat(walkXY[i] as XY[]),
      first_seq: range ? range[0] : null,
      last_seq: range ? range[1] : null,
      instruction: instructions[i],
      is_dead_end: graph.nodes[h.to].degree === 1,
      length_m,
    };
  });

  let workingM = 0;
  let nonWorkingM = 0;
  for (const s of steps) {
    if (s.kind === "work") workingM += s.length_m;
    else nonWorkingM += s.length_m;
  }
  let totalM = 0;
  for (const s of steps) totalM += s.length_m;

  const first = steps[0];
  const last = steps[steps.length - 1];
  const fallback = graph.nodes[t.startNode];
  const start = first
    ? { node_id: first.from_node, lon: first.walkline[0][0], lat: first.walkline[0][1] }
    : { node_id: fallback.id, lon: fallback.lonLat[0], lat: fallback.lonLat[1] };
  const endPoint = last ? last.walkline[last.walkline.length - 1] : null;
  const end = last && endPoint
    ? { node_id: last.to_node, lon: endPoint[0], lat: endPoint[1] }
    : start;
  return {
    key,
    hand: t.hand,
    start,
    end,
    total_m: round2(totalM),
    working_m: round2(workingM),
    non_working_m: round2(nonWorkingM),
    return_m: 0,
    rank_cost_m: round2(t.rankCostM),
    end_to_start_m: round2(t.endToStartM),
    stranded_count: doorOrder.strandedCount,
    straight_transfers: t.straightTransfers,
    door_order: doorOrder.order,
    steps,
    warnings: [...t.warnings],
    tree: { step_chain: records.map((r) => r.chain), chain_parent: [...t.chainParent] },
  };
}
