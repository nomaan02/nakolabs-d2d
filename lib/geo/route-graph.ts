/**
 * Stage 5b — the clipped road graph as half-edges.
 *
 * Input is the jsonb document from `route_clipped_subgraph` (migration 018).
 * Output is a graph the traversal can walk: every road segment becomes two
 * half-edges (from→to and to→from), every node knows its departing
 * half-edges in an explicit total order, and every bearing is precomputed.
 *
 * Nothing here consults the clock or a random source. Every list is sorted on
 * an explicit key before use; nothing relies on Map/Set iteration order or on
 * the order rows arrived in. See docs/ROUTE-DESIGN.md.
 */

import type { SweepDirection } from "@/lib/geo/rotation";

export type LonLat = [number, number];
export type XY = { x: number; y: number };

export type RouteDoor = { uprn: number; lon: number; lat: number };

export type RouteNodeInput = { id: number; lon: number; lat: number };

export type RouteSegmentInput = {
  id: number;
  osmWayId: number;
  fromNode: number;
  toNode: number;
  name: string | null;
  highway: string;
  lengthM: number;
  coords: LonLat[];
};

export type RouteInputs = {
  assignmentId: string;
  territoryId: string;
  visitNumber: number;
  entryVertexIndex: number;
  sweepDirection: SweepDirection;
  knockCount: number;
  hasRoute: boolean;
  snapshotCount: number;
  centroid: LonLat;
  ring: LonLat[];
  nodes: RouteNodeInput[];
  segments: RouteSegmentInput[];
  doors: RouteDoor[];
};

export const TWO_PI = 2 * Math.PI;
/** Two bearings closer than this are a tie and fall through to the id order. */
export const BEARING_TIE_RAD = 1e-6;
const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Parsing the RPC document
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, what: string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`route inputs: ${what} is not a finite number`);
  }
  return n;
}

function lonLat(value: unknown, what: string): LonLat {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`route inputs: ${what} is not a coordinate pair`);
  }
  return [num(value[0], `${what}[0]`), num(value[1], `${what}[1]`)];
}

function isSweep(value: unknown): value is SweepDirection {
  return value === "cw" || value === "ccw";
}

/**
 * Validates and normalises the `route_clipped_subgraph` document. Re-sorts
 * every array on its id even though SQL already did — the order is the
 * product and must not depend on transport.
 */
export function parseRouteInputs(raw: unknown): RouteInputs {
  if (!isRecord(raw)) throw new Error("route inputs: document is not an object");

  if (!isSweep(raw.sweep_direction)) {
    throw new Error("route inputs: sweep_direction is not cw or ccw");
  }

  const ringRaw = raw.ring;
  if (!Array.isArray(ringRaw) || ringRaw.length < 3) {
    throw new Error("route inputs: polygon ring has fewer than three corners");
  }

  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .map((n, i) => {
      if (!isRecord(n)) throw new Error(`route inputs: node ${i} malformed`);
      return { id: num(n.id, "node.id"), lon: num(n.lon, "node.lon"), lat: num(n.lat, "node.lat") };
    })
    .sort((a, b) => a.id - b.id);

  const segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .map((s, i) => {
      if (!isRecord(s)) throw new Error(`route inputs: segment ${i} malformed`);
      const coordsRaw = s.coords;
      if (!Array.isArray(coordsRaw) || coordsRaw.length < 2) {
        throw new Error(`route inputs: segment ${String(s.id)} has fewer than two vertices`);
      }
      return {
        id: num(s.id, "segment.id"),
        osmWayId: num(s.osm_way_id, "segment.osm_way_id"),
        fromNode: num(s.from_node, "segment.from_node"),
        toNode: num(s.to_node, "segment.to_node"),
        name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : null,
        highway: typeof s.highway === "string" ? s.highway : "",
        lengthM: num(s.length_m, "segment.length_m"),
        coords: coordsRaw.map((c, j) => lonLat(c, `segment ${String(s.id)} vertex ${j}`)),
      };
    })
    .sort((a, b) => a.id - b.id);

  const doors = (Array.isArray(raw.doors) ? raw.doors : [])
    .map((d, i) => {
      if (!isRecord(d)) throw new Error(`route inputs: door ${i} malformed`);
      return { uprn: num(d.uprn, "door.uprn"), lon: num(d.lon, "door.lon"), lat: num(d.lat, "door.lat") };
    })
    .sort((a, b) => a.uprn - b.uprn);

  return {
    assignmentId: String(raw.assignment_id ?? ""),
    territoryId: String(raw.territory_id ?? ""),
    visitNumber: num(raw.visit_number, "visit_number"),
    entryVertexIndex: num(raw.entry_vertex_index, "entry_vertex_index"),
    sweepDirection: raw.sweep_direction,
    knockCount: num(raw.knock_count ?? 0, "knock_count"),
    hasRoute: raw.has_route === true,
    snapshotCount: num(raw.snapshot_count ?? doors.length, "snapshot_count"),
    centroid: lonLat(raw.centroid, "centroid"),
    ring: ringRaw.map((c, i) => lonLat(c, `ring[${i}]`)),
    nodes,
    segments,
    doors,
  };
}

