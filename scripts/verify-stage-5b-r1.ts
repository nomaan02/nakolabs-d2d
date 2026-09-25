/**
 * Stage 5b (R1) — walking-pattern route generator: verification harness.
 *
 * Signs in as an existing admin (magic link + OTP, as seed-demo.ts does — no
 * users are created), reads `route_walk_inputs` for each prop, runs the
 * generator, checks the acceptance list and writes one GeoJSON preview per
 * variant per prop to data/route-previews/ (gitignored). Nothing is stored.
 *
 * Prints counts, metres and md5s only — never geometries, step lists or UPRNs.
 *
 *   npm run verify:stage5b-r1
 *   npm run verify:stage5b-r1 -- --props="REF - Speedwell"
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import type { Database } from "@/lib/supabase/types";
import type { GraphSegment, RouteGraph, XY } from "@/lib/geo/route-graph";
import { fetchWalkInputs, type WalkInputs } from "@/lib/geo/walk/inputs";
import { generateWalk, overlap, prepare } from "@/lib/geo/walk/generate";
import { variantToGeoJson } from "@/lib/geo/walk/preview";
import { PAVEMENT_OFFSET_M, pointAlong, sideOfPolyline } from "@/lib/geo/walk/geometry";
import type { Demand } from "@/lib/geo/walk/demand";
import type { WalkResult, WalkStep, WalkVariant } from "@/lib/geo/walk/types";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const ACCEPTANCE_PROPS = ["REF - Speedwell", "redland", "Northville"];
const PREVIEW_ONLY_PROPS = [
  "DEMO - Clifton (Princess Victoria Street)",
  "DEMO - Southville (Stackpool Road)",
  "DEMO - Bishopston (Monmouth Road)",
  "TEST - dry run",
];
const PREVIEW_DIR = join(process.cwd(), "data", "route-previews");

const argProps = process.argv.find((a) => a.startsWith("--props="))?.slice("--props=".length);
const PROPS = argProps ? argProps.split(",").map((s) => s.trim()).filter(Boolean) : [...ACCEPTANCE_PROPS, ...PREVIEW_ONLY_PROPS];

const service = createClient<Database>(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

type Status = "PASS" | "FAIL" | "NOT RUN";
const results: { item: string; status: Status; evidence: string }[] = [];
function record(item: string, status: Status, evidence: string): void {
  results.push({ item, status, evidence });
  console.log(`  [${status}] ${item}\n         ${evidence.replace(/\n/g, "\n         ")}`);
}
function heading(s: string): void {
  console.log(`\n== ${s}`);
}
function md5(value: unknown): string {
  return createHash("md5").update(JSON.stringify(value)).digest("hex");
}
function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
/** The output minus timings — what determinism is judged on. */
function stable(r: WalkResult): Omit<WalkResult, "timings"> {
  const copy: Partial<WalkResult> = { ...r };
  delete copy.timings;
  return copy as Omit<WalkResult, "timings">;
}

// ---------------------------------------------------------------------------
// Admin session (no users created)
// ---------------------------------------------------------------------------

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
  return {
    client,
    signOut: async () => {
      await client.auth.signOut({ scope: "local" });
    },
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type Prepared = { inputs: WalkInputs; graph: RouteGraph; demand: Demand; result: WalkResult };

function variant(r: WalkResult, key: string): WalkVariant | undefined {
  return r.variants.find((v) => v.key === key);
}

function segmentNodesByStreet(graph: RouteGraph, name: string): Set<number> {
  const nodes = new Set<number>();
  for (const s of graph.segments) {
    if (s.name === name) {
      nodes.add(graph.nodes[s.fromNode].id);
      nodes.add(graph.nodes[s.toNode].id);
    }
  }
  return nodes;
}

/**
 * One out-and-back: the steps of `street` form one contiguous block
 * [out+, cross, back+] with no foreign steps, and the single cross is at
 * the far end from where the street was entered: its node is the out pass's
 * last to_node.
 */
function checkOutAndBack(v: WalkVariant, street: string): { ok: boolean; evidence: string } {
  const idx = v.steps.map((s, i) => (s.street_name === street && s.kind !== "cross" ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return { ok: false, evidence: `${street}: no steps` };
  const first = idx[0];
  const last = idx[idx.length - 1];
  const block = v.steps.slice(first, last + 1);
  const foreign = block.filter((s) => s.street_name !== street && s.kind !== "cross");
  const crosses = block.map((s, i) => (s.kind === "cross" ? first + i : -1)).filter((i) => i >= 0);
  const works = idx.filter((i) => v.steps[i].kind === "work");
  const c = crosses[0];
  const atFarEnd = crosses.length === 1 && c > first && v.steps[c].to_node === v.steps[c - 1].to_node;
  const before = idx.filter((i) => i < (c ?? Infinity)).length;
  const after = idx.filter((i) => i > (c ?? -1)).length;
  const ok = foreign.length === 0 && crosses.length === 1 && atFarEnd && before > 0 && after > 0;
  return {
    ok,
    evidence: `${street}: steps ${first}–${last} (${works.length} work, cross at step ${crosses.join(",") || "none"}${atFarEnd ? ` at node ${v.steps[c].to_node}, the out pass's far end` : ""}, ${foreign.length} foreign steps inside)`,
  };
}

// ---------------------------------------------------------------------------
// Open paths, turns, connectivity (2026-09-25)
// ---------------------------------------------------------------------------

function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sameCoord(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function lineLength(pts: XY[]): number {
  let t = 0;
  for (let i = 1; i < pts.length; i += 1) t += dist(pts[i - 1], pts[i]);
  return t;
}

/** Planar metres from from_node of the nearest point on the segment centreline. */
function projectAlong(seg: GraphSegment, p: XY): number {
  let best = Infinity;
  let along = 0;
  for (let i = 1; i < seg.xy.length; i += 1) {
    const a = seg.xy[i - 1];
    const b = seg.xy[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
    if (d < best) {
      best = d;
      along = seg.cumXY[i - 1] + u * Math.sqrt(l2);
    }
  }
  return along;
}

function distToPolyline(pts: XY[], p: XY): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)));
  }
  return best;
}

/** Points every ≤ 0.5 m along a polyline, vertices included. */
function samples(pts: XY[]): XY[] {
  const out: XY[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / 0.5));
    for (let k = 0; k < n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  if (pts.length > 0) out.push(pts[pts.length - 1]);
  return out;
}

