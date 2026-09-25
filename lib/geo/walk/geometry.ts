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
 * Offsets a polyline by `offsetM` onto `side` of its direction of travel.
 * Interior vertices use the mitre of the adjacent edge normals, capped at
 * twice the offset so a hairpin cannot throw the line across the road.
 */
export function offsetPolyline(ptsIn: XY[], offsetM: number, side: Hand): XY[] {
  const pts = dedupeXY(ptsIn);
  if (pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out: XY[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    let nx: number;
    let ny: number;
    if (i === 0) {
      const n = normal(pts[1].x - pts[0].x, pts[1].y - pts[0].y, side);
      nx = n.x * offsetM;
      ny = n.y * offsetM;
    } else if (i === pts.length - 1) {
      const n = normal(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, side);
      nx = n.x * offsetM;
      ny = n.y * offsetM;
    } else {
      const a = normal(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, side);
      const b = normal(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y, side);
      const mx = a.x + b.x;
      const my = a.y + b.y;
      const mlen = Math.hypot(mx, my);
      if (mlen < 1e-9) {
        nx = a.x * offsetM;
        ny = a.y * offsetM;
      } else {
        // Mitre length = offset / cos(θ/2) = 2·offset / |a + b|, capped at 2× offset.
        const scale = Math.min(2 * offsetM / mlen, 2 * offsetM);
        nx = (mx / mlen) * scale;
        ny = (my / mlen) * scale;
      }
    }
    out.push({ x: pts[i].x + nx, y: pts[i].y + ny });
  }
  return out;
}

/** Along-track parameter of `point` on the line through `from` → `to`. 0 at `from`, 1 at `to`. */
function along(from: XY, to: XY, point: XY): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return ((point.x - from.x) * dx + (point.y - from.y) * dy) / lenSq;
}

/**
 * The mitre `offsetPolyline` would place at the shared vertex of two parts.
 * Reuses that function on the two neighbouring edges so the mitre maths stays
 * in one place.
 */
function cornerMitre(prev: XY[], next: XY[], offsetM: number, side: Hand): XY {
  const p = prev[prev.length - 2];
  const v = prev[prev.length - 1];
  const q = next[1];
  return offsetPolyline([p, v, q], offsetM, side)[1];
}

/**
 * True when the mitre at this join falls past the far end of either
 * neighbouring edge. Joining there would fold the walkline back on itself.
 */
function joinOvershoots(prev: XY[], next: XY[], offsetM: number, side: Hand): boolean {
  const v = prev[prev.length - 1];
  const w = next[0];
  if (v.x !== w.x || v.y !== w.y) return true;
  const p = prev[prev.length - 2];
  const q = next[1];
  if ((p.x === v.x && p.y === v.y) || (q.x === v.x && q.y === v.y)) return true;
  const m = cornerMitre(prev, next, offsetM, side);
  return along(p, v, m) < 0 || along(v, q, m) > 1;
}

/**
 * Offsets each part of a continuous run as one polyline, so a shared vertex
 * gets a single mitred point instead of two independent square ends.
 * A join whose mitre would land beyond the far end of either neighbouring
 * edge — or that would reverse that edge once the other end is mitred too —
 * is left as two independent square ends.
 */
export function offsetRun(partsIn: XY[][], offsetM: number, side: Hand): XY[][] {
  const parts = partsIn.map((p) => dedupeXY(p));
  const n = parts.length;
  if (n === 0) return [];
  const join = new Array<boolean>(n - 1).fill(true);
  for (let i = 0; i < n - 1; i += 1) {
    if (parts[i].length < 2 || parts[i + 1].length < 2 || joinOvershoots(parts[i], parts[i + 1], offsetM, side)) {
      join[i] = false;
    }
  }
  for (let i = 0; i < n; i += 1) {
    const part = parts[i];
    if (part.length < 2) continue;
    const own = offsetPolyline(part, offsetM, side);
    for (let e = 0; e < part.length - 1; e += 1) {
      const startIsJoin = e === 0 && i > 0 && join[i - 1];
      const endIsJoin = e === part.length - 2 && i < n - 1 && join[i];
      if (!startIsJoin && !endIsJoin) continue;
      const startPt = startIsJoin ? cornerMitre(parts[i - 1], part, offsetM, side) : own[e];
      const endPt = endIsJoin ? cornerMitre(part, parts[i + 1], offsetM, side) : own[e + 1];
      if (along(part[e], part[e + 1], endPt) <= along(part[e], part[e + 1], startPt)) {
        if (startIsJoin) join[i - 1] = false;
        if (endIsJoin) join[i] = false;
      }
    }
  }

  const out: XY[][] = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && join[j]) j += 1;
    const group = parts.slice(i, j + 1);
    const offset = offsetGroup(group, offsetM, side);
    for (let k = 0; k < offset.length; k += 1) out[i + k] = offset[k];
    i = j + 1;
  }
  return out;
}

/** Concatenates parts that share their join vertex, offsets once, splits back. */
function offsetGroup(parts: XY[][], offsetM: number, side: Hand): XY[][] {
  if (parts.length === 1) return [offsetPolyline(parts[0], offsetM, side)];
  const merged: XY[] = [];
  const ranges: [number, number][] = [];
  for (const part of parts) {
    const start = merged.length === 0 ? 0 : merged.length - 1;
    if (merged.length === 0) merged.push(...part);
    else merged.push(...part.slice(1));
    ranges.push([start, merged.length]);
  }
  const offset = offsetPolyline(merged, offsetM, side);
  return ranges.map(([a, b]) => offset.slice(a, b));
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
