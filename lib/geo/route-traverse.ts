/**
 * Stage 5b — greedy serpentine traversal over half-edges.
 *
 * Deterministic, not optimal (invariant 6). From the current node take the
 * unvisited half-edge chosen by the turn rule (cw = leftmost, ccw =
 * rightmost, relative to the arrival bearing). The U-turn — the reverse of
 * the half-edge just walked — is only taken when nothing else at the node is
 * unvisited. When nothing at all is unvisited, backtrack by Dijkstra over the
 * clipped graph to the nearest node that has something; when the component
 * is exhausted, transfer in a straight line to the nearest node of the next.
 *
 * Every tie breaks on an explicit total order:
 *   bearing ties    → ascending osm_way_id, then segment id, then +dir first
 *   backtrack ties  → shortest distance, then ascending node id
 *   component order → nearest node, then lowest node id in the component,
 *                     then node id
 *
 * No Math.random, no Date.now, no Set/Map iteration. See docs/ROUTE-DESIGN.md.
 */

import type { SweepDirection } from "@/lib/geo/rotation";
import {
  BEARING_TIE_RAD,
  bearing,
  haversineM,
  planarDistance,
  wrapTurn,
  type RouteGraph,
} from "@/lib/geo/route-graph";

export type WorkLeg = {
  kind: "work";
  halfEdge: number;
  /** Signed turn from the arrival bearing, radians. Null for the very first leg. */
  turn: number | null;
  /** The reverse of the half-edge just walked, taken because nothing else was left. */
  uturn: boolean;
  /** First working leg after a backtrack or a transfer. */
  afterTransfer: boolean;
  /** The very first working leg of the route. */
  first: boolean;
};

export type BacktrackLeg = {
  kind: "backtrack";
  /** Half-edge indexes walked, in order. All already visited. */
  path: number[];
  lengthM: number;
};

export type TransferLeg = {
  kind: "transfer";
  fromNode: number;
  toNode: number;
  lengthM: number;
};

export type Leg = WorkLeg | BacktrackLeg | TransferLeg;

export type TraversalResult = {
  legs: Leg[];
  terminatedBy: "all_visited" | "bound";
  /** Metres walked including backtracks and transfers. */
  walkedM: number;
  /** 2 × Σ length_m: the floor for a complete two-pass route. */
  requiredM: number;
  /** The safety bound: twice the required length. */
  boundM: number;
  entryNode: number;
  backtracks: number;
  transfers: number;
  /** Cumulative metres at the START of each half-edge's working pass; -1 if never worked. */
  workStartM: Float64Array;
};

function chooseByTurn(
  graph: RouteGraph,
  candidates: number[],
  arrivalBearing: number,
  sweep: SweepDirection,
): { halfEdge: number; turn: number } {
  let best = -1;
  let bestTurn = 0;
  for (const c of candidates) {
    const turn = wrapTurn(graph.halfEdges[c].departureBearing - arrivalBearing);
    if (best === -1) {
      best = c;
      bestTurn = turn;
      continue;
    }
    const better =
      sweep === "cw" ? turn < bestTurn - BEARING_TIE_RAD : turn > bestTurn + BEARING_TIE_RAD;
    if (better) {
      best = c;
      bestTurn = turn;
    }
    // Within the tie band the earlier candidate stands: `candidates` is the
    // node's out list, already in (osm_way_id, segment id, dir) order.
  }
  return { halfEdge: best, turn: bestTurn };
}

/**
 * Shortest path from `source` to the nearest node with an unvisited departing
 * half-edge, over the clipped graph in both directions. O(V²) selection with
 * ties on ascending node index (= ascending id), so it is plainly
 * deterministic. Returns null when nothing unvisited is reachable.
 */
function backtrackPath(
  graph: RouteGraph,
  source: number,
  hasUnvisitedOut: (node: number) => boolean,
): { target: number; path: number[]; lengthM: number } | null {
  const n = graph.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[source] = 0;

  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1) return null;
    done[u] = 1;

    if (u !== source && hasUnvisitedOut(u)) {
      const path: number[] = [];
      let cur = u;
      while (cur !== source) {
        const h = prev[cur];
        path.push(h);
        cur = graph.halfEdges[h].from;
      }
      path.reverse();
      return { target: u, path, lengthM: dist[u] };
    }

    for (const o of graph.nodes[u].out) {
      const h = graph.halfEdges[o];
      const nd = dist[u] + graph.segments[h.segment].lengthM;
      if (nd < dist[h.to]) {
        dist[h.to] = nd;
        prev[h.to] = o;
      }
    }
  }
}