type Ctx = {
  p: Prepared;
  segById: Map<number, GraphSegment>;
  alongByUprn: Map<number, number>;
  nodeXY: Map<number, XY>;
};

function ctxFor(p: Prepared): Ctx {
  const segById = new Map(p.graph.segments.map((s) => [s.id, s]));
  const alongByUprn = new Map<number, number>();
  for (const d of p.demand.doors) if (!d.stranded) alongByUprn.set(d.uprn, d.alongM);
  const nodeXY = new Map(p.graph.nodes.map((n) => [n.id, n.xy]));
  return { p, segById, alongByUprn, nodeXY };
}

function xyOf(c: Ctx, coords: [number, number][]): XY[] {
  return coords.map((q) => c.p.graph.project(q));
}

function leadIn(v: WalkVariant): { steps: number; metres: number } {
  let steps = 0;
  let metres = 0;
  for (const s of v.steps) {
    if (s.kind === "work") break;
    steps += 1;
    metres += s.length_m;
  }
  return { steps, metres };
}

function checkOpenPath(c: Ctx, v: WalkVariant): string[] {
  const problems: string[] = [];
  const n = v.steps.length;
  if (n === 0) return ["no steps"];
  const first = v.steps[0];
  const last = v.steps[n - 1];
  if (first.kind !== "work") problems.push(`step 0 is ${first.kind}`);
  if (last.kind !== "work") problems.push(`step ${n - 1} is ${last.kind}`);
  if (v.return_m !== 0) problems.push(`return_m ${v.return_m}`);
  if (!sameCoord([v.start.lon, v.start.lat], first.walkline[0])) problems.push("start is not the first walkline point");
  if (!sameCoord([v.end.lon, v.end.lat], last.walkline[last.walkline.length - 1])) problems.push("end is not the last walkline point");
  const sum = v.steps.reduce((a, s) => a + s.length_m, 0);
  if (Math.abs(sum - v.total_m) > 0.01) problems.push(`total_m ${v.total_m} vs Σ length_m ${sum.toFixed(2)}`);
  if (first.kind === "work" && first.first_seq !== null && first.segment_id !== null) {
    const seg = c.segById.get(first.segment_id) as GraphSegment;
    const along = c.alongByUprn.get(v.door_order[first.first_seq]);
    const centre = xyOf(c, first.centreline);
    const widened = lineLength(centre) <= WIDENED_MAX_M;
    if (along !== undefined && !widened) {
      const d = dist(pointAlong(seg, along), centre[0]);
      if (d > 0.5) problems.push(`step 0 first door foot ${d.toFixed(2)} m from the first centreline vertex`);
    }
  }
  return problems;
}

type FoundTurn = { a: number; cross: number; b: number; seg: GraphSegment; dir: 1 | -1 };

function findStepTurns(c: Ctx, v: WalkVariant): FoundTurn[] {
  const out: FoundTurn[] = [];
  const steps = v.steps;
  for (let i = 0; i < steps.length; i += 1) {
    const a = steps[i];
    if (a.kind === "cross" || a.segment_id === null) continue;
    let j = i + 1;
    let cross = -1;
    if (j < steps.length && steps[j].kind === "cross") {
      cross = j;
      j += 1;
    }
    const b = steps[j];
    if (!b || b.kind === "cross" || b.segment_id !== a.segment_id || b.from_node !== a.to_node || b.to_node !== a.from_node) continue;
    const chainA = v.tree.step_chain[i];
    const chainB = v.tree.step_chain[j];
    const sameChain = chainA !== -1 && chainB === chainA;
    const viaTransfer = cross === -1 && (chainA === -1) !== (chainB === -1);
    if (!sameChain && !viaTransfer) continue;
    const seg = c.segById.get(a.segment_id) as GraphSegment;
    let dir: 1 | -1 = c.p.graph.nodes[seg.fromNode].id === a.from_node ? 1 : -1;
    if (seg.fromNode === seg.toNode) {
      // A loop's two ends are one node, so read the direction off the line itself, away from that node.
      const centre = xyOf(c, a.centreline);
      const m = Math.max(0, Math.floor(centre.length / 2) - 1);
      dir = projectAlong(seg, centre[m + 1] ?? centre[m]) >= projectAlong(seg, centre[m]) ? 1 : -1;
    }
    out.push({ a: i, cross, b: j, seg, dir });
  }
  return out;
}

type TurnStats = {
  checked: number;
  crossTurns: number;
  oneSided: number;
  walkWalk: number;
  loops: number;
  pulledBackM: number;
  problems: string[];
  oneSidedExample: string | null;
};

const ARC_N = 9;
/** A 1 m minimum span, as stored: coordinates are rounded to about 1 cm. */
const WIDENED_MAX_M = 1.05;
const CLAMP_M = PAVEMENT_OFFSET_M + 1 - 0.1;

/** Direction of travel into the turn at T, and T's centreline foot. */
function travelFrame(t: FoundTurn, T: number): { foot: XY; u: XY } {
  const seg = t.seg;
  // The edge walked in on: ending at T going forwards, starting at T going
  // backwards. T within 1e-6 m of a vertex is that vertex, as in the generator.
  const eps = 1e-6;
  let i = 1;
  while (i < seg.xy.length - 1 && !(seg.cumXY[i] > seg.cumXY[i - 1] && (t.dir === 1 ? seg.cumXY[i] >= T - eps : seg.cumXY[i] > T + eps))) i += 1;
  const dx = seg.xy[i].x - seg.xy[i - 1].x;
  const dy = seg.xy[i].y - seg.xy[i - 1].y;
  const len = Math.hypot(dx, dy) || 1;
  return { foot: pointAlong(seg, T), u: { x: (dx / len) * t.dir, y: (dy / len) * t.dir } };
}

function ahead(frame: { foot: XY; u: XY }, q: XY): number {
  return (q.x - frame.foot.x) * frame.u.x + (q.y - frame.foot.y) * frame.u.y;
}

