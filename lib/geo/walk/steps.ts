/**
 * Stage 5b (R1) — turns a traversal into the typed variant: door order,
 * door ranges per work step, instructions from the fixed vocabulary, and
 * centreline / walkline geometry.
 */

import {
  bearing,
  displayStreet,
  halfEdgeLonLat,
  wrapTurn,
  type LonLat,
  type RouteGraph,
  type XY,
} from "@/lib/geo/route-graph";
import { doorDistance, type Demand } from "@/lib/geo/walk/demand";
import {
  CROSS_M,
  PAVEMENT_OFFSET_M,
  makeUnproject,
  offsetPolyline,
  round2,
  roundCoord,
} from "@/lib/geo/walk/geometry";
import { STRAIGHT_RAD, type Rec, type Traversal } from "@/lib/geo/walk/traverse";
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
      out.push("Cross at the end");
      continue;
    }
    const street = streetOf(graph, r);
    if (r.role === "return") {
      out.push("Back to the start");
    } else if (r.kind === "walk") {
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
  return out;
}

// ---------------------------------------------------------------------------
// Geometry and assembly
// ---------------------------------------------------------------------------

function unitNormalAtEnd(xy: XY[], hand: Hand): XY {
  // Normal at the last vertex of a polyline, on the hand side of travel.
  let i = xy.length - 2;
  while (i > 0 && xy[i].x === xy[xy.length - 1].x && xy[i].y === xy[xy.length - 1].y) i -= 1;
  const a = xy[Math.max(0, i)];
  const b = xy[xy.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return hand === "right" ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
}

export function buildVariant(
  graph: RouteGraph,
  demand: Demand,
  t: Traversal,
  key: VariantKey,
  centroid: LonLat,
): WalkVariant {
  const unproject = makeUnproject(graph.project, centroid);
  const toLonLat = (pts: XY[]): LonLat[] => pts.map((p) => roundCoord(unproject(p)));
  const doorOrder = buildDoorOrder(graph, demand, t.records);
  const instructions = buildInstructions(graph, t.records, t.hand);

  const steps: WalkStep[] = t.records.map((r, i) => {
    const range = doorOrder.ranges[i];
    if (r.kind === "cross") {
      const h = graph.halfEdges[r.half];
      const xy = h.dir === 1 ? graph.segments[h.segment].xy : [...graph.segments[h.segment].xy].reverse();
      const n = unitNormalAtEnd(xy, t.hand);
      const node = graph.nodes[r.toNode];
      const line = toLonLat([
        { x: node.xy.x + n.x * PAVEMENT_OFFSET_M, y: node.xy.y + n.y * PAVEMENT_OFFSET_M },
        { x: node.xy.x - n.x * PAVEMENT_OFFSET_M, y: node.xy.y - n.y * PAVEMENT_OFFSET_M },
      ]);
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
        length_m: round2(CROSS_M),
      };
    }
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
        centreline: [roundCoord(a.lonLat), roundCoord(b.lonLat)],
        walkline: toLonLat(offsetPolyline([a.xy, b.xy], PAVEMENT_OFFSET_M, t.hand)),
        first_seq: null,
        last_seq: null,
        instruction: instructions[i],
        is_dead_end: b.degree === 1,
        length_m: round2(r.lengthM),
      };
    }
    const h = graph.halfEdges[r.half];
    const seg = graph.segments[h.segment];
    const xy = h.dir === 1 ? seg.xy : [...seg.xy].reverse();
    return {
      kind: r.kind,
      segment_id: seg.id,
      street_name: seg.name,
      side: t.hand,
      from_node: graph.nodes[h.from].id,
      to_node: graph.nodes[h.to].id,
      centreline: halfEdgeLonLat(graph, h).map(roundCoord),
      walkline: toLonLat(offsetPolyline(xy, PAVEMENT_OFFSET_M, t.hand)),
      first_seq: range ? range[0] : null,
      last_seq: range ? range[1] : null,
      instruction: instructions[i],
      is_dead_end: graph.nodes[h.to].degree === 1,
      length_m: round2(r.lengthM),
    };
  });

  const start = graph.nodes[t.startNode];
  const end = graph.nodes[t.records.length > 0 ? t.records[t.records.length - 1].toNode : t.startNode];
  return {
    key,
    hand: t.hand,
    start: { node_id: start.id, lon: start.lonLat[0], lat: start.lonLat[1] },
    end: { node_id: end.id, lon: end.lonLat[0], lat: end.lonLat[1] },
    total_m: round2(t.workingM + t.nonWorkingM),
    working_m: round2(t.workingM),
    non_working_m: round2(t.nonWorkingM),
    return_m: round2(t.returnM),
    rank_cost_m: round2(t.rankCostM),
    end_to_start_m: round2(t.endToStartM),
    stranded_count: doorOrder.strandedCount,
    straight_transfers: t.straightTransfers,
    door_order: doorOrder.order,
    steps,
    warnings: [...t.warnings],
    tree: { step_chain: t.records.map((r) => r.chain), chain_parent: [...t.chainParent] },
  };
}