export function traverse(
  graph: RouteGraph,
  sweep: SweepDirection,
  entryNode: number,
): TraversalResult {
  const { halfEdges, nodes, segments } = graph;
  const visited = new Uint8Array(halfEdges.length);
  const workStartM = new Float64Array(halfEdges.length).fill(-1);
  let remaining = halfEdges.length;

  const hasUnvisitedOut = (node: number): boolean =>
    nodes[node].out.some((o) => !visited[o]);

  const legs: Leg[] = [];
  const requiredM = 2 * graph.totalLengthM;
  const boundM = 2 * requiredM;
  let walkedM = 0;
  let current = entryNode;
  // Start as if arrived facing the prop centroid. Stable and deterministic.
  let arrivalBearing = bearing(nodes[entryNode].xy, graph.centroidXY);
  let lastArrival = -1;
  let afterTransfer = false;
  let first = true;
  let backtracks = 0;
  let transfers = 0;
  let terminatedBy: TraversalResult["terminatedBy"] = "all_visited";

  const walk = (h: number, turn: number | null, uturn: boolean) => {
    const he = halfEdges[h];
    legs.push({ kind: "work", halfEdge: h, turn, uturn, afterTransfer, first });
    workStartM[h] = walkedM;
    visited[h] = 1;
    remaining -= 1;
    walkedM += segments[he.segment].lengthM;
    current = he.to;
    arrivalBearing = he.arrivalBearing;
    lastArrival = h;
    afterTransfer = false;
    first = false;
  };

  // Every iteration either visits a new half-edge, or moves to a node that
  // has one (and the next iteration visits it). Bounded by 2 × half-edges.
  while (remaining > 0) {
    if (walkedM >= boundM) {
      terminatedBy = "bound";
      break;
    }

    const reverseOfArrival = lastArrival === -1 ? -1 : halfEdges[lastArrival].reverse;
    const candidates = nodes[current].out.filter((o) => !visited[o] && o !== reverseOfArrival);

    if (candidates.length > 0) {
      const pick = chooseByTurn(graph, candidates, arrivalBearing, sweep);
      walk(pick.halfEdge, first ? null : pick.turn, false);
      continue;
    }

    if (reverseOfArrival !== -1 && !visited[reverseOfArrival]) {
      walk(reverseOfArrival, Math.PI, true);
      continue;
    }

    const back = backtrackPath(graph, current, hasUnvisitedOut);
    if (back) {
      backtracks += 1;
      legs.push({ kind: "backtrack", path: back.path, lengthM: back.lengthM });
      walkedM += back.lengthM;
      current = back.target;
      const lastLeg = halfEdges[back.path[back.path.length - 1]];
      arrivalBearing = lastLeg.arrivalBearing;
      lastArrival = lastLeg.index;
      afterTransfer = true;
      continue;
    }

    // Component exhausted. Nearest node anywhere with something unvisited;
    // ties → lowest node id in its component, then node id.
    let target = -1;
    let bestD = Infinity;
    let bestComponent = Infinity;
    for (const node of nodes) {
      if (!hasUnvisitedOut(node.index)) continue;
      const d = planarDistance(nodes[current].xy, node.xy);
      if (
        d < bestD ||
        (d === bestD && node.component < bestComponent) ||
        (d === bestD && node.component === bestComponent && node.id < nodes[target].id)
      ) {
        bestD = d;
        bestComponent = node.component;
        target = node.index;
      }
    }
    if (target === -1) break; // cannot happen while remaining > 0; defensive

    transfers += 1;
    const lengthM = haversineM(nodes[current].lonLat, nodes[target].lonLat);
    legs.push({ kind: "transfer", fromNode: current, toNode: target, lengthM });
    walkedM += lengthM;
    arrivalBearing = bearing(nodes[current].xy, nodes[target].xy);
    current = target;
    lastArrival = -1;
    afterTransfer = true;
  }

  return {
    legs,
    terminatedBy,
    walkedM,
    requiredM,
    boundM,
    entryNode,
    backtracks,
    transfers,
    workStartM,
  };
}