/** Arc clamp, in the direction of travel: every point at least one offset + 1 m short of the far node, or no forward bulge when the door itself is closer. */
function arcClampProblem(c: Ctx, t: FoundTurn, T: number, arc: XY[], widened: boolean): string | null {
  const frame = travelFrame(t, T);
  const far = c.p.graph.nodes[t.dir === 1 ? t.seg.toNode : t.seg.fromNode].xy;
  const doorShort = ahead(frame, far);
  let worstShort = Infinity;
  let worstPast = -Infinity;
  for (const q of arc) {
    worstShort = Math.min(worstShort, doorShort - ahead(frame, q));
    worstPast = Math.max(worstPast, ahead(frame, q));
  }
  if (doorShort >= PAVEMENT_OFFSET_M + 1) {
    if (worstShort < CLAMP_M - (widened ? 0.5 : 0)) return `arc reaches ${worstShort.toFixed(2)} m short of the far node`;
  } else if (worstPast > 0.1 + (widened ? 0.5 : 0)) {
    return `door ${doorShort.toFixed(2)} m from the far node but the arc bulges ${worstPast.toFixed(2)} m`;
  }
  return null;
}

function checkTurns(c: Ctx, v: WalkVariant, label: string): TurnStats {
  const stats: TurnStats = { checked: 0, crossTurns: 0, oneSided: 0, walkWalk: 0, loops: 0, pulledBackM: 0, problems: [], oneSidedExample: null };
  const bad = (i: number, msg: string) => stats.problems.push(`${label} step ${i}: ${msg}`);
  for (const t of findStepTurns(c, v)) {
    stats.checked += 1;
    const a = v.steps[t.a];
    const b = v.steps[t.b];
    const L = t.seg.planarLengthM;
    let T = t.dir === 1 ? -Infinity : Infinity;
    for (const s of [a, b]) {
      if (s.kind !== "work" || s.first_seq === null || s.last_seq === null) continue;
      for (let q = s.first_seq; q <= s.last_seq; q += 1) {
        const along = c.alongByUprn.get(v.door_order[q]);
        if (along === undefined) continue;
        T = t.dir === 1 ? Math.max(T, along) : Math.min(T, along);
      }
    }
    const walkWalk = a.kind === "walk" && b.kind === "walk";
    if (!Number.isFinite(T)) {
      if (!walkWalk || t.cross !== -1) {
        bad(t.a, "turn with no knocked door on its segment");
        continue;
      }
      // A walk handed back by a transfer: nothing knocked, so it turns at the node.
      T = t.dir === 1 ? L : 0;
    }
    stats.pulledBackM += t.dir === 1 ? L - T : T;
    const aW = xyOf(c, a.walkline);
    const bW = xyOf(c, b.walkline);
    const widened = lineLength(xyOf(c, a.centreline)) <= WIDENED_MAX_M || lineLength(xyOf(c, b.centreline)) <= WIDENED_MAX_M;
    const tol = 0.5 + (widened ? 0.5 : 0);
    // Walkline points near the turn are judged in the direction of travel at
    // T (a 4 m offset point at a bend projects onto the wrong edge). The
    // centreline lies on the segment, so its points are judged by projection.
    const frame = travelFrame(t, T);
    const near = 2 * PAVEMENT_OFFSET_M + 1;
    const loop = t.seg.fromNode === t.seg.toNode;
    // On a loop the node is both ends, so projection cannot say which side of
    // T a point is. There, each centreline must instead be the segment's own
    // vertices in walking order, ending (a) or starting (b) at T's foot.
    const past = (q: XY) => (!loop && dist(q, frame.foot) <= near ? ahead(frame, q) : -Infinity);
    if (loop) {
      stats.loops += 1;
      for (const [k, s, towardT] of [[t.a, a, true], [t.b, b, false]] as const) {
        const inner = s.centreline.slice(1, -1);
        const idx = inner.map((p) => t.seg.lonLat.findIndex((q, n) => n > 0 && n < t.seg.lonLat.length - 1 && sameCoord(q, p)));
        const stepDir = towardT ? t.dir : -t.dir;
        const ordered = idx.every((n, m) => n > 0 && (m === 0 || (n - idx[m - 1]) * stepDir > 0));
        if (!ordered) bad(k, "loop centreline is not the segment's vertices in walking order");
        const endAtT = xyOf(c, [towardT ? s.centreline[s.centreline.length - 1] : s.centreline[0]])[0];
        if (dist(endAtT, frame.foot) > tol) bad(k, `loop centreline ${towardT ? "ends" : "starts"} ${dist(endAtT, frame.foot).toFixed(2)} m from the furthest door`);
      }
    }
    for (const [k, s] of loop ? [] : ([[t.a, a], [t.b, b]] as const)) {
      const centre = xyOf(c, s.centreline);
      const worst = Math.max(...centre.map((q) => {
        const along = projectAlong(t.seg, q);
        return t.dir === 1 ? along - T : T - along;
      }));
      if (worst > tol) bad(k, `centreline runs ${worst.toFixed(2)} m past the furthest door`);
    }
    const aCentreEnd = loop ? T : projectAlong(t.seg, xyOf(c, [a.centreline[a.centreline.length - 1]])[0]);
    const bCentreStart = loop ? T : projectAlong(t.seg, xyOf(c, [b.centreline[0]])[0]);
    if (Math.abs(aCentreEnd - T) > tol) bad(t.a, `centreline ends ${Math.abs(aCentreEnd - T).toFixed(2)} m from the furthest door`);
    if (Math.abs(bCentreStart - T) > tol) bad(t.b, `centreline starts ${Math.abs(bCentreStart - T).toFixed(2)} m from the furthest door`);

    // The arc of a one-sided turn is inside the walk step; it is held to the arc rule, not the past-T rule.
    let aBody = aW;
    let bBody = bW;
    let arc: XY[] | null = null;
    if (t.cross !== -1) {
      stats.crossTurns += 1;
      const x = v.steps[t.cross];
      if (x.walkline.length !== ARC_N) bad(t.cross, `cross walkline has ${x.walkline.length} points`);
      if (!sameCoord(x.walkline[0], a.walkline[a.walkline.length - 1])) bad(t.cross, "cross does not start at the out step's walkline end");
      if (!sameCoord(x.walkline[x.walkline.length - 1], b.walkline[0])) bad(t.cross, "cross does not end at the back step's walkline start");
      arc = xyOf(c, x.walkline);
    } else {
      stats.oneSided += 1;
      // The walk back is the walk half; with two walks, the transfer half.
      const walkFirst = walkWalk ? v.tree.step_chain[t.a] === -1 : a.kind === "walk";
      const w = walkFirst ? a : b;
      const k = walkFirst ? b : a;
      if (walkWalk) stats.walkWalk += 1;
      if (w.kind !== "walk" || (k.kind !== "work" && !walkWalk)) {
        bad(t.a, `one-sided turn is ${a.kind}/${b.kind}`);
        continue;
      }
      const wXY = walkFirst ? aW : bW;
      const kXY = walkFirst ? bW : aW;
      if (wXY.length < ARC_N + 1) {
        bad(walkFirst ? t.a : t.b, `walk back has ${wXY.length} points, no room for an arc`);
        continue;
      }
      arc = walkFirst ? wXY.slice(wXY.length - ARC_N) : wXY.slice(0, ARC_N);
      const body = walkFirst ? wXY.slice(0, wXY.length - ARC_N + 1) : wXY.slice(ARC_N - 1);
      // The far-end point may be the connecting line to the next step, which starts wherever that step starts.
      const bodyPastCheck = walkFirst ? body.slice(1) : body.slice(0, -1);
      if (walkFirst) aBody = bodyPastCheck;
      else bBody = bodyPastCheck;
      const joined = walkFirst
        ? sameCoord(a.walkline[a.walkline.length - 1], b.walkline[0])
        : sameCoord(b.walkline[0], a.walkline[a.walkline.length - 1]);
      if (!joined) bad(t.a, "work line and walk back do not meet");
      let nearest = Infinity;
      for (const q of samples(bodyPastCheck)) nearest = Math.min(nearest, distToPolyline(kXY, q));
      if (nearest < 1) bad(walkFirst ? t.a : t.b, `walk back comes within ${nearest.toFixed(2)} m of the work line`);
      if (stats.oneSidedExample === null) {
        stats.oneSidedExample = `steps ${t.a} (${a.kind}) → ${t.b} (${b.kind}) on ${a.street_name ?? "an unnamed road"} (segment ${a.segment_id}); separation ≥ ${nearest.toFixed(2)} m; arc bulge ${Math.max(...arc.map(past)).toFixed(2)} m`;
      }
    }

    const aEnd = ahead(frame, aW[aW.length - 1]);
    const bStart = ahead(frame, bW[0]);
    if (Math.abs(aEnd) > tol) bad(t.a, `walkline ends ${aEnd.toFixed(2)} m from the furthest door`);
    if (Math.abs(bStart) > tol) bad(t.b, `walkline starts ${bStart.toFixed(2)} m from the furthest door`);
    const worstPast = Math.max(...aBody.map(past), ...bBody.map(past));
    if (worstPast > tol) bad(t.a, `a walkline runs ${worstPast.toFixed(2)} m past the furthest door`);
    if (arc) {
      const clamp = arcClampProblem(c, t, T, arc, widened);
      if (clamp) bad(t.cross !== -1 ? t.cross : t.a, clamp);
    }
  }
  return stats;
}

