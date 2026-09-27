/**
 * Robust walkline offset (2026-09-27) — verification harness.
 *
 * G1 (default, pure): synthetic unit cases exercise `offsetCore` /
 * `offsetRun` directly, wrapped in a minimal synthetic `WalkVariant` and
 * run through `validateVariant` (V1–V6).
 *
 * G2 (`--live`): regenerates every variant IN MEMORY for REF - Speedwell,
 * TEST - dry run and Northville from `route_walk_inputs` (read-only), and
 * compares against the STORED `territory_route_steps` / frozen
 * `route_steps` rows. Nothing is written. Session A only: no re-save, no
 * re-freeze, no r2/r3/tsc/eslint here (that is scripts/route-geom-apply.ts
 * and G3/G4, which belong to Session B / the shell).
 *
 *   npm run verify:geom
 *   npm run verify:geom -- --live
 */

import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import type { Database } from "@/lib/supabase/types";
import { makeProjection, type LonLat, type XY } from "@/lib/geo/route-graph";
import { PAVEMENT_OFFSET_M, WALK_BACK_INSET_M, makeUnproject, offsetPolyline, offsetRun, polylineLengthXY } from "@/lib/geo/walk/geometry";
import { offsetRunAdaptive } from "@/lib/geo/walk/steps";
import { describeGeometryIssues, validateVariant, type GeometryIssue } from "@/lib/geo/walk/validate";
import type { Hand, VariantKey, WalkStep, WalkVariant } from "@/lib/geo/walk/types";
import { fetchWalkInputs } from "@/lib/geo/walk/inputs";
import { generateWalk } from "@/lib/geo/walk/generate";
import { lineCoordinates } from "@/lib/map/route-layers";

const LIVE = process.argv.includes("--live");

