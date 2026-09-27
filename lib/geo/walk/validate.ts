/**
 * Robust walkline offset (2026-09-27) — pure geometry validator.
 *
 * Proves, for one generated route, that its walklines are continuous
 * (V1), never cross themselves (V2), never cross the next step's walkline
 * except at their shared point (V3), stay within one offset band of their
 * own centreline (V4), are drawn on the declared side (V5), and never
 * silently collapse a real leg to a point without saying so (V6, owner
 * addition 2026-09-27).
 *
 * Pure: no database access, no network. Reads only `WalkVariant` /
 * `WalkResult` (lib/geo/walk/types.ts) and `walk_meta`, which is the
 * verification aid `buildVariant` attaches and `variantForStorage` strips.
 *
 * Tolerances (0.05 m) match the existing `VERTEX_EPS_M`-adjacent scale used
 * elsewhere in lib/geo/walk/; the mitre limit (2d) is the existing rule
 * reused, not a new threshold. None of these is tuned to make a fixture
 * pass — see docs/CLAUDE-HANDOFF.md "plan approved" entry.
 *
 * The low-level pieces (`dist`, `isZeroLength`, `segIntersection`,
 * `selfCrosses`, `distToPolylineXY`, and the tolerance constants) are
 * exported so `lib/geo/walk/steps.ts`'s adaptive-offset ladder (Session A2,
 * 2026-09-27) can run the SAME V2/V3/V4/V6 checks, run-local, while picking
 * an offset — rather than duplicating this logic.
 */

import { polylineLengthXY, sideOfPolyline } from "@/lib/geo/walk/geometry";
import { makeProjection, type LonLat, type XY } from "@/lib/geo/route-graph";
import type { WalkResult, WalkStep, WalkVariant } from "@/lib/geo/walk/types";

export type GeometryCheck = "V1" | "V2" | "V3" | "V4" | "V5" | "V6";

export type GeometryIssue = {
  variant: string;
  step: number;
  check: GeometryCheck;
  metres: number;
};

/** V1 continuity, V3 crossing-at-shared-point, and "is this walkline zero-length" all use this scale. */
export const TOL_M = 0.05;
/** V4's own fidelity slack, same magnitude as TOL_M, named separately because the spec names it separately. */
export const FIDELITY_TOL_M = 0.05;
/** V6: a walkline this short counts as collapsed. */
export const COLLAPSE_M = 0.05;

export function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isZeroLength(line: XY[]): boolean {
  return line.length < 2 || polylineLengthXY(line) <= COLLAPSE_M;
}

/** Perpendicular distance from `p` to the nearest point of polyline `line` (clamped per segment). */
export function distToPolylineXY(line: XY[], p: XY): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)));
  }
  if (line.length === 1) best = dist(line[0], p);
  return best;
}

/** Bounded segment intersection point, or null. Touching at an endpoint counts (inclusive bounds). */
export function segIntersection(a: XY, b: XY, c: XY, d: XY): XY | null {
  const d1x = b.x - a.x;
  const d1y = b.y - a.y;
  const d2x = d.x - c.x;
  const d2y = d.y - c.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) <= 1e-12) return null;
  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / denom;
  const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / denom;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return { x: a.x + t * d1x, y: a.y + t * d1y };
}

/**
 * True when edge (a,b) then (c,d) — sharing vertex b = c — doubles back on
 * itself: collinear (cross ≈ 0) and reversed (dot < 0). The general segment
 * intersection test cannot see this, because it always "touches" at the
 * shared vertex regardless of direction.
 */
function adjacentPairFoldsBack(a: XY, b: XY, c: XY, d: XY): boolean {
  const u1x = b.x - a.x;
  const u1y = b.y - a.y;
  const u2x = d.x - c.x;
  const u2y = d.y - c.y;
  const len1 = Math.hypot(u1x, u1y);
  const len2 = Math.hypot(u2x, u2y);
  if (len1 <= 1e-9 || len2 <= 1e-9) return false;
  const cross = (u1x * u2y - u1y * u2x) / (len1 * len2);
  const dotN = (u1x * u2x + u1y * u2y) / (len1 * len2);
  return Math.abs(cross) <= 1e-6 && dotN < 0;
}

/** V2: any two non-adjacent edges cross, or an adjacent pair folds back on itself. */
export function selfCrosses(line: XY[]): boolean {
  const n = line.length;
  for (let i = 0; i + 1 < n; i += 1) {
    for (let j = i + 1; j + 1 < n; j += 1) {
      if (j === i) continue;
      if (j === i + 1) {
        if (adjacentPairFoldsBack(line[i], line[i + 1], line[j], line[j + 1])) return true;
        continue;
      }
      if (segIntersection(line[i], line[i + 1], line[j], line[j + 1])) return true;
    }
  }
  return false;
}

/**
 * The checkable range of a walkline: `walk_meta`'s exact `head_arc_points` /
 * `tail_arc_points` counts are excluded from each end (2026-09-27, Session
 * A2 — replaces the flat 9-vertex `ARC_POINTS` guard, which over-excluded a
 * 1-point connector end by 8 genuine vertices).
 */
function nonArcRange(line: XY[], headArcPoints: number, tailArcPoints: number): { lo: number; hi: number } {
  const n = line.length;
  const lo = Math.min(headArcPoints, n - 1);
  const hi = Math.max(n - 1 - tailArcPoints, 0);
  return { lo, hi };
}

