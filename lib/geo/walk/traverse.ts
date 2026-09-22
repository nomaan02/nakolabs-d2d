/**
 * Stage 5b (R1) — the walking-pattern traversal. docs/ROUTE-DESIGN-v2.md (a),
 * (b), (f) are the specification of this file; nothing here is decided that
 * the note does not state.
 *
 * The walk is a depth-first traversal over CHAINS (one street as walked). A
 * branch is walked out knocking the hand side, crossed at its far end, and
 * walked straight back knocking the other side, entering hand-side
 * sub-branches at intermediate junctions on the way. A one-sided chain met in
 * trunk mode is a carry-on: the walker follows it and does not come back.
 * Leftovers are reached by transfers over the buffer graph. The walk ends
 * where the pattern ends; a "Back to the start" leg is appended.
 *
 * Determinism: every candidate list is sorted on an explicit total order
 * (turn key, segment id, direction); no Set or Map is iterated; the only
 * Map read is `graph.nodeIndexById`, by key.
 */

import {
  BEARING_TIE_RAD,
  bearing,
  haversineM,
  planarDistance,
  wrapTurn,
  type HalfEdge,
  type RouteGraph,
} from "@/lib/geo/route-graph";
import { knockedSide, otherSide, type Demand, type Side } from "@/lib/geo/walk/demand";
import { CROSS_M } from "@/lib/geo/walk/geometry";
import { shortestPath } from "@/lib/geo/walk/shortest-path";
import type { Hand, StepKind } from "@/lib/geo/walk/types";

/** A continuation with a different name must be within this of straight. Also the wording threshold for "Carry on". */
export const STRAIGHT_RAD = (30 * Math.PI) / 180;

export type Role = "out" | "back" | "carry" | "transfer" | "return";

export type Rec = {
  kind: StepKind;
  /** Half-edge walked; on a cross, the half-edge that ARRIVED at the crossing node; -1 on a straight line. */
  half: number;
  fromNode: number;
  toNode: number;
  /** Segment side knocked (0 left / 1 right of from_node → to_node) on a work step; -1 otherwise. */
  side: Side | -1;
  /** Chain id; -1 on transfers and the return leg. */
  chain: number;
  role: Role;
  lengthM: number;
  straight: boolean;
};

export type Traversal = {
  hand: Hand;
  startNode: number;
  /** Node where the pattern ended, before any return leg. */
  endNode: number;
  records: Rec[];
  chainParent: number[];
  rankCostM: number;
  endToStartM: number;
  returnM: number;
  workingM: number;
  nonWorkingM: number;
  transfers: number;
  straightTransfers: number;
  warnings: string[];
  coveredEverySide: boolean;
};

type Cand = { o: number; turn: number; edges: number[] };

