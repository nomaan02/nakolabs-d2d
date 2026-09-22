/**
 * Stage 5b (R1) — planar geometry for walklines.
 *
 * The walkline is the centreline offset onto the pavement being walked.
 * MapLibre's `line-offset` moves a drawn line but not the symbols placed
 * along it, so direction chevrons would sit on the road centre; the geometry
 * itself is offset instead. "~4 m" is a display offset, not a measurement.
 */

import type { LonLat, XY } from "@/lib/geo/route-graph";
import type { Hand } from "@/lib/geo/walk/types";

/** Metres from the road centreline to the walkline. */
export const PAVEMENT_OFFSET_M = 4;
/** The crossing distance charged for every cross step: pavement to pavement. */
export const CROSS_M = 2 * PAVEMENT_OFFSET_M;

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
