/**
 * Stage 5b (R1) — orchestrator: inputs → graph → demand → candidates →
 * ranked variants. Pure; no database writes. docs/ROUTE-DESIGN-v2.md (c), (d), (e).
 */

import { buildRouteGraph, planarDistance, type RouteGraph, type XY } from "@/lib/geo/route-graph";
import { buildDemand, type Demand } from "@/lib/geo/walk/demand";
import type { WalkInputs } from "@/lib/geo/walk/inputs";
import { buildVariant } from "@/lib/geo/walk/steps";
import { reverseTraversal, traverse, type Traversal } from "@/lib/geo/walk/traverse";
import type { CandidateSummary, Hand, VariantKey, WalkResult, WalkTimings, WalkVariant } from "@/lib/geo/walk/types";

/** Perimeter samples for start enumeration. */
export const START_SAMPLES = 24;
/** A sample adopts the nearest working node only when it is within this. */
export const START_SNAP_M = 60;
/** At most this many alternatives. */
export const MAX_ALTS = 4;
/** First-fifth door overlap at or above this is not materially different. */
export const OVERLAP_THRESHOLD = 0.5;

const HANDS: Hand[] = ["left", "right"];

/**
 * Start candidates (design c): the ring sampled at 24 points by perimeter
 * fraction from vertex 0; each sample takes the nearest working node within
 * 60 m; de-duplicated and sorted by node id. If no sample finds one within
 * 60 m, every sample takes its nearest working node regardless.
 */