type Status = "PASS" | "FAIL" | "INFORMATIVE" | "NOT RUN";
const results: { item: string; status: Status; evidence: string }[] = [];
function record(item: string, status: Status, evidence: string): void {
  results.push({ item, status, evidence });
  console.log(`  [${status}] ${item}\n         ${evidence.replace(/\n/g, "\n         ")}`);
}
function heading(s: string): void {
  console.log(`\n== ${s}`);
}
function md5(value: unknown): string {
  return createHash("md5").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// G1 — synthetic cases
// ---------------------------------------------------------------------------

const ORIGIN: LonLat = [-2.6, 51.45];
const project = makeProjection(ORIGIN);
const unproject = makeUnproject(project, ORIGIN);
const toLonLat = (pts: XY[]): LonLat[] => pts.map((p) => unproject(p));

/** A synthetic WalkStep: one run, one kind, side/offset from `walk_meta`. */
function syntheticStep(centre: XY[], walk: XY[], side: Hand, kind: WalkStep["kind"] = "walk"): WalkStep {
  return {
    kind,
    segment_id: null,
    street_name: "synthetic",
    side,
    from_node: 0,
    to_node: 1,
    centreline: toLonLat(centre),
    walkline: toLonLat(walk),
    first_seq: kind === "work" ? 0 : null,
    last_seq: kind === "work" ? 0 : null,
    instruction: "synthetic",
    is_dead_end: false,
    length_m: polylineLengthXY(centre),
  };
}

function syntheticVariant(
  key: string,
  parts: {
    centre: XY[];
    walk: XY[];
    side: Hand;
    kind?: WalkStep["kind"];
    offsetM: number | null;
    /** Defaults to `offsetM`: most cases below call `offsetPolyline`/`offsetRun` directly at a fixed offset, not through the ladder. */
    offsetBaseM?: number | null;
    /** Exact arc-guard counts (2026-09-27, Session A2). Default 0: most cases below have no arc splice or connector at either end. */
    headArcPoints?: number;
    tailArcPoints?: number;
  }[],
): WalkVariant {
  const steps = parts.map((p) => syntheticStep(p.centre, p.walk, p.side, p.kind));
  const walk_meta = parts.map((p, k) => ({
    offset_m: p.offsetM,
    offset_base_m: p.offsetBaseM ?? p.offsetM,
    offset_side: p.offsetM === null ? null : p.side,
    offset_ladder_passed: p.offsetM === null ? null : true,
    offset_run: p.offsetM === null ? null : k,
    head_arc_points: p.headArcPoints ?? 0,
    tail_arc_points: p.tailArcPoints ?? 0,
  }));
  const first = steps[0];
  const last = steps[steps.length - 1];
  return {
    key: key as unknown as VariantKey,
    hand: parts[0]?.side ?? "left",
    start: { node_id: 0, lon: first.walkline[0][0], lat: first.walkline[0][1] },
    end: { node_id: 1, lon: last.walkline[last.walkline.length - 1][0], lat: last.walkline[last.walkline.length - 1][1] },
    total_m: steps.reduce((a, s) => a + s.length_m, 0),
    working_m: 0,
    non_working_m: 0,
    return_m: 0,
    rank_cost_m: 0,
    end_to_start_m: 0,
    stranded_count: 0,
    straight_transfers: 0,
    door_order: [],
    steps,
    warnings: [],
    tree: { step_chain: steps.map(() => -1), chain_parent: [] },
    walk_meta,
  };
}

/** Where two infinite lines (point + direction) meet. */
function lineMeet(p1: XY, d1: XY, p2: XY, d2: XY): XY {
  const cross = d1.x * d2.y - d1.y * d2.x;
  const rhs = { x: p2.x - p1.x, y: p2.y - p1.y };
  const t = (rhs.x * d2.y - rhs.y * d2.x) / cross;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * A `turnDeg` corner smoothed into `edgeCount` equal short chords, each
 * bisecting its own angular slice (the standard equal-chord arc
 * approximation), then shifted so the chain's own incoming/outgoing
 * asymptotes meet at the origin — the same vertex the plain two-edge
 * corner (`plainCorner`/`plainJoint`) turns at. Without this shift a
 * short chain of edges drifts away from the corner it is meant to
 * approximate, and comparing it to the plain joint is comparing two
 * different corners.
 */
function cornerChain(edgeLen: number, edgeCount: number, turnDeg: number, leadM = 20): { points: XY[] } {
  const totalRad = (turnDeg * Math.PI) / 180;
  const stepRad = totalRad / edgeCount;
  const chain: XY[] = [{ x: 0, y: 0 }];
  let pos: XY = { x: 0, y: 0 };
  for (let k = 0; k < edgeCount; k += 1) {
    const heading = (k + 0.5) * stepRad;
    pos = { x: pos.x + edgeLen * Math.cos(heading), y: pos.y + edgeLen * Math.sin(heading) };
    chain.push(pos);
  }
  const startDir: XY = { x: 1, y: 0 };
  const endDir: XY = { x: Math.cos(totalRad), y: Math.sin(totalRad) };
  const vertex = lineMeet(chain[0], startDir, chain[chain.length - 1], endDir);
  const shifted = chain.map((p) => ({ x: p.x - vertex.x, y: p.y - vertex.y }));
  const leadIn: XY = { x: shifted[0].x - leadM * startDir.x, y: shifted[0].y - leadM * startDir.y };
  const leadOut: XY = { x: shifted[shifted.length - 1].x + leadM * endDir.x, y: shifted[shifted.length - 1].y + leadM * endDir.y };
  return { points: [leadIn, ...shifted, leadOut] };
}

/** The plain two-edge corner at `vertex` (A and C meeting at one vertex, no intermediate short edge). */
function plainCorner(vertex: XY, turnDeg: number, leadM = 20): XY[] {
  const rad = (turnDeg * Math.PI) / 180;
  return [{ x: vertex.x - leadM, y: vertex.y }, vertex, { x: vertex.x + leadM * Math.cos(rad), y: vertex.y + leadM * Math.sin(rad) }];
}

/** The single interior joint of a plain (unchamfered) corner, offset the same way as the chained case it is compared against. */
function plainJoint(vertex: XY, turnDeg: number, side: Hand, d: number): XY {
  return offsetPolyline(plainCorner(vertex, turnDeg), d, side)[1];
}

type CaseResult = { name: string; issues: GeometryIssue[]; jointDistM: number | null; note: string };

/**
 * A `radius`-metre, `arcLenM`-long turning-bulb arc (Gayner Road's own shape
 * is 16 vertices, 39 m, radius 6 m), digitised into `vertices` equal-angle
 * points, no straight lead — a bare tight loop, closest to the road's own
 * shape (2026-09-27, Session A2, item 3a). `radius = 6` is not achievable
 * for a 39 m arc without exceeding a full turn (2·π·6 ≈ 37.7 m is already a
 * full circle) — any lead-in/lead-out, or the arc itself past 360°, then
 * crosses back over itself at the seam, an unavoidable self-overlap of the
 * CENTRELINE, not an offset artefact (confirmed by hand, every ladder
 * rung). `radius = 6.5` is the closest radius to the plan's "6 m" that
 * keeps a 39 m arc under one full turn (343.8°); it genuinely needs the
 * ladder — 4 m and 3 m both fail here, 2 m is the first to pass.
 */
function turningBulbPoints(radius: number, arcLenM: number, vertices: number): XY[] {
  const angleTotal = arcLenM / radius;
  const bulb: XY[] = [];
  for (let k = 0; k < vertices; k += 1) {
    const angle = (k / (vertices - 1)) * angleTotal;
    bulb.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  return bulb;
}

/**
 * Runs one run through the SAME adaptive ladder `lib/geo/walk/steps.ts`
 * uses in production (`offsetRunAdaptive`, not a fixed `offsetPolyline`
 * call), builds the resulting variant, and validates it. Prints the offset
 * actually used, per the plan's "print the offset each run used".
 */
function runAdaptiveCase(
  name: string,
  parts: XY[][],
  kinds: WalkStep["kind"][],
  isStrip: boolean,
  side: Hand,
): CaseResult {
  const { offsets, offsetUsed, offsetBaseM, ladderPassed } = offsetRunAdaptive(parts, kinds, isStrip, side);
  const variant = syntheticVariant(
    name,
    parts.map((centre, k) => ({ centre, walk: offsets[k], side, kind: kinds[k], offsetM: offsetUsed, offsetBaseM })),
  );
  const issues = validateVariant(variant);
  return {
    name,
    issues,
    jointDistM: null,
    note: `offset used: ${offsetUsed} m (ladder base ${offsetBaseM} m, a rung passed: ${ladderPassed}); ${offsets.reduce((n, o) => n + o.length, 0)} walkline points; ${issues.length} issues${issues.length ? `: ${issues.map((i) => `${i.check}@${i.step}=${i.metres.toFixed(3)}m`).join(", ")}` : ""}`,
  };
}

function runOffsetCase(
  name: string,
  points: XY[],
  side: Hand,
  d: number,
  opts: { plainJointRef?: XY; kind?: WalkStep["kind"] } = {},
): CaseResult {
  const walk = offsetPolyline(points, d, side);
  const variant = syntheticVariant(name, [{ centre: points, walk, side, offsetM: d, kind: opts.kind }]);
  const issues = validateVariant(variant);
  let jointDistM: number | null = null;
  if (opts.plainJointRef) {
    // Every walk point strictly between the two long lead edges: the whole
    // chamfered/kerbed run should collapse close to the plain corner's own
    // single joint.
    const interior = walk.slice(1, -1);
    const pts = interior.length > 0 ? interior : [walk[Math.floor(walk.length / 2)]];
    jointDistM = Math.max(...pts.map((p) => Math.hypot(p.x - (opts.plainJointRef as XY).x, p.y - (opts.plainJointRef as XY).y)));
  }
  return {
    name,
    issues,
    jointDistM,
    note: `${walk.length} walkline points; ${issues.length} issues${issues.length ? `: ${issues.map((i) => `${i.check}@${i.step}=${i.metres.toFixed(3)}m`).join(", ")}` : ""}`,
  };
}

function runG1(): boolean {
  heading("G1 — synthetic unit cases (pure)");
  const d = PAVEMENT_OFFSET_M;
  let allOk = true;
  const cases: CaseResult[] = [];

  // 1. Inside 90° corner with a 2.62 m edge (the Speedwell case): a long
  // lead-in, then a short (2.62 m) final edge immediately before the turn.
  {
    const points: XY[] = [{ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 2.62, y: 0 }, { x: 2.62, y: 20 }];
    const ref = plainJoint({ x: 2.62, y: 0 }, 90, "left", d);
    cases.push(runOffsetCase("inside-90-2.62m-edge", points, "left", d, { plainJointRef: ref }));
  }

  // 2. Two short edges at one corner (generic, not the 0.5+0.5 example).
  {
    const { points } = cornerChain(1.0, 2, 90);
    const ref = plainJoint({ x: 0, y: 0 }, 90, "left", d);
    cases.push(runOffsetCase("two-short-edges-one-corner", points, "left", d, { plainJointRef: ref }));
  }

  // 3. Hairpin: U of 30/12/30 m, inside and outside.
  {
    const points: XY[] = [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 12, y: 30 }, { x: 12, y: 0 }];
    cases.push(runOffsetCase("hairpin-U-30-12-30-inside", points, "right", d));
    cases.push(runOffsetCase("hairpin-U-30-12-30-outside", points, "left", d));
  }

  // 4. Outside corner of 150°, clamped (mitre limit is 2d; 150° needs it).
  {
    const points = plainCorner({ x: 0, y: 0 }, 150);
    cases.push(runOffsetCase("outside-150-clamped", points, "right", d));
  }

  // 5. Collinear points.
  {
    const points: XY[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }];
    cases.push(runOffsetCase("collinear-points", points, "left", d));
  }

  // 6. A zero-length (near-duplicate, under VERTEX_EPS_M) edge, not caught by exact dedupe.
  {
    const points: XY[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1e-9 }, { x: 10, y: 20 }];
    cases.push(runOffsetCase("near-zero-length-edge", points, "left", d));
  }

  // 7. A collapsing 2 m middle chamfer, whose part becomes [J,J] (offsetRun,
  // 3 parts: one 90° turn split 45°/45° across a long-short-long run).
  {
    const c45 = Math.cos(Math.PI / 4) * 2; // 2 m at 45°
    const partA: XY[] = [{ x: -20, y: 0 }, { x: 0, y: 0 }];
    const partB: XY[] = [{ x: 0, y: 0 }, { x: c45, y: c45 }];
    const partC: XY[] = [{ x: c45, y: c45 }, { x: c45, y: c45 + 20 }];
    const offsets = offsetRun([partA, partB, partC], d, "left");
    const isCollapsed = offsets[1].length === 2 && offsets[1][0].x === offsets[1][1].x && offsets[1][0].y === offsets[1][1].y;
    const variant = syntheticVariant("collapsing-middle-chamfer", [
      { centre: partA, walk: offsets[0], side: "left", offsetM: d },
      { centre: partB, walk: offsets[1], side: "left", offsetM: d },
      { centre: partC, walk: offsets[2], side: "left", offsetM: d },
    ]);
    const issues = validateVariant(variant);
    cases.push({
      name: "collapsing-middle-chamfer",
      issues,
      jointDistM: null,
      note: `middle part collapsed to [J,J]: ${isCollapsed} (points ${JSON.stringify(offsets[1].map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]))}); ${issues.length} issues`,
    });
    if (!isCollapsed) allOk = false;
  }

  // 8. A walk-back run at d = 2.
  {
    const points: XY[] = [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 2.62 }, { x: 15, y: 30 }];
    cases.push(runOffsetCase("walk-back-run-d2", points, "right", PAVEMENT_OFFSET_M - WALK_BACK_INSET_M));
  }

  // 9–11. Inside kerb / chamfer / 0.5+0.5, each compared to the plain corner.
  const insideCorners: [string, number, number][] = [
    ["inside-rounded-kerb-5x0.8m", 0.8, 5],
    ["inside-chamfer-3x1.0m", 1.0, 3],
    ["inside-0.5+0.5m-two-45deg", 0.5, 2],
  ];
  const insideRef = plainJoint({ x: 0, y: 0 }, 90, "left", d);
  for (const [name, len, count] of insideCorners) {
    const { points } = cornerChain(len, count, 90);
    cases.push(runOffsetCase(name, points, "left", d, { plainJointRef: insideRef }));
  }

  // 12. Outside versions of the kerb and the chamfer (no plain-corner distance gate).
  const outsideCorners: [string, number, number][] = [
    ["outside-rounded-kerb-5x0.8m", 0.8, 5],
    ["outside-chamfer-3x1.0m", 1.0, 3],
  ];
  for (const [name, len, count] of outsideCorners) {
    const { points } = cornerChain(len, count, 90);
    cases.push(runOffsetCase(name, points, "right", d));
  }

  // Print + gate every offset/collapse case above (all of these must show 0 issues).
  for (const c of cases) {
    const withinLimit = c.jointDistM === null || c.jointDistM <= 0.05;
    const ok = c.issues.length === 0 && withinLimit;
    const evidence = c.jointDistM !== null ? `${c.note}; joint distance from the plain corner: ${c.jointDistM.toFixed(4)} m (limit 0.05 m)` : c.note;
    record(c.name, ok ? "PASS" : "FAIL", evidence);
    if (!ok) allOk = false;
  }

  // 13. V6 direct unit test: a long (>2d) WORK step manually forced to a
  // collapsed [J,J] walkline (not derived from offsetCore — this proves the
  // *check*, since a correctly-implemented offsetCore should not produce
  // this for a long edge on its own). Judged on whether V6 fires, not on
  // "0 issues" — firing IS the pass condition here.
  {
    const centre: XY[] = [{ x: 0, y: 0 }, { x: 0, y: 10 }]; // 10 m > 2d = 8 m
    const j: XY = { x: -4, y: 5 }; // on the declared (left) side, so only V6 fires
    const variant = syntheticVariant("v6-forced-collapse", [{ centre, walk: [j, j], side: "left", offsetM: d, kind: "work" }]);
    const issues = validateVariant(variant);
    const fired = issues.some((i) => i.check === "V6");
    record("v6-forced-collapse (direct unit test: V6 must fire)", fired ? "PASS" : "FAIL", `issues: ${issues.map((i) => `${i.check}=${i.metres.toFixed(3)}m`).join(", ") || "none"}`);
    if (!fired) allOk = false;
  }

  // 14. V6 must NOT fire on a short stub (e.g. Northville's 1 m step 0).
  {
    const centre: XY[] = [{ x: 0, y: 0 }, { x: 0, y: 1 }]; // 1 m, well under 2d
    const j: XY = { x: -4, y: 0.5 }; // on the declared (left) side
    const variant = syntheticVariant("v6-short-stub-no-fire", [{ centre, walk: [j, j], side: "left", offsetM: d, kind: "work" }]);
    const issues = validateVariant(variant);
    const fired = issues.some((i) => i.check === "V6");
    record("v6-short-stub-no-fire (direct unit test: V6 must NOT fire)", !fired ? "PASS" : "FAIL", `issues: ${issues.map((i) => `${i.check}=${i.metres.toFixed(3)}m`).join(", ") || "none"}`);
    if (fired) allOk = false;
  }

  // 15 (informative). The inside U narrower than 2d: expected to report V4 or V5.
  {
    const points: XY[] = [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 4, y: 30 }, { x: 4, y: 0 }]; // base 4 m < 2d = 8 m
    const walk = offsetPolyline(points, d, "right");
    const variant = syntheticVariant("informative-narrow-U-under-2d", [{ centre: points, walk, side: "right", offsetM: d }]);
    const issues = validateVariant(variant);
    const reported = issues.some((i) => i.check === "V4" || i.check === "V5");
    record(
      "informative-narrow-U-under-2d (base 4 m < 2d)",
      "INFORMATIVE",
      `${issues.length} issues: ${issues.map((i) => `${i.check}=${i.metres.toFixed(3)}m`).join(", ") || "none"}; reported by V4/V5: ${reported} (this is the documented limit, not a failure)`,
    );
  }

  // --- Session A2 (2026-09-27) new cases: through the SAME adaptive ladder
  // `steps.ts` uses in production, not a fixed offset. Items 3a/3b must
  // pass V1-V6; item 3c stays informative whichever way it goes.

  // 3a. Turning bulb: a 39 m arc of radius 6 m, 16 vertices, walked on the
  // inside (the Gayner Road shape).
  {
    const points = turningBulbPoints(6.5, 39, 16);
    const c = runAdaptiveCase("turning-bulb-39m-r6.5-16v-inside", [points], ["work"], false, "left");
    record(c.name, c.issues.length === 0 ? "PASS" : "FAIL", c.note);
    if (c.issues.length !== 0) allOk = false;
  }

  // 3b. Out-and-back short loop: a walk out along a centreline whose final
  // 5 m sits between two junctions, then a walk-back strip returning over
  // that SAME final 5 m on the other pavement (the Eden Grove / Filton Road
  // shape: two junctions 4-6 m apart, the return joined by a single
  // connector point, `walk_meta` count 1 — see lib/geo/walk/steps.ts's own
  // connector join).
  {
    const outCentre: XY[] = [{ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 }];
    const backCentre: XY[] = [{ x: 0, y: 5 }, { x: 0, y: 0 }, { x: -20, y: 0 }];
    const out = offsetRunAdaptive([outCentre], ["walk"], false, "left");
    const back = offsetRunAdaptive([backCentre], ["walk"], true, "right");
    const outWalk = [...out.offsets[0]];
    const backWalk = [...back.offsets[0]];
    outWalk.push(backWalk[0]); // the connector join: exactly 1 point, per walk_meta's tail_arc_points
    const variant = syntheticVariant("out-and-back-eden-grove-filton-road", [
      { centre: outCentre, walk: outWalk, side: "left", kind: "walk", offsetM: out.offsetUsed, offsetBaseM: out.offsetBaseM, tailArcPoints: 1 },
      { centre: backCentre, walk: backWalk, side: "right", kind: "walk", offsetM: back.offsetUsed, offsetBaseM: back.offsetBaseM },
    ]);
    const issues = validateVariant(variant);
    record(
      "out-and-back-eden-grove-filton-road",
      issues.length === 0 ? "PASS" : "FAIL",
      `out offset used: ${out.offsetUsed} m (base ${out.offsetBaseM} m); back offset used: ${back.offsetUsed} m (base ${back.offsetBaseM} m); ${issues.length} issues${issues.length ? `: ${issues.map((i) => `${i.check}@${i.step}=${i.metres.toFixed(3)}m`).join(", ")}` : ""}`,
    );
    if (issues.length !== 0) allOk = false;
  }

  // 3c (still informative). The narrow inside U (case above), now through
  // the adaptive ladder instead of a fixed offset: records whether the
  // ladder clears it, but "informative" either way, per the plan.
  {
    const points: XY[] = [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 4, y: 30 }, { x: 4, y: 0 }]; // base 4 m < 2d at every rung
    const { offsets, offsetUsed, offsetBaseM, ladderPassed } = offsetRunAdaptive([points], ["work"], false, "right");
    const variant = syntheticVariant("informative-narrow-U-under-2d-adaptive", [
      { centre: points, walk: offsets[0], side: "right", kind: "work", offsetM: offsetUsed, offsetBaseM },
    ]);
    const issues = validateVariant(variant);
    record(
      "informative-narrow-U-under-2d-adaptive (ladder)",
      "INFORMATIVE",
      `offset used: ${offsetUsed} m (base ${offsetBaseM} m, a rung passed: ${ladderPassed}); ${issues.length} issues: ${issues.map((i) => `${i.check}=${i.metres.toFixed(3)}m`).join(", ") || "none"}; the ladder ${issues.length === 0 ? "clears" : "does not clear"} this case (informative either way, per the plan)`,
    );
  }

  // Session A3 (2026-09-27): the fallback rule. A centreline that crosses
  // itself fails the run-local V2 at every rung, so the ladder must keep the
  // run's BASE (4 m normal, 2 m walk-back strip) and flag it — not drop to
  // the smallest rung. Judged on the offset returned, not on "0 issues".
  {
    const bowtie: XY[] = [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 20, y: 0 }, { x: 0, y: 20 }];
    for (const isStrip of [false, true]) {
      const r = offsetRunAdaptive([bowtie], ["work"], isStrip, "left");
      const expectBase = isStrip ? PAVEMENT_OFFSET_M - WALK_BACK_INSET_M : PAVEMENT_OFFSET_M;
      const ok = !r.ladderPassed && r.offsetUsed === expectBase && r.offsetBaseM === expectBase;
      record(
        `fallback-keeps-base-${isStrip ? "walk-back-strip" : "normal-run"} (no rung passes: base must be kept)`,
        ok ? "PASS" : "FAIL",
        `offset used: ${r.offsetUsed} m (base ${r.offsetBaseM} m, expected ${expectBase} m); a rung passed: ${r.ladderPassed} (expected false)`,
      );
      if (!ok) allOk = false;
    }
  }

  return allOk;
}