// ---------------------------------------------------------------------------
// Plane, bearings, distances
// ---------------------------------------------------------------------------

/**
 * Equirectangular projection centred on the prop, in metres. At prop scale
 * (under a couple of kilometres) the distortion is below 0.1%, which is far
 * inside what a 40 m threshold or a turn angle can notice.
 */
export function makeProjection(origin: LonLat): (p: LonLat) => XY {
  const kx = Math.cos(origin[1] * DEG) * EARTH_RADIUS_M * DEG;
  const ky = EARTH_RADIUS_M * DEG;
  return (p) => ({ x: (p[0] - origin[0]) * kx, y: (p[1] - origin[1]) * ky });
}

/** Compass bearing in the plane: 0 = north, clockwise, in [0, 2π). ST_Azimuth's convention. */
export function bearing(from: XY, to: XY): number {
  const b = Math.atan2(to.x - from.x, to.y - from.y);
  return b < 0 ? b + TWO_PI : b;
}

/** Wraps a bearing difference into (−π, π]. Negative is a left turn, positive right, +π a U-turn. */
export function wrapTurn(delta: number): number {
  let t = ((delta % TWO_PI) + TWO_PI) % TWO_PI;
  if (t > Math.PI) t -= TWO_PI;
  return t;
}

export function planarDistance(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Great-circle metres. Used only for transfer legs, which have no length_m of their own. */
export function haversineM(a: LonLat, b: LonLat): number {
  const φ1 = a[1] * DEG;
  const φ2 = b[1] * DEG;
  const dφ = (b[1] - a[1]) * DEG;
  const dλ = (b[0] - a[0]) * DEG;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export type GraphNode = {
  index: number;
  id: number;
  lonLat: LonLat;
  xy: XY;
  /** Departing half-edge indexes, sorted by (osm_way_id, segment id, dir). */
  out: number[];
  /** Number of segment ends meeting here. A self-loop counts twice. */
  degree: number;
  /** Connected component label = lowest node id in the component. */
  component: number;
};

export type GraphSegment = {
  index: number;
  id: number;
  osmWayId: number;
  fromNode: number;
  toNode: number;
  name: string | null;
  highway: string;
  lengthM: number;
  lonLat: LonLat[];
  xy: XY[];
  /** Planar cumulative distance at each vertex, metres, from vertex 0. */
  cumXY: number[];
  planarLengthM: number;
  /** Half-edge index walking from_node → to_node. */
  forwardHalfEdge: number;
  /** Half-edge index walking to_node → from_node. */
  backwardHalfEdge: number;
  /** True when either direction of this segment runs along a chain that ends at a clipped dead end. */
  isSpur: boolean;
};

export type HalfEdge = {
  index: number;
  segment: number;
  dir: 1 | -1;
  from: number;
  to: number;
  reverse: number;
  departureBearing: number;
  arrivalBearing: number;
  /** Following this half-edge, then straight on through degree-2 nodes, reaches a degree-1 node. */
  headsToDeadEnd: boolean;
};

export type RouteGraph = {
  nodes: GraphNode[];
  segments: GraphSegment[];
  halfEdges: HalfEdge[];
  nodeIndexById: Map<number, number>;
  project: (p: LonLat) => XY;
  centroidXY: XY;
  /** Σ length_m over clipped segments. A complete two-pass route is at least twice this. */
  totalLengthM: number;
  componentCount: number;
};

function firstDistinctBearing(xy: XY[]): number {
  const a = xy[0];
  for (let i = 1; i < xy.length; i += 1) {
    if (xy[i].x !== a.x || xy[i].y !== a.y) return bearing(a, xy[i]);
  }
  return 0;
}

function lastDistinctBearing(xy: XY[]): number {
  const b = xy[xy.length - 1];
  for (let i = xy.length - 2; i >= 0; i -= 1) {
    if (xy[i].x !== b.x || xy[i].y !== b.y) return bearing(xy[i], b);
  }
  return 0;
}

/** Coordinates of a half-edge in its direction of travel. */
export function halfEdgeLonLat(graph: RouteGraph, h: HalfEdge): LonLat[] {
  const seg = graph.segments[h.segment];
  return h.dir === 1 ? seg.lonLat : [...seg.lonLat].reverse();
}

export function buildRouteGraph(inputs: RouteInputs): RouteGraph {
  const project = makeProjection(inputs.centroid);
  const centroidXY = project(inputs.centroid);

  const nodeIndexById = new Map<number, number>();
  const nodes: GraphNode[] = inputs.nodes.map((n, index) => {
    nodeIndexById.set(n.id, index);
    return {
      index,
      id: n.id,
      lonLat: [n.lon, n.lat],
      xy: project([n.lon, n.lat]),
      out: [],
      degree: 0,
      component: n.id,
    };
  });

  const segments: GraphSegment[] = [];
  const halfEdges: HalfEdge[] = [];
  let totalLengthM = 0;

  for (const s of inputs.segments) {
    const fromNode = nodeIndexById.get(s.fromNode);
    const toNode = nodeIndexById.get(s.toNode);
    if (fromNode === undefined || toNode === undefined) {
      throw new Error(`route graph: segment ${s.id} references a node outside the clipped set`);
    }
    const xy = s.coords.map(project);
    const cumXY: number[] = [0];
    for (let i = 1; i < xy.length; i += 1) {
      cumXY.push(cumXY[i - 1] + planarDistance(xy[i - 1], xy[i]));
    }
    const index = segments.length;
    const forward = halfEdges.length;
    const backward = forward + 1;
    segments.push({
      index,
      id: s.id,
      osmWayId: s.osmWayId,
      fromNode,
      toNode,
      name: s.name,
      highway: s.highway,
      lengthM: s.lengthM,
      lonLat: s.coords,
      xy,
      cumXY,
      planarLengthM: cumXY[cumXY.length - 1],
      forwardHalfEdge: forward,
      backwardHalfEdge: backward,
      isSpur: false,
    });
    totalLengthM += s.lengthM;

    const reversedXY = [...xy].reverse();
    halfEdges.push({
      index: forward,
      segment: index,
      dir: 1,
      from: fromNode,
      to: toNode,
      reverse: backward,
      departureBearing: firstDistinctBearing(xy),
      arrivalBearing: lastDistinctBearing(xy),
      headsToDeadEnd: false,
    });
    halfEdges.push({
      index: backward,
      segment: index,
      dir: -1,
      from: toNode,
      to: fromNode,
      reverse: forward,
      departureBearing: firstDistinctBearing(reversedXY),
      arrivalBearing: lastDistinctBearing(reversedXY),
      headsToDeadEnd: false,
    });
    nodes[fromNode].out.push(forward);
    nodes[toNode].out.push(backward);
    nodes[fromNode].degree += 1;
    nodes[toNode].degree += 1;
  }

  // Explicit total order on departures: osm_way_id, segment id, then the
  // forward direction first. This is the bearing tie-break from the brief.
  for (const node of nodes) {
    node.out.sort((a, b) => {
      const ha = halfEdges[a];
      const hb = halfEdges[b];
      const sa = segments[ha.segment];
      const sb = segments[hb.segment];
      return sa.osmWayId - sb.osmWayId || sa.id - sb.id || hb.dir - ha.dir;
    });
  }

  // Dead-end chains. A half-edge heads to a dead end when, after arriving,
  // the only way on is straight through degree-2 nodes until a degree-1 node.
  for (const h of halfEdges) {
    let prevSegment = h.segment;
    let cur = h.to;
    let hops = 0;
    let deadEnd = false;
    for (;;) {
      const node = nodes[cur];
      if (node.degree === 1) {
        deadEnd = true;
        break;
      }
      if (node.degree !== 2) break;
      const onward = node.out.find((o) => halfEdges[o].segment !== prevSegment);
      if (onward === undefined) break;
      prevSegment = halfEdges[onward].segment;
      cur = halfEdges[onward].to;
      hops += 1;
      if (hops > nodes.length) break;
    }
    h.headsToDeadEnd = deadEnd;
  }
  for (const h of halfEdges) {
    if (h.headsToDeadEnd) segments[h.segment].isSpur = true;
  }

  // Components, labelled by lowest node id. Nodes are in ascending id order,
  // so a plain scan with a stack gives every node its minimum-id label.
  const seen = new Uint8Array(nodes.length);
  let componentCount = 0;
  for (const root of nodes) {
    if (seen[root.index]) continue;
    componentCount += 1;
    const stack = [root.index];
    seen[root.index] = 1;
    while (stack.length > 0) {
      const u = stack.pop() as number;
      nodes[u].component = root.id;
      for (const o of nodes[u].out) {
        const v = halfEdges[o].to;
        if (!seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
  }

  return {
    nodes,
    segments,
    halfEdges,
    nodeIndexById,
    project,
    centroidXY,
    totalLengthM,
    componentCount,
  };
}

/** Display name for instructions. Unnamed service roads are a third of Northville's clipped graph. */
export function displayStreet(segment: Pick<GraphSegment, "name" | "highway">): string {
  if (segment.name) return segment.name;
  return segment.highway === "service" ? "service road" : "unnamed road";
}

/**
 * The clipped node nearest a point, by planar distance. Ties → ascending node
 * id (nodes are already in id order, so the first minimum wins).
 */
export function nearestNode(graph: RouteGraph, point: XY): GraphNode {
  let best = graph.nodes[0];
  let bestD = Infinity;
  for (const node of graph.nodes) {
    const d = planarDistance(node.xy, point);
    if (d < bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}
