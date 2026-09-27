/**
 * Stage 5b (R1) — planar geometry for walklines.
 *
 * The walkline is the centreline offset onto the pavement being walked.
 * MapLibre's `line-offset` moves a drawn line but not the symbols placed
 * along it, so direction chevrons would sit on the road centre; the geometry
 * itself is offset instead. "~4 m" is a display offset, not a measurement.
 */

import type { GraphSegment, LonLat, XY } from "@/lib/geo/route-graph";
import type { Hand } from "@/lib/geo/walk/types";

/** Metres from the road centreline to the walkline. */
export const PAVEMENT_OFFSET_M = 4;
/** The crossing distance charged for every cross step: pavement to pavement. */
export const CROSS_M = 2 * PAVEMENT_OFFSET_M;
/**
 * A walk back along the pavement just knocked is drawn this much nearer the
 * road than the work line, so the two sit side by side instead of on top of
 * each other. Display only.
 */
export const WALK_BACK_INSET_M = 2;

type SegmentLine = Pick<GraphSegment, "xy" | "lonLat" | "cumXY" | "planarLengthM">;

/** A distance along this close to a vertex is that vertex (a door snapped to a corner). */
const VERTEX_EPS_M = 1e-6;

/** Index of the first non-degenerate edge whose far vertex is at or beyond `m`. */
function edgeAt(seg: SegmentLine, m: number): number {
  const n = seg.xy.length;
  for (let i = 1; i < n; i += 1) {
    if (seg.cumXY[i] > seg.cumXY[i - 1] && seg.cumXY[i] >= m) return i;
  }
  for (let i = n - 1; i >= 1; i -= 1) {
    if (seg.cumXY[i] > seg.cumXY[i - 1]) return i;
  }
  return 1;
}

function cutPoint(seg: SegmentLine, m: number): { xy: XY; lonLat: LonLat } {
  const i = edgeAt(seg, m);
  const span = seg.cumXY[i] - seg.cumXY[i - 1];
  const u = span > 0 ? Math.max(0, Math.min(1, (m - seg.cumXY[i - 1]) / span)) : 0;
  const a = seg.xy[i - 1];
  const b = seg.xy[i];
  const la = seg.lonLat[i - 1];
  const lb = seg.lonLat[i];
  return {
    xy: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u },
    lonLat: [la[0] + (lb[0] - la[0]) * u, la[1] + (lb[1] - la[1]) * u],
  };
}

/** The centreline point `m` planar metres from the segment's from_node. */
export function pointAlong(seg: SegmentLine, m: number): XY {
  return cutPoint(seg, m).xy;
}

/**
 * Unit direction of the segment's edge at `m`, from_node → to_node. At a
 * vertex, `approach` picks the edge arrived along: 1 the edge before `m`,
 * -1 the edge after it.
 */
export function directionAlong(seg: SegmentLine, m: number, approach: 1 | -1 = 1): XY {
  let i = edgeAt(seg, approach === 1 ? m - VERTEX_EPS_M : m);
  if (approach === -1) {
    while (i < seg.xy.length - 1 && seg.cumXY[i] <= m + VERTEX_EPS_M) i += 1;
  }
  const dx = seg.xy[i].x - seg.xy[i - 1].x;
  const dy = seg.xy[i].y - seg.xy[i - 1].y;
  const len = Math.hypot(dx, dy);
  return len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
}

/**
 * The part of a segment between `fromM` and `toM` planar metres from its
 * from_node, in the segment's own direction. The segment's vertices are kept
 * exactly; only a cut end is interpolated. The full span returns the
 * segment's own arrays.
 */