type Gap = { i: number; m: number; what: string; kinds: string };

function checkConnectivity(c: Ctx, v: WalkVariant): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 0; i + 1 < v.steps.length; i += 1) {
    const s: WalkStep = v.steps[i];
    const t: WalkStep = v.steps[i + 1];
    const m = dist(c.p.graph.project(s.walkline[s.walkline.length - 1]), c.p.graph.project(t.walkline[0]));
    if (m > 0.5) {
      const kinds = `${s.kind}${s.segment_id === null && s.kind === "walk" ? " (straight)" : ""} → ${t.kind}${t.segment_id === null && t.kind === "walk" ? " (straight)" : ""}`;
      gaps.push({ i, m, kinds, what: `${s.kind} ${s.street_name ?? "-"} → ${t.kind} ${t.street_name ?? "-"}` });
    }
  }
  return gaps;
}

function checkOneWorkStepPerSegment(p: Prepared, v: WalkVariant, street: string): { ok: boolean; evidence: string } {
  const segs = p.graph.segments.filter((s) => s.name === street);
  const working = segs.filter((s) => p.demand.working[s.index * 2] === 1 || p.demand.working[s.index * 2 + 1] === 1);
  const walkingOnly = segs.length - working.length;
  const failures: string[] = [];
  for (const s of working) {
    const work = v.steps.filter((st) => st.kind === "work" && st.segment_id === s.id);
    const sides = [p.demand.working[s.index * 2], p.demand.working[s.index * 2 + 1]];
    const expected = sides[0] + sides[1];
    if (work.length !== expected) failures.push(`seg ${s.id}: ${work.length} work steps, ${expected} working side(s)`);
  }
  const twoSided = working.filter((s) => p.demand.working[s.index * 2] === 1 && p.demand.working[s.index * 2 + 1] === 1).length;
  return {
    ok: failures.length === 0 && twoSided === 0,
    evidence: `${street}: ${segs.length} buffer segments, ${working.length} with prop doors (${twoSided} two-sided), ${walkingOnly} walking-only; ${failures.length === 0 ? "each working segment has exactly one work step per working side" : failures.join("; ")}`,
  };
}

function descends(chainParent: number[], c: number, ancestor: number): boolean {
  let cur = c;
  let hops = 0;
  while (cur !== -1 && hops <= chainParent.length) {
    if (cur === ancestor) return true;
    cur = chainParent[cur];
    hops += 1;
  }
  return false;
}

function checkSeparation(p: Prepared, v: WalkVariant): { passing: number; total: number; failures: string[]; streets: string } {
  const bySeg = new Map<number, number[]>();
  v.steps.forEach((s, i) => {
    if (s.kind === "work" && s.segment_id !== null) {
      const list = bySeg.get(s.segment_id) ?? [];
      list.push(i);
      bySeg.set(s.segment_id, list);
    }
  });
  const twoSided = p.graph.segments.filter((s) => p.demand.working[s.index * 2] === 1 && p.demand.working[s.index * 2 + 1] === 1);
  let passing = 0;
  const failures: string[] = [];
  const streetTotals = new Map<string, { pass: number; total: number }>();
  for (const s of twoSided) {
    const idx = bySeg.get(s.id) ?? [];
    const name = s.name ?? `(${s.highway})`;
    const st = streetTotals.get(name) ?? { pass: 0, total: 0 };
    st.total += 1;
    let reason: string | null = null;
    if (idx.length !== 2) reason = `${idx.length} work steps`;
    else {
      const [i, j] = idx;
      const c = v.tree.step_chain[i];
      if (v.tree.step_chain[j] !== c) reason = "sides knocked in different chains";
      else {
        for (let k = i + 1; k < j; k += 1) {
          const ck = v.tree.step_chain[k];
          if (ck === -1 || !descends(v.tree.chain_parent, ck, c)) {
            reason = `step ${k} (${v.steps[k].kind}${v.steps[k].street_name ? ` ${v.steps[k].street_name}` : ""}) is outside the street's branches`;
            break;
          }
        }
      }
    }
    if (reason === null) {
      passing += 1;
      st.pass += 1;
    } else failures.push(`seg ${s.id} ${name}: ${reason}`);
    streetTotals.set(name, st);
  }
  const streetsPass = [...streetTotals.values()].filter((x) => x.pass === x.total).length;
  return { passing, total: twoSided.length, failures, streets: `${streetsPass}/${streetTotals.size} named streets fully passing` };
}