export function traverse(graph: RouteGraph, demand: Demand, startNode: number, hand: Hand): Traversal {
  const nSeg = graph.segments.length;
  const claimed = new Uint8Array(nSeg * 2);
  /** > 0 while the segment belongs to a chain currently being walked (this chain or an ancestor). */
  const active = new Uint16Array(nSeg);
  let remaining = demand.workingSides;
  const records: Rec[] = [];
  const chainParent: number[] = [];
  const warnings: string[] = [];
  let transfers = 0;
  let straightTransfers = 0;

  const hasDemandSide = (seg: number, side: Side): boolean =>
    demand.working[seg * 2 + side] === 1 && claimed[seg * 2 + side] === 0;
  const hasDemand = (seg: number): boolean => hasDemandSide(seg, 0) || hasDemandSide(seg, 1);

  function newChain(parent: number): number {
    chainParent.push(parent);
    return chainParent.length - 1;
  }

  /**
   * Turn key for the hand: right hand → sharpest right first, then straight,
   * then left turns; left hand mirrored. A single total order over departures,
   * which is the "keep the hand on the wall" order at any junction.
   */
  function turnKey(turn: number): number {
    return hand === "right" ? -turn : turn;
  }

  function compareCands(a: Cand, b: Cand): number {
    const ka = turnKey(a.turn);
    const kb = turnKey(b.turn);
    if (Math.abs(ka - kb) > BEARING_TIE_RAD) return ka - kb;
    const sa = graph.segments[graph.halfEdges[a.o].segment];
    const sb = graph.segments[graph.halfEdges[b.o].segment];
    return sa.id - sb.id || graph.halfEdges[b.o].dir - graph.halfEdges[a.o].dir;
  }

  /** Continuation rule (design f.1): same non-null name with the smallest |turn|; else straight within 30°; else the street ends. */
  function continuation(h: HalfEdge): number {
    const node = graph.nodes[h.to];
    const name = graph.segments[h.segment].name;
    let bestSame = -1;
    let bestSameTurn = Infinity;
    let bestAny = -1;
    let bestAnyTurn = Infinity;
    for (const o of node.out) {
      if (o === h.reverse) continue;
      const d = graph.halfEdges[o];
      const t = Math.abs(wrapTurn(d.departureBearing - h.arrivalBearing));
      if (name !== null && graph.segments[d.segment].name === name && t < bestSameTurn - BEARING_TIE_RAD) {
        bestSame = o;
        bestSameTurn = t;
      }
      if (t < bestAnyTurn - BEARING_TIE_RAD) {
        bestAny = o;
        bestAnyTurn = t;
      }
    }
    if (bestSame !== -1) return bestSame;
    if (bestAny !== -1 && bestAnyTurn <= STRAIGHT_RAD) return bestAny;
    return -1;
  }

  const chainMark = new Uint32Array(nSeg);
  let chainStamp = 0;

  /** The chain departing along `startHalf`, trimmed to its last segment with demand. Empty when nothing ahead needs knocking. */
  function chainFor(startHalf: number): number[] {
    chainStamp += 1;
    const edges = [startHalf];
    chainMark[graph.halfEdges[startHalf].segment] = chainStamp;
    let cur = graph.halfEdges[startHalf];
    while (edges.length <= nSeg) {
      const c = continuation(cur);
      if (c === -1) break;
      const s = graph.halfEdges[c].segment;
      if (chainMark[s] === chainStamp || active[s] > 0) break;
      chainMark[s] = chainStamp;
      edges.push(c);
      cur = graph.halfEdges[c];
    }
    let last = -1;
    for (let i = 0; i < edges.length; i += 1) {
      if (hasDemand(graph.halfEdges[edges[i]].segment)) last = i;
    }
    return last === -1 ? [] : edges.slice(0, last + 1);
  }

  function profile(edges: number[]): { handD: boolean; otherD: boolean } {
    let handD = false;
    let otherD = false;
    for (const e of edges) {
      const h = graph.halfEdges[e];
      const s = knockedSide(hand, h.dir);
      if (hasDemandSide(h.segment, s)) handD = true;
      if (hasDemandSide(h.segment, otherSide(s))) otherD = true;
    }
    return { handD, otherD };
  }

  function emitRoad(h: HalfEdge, chain: number, role: Role): void {
    const seg = graph.segments[h.segment];
    const side = knockedSide(hand, h.dir);
    if (hasDemandSide(h.segment, side)) {
      claimed[h.segment * 2 + side] = 1;
      remaining -= 1;
      records.push({ kind: "work", half: h.index, fromNode: h.from, toNode: h.to, side, chain, role, lengthM: seg.lengthM, straight: false });
    } else {
      records.push({ kind: "walk", half: h.index, fromNode: h.from, toNode: h.to, side: -1, chain, role, lengthM: seg.lengthM, straight: false });
    }
  }

  /** Branch mode at an intermediate node: hand-side departures with demand ahead, sharpest first, re-evaluated after each returns. */
  function intermediate(arrived: HalfEdge, continuationHalf: number, parentChain: number): void {
    for (;;) {
      const cands: Cand[] = [];
      for (const o of graph.nodes[arrived.to].out) {
        if (o === arrived.reverse || o === continuationHalf) continue;
        const d = graph.halfEdges[o];
        if (active[d.segment] > 0) continue;
        const turn = wrapTurn(d.departureBearing - arrived.arrivalBearing);
        const onHand = hand === "right" ? turn > BEARING_TIE_RAD : turn < -BEARING_TIE_RAD;
        if (!onHand) continue;
        const edges = chainFor(o);
        if (edges.length === 0) continue;
        cands.push({ o, turn, edges });
      }
      if (cands.length === 0) return;
      cands.sort(compareCands);
      walkChain(cands[0].edges, newChain(parentChain), true);
    }
  }

  /** Walks a chain out; as a branch, crosses at the far end when needed and walks back. Returns the node the walker stands on afterwards. */
  function walkChain(edges: number[], chain: number, isBranch: boolean): number {
    for (const e of edges) active[graph.halfEdges[e].segment] += 1;
    for (let i = 0; i < edges.length; i += 1) {
      const h = graph.halfEdges[edges[i]];
      emitRoad(h, chain, isBranch ? "out" : "carry");
      if (i < edges.length - 1) intermediate(h, edges[i + 1], chain);
    }
    const last = graph.halfEdges[edges[edges.length - 1]];
    if (!isBranch) {
      for (const e of edges) active[graph.halfEdges[e].segment] -= 1;
      return last.to;
    }
    let needCross = false;
    for (const e of edges) {
      const h = graph.halfEdges[e];
      if (hasDemandSide(h.segment, otherSide(knockedSide(hand, h.dir)))) needCross = true;
    }
    if (needCross) {
      records.push({ kind: "cross", half: last.index, fromNode: last.to, toNode: last.to, side: -1, chain, role: "out", lengthM: CROSS_M, straight: false });
    }
    for (let i = edges.length - 1; i >= 0; i -= 1) {
      const r = graph.halfEdges[graph.halfEdges[edges[i]].reverse];
      emitRoad(r, chain, "back");
      if (i > 0) intermediate(r, graph.halfEdges[edges[i - 1]].reverse, chain);
    }
    for (const e of edges) active[graph.halfEdges[e].segment] -= 1;
    return graph.halfEdges[edges[0]].from;
  }

  /**
   * Trunk mode at `node`: two-sided chains are branches (they return here);
   * the first hand-only chain is a carry-on, followed to its far end where
   * trunk mode runs again. Returns where the trunk ran out.
   */
  function trunk(node: number, arrivalBearing: number, exclude: number, parentChain: number): { node: number; arrivalBearing: number } {
    for (;;) {
      const twoSided: Cand[] = [];
      const handOnly: Cand[] = [];
      for (const o of graph.nodes[node].out) {
        if (o === exclude) continue;
        const d = graph.halfEdges[o];
        if (active[d.segment] > 0) continue;
        const edges = chainFor(o);
        if (edges.length === 0) continue;
        const p = profile(edges);
        if (!p.handD) continue; // wrong-side chain: reached from its other end, later
        const cand = { o, turn: wrapTurn(d.departureBearing - arrivalBearing), edges };
        if (p.otherD) twoSided.push(cand);
        else handOnly.push(cand);
      }
      if (twoSided.length > 0) {
        twoSided.sort(compareCands);
        walkChain(twoSided[0].edges, newChain(parentChain), true);
        continue;
      }
      if (handOnly.length > 0) {
        handOnly.sort(compareCands);
        const c = handOnly[0];
        const chain = newChain(parentChain);
        const end = walkChain(c.edges, chain, false);
        const last = graph.halfEdges[c.edges[c.edges.length - 1]];
        node = end;
        arrivalBearing = last.arrivalBearing;
        exclude = last.reverse;
        parentChain = chain;
        continue;
      }
      return { node, arrivalBearing };
    }
  }

  /** A node is usable when some departure has a chain with demand on the hand side as walked out. */
  function usable(v: number): boolean {
    for (const o of graph.nodes[v].out) {
      const edges = chainFor(o);
      if (edges.length > 0 && profile(edges).handD) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // The walk
  // -------------------------------------------------------------------------

  let cur = trunk(startNode, bearing(graph.centroidXY, graph.nodes[startNode].xy), -1, -1);
  let guard = 0;
  while (remaining > 0) {
    guard += 1;
    if (guard > demand.workingSides + 1) {
      warnings.push("traversal stopped: no progress while demand remained");
      break;
    }
    const before = remaining;
    const res = shortestPath(graph, cur.node, usable);
    transfers += 1;
    if (res === null) {
      // No road joins the components: straight line to the nearest usable node.
      let target = -1;
      let bestD = Infinity;
      for (const n of graph.nodes) {
        if (!usable(n.index)) continue;
        const d = planarDistance(graph.nodes[cur.node].xy, n.xy);
        if (d < bestD) {
          bestD = d;
          target = n.index;
        }
      }
      if (target === -1) {
        warnings.push("demand remained but no usable node exists");
        break;
      }
      const a = graph.nodes[cur.node];
      const b = graph.nodes[target];
      records.push({ kind: "walk", half: -1, fromNode: a.index, toNode: b.index, side: -1, chain: -1, role: "transfer", lengthM: haversineM(a.lonLat, b.lonLat), straight: true });
      straightTransfers += 1;
      warnings.push(`straight-line transfer: no road in the buffer joins node ${a.id} to node ${b.id} (${Math.round(bestD)} m)`);
      cur = trunk(target, bearing(a.xy, b.xy), -1, -1);
    } else {
      let arrivalBearing = cur.arrivalBearing;
      for (const e of res.path) {
        const h = graph.halfEdges[e];
        records.push({ kind: "walk", half: e, fromNode: h.from, toNode: h.to, side: -1, chain: -1, role: "transfer", lengthM: graph.segments[h.segment].lengthM, straight: false });
        arrivalBearing = h.arrivalBearing;
      }
      cur = trunk(res.target, arrivalBearing, -1, -1);
    }
    if (remaining === before) {
      warnings.push("traversal stopped: a transfer made no progress");
      break;
    }
  }

  const endNode = cur.node;
  const endToStartM = planarDistance(graph.nodes[endNode].xy, graph.nodes[startNode].xy);

  let rankCostM = 0;
  let workingM = 0;
  for (const r of records) {
    if (r.kind === "work") workingM += r.lengthM;
    else rankCostM += r.lengthM;
  }

  let returnM = 0;
  if (endNode !== startNode) {
    const back = shortestPath(graph, endNode, (n) => n === startNode);
    if (back === null) {
      const a = graph.nodes[endNode];
      const b = graph.nodes[startNode];
      const d = haversineM(a.lonLat, b.lonLat);
      records.push({ kind: "walk", half: -1, fromNode: a.index, toNode: b.index, side: -1, chain: -1, role: "return", lengthM: d, straight: true });
      returnM += d;
      warnings.push(`straight-line return: no road in the buffer joins node ${a.id} back to the start node ${b.id}`);
    } else {
      for (const e of back.path) {
        const h = graph.halfEdges[e];
        const len = graph.segments[h.segment].lengthM;
        records.push({ kind: "walk", half: e, fromNode: h.from, toNode: h.to, side: -1, chain: -1, role: "return", lengthM: len, straight: false });
        returnM += len;
      }
    }
  }

  // Rank cost is every non-working metre, the return leg included (design c,
  // post-run correction): excluding it rewarded starting beside a doorless
  // segment so that segment became a "free" return leg.
  return {
    hand,
    startNode,
    endNode,
    records,
    chainParent,
    rankCostM: rankCostM + returnM,
    endToStartM,
    returnM,
    workingM,
    nonWorkingM: rankCostM + returnM,
    transfers,
    straightTransfers,
    warnings,
    coveredEverySide: remaining === 0,
  };
}

/**
 * `best_reversed`: the record list backwards, every half-edge reversed, out
 * and back passes swapped. The old return leg becomes an opening walk. The
 * knocked segment side is a physical pavement and does not change; the side
 * relative to travel flips because the hand flips (design d).
 */
export function reverseTraversal(graph: RouteGraph, t: Traversal): Traversal {
  const records: Rec[] = [];
  for (let i = t.records.length - 1; i >= 0; i -= 1) {
    const r = t.records[i];
    const role: Role = r.role === "out" ? "back" : r.role === "back" ? "out" : r.role === "return" ? "transfer" : r.role;
    if (r.kind === "cross") {
      records.push({ ...r, role });
      continue;
    }
    records.push({
      ...r,
      half: r.half === -1 ? -1 : graph.halfEdges[r.half].reverse,
      fromNode: r.toNode,
      toNode: r.fromNode,
      role,
    });
  }
  const startNode = t.records.length > 0 ? records[0].fromNode : t.startNode;
  return {
    hand: t.hand === "left" ? "right" : "left",
    startNode,
    endNode: records.length > 0 ? records[records.length - 1].toNode : startNode,
    records,
    chainParent: [...t.chainParent],
    rankCostM: t.rankCostM,
    endToStartM: 0,
    returnM: 0,
    workingM: t.workingM,
    nonWorkingM: t.nonWorkingM,
    transfers: t.transfers,
    straightTransfers: t.straightTransfers,
    warnings: [...t.warnings],
    coveredEverySide: t.coveredEverySide,
  };
}