export function sliceAlong(seg: SegmentLine, fromM: number, toM: number): { xy: XY[]; lonLat: LonLat[] } {
  const n = seg.xy.length;
  const L = seg.planarLengthM;
  if (fromM <= 0 && toM >= L) return { xy: [...seg.xy], lonLat: [...seg.lonLat] };
  const xy: XY[] = [];
  const lonLat: LonLat[] = [];
  const push = (p: { xy: XY; lonLat: LonLat }) => {
    xy.push(p.xy);
    lonLat.push(p.lonLat);
  };
  const EPS = VERTEX_EPS_M;
  const vertex = (k: number) => ({ xy: seg.xy[k], lonLat: seg.lonLat[k] });
  const at = (m: number, fallback: number) => {
    for (let k = 0; k < n; k += 1) if (Math.abs(seg.cumXY[k] - m) <= EPS) return vertex(k);
    return m <= 0 || m >= L ? vertex(fallback) : cutPoint(seg, m);
  };
  push(fromM <= 0 ? vertex(0) : at(fromM, 0));
  for (let k = 0; k < n; k += 1) {
    if (seg.cumXY[k] > fromM + EPS && seg.cumXY[k] < toM - EPS) push(vertex(k));
  }
  push(toM >= L ? vertex(n - 1) : at(toM, n - 1));
  return { xy, lonLat };
}

export const ARC_POINTS = 9;
const ARC_COS = Array.from({ length: ARC_POINTS }, (_, k) => Math.cos((k * Math.PI) / (ARC_POINTS - 1)));
const ARC_SIN = Array.from({ length: ARC_POINTS }, (_, k) => Math.sin((k * Math.PI) / (ARC_POINTS - 1)));

/**
 * A U-turn from `p0` to `p1`: half an ellipse on the chord, bulging along
 * `u` (the direction of travel into the turn). The bulge is at most half the
 * chord and keeps the apex one pavement offset plus 1 m short of the far
 * node, `reachM` metres ahead of the chord. At 0 it is the straight chord.
 * The end points are `p0` and `p1` themselves, so the joins are exact.
 */
export function uTurnArc(p0: XY, p1: XY, u: XY, reachM: number): XY[] {
  const cx = (p0.x + p1.x) / 2;
  const cy = (p0.y + p1.y) / 2;
  const ex = p0.x - cx;
  const ey = p0.y - cy;
  const r = Math.hypot(ex, ey);
  const a = Math.min(r, Math.max(0, reachM - PAVEMENT_OFFSET_M - 1));
  const out: XY[] = [p0];
  for (let k = 1; k < ARC_POINTS - 1; k += 1) {
    out.push({ x: cx + ex * ARC_COS[k] + u.x * a * ARC_SIN[k], y: cy + ey * ARC_COS[k] + u.y * a * ARC_SIN[k] });
  }
  out.push(p1);
  return out;
}

/**
 * Inverse of `makeProjection(origin)`. The projection is linear
 * (equirectangular), so its scale factors are recovered exactly by projecting
 * two reference points; nothing is copied from route-graph.ts.
 */
export function makeUnproject(project: (p: LonLat) => XY, origin: LonLat): (p: XY) => LonLat {
  const o = project(origin);
  const ex = project([origin[0] + 0.001, origin[1]]);
  const ny = project([origin[0], origin[1] + 0.001]);
  const kx = (ex.x - o.x) / 0.001;
  const ky = (ny.y - o.y) / 0.001;
  return (p) => [origin[0] + (p.x - o.x) / kx, origin[1] + (p.y - o.y) / ky];
}