/**
 * Validates one variant. Coordinates are projected locally around the
 * variant's own first walkline point (no shared, distance-distorting
 * origin), per the plan. `meta` defaults to the variant's own `walk_meta`
 * (the verification aid `buildVariant` attaches); a caller may pass a
 * different one, e.g. when re-deriving it against stored rows that no
 * longer carry it.
 */
export function validateVariant(variant: WalkVariant, meta: WalkVariant["walk_meta"] = variant.walk_meta): GeometryIssue[] {
  const issues: GeometryIssue[] = [];
  const steps = variant.steps;
  if (steps.length === 0) return issues;
  const origin: LonLat = steps[0].walkline[0] ?? steps[0].centreline[0] ?? [0, 0];
  const project = makeProjection(origin);
  const walk: XY[][] = steps.map((s) => s.walkline.map(project));
  const centre: XY[][] = steps.map((s) => s.centreline.map(project));

  const report = (step: number, check: GeometryCheck, metres: number) => {
    issues.push({ variant: variant.key, step, check, metres });
  };

  // V1: continuity between every consecutive pair, cross arcs included.
  for (let i = 0; i + 1 < steps.length; i += 1) {
    const end = walk[i][walk[i].length - 1];
    const start = walk[i + 1][0];
    const gap = dist(end, start);
    if (gap > TOL_M) report(i, "V1", gap);
  }

  // V2: no walkline crosses itself.
  for (let i = 0; i < steps.length; i += 1) {
    if (isZeroLength(walk[i])) continue;
    if (selfCrosses(walk[i])) report(i, "V2", polylineLengthXY(walk[i]));
  }

  // V3: no crossing between consecutive non-degenerate walklines, other
  // than within TOL_M of their shared point. A zero-length step is
  // skipped, so its neighbours are checked against each other.
  {
    const anchors: number[] = [];
    for (let i = 0; i < steps.length; i += 1) if (!isZeroLength(walk[i])) anchors.push(i);
    for (let a = 0; a + 1 < anchors.length; a += 1) {
      const i = anchors[a];
      const j = anchors[a + 1];
      const shared = walk[i][walk[i].length - 1];
      let worst = 0;
      const lineI = walk[i];
      const lineJ = walk[j];
      for (let p = 0; p + 1 < lineI.length; p += 1) {
        for (let q = 0; q + 1 < lineJ.length; q += 1) {
          const m = segIntersection(lineI[p], lineI[p + 1], lineJ[q], lineJ[q + 1]);
          if (!m) continue;
          const d = dist(m, shared);
          if (d > TOL_M) worst = Math.max(worst, d);
        }
      }
      if (worst > 0) report(i, "V3", worst);
    }
  }

  // V4: every non-arc vertex is within [d - 0.05, 2d + 0.05] of its own centreline.
  for (let i = 0; i < steps.length; i += 1) {
    const m = meta[i];
    if (m.offset_m === null) continue; // every vertex of a cross step is arc
    const d = m.offset_m;
    const { lo, hi } = nonArcRange(walk[i], m.head_arc_points, m.tail_arc_points);
    let worst = 0;
    for (let k = lo; k <= hi; k += 1) {
      const dc = distToPolylineXY(centre[i], walk[i][k]);
      const under = d - FIDELITY_TOL_M - dc;
      const over = dc - (2 * d + FIDELITY_TOL_M);
      worst = Math.max(worst, under, over);
    }
    if (worst > 0) report(i, "V4", worst);
  }

  // V5: the midpoint of each non-arc edge lies on the declared side of its own centreline.
  for (let i = 0; i < steps.length; i += 1) {
    const m = meta[i];
    if (m.offset_side === null) continue;
    const { lo, hi } = nonArcRange(walk[i], m.head_arc_points, m.tail_arc_points);
    let worst = 0;
    for (let k = lo; k < hi; k += 1) {
      const mid = { x: (walk[i][k].x + walk[i][k + 1].x) / 2, y: (walk[i][k].y + walk[i][k + 1].y) / 2 };
      const side = sideOfPolyline(centre[i], mid);
      if (side !== "on" && side !== m.offset_side) worst = Math.max(worst, distToPolylineXY(centre[i], mid));
    }
    if (worst > 0) report(i, "V5", worst);
  }

  // V6 (owner addition, 2026-09-27): a WORK step whose centreline is a real
  // leg (> 2d) but whose walkline collapsed to a point is a silent V4 gap.
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i] as WalkStep;
    if (step.kind !== "work") continue;
    const m = meta[i];
    if (m.offset_m === null) continue;
    const centreLenM = polylineLengthXY(centre[i]);
    const walkLenM = polylineLengthXY(walk[i]);
    if (centreLenM > 2 * m.offset_m && walkLenM < COLLAPSE_M) report(i, "V6", centreLenM);
  }

  return issues;
}

export function validateWalkResult(result: WalkResult): GeometryIssue[] {
  return result.variants.flatMap((v) => validateVariant(v));
}

/** "Route geometry: 0 issues" or "Route geometry: 3 issues (steps best 4, 17; alt_1 9)". */
export function describeGeometryIssues(issues: GeometryIssue[]): string {
  if (issues.length === 0) return "Route geometry: 0 issues";
  const byVariant = new Map<string, Set<number>>();
  for (const issue of issues) {
    const set = byVariant.get(issue.variant) ?? new Set<number>();
    set.add(issue.step);
    byVariant.set(issue.variant, set);
  }
  const parts = [...byVariant.entries()].map(
    ([key, steps]) => `${key} ${[...steps].sort((a, b) => a - b).join(", ")}`,
  );
  return `Route geometry: ${issues.length} issues (steps ${parts.join("; ")})`;
}
