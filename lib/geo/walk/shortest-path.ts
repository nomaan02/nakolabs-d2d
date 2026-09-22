/**
 * Stage 5b (R1) — Dijkstra over the buffer graph, for transfers and the
 * return to the start. Undirected (both half-edges), weight `length_m`.
 *
 * Deterministic: the heap orders on (distance, node index) so equal distances
 * pop in ascending node id; relaxation follows each node's `out` list, which
 * is already in (osm_way_id, segment id, direction) order; a predecessor is
 * replaced only on a strictly shorter distance.
 */

import type { RouteGraph } from "@/lib/geo/route-graph";

export type PathResult = {
  target: number;
  /** Half-edge indexes walked, in order. Empty when target === source. */
  path: number[];
  lengthM: number;
};

class MinHeap {
  private dist: number[] = [];
  private node: number[] = [];

  get size(): number {
    return this.node.length;
  }

  private less(i: number, j: number): boolean {
    return this.dist[i] < this.dist[j] || (this.dist[i] === this.dist[j] && this.node[i] < this.node[j]);
  }

  private swap(i: number, j: number): void {
    const d = this.dist[i];
    this.dist[i] = this.dist[j];
    this.dist[j] = d;
    const n = this.node[i];
    this.node[i] = this.node[j];
    this.node[j] = n;
  }

  push(dist: number, node: number): void {
    this.dist.push(dist);
    this.node.push(node);
    let i = this.node.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { dist: number; node: number } {
    const top = { dist: this.dist[0], node: this.node[0] };
    const lastD = this.dist.pop() as number;
    const lastN = this.node.pop() as number;
    if (this.node.length > 0) {
      this.dist[0] = lastD;
      this.node[0] = lastN;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.node.length && this.less(l, m)) m = l;
        if (r < this.node.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest path from `source` to the nearest node satisfying `isTarget`.
 * Returns null when no such node is reachable.
 */
export function shortestPath(
  graph: RouteGraph,
  source: number,
  isTarget: (node: number) => boolean,
): PathResult | null {
  const n = graph.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  dist[source] = 0;
  heap.push(0, source);

  while (heap.size > 0) {
    const { dist: d, node: u } = heap.pop();
    if (done[u] || d > dist[u]) continue;
    done[u] = 1;
    if (isTarget(u)) {
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
        heap.push(nd, h.to);
      }
    }
  }
  return null;
}