/** Drops consecutive repeated points. */
export function dedupeXY(pts: XY[]): XY[] {
  const out: XY[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  return out;
}

export function polylineLengthXY(pts: XY[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return total;
}

/** Unit normal to the direction (dx, dy) on the given side of travel. */
function normal(dx: number, dy: number, side: Hand): XY {
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  return side === "right" ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
}

/**
 * Robust walkline offset (2026-09-27). Replaces the old mitre-with-refusal
 * scheme: `offsetRun` / `offsetPolyline` are now thin wrappers over
 * `offsetCore`, which removes an offset edge that would run backwards
 * (an inside corner too tight for the offset) and re-joins its neighbours,
 * repeating until nothing is left to remove, before ever falling back to a
 * bridge. See docs/CLAUDE-HANDOFF.md "plan approved" entry for the design.
 */

/** A numerical guard for a near-zero cross product, not a tuning knob. */
const EPS_SIN = 1e-9;

type CoreEdge = {
  /** Index into the (deduped) source point array: this edge runs p[i] → p[i+1]. */
  i: number;
  /** Unit direction p[i] → p[i+1]. */
  u: XY;
  /** Unit normal on `side`. */
  nUnit: XY;
  len: number;
  /** The offset line's own start point: p[i] + nUnit·d. */
  a: XY;
};

type CoreKept = {
  edge: CoreEdge;
  /** Kept span of the offset line, as a parameter along `edge.u` from `edge.a`, in metres. */
  s: number;
  e: number;
  /** The point(s) this entry's start was joined to the previous kept entry by. Empty for the first. */
  jointIn: XY[];
};

type CoreJoin = {
  kind: "collinear" | "antiParallel" | "inside" | "outside" | "bridge";
  pts: XY[];
  tE: number;
  sS: number;
};

/** Signed parameter of `p` along the infinite line through `edge.a` in direction `edge.u`, in metres. */
function paramAlongEdge(edge: CoreEdge, p: XY): number {
  return (p.x - edge.a.x) * edge.u.x + (p.y - edge.a.y) * edge.u.y;
}

function pointAtParam(edge: CoreEdge, t: number): XY {
  return { x: edge.a.x + edge.u.x * t, y: edge.a.y + edge.u.y * t };
}

function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The join of two consecutive offset lines, as an unbounded line
 * intersection. `kind` records the turn as seen from the offset side:
 * `inside` (the path bends towards it, offsetting pulls the lines together
 * sooner), `outside` (bends away, mitred or clamped), `collinear` (one
 * point, the midpoint) or `antiParallel` (no intersection exists).
 */
function coreJoin(top: CoreKept, seg: CoreKept, pts: XY[], d: number, side: Hand): CoreJoin {
  const tu = top.edge.u;
  const su = seg.edge.u;
  const cross = tu.x * su.y - tu.y * su.x;
  const dot = tu.x * su.x + tu.y * su.y;
  if (Math.abs(cross) <= EPS_SIN) {
    if (dot > 0) {
      const topEnd = pointAtParam(top.edge, top.edge.len);
      const m = { x: (topEnd.x + seg.edge.a.x) / 2, y: (topEnd.y + seg.edge.a.y) / 2 };
      return { kind: "collinear", pts: [m], tE: paramAlongEdge(top.edge, m), sS: paramAlongEdge(seg.edge, m) };
    }
    return { kind: "antiParallel", pts: [], tE: NaN, sS: NaN };
  }
  const signedTurn = side === "left" ? cross : -cross;
  const rhs = { x: seg.edge.a.x - top.edge.a.x, y: seg.edge.a.y - top.edge.a.y };
  const t = (rhs.x * su.y - rhs.y * su.x) / cross;
  const s = (rhs.x * tu.y - rhs.y * tu.x) / cross;
  const m = pointAtParam(top.edge, t);
  if (signedTurn > EPS_SIN) {
    return { kind: "inside", pts: [m], tE: t, sS: s };
  }
  // Outside: mitre if within the limit, otherwise clamp on the bisector of
  // the two unit normals, 2d from the shared centreline vertex p[seg.edge.i].
  const v = pts[seg.edge.i];
  if (dist(m, v) <= 2 * d + VERTEX_EPS_M) {
    return { kind: "outside", pts: [m], tE: t, sS: s };
  }
  const sum = { x: top.edge.nUnit.x + seg.edge.nUnit.x, y: top.edge.nUnit.y + seg.edge.nUnit.y };
  const sumLen = Math.hypot(sum.x, sum.y);
  const bisector = sumLen > EPS_SIN ? { x: sum.x / sumLen, y: sum.y / sumLen } : top.edge.nUnit;
  const clamped = { x: v.x + bisector.x * 2 * d, y: v.y + bisector.y * 2 * d };
  return { kind: "outside", pts: [clamped], tE: paramAlongEdge(top.edge, clamped), sS: paramAlongEdge(seg.edge, clamped) };
}

/**
 * Fallback when no valid inside joint exists (anti-parallel, or a narrow
 * U/V whose inside joint lies too far from the vertex it replaces): top
 * keeps its own untrimmed end, seg keeps its own untrimmed start, and the
 * two are left unjoined — a straight bridge between them.
 */
function coreBridge(top: CoreKept, seg: CoreKept): CoreJoin {
  return { kind: "bridge", pts: [pointAtParam(top.edge, top.edge.len), seg.edge.a], tE: top.edge.len, sS: 0 };
}

/** Nearest, in metres, of `m` to any source vertex the removal cascade between `top` and `seg` swallowed. */
function nearestReplacedVertexM(m: XY, top: CoreKept, seg: CoreKept, pts: XY[]): number {
  let best = Infinity;
  for (let k = top.edge.i + 1; k <= seg.edge.i; k += 1) best = Math.min(best, dist(m, pts[k]));
  return best;
}

/**
 * `P`, capped to at most `2d` from `v`: the point on `edge`'s line nearest
 * `P` at exactly that distance, or `P` itself if already within the limit.
 * General circle/line intersection: `v` is not assumed to lie on `edge`.
 */
function capAtMitreLimit(p: XY, v: XY, edge: CoreEdge, d: number): XY {
  if (dist(p, v) <= 2 * d + VERTEX_EPS_M) return p;
  const w = { x: edge.a.x - v.x, y: edge.a.y - v.y };
  const wu = w.x * edge.u.x + w.y * edge.u.y;
  const disc = wu * wu - (w.x * w.x + w.y * w.y - 4 * d * d);
  const tP = paramAlongEdge(edge, p);
  if (disc < 0) return pointAtParam(edge, -wu);
  const root = Math.sqrt(disc);
  const t1 = -wu + root;
  const t2 = -wu - root;
  const t = Math.abs(t1 - tP) <= Math.abs(t2 - tP) ? t1 : t2;
  return pointAtParam(edge, t);
}

/**
 * Collapse-aware offset of one polyline (already deduped) by `d` onto
 * `side`. Removal runs before any bridge: an offset segment that would end
 * up reversed or ≤ 0 long is removed and its neighbours re-joined, repeated
 * until nothing is left to remove — handling several short edges in a row
 * (a rounded kerb, a chamfer). The bridge is only the fallback when no
 * intersection exists (anti-parallel) or the inside joint would lie more
 * than 2d from the nearest vertex the cascade replaced (a narrow U/V).
 * A cascade reaching the free start or the free end caps at the mitre
 * limit instead of running off unbounded. Returns the offset line and,
 * for every source vertex index, the index into that line it maps to.
 */
export function offsetCore(pts: XY[], d: number, side: Hand): { out: XY[]; at: number[] } {
  const n = pts.length;
  const edges: CoreEdge[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    if (len <= VERTEX_EPS_M) continue;
    const u = { x: dx / len, y: dy / len };
    const nUnit = normal(dx, dy, side);
    edges.push({ i, u, nUnit, len, a: { x: pts[i].x + nUnit.x * d, y: pts[i].y + nUnit.y * d } });
  }
  if (edges.length === 0) {
    const p0 = pts[0] ?? { x: 0, y: 0 };
    return { out: [{ ...p0 }, { ...p0 }], at: new Array(n).fill(0) };
  }

  const stack: CoreKept[] = [];
  let start: XY = edges[0].a;

  for (const E of edges) {
    const seg: CoreKept = { edge: E, s: 0, e: E.len, jointIn: [] };
    for (;;) {
      if (stack.length === 0) {
        stack.push(seg);
        break;
      }
      const top = stack[stack.length - 1];
      top.e = top.edge.len; // untrimmed again before every re-join attempt
      let j = coreJoin(top, seg, pts, d, side);
      if (j.kind === "antiParallel") {
        j = coreBridge(top, seg);
      } else if (j.tE <= top.s + VERTEX_EPS_M) {
        if (stack.length === 1) {
          start = capAtMitreLimit(j.pts[0], pts[seg.edge.i], seg.edge, d);
          stack.pop();
          seg.s = paramAlongEdge(seg.edge, start);
          stack.push(seg);
          break;
        }
        stack.pop();
        continue; // re-join seg with the new top
      } else if (j.kind === "inside" && nearestReplacedVertexM(j.pts[0], top, seg, pts) > 2 * d + VERTEX_EPS_M) {
        j = coreBridge(top, seg);
      }
      top.e = j.tE;
      seg.s = j.sS;
      seg.jointIn = j.pts;
      stack.push(seg);
      break;
    }
  }

  let end: XY | null = null;
  while (stack.length > 1 && stack[stack.length - 1].e <= stack[stack.length - 1].s + VERTEX_EPS_M) {
    const last = stack[stack.length - 1];
    const below = stack[stack.length - 2];
    end = capAtMitreLimit(last.jointIn[0], pts[last.edge.i], below.edge, d);
    stack.pop();
    below.e = paramAlongEdge(below.edge, end);
  }
  if (end === null) {
    const last = stack[stack.length - 1];
    end = pointAtParam(last.edge, last.e);
  }

  const out: XY[] = [start];
  const jointStart: number[] = new Array(stack.length).fill(0);
  for (let k = 1; k < stack.length; k += 1) {
    jointStart[k] = out.length;
    out.push(...stack[k].jointIn);
  }
  const endIndex = out.length;
  out.push(end);

  const at = new Array(n).fill(0);
  const lastEntry = stack[stack.length - 1];
  for (let i = 0; i < n; i += 1) {
    if (i <= stack[0].edge.i) {
      at[i] = 0;
    } else if (i > lastEntry.edge.i) {
      at[i] = endIndex;
    } else {
      let k = 1;
      while (k < stack.length && stack[k].edge.i < i) k += 1;
      at[i] = jointStart[k];
    }
  }
  return { out, at };
}

/**
 * Offsets a polyline by `offsetM` onto `side` of its direction of travel.
 * See `offsetCore`.
 */
export function offsetPolyline(ptsIn: XY[], offsetM: number, side: Hand): XY[] {
  return offsetCore(dedupeXY(ptsIn), offsetM, side).out;
}

function samePoint(a: XY, b: XY): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Offsets a whole run of parts as one merged polyline, so neighbouring
 * parts share the exact same boundary point by construction — continuity
 * comes from the join, not from a later equality patch. When a part's
 * first point equals the previous part's last point the boundary is
 * shared; otherwise both points are kept and the tiny edge between them is
 * an ordinary offset edge. A one-point result is emitted as `[P, P]`
 * because the stored geometry needs at least two points.
 */
export function offsetRun(partsIn: XY[][], offsetM: number, side: Hand): XY[][] {
  const parts = partsIn;
  const n = parts.length;
  if (n === 0) return [];
  const merged: XY[] = [];
  const firstMergedIndex: number[] = new Array(n).fill(0);
  for (let p = 0; p < n; p += 1) {
    const part = parts[p];
    if (part.length === 0) {
      firstMergedIndex[p] = Math.max(0, merged.length - 1);
      continue;
    }
    if (merged.length === 0) {
      firstMergedIndex[p] = 0;
      merged.push(...part);
    } else if (samePoint(merged[merged.length - 1], part[0])) {
      firstMergedIndex[p] = merged.length - 1;
      merged.push(...part.slice(1));
    } else {
      firstMergedIndex[p] = merged.length;
      merged.push(...part);
    }
  }
  const { out, at } = offsetCore(merged, offsetM, side);
  const result: XY[][] = [];
  for (let p = 0; p < n; p += 1) {
    const startOut = at[firstMergedIndex[p]];
    const endOut = p === n - 1 ? out.length - 1 : at[firstMergedIndex[p + 1]];
    const slice = out.slice(startOut, endOut + 1);
    result.push(slice.length >= 2 ? slice : [out[startOut], out[startOut]]);
  }
  return result;
}

/**
 * Which side of a polyline a point lies on, judged at the nearest polyline
 * segment: 'left' or 'right' of the direction of travel, 'on' when collinear.
 */
export function sideOfPolyline(pts: XY[], p: XY): "left" | "right" | "on" {
  let bestD = Infinity;
  let bestCross = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let u = 0;
    if (lenSq > 0) {
      u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
      u = Math.max(0, Math.min(1, u));
    }
    const qx = a.x + u * dx;
    const qy = a.y + u * dy;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < bestD) {
      bestD = d;
      bestCross = dx * (p.y - a.y) - dy * (p.x - a.x);
    }
  }
  if (bestCross > 0) return "left";
  if (bestCross < 0) return "right";
  return "on";
}

export function roundCoord(p: LonLat): LonLat {
  return [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