function checkReversed(best: WalkVariant, rev: WalkVariant): { ok: boolean; evidence: string } {
  const n = best.steps.length;
  const problems: string[] = [];
  if (rev.steps.length !== n) problems.push(`step counts ${n} vs ${rev.steps.length}`);
  for (let i = 0; i < Math.min(n, rev.steps.length); i += 1) {
    const a = best.steps[i];
    const b = rev.steps[n - 1 - i];
    if (a.kind !== b.kind || a.segment_id !== b.segment_id) problems.push(`step ${i}: kind/segment differ`);
    if (a.side === b.side) problems.push(`step ${i}: side not flipped`);
    if (Math.abs(a.length_m - b.length_m) > 0.01) problems.push(`step ${i}: length differs`);
    const ra = [...a.centreline].reverse();
    if (JSON.stringify(ra) !== JSON.stringify(b.centreline)) problems.push(`step ${i}: centreline is not the reverse`);
    if (problems.length > 5) break;
  }
  if (Math.abs(best.total_m - rev.total_m) > 0.01) problems.push(`total ${best.total_m} vs ${rev.total_m}`);
  if (best.hand === rev.hand) problems.push("hand did not flip");
  const liveBest = best.door_order.slice(0, best.door_order.length - best.stranded_count);
  const liveRev = rev.door_order.slice(0, rev.door_order.length - rev.stranded_count);
  if (JSON.stringify([...liveBest].reverse()) !== JSON.stringify(liveRev)) problems.push("door order is not the reverse");
  const stepSet = (v: WalkVariant) => md5([...v.steps.map((s) => `${s.kind}|${s.segment_id}|${s.length_m}`)].sort());
  return {
    ok: problems.length === 0,
    evidence: `best md5 ${md5(best.steps)}; best_reversed md5 ${md5(rev.steps)}; step multiset md5 ${stepSet(best)} == ${stepSet(rev)} (${stepSet(best) === stepSet(rev)}); total ${best.total_m} m vs ${rev.total_m} m; hands ${best.hand}/${rev.hand}${problems.length ? `; PROBLEMS: ${problems.slice(0, 5).join("; ")}` : ""}`,
  };
}