export function enumerateStarts(graph: RouteGraph, demand: Demand, ring: XY[]): number[] {
  const working = new Uint8Array(graph.nodes.length);
  for (let s = 0; s < graph.segments.length; s += 1) {
    if (demand.working[s * 2] === 1 || demand.working[s * 2 + 1] === 1) {
      working[graph.segments[s].fromNode] = 1;
      working[graph.segments[s].toNode] = 1;
    }
  }
  const workingNodes = graph.nodes.filter((n) => working[n.index] === 1);
  if (workingNodes.length === 0) return [];

  const closed = ring.length > 0 && (ring[0].x !== ring[ring.length - 1].x || ring[0].y !== ring[ring.length - 1].y)
    ? [...ring, ring[0]]
    : ring;
  const cum = [0];
  for (let i = 1; i < closed.length; i += 1) cum.push(cum[i - 1] + planarDistance(closed[i - 1], closed[i]));
  const perimeter = cum[cum.length - 1];

  const samples: XY[] = [];
  for (let k = 0; k < START_SAMPLES; k += 1) {
    const target = (perimeter * k) / START_SAMPLES;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i += 1;
    const a = closed[i - 1];
    const b = closed[i];
    const span = cum[i] - cum[i - 1];
    const u = span > 0 ? (target - cum[i - 1]) / span : 0;
    samples.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }

  const nearest = samples.map((p) => {
    let best = workingNodes[0];
    let bestD = Infinity;
    for (const n of workingNodes) {
      const d = planarDistance(n.xy, p);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return { node: best.index, d: bestD };
  });

  let picked = nearest.filter((n) => n.d <= START_SNAP_M).map((n) => n.node);
  if (picked.length === 0) picked = nearest.map((n) => n.node);
  const seen = new Uint8Array(graph.nodes.length);
  const out: number[] = [];
  for (const n of picked) {
    if (seen[n]) continue;
    seen[n] = 1;
    out.push(n);
  }
  return out.sort((a, b) => graph.nodes[a].id - graph.nodes[b].id);
}

type Scored = { t: Traversal; startNodeId: number };

/**
 * Rank order (design change, open paths): non-working metres between the
 * first and last door, then first and last doors nearer each other, then
 * search start node id, then the reference drawing's hand (right) before left.
 */
export function compareCandidates(a: Scored, b: Scored): number {
  return (
    a.t.rankCostM - b.t.rankCostM ||
    a.t.endToStartM - b.t.endToStartM ||
    a.startNodeId - b.startNodeId ||
    (a.t.hand === b.t.hand ? 0 : a.t.hand === "right" ? -1 : 1)
  );
}

function firstFifth(order: number[], strandedCount: number): number[] {
  const live = order.slice(0, order.length - strandedCount);
  return live.slice(0, Math.max(1, Math.ceil(live.length / 5)));
}

/** Fraction of `a` found in `b`. */
export function overlap(a: number[], b: number[]): number {
  if (a.length === 0) return 0;
  const inB = new Set(b);
  let hits = 0;
  for (const u of a) if (inB.has(u)) hits += 1;
  return hits / a.length;
}

/** Materially different (design e): a new start node, and first-fifth door overlap below 50 % with every accepted route. */
export function materiallyDifferent(cand: WalkVariant, accepted: WalkVariant[]): boolean {
  const f = firstFifth(cand.door_order, cand.stranded_count);
  for (const v of accepted) {
    if (v.start.node_id === cand.start.node_id) return false;
    if (overlap(f, firstFifth(v.door_order, v.stranded_count)) >= OVERLAP_THRESHOLD) return false;
  }
  return true;
}

export function generateWalk(inputs: WalkInputs): WalkResult {
  const t0 = performance.now();
  const graph = buildRouteGraph(inputs.route);
  const t1 = performance.now();
  const demand = buildDemand(graph, inputs.route.doors);
  const t2 = performance.now();

  const ringXY = inputs.route.ring.map(graph.project);
  const starts = enumerateStarts(graph, demand, ringXY);
  const scored: Scored[] = [];
  for (const start of starts) {
    for (const hand of HANDS) {
      scored.push({ t: traverse(graph, demand, start, hand), startNodeId: graph.nodes[start].id });
    }
  }
  scored.sort(compareCandidates);
  const t3 = performance.now();

  const variants: WalkVariant[] = [];
  if (scored.length > 0) {
    const best = buildVariant(graph, demand, scored[0].t, "best", inputs.route.centroid);
    const reversed = buildVariant(graph, demand, reverseTraversal(graph, scored[0].t), "best_reversed", inputs.route.centroid);
    variants.push(best, reversed);
    const accepted: WalkVariant[] = [best, reversed];
    let k = 0;
    for (let i = 1; i < scored.length && k < MAX_ALTS; i += 1) {
      const key: VariantKey = `alt_${k + 1}`;
      const v = buildVariant(graph, demand, scored[i].t, key, inputs.route.centroid);
      if (!materiallyDifferent(v, accepted)) continue;
      accepted.push(v);
      variants.push(v);
      k += 1;
    }
  }
  const t4 = performance.now();

  const candidates: CandidateSummary[] = scored.map((s) => ({
    start_node_id: s.startNodeId,
    hand: s.t.hand,
    rank_cost_m: Math.round(s.t.rankCostM * 100) / 100,
    end_to_start_m: Math.round(s.t.endToStartM * 100) / 100,
    transfers: s.t.transfers,
    straight_transfers: s.t.straightTransfers,
    covered_every_side: s.t.coveredEverySide,
  }));

  const timings: WalkTimings = {
    parse_ms: 0,
    graph_ms: Math.round(t1 - t0),
    demand_ms: Math.round(t2 - t1),
    candidates_ms: Math.round(t3 - t2),
    variants_ms: Math.round(t4 - t3),
    total_ms: Math.round(t4 - t0),
  };

  return {
    territory_id: inputs.territoryId,
    name: inputs.name,
    buffer_m: inputs.bufferM,
    doors: inputs.route.doors.length,
    stranded_count: demand.strandedCount,
    buffer_segments: graph.segments.length,
    buffer_nodes: graph.nodes.length,
    working_segments: demand.workingSegments,
    two_sided_segments: demand.twoSidedSegments,
    one_sided_segments: demand.oneSidedSegments,
    working_sides: demand.workingSides,
    start_candidates: starts.length,
    candidates,
    variants,
    timings,
  };
}

/** Exposed for the harness: the graph and demand a result was built from. */
export function prepare(inputs: WalkInputs): { graph: RouteGraph; demand: Demand } {
  const graph = buildRouteGraph(inputs.route);
  return { graph, demand: buildDemand(graph, inputs.route.doors) };
}