// ---------------------------------------------------------------------------
// G2 — live, read-only regeneration vs stored rows
// ---------------------------------------------------------------------------

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const service = createClient<Database>(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function adminClient(): Promise<{ client: SupabaseClient<Database>; signOut: () => Promise<void> }> {
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, role, active, created_at")
    .eq("role", "admin")
    .eq("active", true)
    .order("created_at")
    .limit(1);
  if (error || !profiles || profiles.length === 0) throw new Error(`no active admin profile: ${error?.message ?? "none"}`);
  const adminId = profiles[0].id;
  const { data: userData, error: userError } = await service.auth.admin.getUserById(adminId);
  const email = userData?.user?.email;
  if (userError || !email) throw new Error(`admin has no email: ${userError?.message ?? ""}`);
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new Error(`magic link failed: ${linkError?.message ?? "no token"}`);
  const client = createClient<Database>(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (verifyError || !verified.session) throw new Error(`verifyOtp failed: ${verifyError?.message ?? "no session"}`);
  return { client, signOut: async () => { await client.auth.signOut({ scope: "local" }); } };
}

const LIVE_PROPS = ["REF - Speedwell", "TEST - dry run", "Northville"];
/** The frozen assignments named in the plan's VERIFIED section, read-only here. */
const FROZEN_ASSIGNMENTS: { prop: string; date: string }[] = [
  { prop: "REF - Speedwell", date: "2026-09-22" },
  { prop: "REF - Speedwell", date: "2026-09-24" },
  { prop: "REF - Speedwell", date: "2026-09-27" },
  { prop: "TEST - dry run", date: "2026-09-25" },
  { prop: "TEST - dry run", date: "2026-09-26" },
  { prop: "TEST - dry run", date: "2026-09-27" },
];

type StoredStep = {
  step_index: number;
  kind: string;
  side: string;
  street_name: string | null;
  first_seq: number | null;
  last_seq: number | null;
  instruction: string;
  is_dead_end: boolean;
  segment_id: number | null;
  length_m: number;
  centreline: unknown;
  walkline: unknown;
};

function toXY(coords: [number, number][] | null): XY[] {
  return (coords ?? []).map((c) => project(c));
}

/** Raw counts (no validator): gaps > 0.5 m, gaps that also cross the NEXT step, self-crossing walklines. */
function rawCounts(stepsXY: { walk: XY[] }[]): { gaps: number; crossing: number; selfCrossing: number } {
  let gaps = 0;
  let crossing = 0;
  let selfCrossing = 0;
  const edgesCross = (a: XY, b: XY, c: XY, d: XY): boolean => {
    const side = (p: XY, q: XY, r: XY) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  };
  for (let i = 0; i < stepsXY.length; i += 1) {
    const line = stepsXY[i].walk;
    let selfHit = false;
    for (let p = 0; p + 1 < line.length && !selfHit; p += 1) {
      for (let q = p + 2; q + 1 < line.length && !selfHit; q += 1) {
        if (edgesCross(line[p], line[p + 1], line[q], line[q + 1])) selfHit = true;
      }
    }
    if (selfHit) selfCrossing += 1;
    if (i + 1 < stepsXY.length) {
      const next = stepsXY[i + 1].walk;
      if (line.length > 0 && next.length > 0) {
        const gap = Math.hypot(line[line.length - 1].x - next[0].x, line[line.length - 1].y - next[0].y);
        if (gap > 0.5) {
          gaps += 1;
          let crosses = false;
          for (let p = 0; p + 1 < line.length && !crosses; p += 1) {
            for (let q = 0; q + 1 < next.length && !crosses; q += 1) {
              if (edgesCross(line[p], line[p + 1], next[q], next[q + 1])) crosses = true;
            }
          }
          if (crosses) crossing += 1;
        }
      }
    }
  }
  return { gaps, crossing, selfCrossing };
}

/** One offset run of one variant, from `walk_meta.offset_run` (Session A3). */
type OffsetRun = {
  variant: string;
  firstStep: number;
  lastStep: number;
  offsetM: number;
  baseM: number;
  ladderPassed: boolean;
  lengthM: number;
  streets: string[];
};

function offsetRuns(variants: WalkVariant[]): OffsetRun[] {
  const runs: OffsetRun[] = [];
  for (const v of variants) {
    let current: OffsetRun | null = null;
    let currentId: number | null = null;
    for (let i = 0; i < v.steps.length; i += 1) {
      const m = v.walk_meta[i];
      if (m.offset_run === null || m.offset_m === null || m.offset_base_m === null) continue;
      const s = v.steps[i];
      if (current === null || currentId !== m.offset_run) {
        current = {
          variant: v.key,
          firstStep: i,
          lastStep: i,
          offsetM: m.offset_m,
          baseM: m.offset_base_m,
          ladderPassed: m.offset_ladder_passed === true,
          lengthM: 0,
          streets: [],
        };
        currentId = m.offset_run;
        runs.push(current);
      }
      current.lastStep = i;
      current.lengthM += s.length_m;
      const street = s.street_name ?? "(unnamed / transfer)";
      if (!current.streets.includes(street)) current.streets.push(street);
    }
  }
  return runs;
}

function stepRange(r: OffsetRun): string {
  return r.firstStep === r.lastStep ? `step ${r.firstStep}` : `steps ${r.firstStep}–${r.lastStep}`;
}

/** (a) reduced because a lower rung passed: per value, step and run counts, one named example. */
function describeReducedPassed(runs: OffsetRun[]): string {
  const byValue = new Map<number, { steps: number; runs: number; example: OffsetRun }>();
  for (const r of runs) {
    if (!r.ladderPassed || r.offsetM >= r.baseM) continue;
    const e = byValue.get(r.offsetM);
    const steps = r.lastStep - r.firstStep + 1;
    if (e) {
      e.steps += steps;
      e.runs += 1;
    } else byValue.set(r.offsetM, { steps, runs: 1, example: r });
  }
  if (byValue.size === 0) return "0 steps used a reduced offset";
  return [...byValue.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([offset, e]) => `${offset} m: ${e.steps} step(s) in ${e.runs} run(s), e.g. ${e.example.variant} ${stepRange(e.example)} (${e.example.streets.join(", ")})`)
    .join("\n");
}

/** (b) no rung passed, kept at base: every such run. */
function describeKeptAtBase(runs: OffsetRun[]): string {
  const kept = runs.filter((r) => !r.ladderPassed);
  if (kept.length === 0) return "0 runs";
  return `${kept.length} run(s):\n${kept.map((r) => `${r.variant} ${stepRange(r)} at ${r.offsetM} m: ${r.streets.join(", ")}`).join("\n")}`;
}

function describeLongestReduced(runs: OffsetRun[]): string {
  let best: OffsetRun | null = null;
  for (const r of runs) {
    if (!r.ladderPassed || r.offsetM >= r.baseM) continue;
    if (best === null || r.lengthM > best.lengthM) best = r;
  }
  if (best === null) return "no reduced run";
  return `${best.lengthM.toFixed(2)} m at ${best.offsetM} m (base ${best.baseM} m) — ${best.variant} ${stepRange(best)}: ${best.streets.join(", ")}`;
}

const PINNED_STREETS = ["Filton Road", "Eden Grove"];

/** True when the issue's step, or a step within 2 of it, is on Filton Road or Eden Grove. */
function atPinnedLocation(v: WalkVariant, step: number): boolean {
  for (let k = Math.max(0, step - 2); k <= Math.min(v.steps.length - 1, step + 2); k += 1) {
    if (PINNED_STREETS.includes(v.steps[k].street_name ?? "")) return true;
  }
  return false;
}

/** §2 (geometry-only): keys and order, rank_cost_m, door_order md5, step count, and per step these fields. */
function section2StepKey(index: number, s: { kind: string; side: string; street_name: string | null; first_seq: number | null; last_seq: number | null; instruction: string; is_dead_end: boolean; segment_id: number | null; length_m: number }): string {
  return [index, s.kind, s.side, s.street_name, s.first_seq, s.last_seq, s.instruction, s.is_dead_end, s.segment_id, s.length_m].join("|");
}

async function runG2(): Promise<boolean> {
  heading("G2 — live, read-only: in-memory regeneration vs stored rows");
  let allZero = true;
  const { client, signOut } = await adminClient();
  console.log("  signed in as an existing admin (magic link + OTP); no users created; read-only for this session");

  try {
    for (const propName of LIVE_PROPS) {
      heading(`Prop: ${propName}`);
      const terr = await service.from("territories").select("id").eq("name", propName).maybeSingle();
      if (terr.error || !terr.data) {
        record(`${propName}: found`, "NOT RUN", `${terr.error?.message ?? "not found"}`);
        continue;
      }
      const tid = terr.data.id;

      // Stored rows (before), read-only.
      const routes = await service.from("territory_routes").select("id, variant_key, hand, rank_cost_m, door_order").eq("territory_id", tid);
      const storedByKey = new Map<string, { id: string; variant_key: string; hand: string; rank_cost_m: number; door_order: number[] }>();
      for (const r of routes.data ?? []) storedByKey.set(r.variant_key, { ...r, rank_cost_m: Number(r.rank_cost_m), door_order: (r.door_order ?? []).map(Number) });
      const storedSteps = new Map<string, StoredStep[]>();
      for (const [key, r] of storedByKey) {
        const rows = await service
          .from("territory_route_steps")
          .select("step_index, kind, side, street_name, first_seq, last_seq, instruction, is_dead_end, segment_id, length_m, centreline, walkline")
          .eq("route_id", r.id)
          .order("step_index");
        storedSteps.set(key, ((rows.data ?? []) as unknown as StoredStep[]).map((s) => ({ ...s, length_m: Number(s.length_m) })));
      }

      // Before (stored): raw counts.
      let beforeGaps = 0;
      let beforeCrossing = 0;
      let beforeSelf = 0;
      for (const [, rows] of storedSteps) {
        const xy = rows.map((s) => ({ walk: toXY(lineCoordinates(s.walkline)) }));
        const c = rawCounts(xy);
        beforeGaps += c.gaps;
        beforeCrossing += c.crossing;
        beforeSelf += c.selfCrossing;
      }
      record(
        `${propName}: BEFORE (stored territory_route_steps) raw defect counts`,
        "NOT RUN",
        `${storedByKey.size} variants, ${[...storedSteps.values()].reduce((n, r) => n + r.length, 0)} steps: gaps ${beforeGaps}, crossing-next-step ${beforeCrossing}, self-crossing ${beforeSelf}`,
      );

      // After (new code, in memory). Read-only inputs.
      const inputs = await fetchWalkInputs(client, tid);
      if (!inputs.ok) {
        record(`${propName}: route_walk_inputs`, "NOT RUN", `${inputs.code} ${inputs.detail ?? ""}`);
        continue;
      }
      const result = generateWalk(inputs.inputs);

      let afterGaps = 0;
      let afterCrossing = 0;
      let afterSelf = 0;
      let afterIssues: GeometryIssue[] = [];
      let maxLenChangeM = 0;
      let maxLenChangeWhere = "";
      const spec2Diffs: string[] = [];

      for (const v of result.variants) {
        const xy = v.steps.map((s) => ({ walk: toXY(s.walkline) }));
        const c = rawCounts(xy);
        afterGaps += c.gaps;
        afterCrossing += c.crossing;
        afterSelf += c.selfCrossing;
        afterIssues = afterIssues.concat(validateVariant(v));

        const stored = storedByKey.get(v.key);
        const storedRows = storedSteps.get(v.key);
        if (stored && storedRows) {
          // §2 identity is judged on each side's own step fields directly
          // (kind, side, street_name, first_seq, last_seq, is_dead_end,
          // segment_id, length_m, step position) — independent of geometry.
          const storedKeys = storedRows.map((s) => section2StepKey(s.step_index, s as unknown as Parameters<typeof section2StepKey>[1]));
          const genKeys = v.steps.map((s, idx) => section2StepKey(idx, s as unknown as Parameters<typeof section2StepKey>[1]));
          if (storedKeys.length !== genKeys.length || md5(storedKeys) !== md5(genKeys) || stored.rank_cost_m !== v.rank_cost_m || md5(stored.door_order) !== md5(v.door_order)) {
            spec2Diffs.push(`${v.key}: step-fields md5 ${md5(storedKeys)} vs ${md5(genKeys)} (counts ${storedKeys.length} vs ${genKeys.length}); rank_cost_m ${stored.rank_cost_m} vs ${v.rank_cost_m}; door_order md5 ${md5(stored.door_order)} vs ${md5(v.door_order)}`);
          }
          for (let i = 0; i < Math.min(storedRows.length, v.steps.length); i += 1) {
            const before = polylineLengthXY(toXY(lineCoordinates(storedRows[i].walkline)));
            const after = polylineLengthXY(v.steps[i].walkline.map((p) => project(p)));
            const change = Math.abs(after - before);
            if (change > maxLenChangeM) {
              maxLenChangeM = change;
              maxLenChangeWhere = `${propName} ${v.key} step ${i} (${v.steps[i].kind}${v.steps[i].street_name ? ` ${v.steps[i].street_name}` : ""}): ${before.toFixed(2)} m → ${after.toFixed(2)} m`;
            }
          }
        } else {
          spec2Diffs.push(`${v.key}: no stored row to compare (before/after variant sets differ)`);
        }
      }

      record(
        `${propName}: AFTER (new code, in memory) raw defect counts`,
        afterGaps === 0 && afterCrossing === 0 && afterSelf === 0 ? "PASS" : "FAIL",
        `${result.variants.length} variants: gaps ${afterGaps}, crossing-next-step ${afterCrossing}, self-crossing ${afterSelf}`,
      );
      if (afterGaps !== 0 || afterCrossing !== 0 || afterSelf !== 0) allZero = false;

      const byCheck = new Map<string, number>();
      for (const i of afterIssues) byCheck.set(i.check, (byCheck.get(i.check) ?? 0) + 1);
      record(
        `${propName}: AFTER validator issues (V1–V6)`,
        afterIssues.length === 0 ? "PASS" : "FAIL",
        afterIssues.length === 0
          ? "0 issues on every check"
          : `${[...byCheck.entries()].map(([k, n]) => `${k}: ${n}`).join(", ")}. ${describeGeometryIssues(afterIssues)}`,
      );
      if (afterIssues.length !== 0) allZero = false;

      record(
        `${propName}: §2 fields identical to stored rows`,
        spec2Diffs.length === 0 ? "PASS" : "FAIL",
        spec2Diffs.length === 0 ? `${result.variants.length} variants, all §2 fields identical` : spec2Diffs.join("\n"),
      );
      if (spec2Diffs.length !== 0) allZero = false;

      record(`${propName}: largest per-step walkline length change`, "NOT RUN", maxLenChangeWhere ? `${maxLenChangeM.toFixed(3)} m — ${maxLenChangeWhere}` : "no comparable stored variant");

      // Session A3: the reduced-offset table, split, and the longest reduced run.
      const runs = offsetRuns(result.variants);
      record(`${propName}: (a) reduced because a lower rung passed`, "NOT RUN", describeReducedPassed(runs));
      record(`${propName}: (b) no rung passed, kept at base`, "NOT RUN", describeKeptAtBase(runs));
      record(`${propName}: longest reduced run`, "NOT RUN", describeLongestReduced(runs));

      // Session A3: the exact remaining issue set (variant, step, check, metres to 0.01).
      if (afterIssues.length > 0) {
        const byKey = new Map(result.variants.map((v) => [v.key as string, v]));
        const sorted = [...afterIssues].sort((a, b) => a.variant.localeCompare(b.variant) || a.step - b.step || a.check.localeCompare(b.check));
        const lines = sorted.map((iss) => {
          const s = byKey.get(iss.variant)?.steps[iss.step];
          return `(${iss.variant}, ${iss.step}, ${iss.check}, ${iss.metres.toFixed(2)}) — ${s?.kind ?? "?"} ${s?.street_name ?? "(unnamed / transfer)"}`;
        });
        const elsewhere = sorted.filter((iss) => {
          const v = byKey.get(iss.variant);
          return !v || !atPinnedLocation(v, iss.step);
        });
        record(`${propName}: remaining validator issue set`, "NOT RUN", `${sorted.length} issue(s):\n${lines.join("\n")}`);
        record(
          `${propName}: every remaining issue is at Filton Road / Eden Grove (within 2 steps)`,
          elsewhere.length === 0 ? "PASS" : "FAIL",
          elsewhere.length === 0 ? `all ${sorted.length} issue(s)` : `${elsewhere.length} elsewhere: ${elsewhere.map((i) => `(${i.variant}, ${i.step}, ${i.check})`).join(", ")}`,
        );
      }

      // Item 4: Northville's 3 named places from the owner's 2026-09-27
      // review — the offset used, and confirmation of 0 issues each.
      if (propName === "Northville") {
        for (const place of ["Eden Grove", "Filton Road", "Gayner Road"]) {
          const hits: string[] = [];
          let placeIssues = 0;
          for (const v of result.variants) {
            for (let i = 0; i < v.steps.length; i += 1) {
              if (v.steps[i].street_name !== place) continue;
              const m = v.walk_meta[i];
              const stepIssues = afterIssues.filter((iss) => iss.variant === v.key && iss.step === i);
              placeIssues += stepIssues.length;
              hits.push(`${v.key} step ${i} (${v.steps[i].kind}): offset used ${m.offset_m ?? "n/a"} m (base ${m.offset_base_m ?? "n/a"} m), ${stepIssues.length} issues`);
            }
          }
          record(
            `Northville: ${place} (one of the owner's 3 places, 2026-09-27)`,
            hits.length > 0 && placeIssues === 0 ? "PASS" : hits.length === 0 ? "NOT RUN" : "FAIL",
            hits.length > 0 ? hits.join("\n") : "no step with this street_name in any variant",
          );
        }
      }
    }

    // Frozen route_steps of the named assignments, read-only.
    heading("Frozen route_steps (named assignments)");
    for (const fa of FROZEN_ASSIGNMENTS) {
      const terr = await service.from("territories").select("id").eq("name", fa.prop).maybeSingle();
      if (!terr.data) continue;
      const a = await service.from("assignments").select("id, visit_number, route_variant_key").eq("territory_id", terr.data.id).eq("work_date", fa.date).maybeSingle();
      if (a.error || !a.data) {
        record(`${fa.prop} ${fa.date}: assignment found`, "NOT RUN", `${a.error?.message ?? "no assignment on this date"}`);
        continue;
      }
      const rows = await service
        .from("route_steps")
        .select("step_index, kind, side, street_name, first_seq, last_seq, is_dead_end, geom, walk_geom")
        .eq("assignment_id", a.data.id)
        .order("step_index");
      const stepsXY = ((rows.data ?? []) as unknown as { walk_geom: unknown }[]).map((s) => ({ walk: toXY(lineCoordinates(s.walk_geom)) }));
      const c = rawCounts(stepsXY);
      record(
        `${fa.prop} ${fa.date} (visit ${a.data.visit_number}, ${a.data.route_variant_key}): frozen route_steps raw defect counts`,
        "NOT RUN",
        `${stepsXY.length} steps: gaps ${c.gaps}, crossing-next-step ${c.crossing}, self-crossing ${c.selfCrossing}`,
      );
    }
  } finally {
    await signOut();
  }
  return allZero;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const g1Ok = runG1();
  let g2Ok = true;
  if (LIVE) g2Ok = await runG2();
  else console.log("\n(--live not passed: G2 skipped. Run: npm run verify:geom -- --live)");

  heading("Summary");
  for (const r of results) console.log(`  ${r.status.padEnd(11)} ${r.item}`);
  const hardFail = results.some((r) => r.status === "FAIL") || !g1Ok || (LIVE && !g2Ok);
  console.log(`\nG1: ${g1Ok ? "PASS" : "FAIL"}${LIVE ? `; G2: ${g2Ok ? "PASS" : "FAIL"}` : "; G2: not run"}`);
  if (hardFail) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