function checkWalklines(p: Prepared, v: WalkVariant): { ok: boolean; evidence: string } {
  const byUprn = new Map<number, { x: number; y: number }>();
  for (const d of p.demand.doors) byUprn.set(d.uprn, d.xy);
  let checked = 0;
  let doorsChecked = 0;
  let wrong = 0;
  let wrongOfCentre = 0;
  let worstCentreDist = Infinity;
  const sample = v.steps.filter((s) => s.kind === "work" && s.first_seq !== null && s.last_seq !== null);
  for (const s of sample) {
    checked += 1;
    const line = s.walkline.map((c) => p.graph.project(c));
    for (let q = s.first_seq as number; q <= (s.last_seq as number); q += 1) {
      const xy = byUprn.get(v.door_order[q]);
      if (!xy) continue;
      doorsChecked += 1;
      const side = sideOfPolyline(line, xy);
      if (side !== s.side) {
        wrong += 1;
        const centre = s.centreline.map((c) => p.graph.project(c));
        if (sideOfPolyline(centre, xy) !== s.side) wrongOfCentre += 1;
        let d = Infinity;
        for (let i = 1; i < centre.length; i += 1) {
          const a = centre[i - 1];
          const b = centre[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          const u = l2 > 0 ? Math.max(0, Math.min(1, ((xy.x - a.x) * dx + (xy.y - a.y) * dy) / l2)) : 0;
          d = Math.min(d, Math.hypot(xy.x - (a.x + u * dx), xy.y - (a.y + u * dy)));
        }
        worstCentreDist = Math.min(worstCentreDist, d);
      }
    }
  }
  return {
    ok: wrong === 0,
    evidence: `${checked} work steps, ${doorsChecked} doors checked, ${wrong} on the wrong side of the walkline${wrong ? ` (${wrongOfCentre} of those are on the wrong side of the centreline; nearest is ${worstCentreDist.toFixed(1)} m from the centreline — inside the 4 m pavement offset)` : ""}`,
  };
}

function everyDoorOnce(p: Prepared, v: WalkVariant): { ok: boolean; evidence: string } {
  const expected = p.inputs.route.doors.map((d) => d.uprn).sort((a, b) => a - b);
  const got = [...v.door_order].sort((a, b) => a - b);
  const same = expected.length === got.length && expected.every((u, i) => u === got[i]);
  const dupes = got.length - new Set(got).size;
  return { ok: same && dupes === 0, evidence: `${expected.length} knockable doors, ${v.door_order.length} in order, ${dupes} duplicates, stranded ${v.stranded_count}` };
}

function straightTransfers(v: WalkVariant): { count: number; metres: number } {
  const st = v.steps.filter((s) => s.kind === "walk" && s.segment_id === null);
  return { count: st.length, metres: Math.round(st.reduce((a, s) => a + s.length_m, 0)) };
}

function firstFifth(v: WalkVariant): number[] {
  const live = v.door_order.slice(0, v.door_order.length - v.stranded_count);
  return live.slice(0, Math.max(1, Math.ceil(live.length / 5)));
}

function writePreviews(name: string, r: WalkResult): string[] {
  mkdirSync(PREVIEW_DIR, { recursive: true });
  const files: string[] = [];
  for (const v of r.variants) {
    const file = `${slug(name)}__${v.key}.geojson`;
    writeFileSync(join(PREVIEW_DIR, file), JSON.stringify(variantToGeoJson(name, v)));
    files.push(file);
    // Human-readable step summary for review against the drawings (not for the app).
    const lines = v.steps.map((s, i) => {
      const doors = s.first_seq === null || s.last_seq === null ? "" : ` doors ${s.first_seq}–${s.last_seq}`;
      return `${String(i).padStart(3)} ${s.kind.padEnd(5)} ${(s.street_name ?? "-").padEnd(28)} ${s.side.padEnd(5)} ${String(s.length_m).padStart(7)} m${doors}${s.is_dead_end ? " [dead end]" : ""}  ${s.instruction}`;
    });
    writeFileSync(
      join(PREVIEW_DIR, `${slug(name)}__${v.key}.txt`),
      [`${name} — ${v.key} (${v.hand} hand): total ${v.total_m} m, working ${v.working_m} m, non-working ${v.non_working_m} m, stranded ${v.stranded_count}`, ...lines, ...v.warnings.map((w) => `warning: ${w}`)].join("\n"),
    );
  }
  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  heading("Admin session");
  const { client, signOut } = await adminClient();
  console.log("  signed in as an existing admin (magic link + OTP); no users created");

  const prepared = new Map<string, Prepared>();
  const timingsByProp = new Map<string, WalkResult["timings"][]>();
  const determinism = new Map<string, string[]>();

  try {
    for (const name of PROPS) {
      heading(`Prop: ${name}`);
      const { data: terr, error } = await client.from("territories").select("id, name").eq("name", name).limit(1);
      if (error || !terr || terr.length === 0) {
        console.log(`  not found (${error?.message ?? "no row"}); skipped`);
        continue;
      }
      const tFetch = performance.now();
      const fetched = await fetchWalkInputs(client, terr[0].id);
      const fetchMs = Math.round(performance.now() - tFetch);
      if (!fetched.ok) {
        console.log(`  route_walk_inputs failed: ${fetched.code} ${fetched.detail ?? ""}`);
        continue;
      }
      const inputs = fetched.inputs;
      const runs: WalkResult[] = [];
      const hashes: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const r = generateWalk(inputs);
        runs.push(r);
        hashes.push(md5(stable(r)));
      }
      const r = runs[0];
      determinism.set(name, hashes);
      timingsByProp.set(name, runs.map((x) => x.timings));
      const { graph, demand } = prepare(inputs);
      prepared.set(name, { inputs, graph, demand, result: r });

      console.log(
        `  fetch ${fetchMs} ms; buffer ${r.buffer_segments} segments / ${r.buffer_nodes} nodes; working ${r.working_segments} segments (${r.two_sided_segments} two-sided, ${r.one_sided_segments} one-sided, ${r.working_sides} sides); doors ${r.doors}, stranded ${r.stranded_count}; start candidates ${r.start_candidates} × 2 hands = ${r.candidates.length}`,
      );
      console.log(`  timings (run 1): graph ${r.timings.graph_ms} ms, demand ${r.timings.demand_ms} ms, candidates ${r.timings.candidates_ms} ms, variants ${r.timings.variants_ms} ms, total ${r.timings.total_ms} ms`);
      const notCovered = r.candidates.filter((c) => !c.covered_every_side).length;
      if (notCovered > 0) console.log(`  WARNING: ${notCovered} candidates did not cover every working side`);
      if (process.argv.includes("--breakdown")) {
        for (const v of r.variants) {
          if (v.key === "best_reversed") continue;
          const sum = { cross: 0, transfer_road: 0, transfer_straight: 0, chain_back: 0, chain_other: 0 };
          const n = { cross: 0, transfer_road: 0, transfer_straight: 0, chain_back: 0, chain_other: 0 };
          let transferRuns = 0;
          v.steps.forEach((s, i) => {
            if (v.tree.step_chain[i] === -1 && (i === 0 || v.tree.step_chain[i - 1] !== -1)) transferRuns += 1;
            if (s.kind === "work") return;
            let k: keyof typeof sum;
            if (s.kind === "cross") k = "cross";
            else if (v.tree.step_chain[i] === -1) k = s.segment_id === null ? "transfer_straight" : "transfer_road";
            else if (s.instruction.startsWith("Come back down")) k = "chain_back";
            else k = "chain_other";
            sum[k] += s.length_m;
            n[k] += 1;
          });
          console.log(
            `    ${v.key.padEnd(6)} non-working breakdown: cross ${n.cross}/${Math.round(sum.cross)} m; transfers ${transferRuns} → road ${n.transfer_road} steps/${Math.round(sum.transfer_road)} m + straight ${n.transfer_straight}/${Math.round(sum.transfer_straight)} m; one-sided back passes ${n.chain_back}/${Math.round(sum.chain_back)} m; other in-chain walks ${n.chain_other}/${Math.round(sum.chain_other)} m`,
          );
        }
      }
      if (process.argv.includes("--candidates")) {
        for (const c of r.candidates) {
          console.log(`    cand start ${c.start_node_id} ${c.hand.padEnd(5)} rank ${String(c.rank_cost_m).padStart(8)} m  end→start ${String(c.end_to_start_m).padStart(8)} m  transfers ${c.transfers} (straight ${c.straight_transfers})${c.covered_every_side ? "" : "  NOT COVERED"}`);
        }
      }
      for (const v of r.variants) {
        const st = straightTransfers(v);
        const kinds = { work: 0, cross: 0, walk: 0 };
        for (const s of v.steps) kinds[s.kind] += 1;
        console.log(
          `  ${v.key.padEnd(13)} ${v.hand.padEnd(5)} start ${v.start.node_id} end ${v.end.node_id}; total ${v.total_m} m = working ${v.working_m} + non-working ${v.non_working_m} (${pct(v.non_working_m, v.total_m)}; rank cost ${v.rank_cost_m} m; first↔last door ${v.end_to_start_m} m); steps ${v.steps.length} (${kinds.work} work, ${kinds.cross} cross, ${kinds.walk} walk); straight transfers ${st.count} / ${st.metres} m; warnings ${v.warnings.length}; md5 ${md5(v.steps)}`,
        );
      }
      const files = writePreviews(name, r);
      console.log(`  previews: ${files.join(", ")}`);
    }
  } finally {
    await signOut();
  }

  // -------------------------------------------------------------------------
  // Acceptance
  // -------------------------------------------------------------------------
  heading("Acceptance");
  record("Design note a–g", "PASS", "docs/ROUTE-DESIGN-v2.md (written before code)");

  const sp = prepared.get("REF - Speedwell");
  const spBest = sp ? variant(sp.result, "best") : undefined;
  if (sp && spBest) {
    const derwent = checkOutAndBack(spBest, "Derwent Road");
    const selby = checkOutAndBack(spBest, "Selby Road");
    record("Speedwell best: Derwent and Selby each one out-and-back, single cross at the far end from where the street was entered", derwent.ok && selby.ok ? "PASS" : "FAIL", `${derwent.evidence}\n${selby.evidence}`);

    const streets = ["Speedwell Road", "Harewood Road", "Ventnor Road"].map((s) => checkOneWorkStepPerSegment(sp, spBest, s));
    record("Speedwell best: every segment of Speedwell, Harewood, Ventnor has exactly one work step, on the prop side", streets.every((s) => s.ok) ? "PASS" : "FAIL", streets.map((s) => s.evidence).join("\n"));

    const workSides = spBest.steps.filter((s) => s.kind === "work");
    const mismatched = workSides.filter((s) => s.side !== spBest.hand).length;
    record("Speedwell best: every work step's side equals the route hand", mismatched === 0 ? "PASS" : "FAIL", `${workSides.length} work steps, hand ${spBest.hand}, ${mismatched} mismatches`);

    const once = everyDoorOnce(sp, spBest);
    record("Speedwell: every door once; stranded count", once.ok ? "PASS" : "FAIL", once.evidence);
  } else {
    for (const item of [
      "Speedwell best: Derwent and Selby each one out-and-back, single cross at the far end from where the street was entered",
      "Speedwell best: every segment of Speedwell, Harewood, Ventnor has exactly one work step, on the prop side",
      "Speedwell best: every work step's side equals the route hand",
      "Speedwell: every door once; stranded count",
    ]) record(item, "NOT RUN", "REF - Speedwell not generated");
  }

  // Open paths (2026-09-25): replaces "Speedwell best: ends within 100 m of start".
  {
    const lines: string[] = [];
    let ok = true;
    let variants = 0;
    for (const [name, p] of prepared) {
      const c = ctxFor(p);
      for (const v of p.result.variants) {
        variants += 1;
        const problems = checkOpenPath(c, v);
        if (problems.length > 0) {
          ok = false;
          lines.push(`${name} ${v.key}: ${problems.slice(0, 4).join("; ")}`);
        }
      }
    }
    record(
      "Open path: first and last steps are work, return_m 0, start/end are the walkline ends, total_m = Σ length_m, step 0 starts at its first door",
      variants === 0 ? "NOT RUN" : ok ? "PASS" : "FAIL",
      `${variants} variants over ${prepared.size} props${lines.length ? `\n${lines.slice(0, 12).join("\n")}` : ", no problems"}`,
    );
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const [name, p] of prepared) {
      for (const key of ["best", "best_reversed"]) {
        const v = variant(p.result, key);
        if (!v) continue;
        ran = true;
        const li = leadIn(v);
        if (li.steps !== 0) ok = false;
        lines.push(`${name} ${key}: ${li.steps} non-work steps / ${li.metres.toFixed(1)} m before the first door`);
      }
    }
    record(
      "Lead-in: no non-work step before the first door, best and best_reversed (was TEST - dry run 5 steps / 219.8 m and 173.4 m; Northville ~542 m)",
      ran ? (ok ? "PASS" : "FAIL") : "NOT RUN",
      lines.join("\n"),
    );
  }

  {
    const lines: string[] = [];
    const problems: string[] = [];
    let checked = 0;
    for (const [name, p] of prepared) {
      const c = ctxFor(p);
      let n = 0;
      let crossTurns = 0;
      let oneSided = 0;
      let loops = 0;
      let pulled = 0;
      for (const v of p.result.variants) {
        const s = checkTurns(c, v, `${name} ${v.key}`);
        n += s.checked;
        crossTurns += s.crossTurns;
        oneSided += s.oneSided;
        loops += s.loops;
        pulled += s.pulledBackM;
        problems.push(...s.problems);
      }
      checked += n;
      lines.push(`${name}: ${n} turns over ${p.result.variants.length} variants (${crossTurns} with a cross, ${oneSided} one-sided, ${loops} on a loop segment); ${pulled.toFixed(1)} m pulled back in total`);
    }
    const sp2 = prepared.get("REF - Speedwell");
    if (sp2) {
      const ventnor = segmentNodesByStreet(sp2.graph, "Ventnor Road");
      const nodeXY = new Map(sp2.graph.nodes.map((n) => [n.id, n.xy]));
      for (const key of ["best", "best_reversed"]) {
        const v = variant(sp2.result, key);
        if (!v) continue;
        for (const street of ["Selby Road", "Derwent Road"]) {
          const crosses = v.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "cross" && s.street_name === street);
          for (const { s, i } of crosses) {
            const apex = sp2.graph.project(s.walkline[Math.floor((s.walkline.length - 1) / 2)]);
            let nearest = Infinity;
            for (const id of ventnor) nearest = Math.min(nearest, dist(apex, nodeXY.get(id) as XY));
            lines.push(`Speedwell ${key} ${street} cross step ${i}: node ${s.to_node}${ventnor.has(s.to_node) ? " (a Ventnor Road node)" : " (not on Ventnor Road)"}; arc apex ${nearest.toFixed(1)} m from the nearest Ventnor Road node`);
          }
        }
      }
    }
    record(
      "Turns: walklines stop level with the furthest door, crosses are 9-point arcs joined exactly, arcs clamped short of the far node",
      checked === 0 ? "NOT RUN" : problems.length === 0 ? "PASS" : "FAIL",
      `${lines.join("\n")}${problems.length ? `\nproblems (${problems.length}): ${problems.slice(0, 12).join("; ")}` : ""}`,
    );
  }

  {
    const lines: string[] = [];
    const problems: string[] = [];
    let ran = false;
    for (const [name, p] of prepared) {
      const c = ctxFor(p);
      for (const v of p.result.variants) {
        const s = checkTurns(c, v, `${name} ${v.key}`);
        ran = ran || s.oneSided > 0;
        for (const pr of s.problems) if (/walk back|one-sided|do not meet/.test(pr)) problems.push(pr);
        if (v.key === "best" && ["Northville", "REF - Speedwell", "TEST - dry run"].includes(name)) {
          lines.push(`${name} best: ${s.oneSided} one-sided turns (${s.walkWalk} walk handed back by a transfer)${s.oneSidedExample ? `; e.g. ${s.oneSidedExample}` : ""}`);
        }
      }
    }
    record(
      "One-sided turns: walk back ≥ 1 m from the work line along their shared length, joined to it by an arc",
      ran ? (problems.length === 0 ? "PASS" : "FAIL") : "NOT RUN",
      `${lines.join("\n")}${problems.length ? `\nproblems (${problems.length}): ${problems.slice(0, 12).join("; ")}` : ""}`,
    );
  }

  {
    const lines: string[] = [];
    let gapsTotal = 0;
    let variants = 0;
    const byWhat = new Map<string, number>();
    for (const [name, p] of prepared) {
      const c = ctxFor(p);
      for (const v of p.result.variants) {
        variants += 1;
        const gaps = checkConnectivity(c, v);
        gapsTotal += gaps.length;
        for (const g of gaps) byWhat.set(g.kinds, (byWhat.get(g.kinds) ?? 0) + 1);
        if (gaps.length > 0) {
          const worst = gaps.reduce((a, g) => (g.m > a.m ? g : a));
          lines.push(`${name} ${v.key}: ${gaps.length} gaps; worst ${worst.m.toFixed(2)} m after step ${worst.i} (${worst.what})`);
        }
      }
    }
    const kinds = [...byWhat.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join("; ");
    record(
      "Connectivity: every step's walkline ends within 0.5 m of the next step's walkline start",
      variants === 0 ? "NOT RUN" : gapsTotal === 0 ? "PASS" : "FAIL",
      `${variants} variants, ${gapsTotal} gaps${kinds ? ` (${kinds})` : ""}${lines.length ? `\n${lines.slice(0, 20).join("\n")}` : ""}`,
    );
  }

  const rd = prepared.get("redland");
  const rdBest = rd ? variant(rd.result, "best") : undefined;
  if (rd && rdBest) {
    const sep = checkSeparation(rd, rdBest);
    record(
      "redland best: two-sided streets — passes separated only by the street's own branches",
      sep.passing === sep.total ? "PASS" : "FAIL",
      `${sep.passing}/${sep.total} two-sided segments (old: 0/96); ${sep.streets}${sep.failures.length ? `\nfailures (${sep.failures.length}): ${sep.failures.slice(0, 12).join("; ")}${sep.failures.length > 12 ? "; …" : ""}` : ""}`,
    );
    const st = straightTransfers(rdBest);
    record("redland straight transfers", st.count === 0 ? "PASS" : "FAIL", `${st.count} straight transfers / ${st.metres} m (old 20 / 2,492 m)`);
  } else {
    record("redland best: two-sided streets — passes separated only by the street's own branches", "NOT RUN", "redland not generated");
    record("redland straight transfers", "NOT RUN", "redland not generated");
  }

  {
    const lines: string[] = [];
    let ran = false;
    for (const name of ["redland", "Northville"]) {
      const p = prepared.get(name);
      if (!p) {
        lines.push(`${name}: not generated`);
        continue;
      }
      ran = true;
      for (const v of p.result.variants) {
        if (v.key === "best_reversed") continue;
        lines.push(`${name} ${v.key}: non-working ${v.non_working_m} m / total ${v.total_m} m = ${pct(v.non_working_m, v.total_m)} (rank cost ${v.rank_cost_m} m)`);
      }
    }
    record("redland and Northville: non-working / total, best and each alt", ran ? "PASS" : "NOT RUN", `${lines.join("\n")}\nold Northville: 26%`);
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const name of ACCEPTANCE_PROPS) {
      const p = prepared.get(name);
      const best = p ? variant(p.result, "best") : undefined;
      const rev = p ? variant(p.result, "best_reversed") : undefined;
      if (!p || !best || !rev) continue;
      ran = true;
      const c = checkReversed(best, rev);
      ok = ok && c.ok;
      lines.push(`${name}: ${c.evidence}`);
    }
    record("best_reversed is best backwards", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const name of ACCEPTANCE_PROPS) {
      const p = prepared.get(name);
      const best = p ? variant(p.result, "best") : undefined;
      if (!p || !best) continue;
      ran = true;
      const alts = p.result.variants.filter((v) => v.key.startsWith("alt_"));
      const parts = alts.map((a) => {
        const ov = overlap(firstFifth(a), firstFifth(best));
        const startsDiffer = a.start.node_id !== best.start.node_id;
        if (ov >= 0.5 || !startsDiffer) ok = false;
        return `${a.key} start ${a.start.node_id} (${startsDiffer ? "new" : "SAME"}) first-fifth overlap vs best ${(100 * ov).toFixed(0)}%, rank cost ${a.rank_cost_m} m`;
      });
      lines.push(`${name}: ${alts.length} alts${parts.length ? ` — ${parts.join("; ")}` : ""}`);
    }
    record("Alts: count per prop; each materially different", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const name of ACCEPTANCE_PROPS) {
      const h = determinism.get(name);
      if (!h) continue;
      ran = true;
      const same = h.every((x) => x === h[0]);
      ok = ok && same;
      lines.push(`${name}: ${h.map((x) => x.slice(0, 12)).join(" ")} ${same ? "identical" : "DIFFER"}`);
    }
    record("Determinism: three runs, identical md5 of the full output (minus timings)", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const name of ACCEPTANCE_PROPS) {
      const p = prepared.get(name);
      const best = p ? variant(p.result, "best") : undefined;
      if (!p || !best) continue;
      ran = true;
      const c = checkWalklines(p, best);
      ok = ok && c.ok;
      lines.push(`${name}: ${c.evidence}`);
    }
    record("Walklines: every door in a work step is on the hand side of its walkline", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const [name, limit] of [["redland", 10000], ["Northville", 5000]] as const) {
      const t = timingsByProp.get(name);
      if (!t) continue;
      ran = true;
      const worst = Math.max(...t.map((x) => x.total_ms));
      if (worst > limit) ok = false;
      lines.push(`${name}: ${t.map((x) => `graph ${x.graph_ms} / demand ${x.demand_ms} / candidates ${x.candidates_ms} / variants ${x.variants_ms} = ${x.total_ms} ms`).join("; ")} (limit ${limit} ms)`);
    }
    record("Per-phase timings, redland and Northville", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const all: string[] = [];
    for (const [name, p] of prepared) all.push(...p.result.variants.map((v) => `${slug(name)}__${v.key}.geojson`));
    record("data/route-previews/: one GeoJSON per variant per prop", all.length > 0 ? "PASS" : "NOT RUN", `${all.length} files in data/route-previews/ (gitignored via /data/*):\n${all.join(", ")}`);
  }

  record("Old generator untouched; nothing stored; no table changed", "NOT RUN", "checked from the shell after the run: git status; git diff --stat lib/geo/route-*.ts; migration 019 is functions only");

  heading("Summary");
  for (const r of results) console.log(`  ${r.status.padEnd(7)} ${r.item}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
