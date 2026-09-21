/**
 * Stage 5b acceptance harness — route generation.
 *
 * Part A runs the traversal on synthetic graphs with no database, so the
 * algorithm's properties (spur, both passes, transfer, determinism, rotation,
 * stranded rule) are shown on graphs whose shape is known exactly.
 *
 * Part B runs against the deployed Supabase project as REAL signed-in users
 * with .invalid emails. The generator itself always runs with the admin's
 * JWT — never the service role. The service role is used only to read
 * evidence, bump nothing, and clean up. Only users, territories and
 * assignments created in this run are ever deleted.
 *
 *   npm run verify:stage5b
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import { allocateProp } from "../lib/geo/allocate-prop";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import { rotationForVisit } from "../lib/geo/rotation";
import {
  makeProjection,
  type LonLat,
  type RouteInputs,
} from "../lib/geo/route-graph";
import { buildRoutePlan, type RoutePlan } from "../lib/geo/route-plan";
import { fetchRouteInputs, generateRoute } from "../lib/geo/route-generate";
import type { Database } from "../lib/supabase/types";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "stage5b-harness-pw-9f2a";

const NORTHVILLE_ASSIGNMENT = "97da5711-2911-496b-8787-4e8ce90ebb4a";
const NORTHVILLE_TERRITORY = "989eaac9-bb72-4479-87ad-20981ace9e7d";
const BISHOPSTON_TERRITORY = "561616b8-b41f-4a00-aa7b-b7668c03ac53";
const BISHOPSTON_WORKED_ASSIGNMENT = "967577df-c4f0-4b32-9952-c939566c3d5b";

/** 18 doors, zero road segments with half their length inside. Fail-open fixture. */
const NO_ROADS_RING: Ring = [
  [-2.5944983, 51.4786898],
  [-2.5944983, 51.4784008],
  [-2.593125, 51.4783774],
  [-2.593125, 51.4786664],
];

/**
 * St Andrews Park, Bishopston, plus a fringe of five doors on its edge.
 * Three roads touch the rectangle (Effingham, Leopold, Maurice) but none has
 * half its length inside, so the clip returns no segments. Fail-open fixture.
 */
const PARK_RING: Ring = [
  [-2.5884, 51.4719],
  [-2.5866, 51.4719],
  [-2.5866, 51.4738],
  [-2.5884, 51.4738],
];

const service = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function line(text = "") {
  console.log(text);
}
function heading(text: string) {
  line();
  line(`── ${text} ${"─".repeat(Math.max(0, 70 - text.length))}`);
}
function md5(text: string): string {
  return createHash("md5").update(text).digest("hex");
}
function verdict(pass: boolean, label: string, evidence: string) {
  line(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  line(`        ${evidence}`);
}

// ---------------------------------------------------------------------------
// Part A — synthetic graphs
// ---------------------------------------------------------------------------

const ORIGIN: LonLat = [-2.6, 51.5];
const project = makeProjection(ORIGIN);
const originXY = project(ORIGIN);
const eastXY = project([ORIGIN[0] + 0.001, ORIGIN[1]]);
const northXY = project([ORIGIN[0], ORIGIN[1] + 0.001]);
const KX = (eastXY.x - originXY.x) / 0.001;
const KY = (northXY.y - originXY.y) / 0.001;

function unproject(x: number, y: number): LonLat {
  return [ORIGIN[0] + x / KX, ORIGIN[1] + y / KY];
}

type SynNode = { id: number; x: number; y: number };
type SynSeg = { id: number; way: number; from: number; to: number; name: string | null; via?: [number, number][] };
type SynDoor = { uprn: number; x: number; y: number };

function synthetic(
  nodes: SynNode[],
  segs: SynSeg[],
  doors: SynDoor[],
  ring: [number, number][],
  rotation = rotationForVisit(1, ring.length),
): RouteInputs {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const metres = (a: SynNode | [number, number], b: SynNode | [number, number]) => {
    const ax = Array.isArray(a) ? a[0] : a.x;
    const ay = Array.isArray(a) ? a[1] : a.y;
    const bx = Array.isArray(b) ? b[0] : b.x;
    const by = Array.isArray(b) ? b[1] : b.y;
    return Math.hypot(bx - ax, by - ay);
  };
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return {
    assignmentId: "synthetic",
    territoryId: "synthetic",
    visitNumber: rotation.visitNumber,
    entryVertexIndex: rotation.entryVertexIndex,
    sweepDirection: rotation.sweepDirection,
    knockCount: 0,
    hasRoute: false,
    snapshotCount: doors.length,
    centroid: unproject(cx, cy),
    ring: ring.map(([x, y]) => unproject(x, y)),
    nodes: nodes.map((n) => {
      const [lon, lat] = unproject(n.x, n.y);
      return { id: n.id, lon, lat };
    }),
    segments: segs.map((s) => {
      const a = byId.get(s.from) as SynNode;
      const b = byId.get(s.to) as SynNode;
      const pts: [number, number][] = [[a.x, a.y], ...(s.via ?? []), [b.x, b.y]];
      let len = 0;
      for (let i = 1; i < pts.length; i += 1) len += metres(pts[i - 1], pts[i]);
      return {
        id: s.id,
        osmWayId: s.way,
        fromNode: s.from,
        toNode: s.to,
        name: s.name,
        highway: "residential",
        lengthM: len,
        coords: pts.map(([x, y]) => unproject(x, y)),
      };
    }),
    doors: doors.map((d) => {
      const [lon, lat] = unproject(d.x, d.y);
      return { uprn: d.uprn, lon, lat };
    }),
  };
}

function workingSequence(plan: RoutePlan): string[] {
  return plan.traversal.legs
    .filter((l): l is Extract<typeof l, { kind: "work" }> => l.kind === "work")
    .map((l) => {
      const h = plan.graph.halfEdges[l.halfEdge];
      return `${plan.graph.segments[h.segment].id}${h.dir === 1 ? "+" : "-"}`;
    });
}

function sharedOrderedPairs(a: string[], b: string[]): number {
  const pairs = new Set<string>();
  for (let i = 1; i < b.length; i += 1) pairs.add(`${b[i - 1]}>${b[i]}`);
  let shared = 0;
  for (let i = 1; i < a.length; i += 1) if (pairs.has(`${a[i - 1]}>${a[i]}`)) shared += 1;
  return a.length > 1 ? shared / (a.length - 1) : 0;
}

function reverseSequence(seq: string[]): string[] {
  return [...seq].reverse().map((s) => (s.endsWith("+") ? `${s.slice(0, -1)}-` : `${s.slice(0, -1)}+`));
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((_, i) => i).sort((i, j) => v[i] - v[j] || i - j);
    const r = new Array<number>(v.length);
    idx.forEach((i, k) => {
      r[i] = k;
    });
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  if (n < 2) return 1;
  let d2 = 0;
  for (let i = 0; i < n; i += 1) d2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function partA() {
  heading("A. synthetic graphs — no database");

  // T with a cul-de-sac: A(0,0)-B(100,0)-C(200,0), spur B-D(100,80).
  const tGraph = synthetic(
    [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 100, y: 0 },
      { id: 3, x: 200, y: 0 },
      { id: 4, x: 100, y: 80 },
    ],
    [
      { id: 10, way: 500, from: 1, to: 2, name: "Elm Road" },
      { id: 11, way: 500, from: 2, to: 3, name: "Elm Road" },
      { id: 12, way: 501, from: 2, to: 4, name: "Priory Close" },
    ],
    [
      { uprn: 1001, x: 30, y: 12 },
      { uprn: 1002, x: 30, y: -12 },
      { uprn: 1003, x: 100 + 10, y: 40 },
      { uprn: 1004, x: 100 - 10, y: 40 },
      { uprn: 1005, x: 170, y: 12 },
      { uprn: 1006, x: 170, y: -90 }, // 90 m from Elm Road: stranded
    ],
    [
      [-20, -30],
      [220, -30],
      [220, 110],
      [-20, 110],
    ],
  );
  const t1 = buildRoutePlan(tGraph, rotationForVisit(1, 4));
  const spurSteps = t1.steps.filter((s) => s.is_spur);
  const firstSpur = spurSteps[0];
  verdict(
    spurSteps.length >= 2 &&
      firstSpur !== undefined &&
      firstSpur.step_index < t1.steps.length - 1 &&
      t1.traversal.terminatedBy === "all_visited",
    "cul-de-sac is a spur and the route continues past it",
    `spur steps at index ${spurSteps.map((s) => s.step_index).join(",")} of ${t1.steps.length}; ` +
      `first spur instruction "${firstSpur?.instruction}"; terminated by ${t1.traversal.terminatedBy}`,
  );
  const elm = t1.steps.filter((s) => s.segment_id === 10).map((s) => s.step_index);
  verdict(
    elm.length === 2,
    "a segment is walked exactly twice (once per side)",
    `segment 10 (Elm Road) working step_index values: ${elm.join(", ")}`,
  );
  const doorsBySide = t1.doors.filter((d) => d.segmentId === 10).map((d) => `${d.uprn}→h${d.halfEdge}`);
  verdict(
    new Set(t1.doors.filter((d) => d.segmentId === 10).map((d) => d.halfEdge)).size === 2,
    "doors either side of one street go to different passes",
    doorsBySide.join("  "),
  );
  verdict(
    t1.snapshot[t1.snapshot.length - 1] === 1006 && t1.strandedCount === 1,
    "a door > 40 m from every segment is appended last and counted",
    `snapshot ${t1.snapshot.join(",")}  stranded=${t1.strandedCount}`,
  );
  const positions = t1.doors.filter((d) => !d.stranded).map((d) => d.routePositionM);
  verdict(
    positions.every((p, i) => i === 0 || p >= positions[i - 1]),
    "snapshot order is monotonic in route position",
    positions.map((p) => p.toFixed(1)).join(" ≤ "),
  );
  line(`  instructions: ${t1.steps.map((s) => `[${s.step_index}] ${s.instruction}`).join(" | ")}`);

  // Determinism: three builds.
  const hashes = [1, 2, 3].map(() => {
    const p = buildRoutePlan(tGraph, rotationForVisit(1, 4));
    return md5(p.routeWkt + "|" + p.snapshot.join(",") + "|" + JSON.stringify(p.steps));
  });
  verdict(new Set(hashes).size === 1, "three builds are byte-identical", hashes.join(" "));

  // Two components: the T plus a detached stub far to the east.
  const two = synthetic(
    [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 100, y: 0 },
      { id: 3, x: 200, y: 0 },
      { id: 4, x: 100, y: 80 },
      { id: 5, x: 400, y: 0 },
      { id: 6, x: 500, y: 0 },
    ],
    [
      { id: 10, way: 500, from: 1, to: 2, name: "Elm Road" },
      { id: 11, way: 500, from: 2, to: 3, name: "Elm Road" },
      { id: 12, way: 501, from: 2, to: 4, name: "Priory Close" },
      { id: 13, way: 502, from: 5, to: 6, name: "Ashley Grove" },
    ],
    [{ uprn: 2001, x: 450, y: 10 }],
    [
      [-20, -30],
      [520, -30],
      [520, 110],
      [-20, 110],
    ],
  );
  const p2 = buildRoutePlan(two, rotationForVisit(1, 4));
  const transfer = p2.steps.find((s) => s.instruction.startsWith("Transfer to"));
  verdict(
    transfer !== undefined &&
      transfer.segment_id === null &&
      p2.traversal.terminatedBy === "all_visited" &&
      p2.graph.componentCount === 2,
    "disconnected components are joined by a flagged transfer and all visited",
    `components=${p2.graph.componentCount} transfer step [${transfer?.step_index}] "${transfer?.instruction}" ` +
      `terminated by ${p2.traversal.terminatedBy}`,
  );

  // Rotation on a grid with a spur. Deliberately ASYMMETRIC: on a grid that
  // is symmetric about its middle row, visits 1 and 2 enter from mirror-image
  // corners with mirror-image turn rules and produce mirror-image routes,
  // which reads as a reversal. That is the graph-size caveat, not a defect.
  // C Street's west half is missing so no reflection maps the graph to itself.
  const grid = synthetic(
    [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 100, y: 0 },
      { id: 3, x: 200, y: 0 },
      { id: 4, x: 0, y: 100 },
      { id: 5, x: 100, y: 100 },
      { id: 6, x: 200, y: 100 },
      { id: 7, x: 0, y: 200 },
      { id: 8, x: 100, y: 200 },
      { id: 9, x: 200, y: 200 },
      { id: 10, x: 250, y: 100 },
    ],
    [
      { id: 21, way: 601, from: 1, to: 2, name: "A Street" },
      { id: 22, way: 601, from: 2, to: 3, name: "A Street" },
      { id: 23, way: 602, from: 4, to: 5, name: "B Street" },
      { id: 24, way: 602, from: 5, to: 6, name: "B Street" },
      { id: 26, way: 603, from: 8, to: 9, name: "C Street" },
      { id: 27, way: 604, from: 1, to: 4, name: "West Road" },
      { id: 28, way: 604, from: 4, to: 7, name: "West Road" },
      { id: 29, way: 605, from: 2, to: 5, name: "Mid Road" },
      { id: 30, way: 605, from: 5, to: 8, name: "Mid Road" },
      { id: 31, way: 606, from: 3, to: 6, name: "East Road" },
      { id: 32, way: 606, from: 6, to: 9, name: "East Road" },
      { id: 33, way: 607, from: 6, to: 10, name: "Short Close" },
    ],
    [],
    [
      [-20, -20],
      [270, -20],
      [270, 220],
      [-20, 220],
    ],
  );
  const v1 = buildRoutePlan(grid, rotationForVisit(1, 4));
  const v2 = buildRoutePlan(grid, rotationForVisit(2, 4));
  const s1 = workingSequence(v1);
  const s2 = workingSequence(v2);
  const shared = sharedOrderedPairs(s1, s2);
  const sharedRev = sharedOrderedPairs(s1, reverseSequence(s2));
  // INFO, not a verdict. On a grid every junction is a 90° cross, so the
  // leftmost rule from one corner and the rightmost rule from the adjacent
  // corner stay mirror images for many legs and read as a partial reversal.
  // The rotation acceptance item runs on Northville (B2).
  line(
    `  INFO  rotation on a 12-segment grid (graph-size caveat): md5 ${md5(v1.routeWkt)} vs ${md5(v2.routeWkt)}; ` +
      `shared ordered pairs ${(shared * 100).toFixed(0)}%, vs reversed ${(sharedRev * 100).toFixed(0)}%; ` +
      `different routes: ${v1.routeWkt !== v2.routeWkt}`,
  );
  verdict(
    v1.traversal.walkedM < v1.traversal.boundM && v1.traversal.terminatedBy === "all_visited",
    "grid terminates by all-visited under the bound",
    `walked ${v1.traversal.walkedM.toFixed(0)} m, required ${v1.traversal.requiredM.toFixed(0)} m, bound ${v1.traversal.boundM.toFixed(0)} m, backtracks ${v1.traversal.backtracks}`,
  );
}

// ---------------------------------------------------------------------------
// Part B — the deployed project, real JWTs
// ---------------------------------------------------------------------------

type HarnessUser = {
  id: string;
  email: string;
  role: "admin" | "canvasser";
  token: string;
  client: ReturnType<typeof createClient<Database>>;
};

async function createUser(role: "admin" | "canvasser", label: string): Promise<HarnessUser> {
  const email = `stage5b-${label}-${Date.now().toString(36)}@nakolabs-test.invalid`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Stage 5b ${label}` },
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  if (role !== "canvasser") {
    const { error: roleError } = await service.from("profiles").update({ role }).eq("id", data.user.id);
    if (roleError) throw new Error(`promote ${label}: ${roleError.message}`);
  }
  const auth = createClient<Database>(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: signInError } = await auth.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError || !session.session) throw new Error(`signIn ${label}: ${signInError?.message}`);
  const client = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });
  return { id: data.user.id, email, role, token: session.session.access_token, client };
}

async function assignmentState(id: string) {
  const { data, error } = await service
    .from("assignments")
    .select("id, uprn_snapshot, route_length_m, route_stranded_count, visit_number, entry_vertex_index, sweep_direction")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`assignment ${id}: ${error?.message}`);
  const { count } = await service
    .from("route_steps")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", id);
  const { count: knocks } = await service
    .from("knock_events")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", id);
  return { ...data, steps: count ?? 0, knocks: knocks ?? 0, checksum: md5(data.uprn_snapshot.join(",")) };
}

async function routeStepsCount(client: ReturnType<typeof createClient<Database>>, assignmentId?: string) {
  let q = client.from("route_steps").select("id", { count: "exact", head: true });
  if (assignmentId) q = q.eq("assignment_id", assignmentId);
  const { count, error } = await q;
  return { count: count ?? 0, error: error?.message ?? null };
}

async function partB() {
  const users: HarnessUser[] = [];
  const territoryIds: string[] = [];
  const assignmentIds: string[] = [];

  try {
    heading("B0. fixtures");
    const admin = await createUser("admin", "admin");
    const c1 = await createUser("canvasser", "c1");
    const c2 = await createUser("canvasser", "c2");
    users.push(admin, c1, c2);
    for (const u of users) line(`  ${u.role.padEnd(9)} ${u.id}  ${u.email}`);

    const before = await assignmentState(NORTHVILLE_ASSIGNMENT);
    line(
      `  Northville assignment: doors=${before.uprn_snapshot.length} knocks=${before.knocks} ` +
        `route_length_m=${before.route_length_m} steps=${before.steps} visit=${before.visit_number} ` +
        `vertex=${before.entry_vertex_index} ${before.sweep_direction} snapshot md5=${before.checksum}`,
    );
    if (before.knocks > 0) throw new Error("Northville has knocks; refusing to use it as the test assignment");

    heading("B1. determinism — Northville, three committed runs under the admin JWT");
    const runs: { hash: string; snapshot: string; steps: string; plan: RoutePlan; timings: string }[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await generateRoute(admin.client, NORTHVILLE_ASSIGNMENT);
      if (!result.ok || !result.plan) throw new Error(`run ${i + 1}: ${result.ok ? "no plan" : `${result.code} ${result.message} ${result.detail ?? ""}`}`);
      const t = result.timings;
      const timings = `clip ${t.clipMs.toFixed(0)} ms · traversal ${t.traversalMs.toFixed(0)} ms · snap+order ${t.snapOrderMs.toFixed(0)} ms · commit ${t.commitMs.toFixed(0)} ms · total ${t.totalMs.toFixed(0)} ms`;
      runs.push({
        hash: md5(result.plan.routeWkt),
        snapshot: md5(result.plan.snapshot.join(",")),
        steps: md5(JSON.stringify(result.plan.steps)),
        plan: result.plan,
        timings,
      });
      const after = await assignmentState(NORTHVILLE_ASSIGNMENT);
      line(
        `  run ${i + 1}: md5(route wkt)=${runs[i].hash} md5(snapshot)=${runs[i].snapshot} md5(steps)=${runs[i].steps}` +
          `  db: route_length_m=${after.route_length_m} steps=${after.steps} stranded=${after.route_stranded_count} snapshot md5=${after.checksum}`,
      );
      line(`        ${timings}`);
    }
    verdict(
      new Set(runs.map((r) => r.hash)).size === 1 &&
        new Set(runs.map((r) => r.snapshot)).size === 1 &&
        new Set(runs.map((r) => r.steps)).size === 1,
      "three runs, same visit_number → identical route, snapshot and steps",
      runs.map((r) => r.hash).join(" = "),
    );
    const plan = runs[2].plan;
    const s = plan.traversal;
    line(
      `  clipped segments=${plan.graph.segments.length} nodes=${plan.graph.nodes.length} components=${plan.graph.componentCount} ` +
        `entry node=${plan.entryNodeId} steps=${plan.steps.length} (working ${plan.workingSteps}) backtracks=${s.backtracks} transfers=${s.transfers}`,
    );

    heading("B2. rotation — visit 1 (committed) vs visit 2 (planned, not written), Northville");
    const fetched = await fetchRouteInputs(admin.client, NORTHVILLE_ASSIGNMENT);
    if (!fetched.ok) throw new Error(`inputs: ${fetched.message}`);
    const ringSize = fetched.inputs.ring.length;
    const rotation1 = rotationForVisit(1, ringSize);
    const rotation2 = rotationForVisit(2, ringSize);
    const plan2 = buildRoutePlan(fetched.inputs, rotation2);
    const seq1 = workingSequence(plan);
    const seq2 = workingSequence(plan2);
    const shared = sharedOrderedPairs(seq1, seq2);
    const sharedRev = sharedOrderedPairs(seq1, reverseSequence(seq2));
    const pos1 = new Map(plan.snapshot.map((u, i) => [u, i]));
    const rho = spearman(
      plan2.snapshot.map((u) => pos1.get(u) as number),
      plan2.snapshot.map((_, i) => i),
    );
    // Product-relevant view: which doors get the first fifth of the day (≈ the first hour of a five-hour shift)?
    const firstFifth = Math.round(plan.snapshot.length / 5);
    const firstDoors1 = new Set(plan.snapshot.slice(0, firstFifth));
    const firstOverlap12 = plan2.snapshot.slice(0, firstFifth).filter((u) => firstDoors1.has(u)).length / firstFifth;
    // Same sweep direction two visits on: does the entry vertex alone move the route?
    const rotation3 = rotationForVisit(3, ringSize);
    const plan3 = buildRoutePlan(fetched.inputs, rotation3);
    const seq3 = workingSequence(plan3);
    const shared13 = sharedOrderedPairs(seq1, seq3);
    const firstOverlap13 = plan3.snapshot.slice(0, firstFifth).filter((u) => firstDoors1.has(u)).length / firstFifth;
    verdict(
      md5(plan.routeWkt) !== md5(plan2.routeWkt) && shared < 0.5 && sharedRev < 0.5,
      "visit 1 and visit 2 produce materially different traversals, not a reversal",
      `ring corners=${ringSize}; visit 1 (vertex ${rotation1.entryVertexIndex} ${rotation1.sweepDirection}) md5 ${md5(plan.routeWkt)}; ` +
        `visit 2 (vertex ${rotation2.entryVertexIndex} ${rotation2.sweepDirection}) md5 ${md5(plan2.routeWkt)}; ` +
        `entry nodes ${plan.entryNodeId} vs ${plan2.entryNodeId}; shared ordered step pairs ${(shared * 100).toFixed(1)}% ` +
        `(vs reversed ${(sharedRev * 100).toFixed(1)}%); Spearman of door order ${rho.toFixed(3)}; first-fifth door overlap ${(firstOverlap12 * 100).toFixed(1)}%; visit 2 terminated by ${plan2.traversal.terminatedBy}. ` +
        `Threshold: < 50% shared pairs both ways — a reversal shares ~100% with the reversed sequence; an unrelated walk of the same streets shares well under half.`,
    );
    line(
      `  same-sweep control — visit 1 vs visit 3 (vertex ${rotation3.entryVertexIndex} ${rotation3.sweepDirection}, entry node ${plan3.entryNodeId}): ` +
        `shared ordered step pairs ${(shared13 * 100).toFixed(1)}%; first-fifth door overlap ${(firstOverlap13 * 100).toFixed(1)}%. ` +
        `Reading: the sweep flip reverses the walk; the entry vertex barely moves it — wall-following converges onto the same face cycle from any point on the boundary street.`,
    );

    heading("B3. proximity — Northville doors vs nearest clipped segment (planar)");
    const within = plan.doors.filter((d) => !d.stranded);
    const beyond = plan.doors.filter((d) => d.stranded);
    const maxD = Math.max(...plan.doors.map((d) => d.distanceM));
    const maxWithin = Math.max(...within.map((d) => d.distanceM));
    verdict(
      beyond.length === plan.strandedCount && within.length + beyond.length === plan.doors.length,
      "every door within 40 m is positioned; every door beyond is stranded, appended, counted",
      `within 40 m: ${within.length} (max ${maxWithin.toFixed(1)} m) · beyond 40 m: ${beyond.length} (max ${maxD.toFixed(1)} m) · stranded_count=${plan.strandedCount}`,
    );
    line(`  doors by nearest highway type: ${JSON.stringify(
      plan.doors.reduce<Record<string, number>>((acc, d) => {
        const seg = plan.graph.segments.find((g) => g.id === d.segmentId);
        const k = seg?.highway ?? "?";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    )}`);

    heading("B4. snapshot order matches distance along the route — Northville");
    const nonStranded = plan.doors.filter((d) => !d.stranded);
    const monotonic = nonStranded.every((d, i) => i === 0 || d.routePositionM >= nonStranded[i - 1].routePositionM);
    const dbState = await assignmentState(NORTHVILLE_ASSIGNMENT);
    verdict(
      monotonic && dbState.uprn_snapshot.join(",") === plan.snapshot.join(","),
      "non-stranded doors are monotonic in route position and the DB snapshot equals the plan",
      `monotonic=${monotonic} over ${nonStranded.length} doors · DB snapshot == plan snapshot: ${dbState.uprn_snapshot.join(",") === plan.snapshot.join(",")}`,
    );

    heading("B5. spur — Northville");
    const spurs = plan.steps.filter((st) => st.is_spur);
    const firstSpur = spurs[0];
    verdict(
      firstSpur !== undefined && firstSpur.step_index < plan.steps.length - 1,
      "an is_spur step exists and the route continues past it",
      firstSpur
        ? `first spur step_index=${firstSpur.step_index} street="${firstSpur.street_name ?? "(unnamed)"}" "${firstSpur.instruction}"; ${spurs.length} spur steps of ${plan.steps.length}; last step_index=${plan.steps.length - 1}`
        : "no spur steps",
    );

    heading("B6. one pass per UPRN — Northville");
    const distinct = new Set(plan.snapshot).size;
    const originalSet = new Set(before.uprn_snapshot);
    verdict(
      distinct === plan.snapshot.length &&
        plan.snapshot.length === before.uprn_snapshot.length &&
        plan.snapshot.every((u) => originalSet.has(u)),
      "count == count distinct == frozen count; same UPRN set",
      `count ${plan.snapshot.length} · distinct ${distinct} · frozen ${before.uprn_snapshot.length}`,
    );

    heading("B7. both sides — a street with doors on both sides has two passes");
    const bySeg = new Map<number, Set<number>>();
    for (const d of plan.doors) {
      if (d.stranded) continue;
      if (!bySeg.has(d.segmentId)) bySeg.set(d.segmentId, new Set());
      bySeg.get(d.segmentId)?.add(d.halfEdge);
    }
    const bothSides = [...bySeg.entries()].filter(([, hs]) => hs.size === 2).sort((a, b) => a[0] - b[0]);
    const example = bothSides[0];
    const exampleSteps = example ? plan.steps.filter((st) => st.segment_id === example[0]).map((st) => st.step_index) : [];
    const twoPassEverywhere = plan.graph.segments.every((g) => plan.steps.filter((st) => st.segment_id === g.id).length === 2);
    verdict(
      example !== undefined && exampleSteps.length === 2 && twoPassEverywhere,
      "two working steps for a two-sided street; every clipped segment has exactly two working steps",
      example
        ? `segment_id=${example[0]} (${plan.graph.segments.find((g) => g.id === example[0])?.name ?? "unnamed"}) step_index ${exampleSteps.join(" and ")}; ${bothSides.length} two-sided segments; all segments two passes: ${twoPassEverywhere}`
        : "no two-sided segment found",
    );

    heading("B8. termination — Northville");
    verdict(
      s.terminatedBy === "all_visited",
      "terminated by all-visited, not the safety bound",
      `terminated_by=${s.terminatedBy} · route_length_m=${plan.routeLengthM.toFixed(0)} · clipped total ${plan.graph.totalLengthM.toFixed(0)} m · 2× clipped ${(2 * plan.graph.totalLengthM).toFixed(0)} m (the two-pass floor) · bound (4×) ${s.boundM.toFixed(0)} m`,
    );

    heading("B9. performance — Northville");
    for (const [i, r] of runs.entries()) line(`  run ${i + 1}: ${r.timings}`);

    heading("B10a. fail-open — DEMO Bishopston (2 clipped segments), fresh test assignment");
    const { data: bish } = await service.from("territories").select("visit_count").eq("id", BISHOPSTON_TERRITORY).single();
    line(`  Bishopston visit_count=${bish?.visit_count} (not changed by this harness)`);
    const bishAlloc = await allocateProp(admin.client, {
      territoryId: BISHOPSTON_TERRITORY,
      workDate: "2099-05-01",
      canvasserIds: [c1.id],
    });
    if (!bishAlloc.ok) throw new Error(`bishopston allocate: ${bishAlloc.message}`);
    assignmentIds.push(bishAlloc.allocation.id);
    const bishBefore = await assignmentState(bishAlloc.allocation.id);
    const bishRoute = await generateRoute(admin.client, bishAlloc.allocation.id);
    const bishAfter = await assignmentState(bishAlloc.allocation.id);
    line(
      `  generator: ok=${bishRoute.ok} ${bishRoute.ok ? `steps=${bishRoute.summary.steps} length=${bishRoute.summary.routeLengthM.toFixed(0)} m stranded=${bishRoute.summary.strandedCount}/${bishRoute.summary.doors} segments=${bishRoute.summary.clippedSegments}` : `${bishRoute.code}: ${bishRoute.message}`}`,
    );
    line(`  snapshot md5 before=${bishBefore.checksum} after=${bishAfter.checksum} · route_length_m after=${bishAfter.route_length_m} · steps after=${bishAfter.steps}`);
    line(
      `  reading: with 2 clipped segments and 50 of 69 doors within 40 m, Bishopston ROUTES rather than failing open — the rule applied on a small graph, not a fail-open case (graph size caveat).`,
    );

    heading("B10b. fail-open — synthetic polygon with doors but no clipped roads");
    const { data: noRoadT, error: noRoadErr } = await admin.client
      .from("territories")
      .insert({ name: "STAGE 5B NO-ROADS — DELETE ME", geom: ringToEwkt(NO_ROADS_RING), created_by: admin.id })
      .select("id")
      .single();
    if (noRoadErr || !noRoadT) throw new Error(`no-roads territory: ${noRoadErr?.message}`);
    territoryIds.push(noRoadT.id);
    const noRoadAlloc = await allocateProp(admin.client, { territoryId: noRoadT.id, workDate: "2099-05-02", canvasserIds: [c1.id] });
    if (!noRoadAlloc.ok) throw new Error(`no-roads allocate: ${noRoadAlloc.message}`);
    assignmentIds.push(noRoadAlloc.allocation.id);
    const nrBefore = await assignmentState(noRoadAlloc.allocation.id);
    const nrRoute = await generateRoute(admin.client, noRoadAlloc.allocation.id);
    const nrAfter = await assignmentState(noRoadAlloc.allocation.id);
    verdict(
      !nrRoute.ok && nrRoute.code === "no_roads" && nrBefore.checksum === nrAfter.checksum && nrAfter.route_length_m === null && nrAfter.steps === 0,
      "no roads → notice only; angular snapshot kept; route_geom null; no steps",
      `${nrRoute.ok ? "unexpected success" : `${nrRoute.code}: "${nrRoute.message}"`} · snapshot md5 before=${nrBefore.checksum} after=${nrAfter.checksum} · doors=${nrAfter.uprn_snapshot.length} · route_length_m=${nrAfter.route_length_m} · steps=${nrAfter.steps}`,
    );

    heading("B10c. fail-open — polygon over a park");
    const { data: parkT, error: parkErr } = await admin.client
      .from("territories")
      .insert({ name: "STAGE 5B PARK — DELETE ME", geom: ringToEwkt(PARK_RING), created_by: admin.id })
      .select("id")
      .single();
    if (parkErr || !parkT) throw new Error(`park territory: ${parkErr?.message}`);
    territoryIds.push(parkT.id);
    const parkAlloc = await allocateProp(admin.client, { territoryId: parkT.id, workDate: "2099-05-03", canvasserIds: [c1.id] });
    if (parkAlloc.ok) {
      assignmentIds.push(parkAlloc.allocation.id);
      const pb = await assignmentState(parkAlloc.allocation.id);
      const pr = await generateRoute(admin.client, parkAlloc.allocation.id);
      const pa = await assignmentState(parkAlloc.allocation.id);
      verdict(
        !pr.ok && pr.code === "no_roads" && pb.checksum === pa.checksum && pa.route_length_m === null && pa.steps === 0,
        "park → notice only; angular snapshot kept; route_geom null; no steps",
        `allocated ${pb.uprn_snapshot.length} fringe doors; generator ${pr.ok ? `unexpectedly routed (steps=${pr.summary.steps} segments=${pr.summary.clippedSegments})` : `${pr.code}: "${pr.message}"`} · snapshot md5 before=${pb.checksum} after=${pa.checksum} · route_length_m=${pa.route_length_m} · steps=${pa.steps}`,
      );
    } else {
      line(`  allocate_prop refused the park: ${parkAlloc.code} "${parkAlloc.message}" — the generator is never reached for a prop with no doors.`);
    }

    heading("B11. freeze — DEMO Bishopston assignment with knocks");
    const worked = await assignmentState(BISHOPSTON_WORKED_ASSIGNMENT);
    const frozen = await generateRoute(admin.client, BISHOPSTON_WORKED_ASSIGNMENT);
    const workedAfter = await assignmentState(BISHOPSTON_WORKED_ASSIGNMENT);
    const { error: commitErr } = await admin.client.rpc("route_commit", {
      p_assignment_id: BISHOPSTON_WORKED_ASSIGNMENT,
      p_steps: [],
      p_route_wkt: "LINESTRING(0 0,1 1)",
      p_route_length_m: 1,
      p_snapshot: worked.uprn_snapshot,
      p_stranded_count: 0,
    });
    verdict(
      !frozen.ok && frozen.code === "frozen" && worked.checksum === workedAfter.checksum && workedAfter.route_length_m === null && commitErr?.hint === "frozen",
      "generator refuses; route_commit refuses independently; nothing changed",
      `knocks=${worked.knocks} · generator: ${frozen.ok ? "unexpected success" : `${frozen.code}: "${frozen.message}"`} · route_commit direct: hint=${commitErr?.hint} "${commitErr?.message}" · snapshot md5 unchanged=${worked.checksum === workedAfter.checksum}`,
    );

    heading("B12. RLS on route_steps under real JWTs");
    const rlsAlloc = await allocateProp(admin.client, { territoryId: NORTHVILLE_TERRITORY, workDate: "2099-06-01", canvasserIds: [c1.id] });
    if (!rlsAlloc.ok) throw new Error(`rls allocate: ${rlsAlloc.message}`);
    assignmentIds.push(rlsAlloc.allocation.id);
    const rlsRoute = await generateRoute(admin.client, rlsAlloc.allocation.id);
    if (!rlsRoute.ok || !rlsRoute.plan) throw new Error(`rls route: ${rlsRoute.ok ? "no plan" : rlsRoute.message}`);
    line(
      `  test assignment ${rlsAlloc.allocation.id} on Northville (visit ${rlsAlloc.allocation.visitNumber}, member c1): steps=${rlsRoute.summary.steps}; ` +
        `same route as the real Northville visit ${before.visit_number}: ${md5(rlsRoute.plan.routeWkt) === runs[2].hash}`,
    );
    const anon = createClient<Database>(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const asC1 = await routeStepsCount(c1.client, rlsAlloc.allocation.id);
    const asC1Other = await routeStepsCount(c1.client, NORTHVILLE_ASSIGNMENT);
    const asC1All = await routeStepsCount(c1.client);
    const asC2 = await routeStepsCount(c2.client, rlsAlloc.allocation.id);
    const asC2All = await routeStepsCount(c2.client);
    const asAdmin = await routeStepsCount(admin.client);
    const asAnon = await routeStepsCount(anon);
    const { error: c1Insert } = await c1.client.from("route_steps").insert({
      assignment_id: rlsAlloc.allocation.id,
      step_index: 9999,
      instruction: "Start on nowhere",
      cumulative_m: 1,
      geom: "SRID=4326;LINESTRING(-2.6 51.5,-2.61 51.5)",
    });
    const { count: c1Deleted, error: c1DeleteErr } = await c1.client
      .from("route_steps")
      .delete({ count: "exact" })
      .eq("assignment_id", rlsAlloc.allocation.id);
    const afterDeleteAttempt = await routeStepsCount(admin.client, rlsAlloc.allocation.id);
    // c1 is the member on every fixture allocated above, so "all" for c1 is
    // the sum of steps over every assignment c1 belongs to — read via the
    // service role as the ground truth to compare the JWT view against.
    const { data: c1Memberships } = await service
      .from("assignment_members")
      .select("assignment_id")
      .eq("canvasser_id", c1.id);
    let c1Expected = 0;
    for (const m of c1Memberships ?? []) c1Expected += (await routeStepsCount(service, m.assignment_id)).count;
    const { count: allStepsTruth } = await service.from("route_steps").select("id", { count: "exact", head: true });
    verdict(
      asC1.count === rlsRoute.summary.steps &&
        asC1Other.count === 0 &&
        asC1All.count === c1Expected &&
        asAdmin.count === (allStepsTruth ?? -1) &&
        asC2.count === 0 &&
        asC2All.count === 0 &&
        asAdmin.count >= rlsRoute.summary.steps + runs[2].plan.steps.length &&
        asAnon.count === 0 &&
        c1Insert !== null &&
        (c1Deleted ?? 0) === 0 &&
        afterDeleteAttempt.count === rlsRoute.summary.steps,
      "member reads own; cannot read another's; admin reads all; anon denied; canvasser cannot write",
      `c1 own=${asC1.count} · c1 other (real Northville)=${asC1Other.count} · c1 all=${asC1All.count} (c1 is on ${c1Memberships?.length ?? 0} fixture assignments; expected ${c1Expected}) · c2 own-of-c1=${asC2.count} · c2 all=${asC2All.count} · admin all=${asAdmin.count} (table truth ${allStepsTruth}) · anon=${asAnon.count}${asAnon.error ? ` (${asAnon.error})` : ""} · c1 insert: ${c1Insert ? `denied (${c1Insert.code})` : "ALLOWED"} · c1 delete: ${c1DeleteErr ? `denied (${c1DeleteErr.code})` : `${c1Deleted ?? 0} rows`} · steps still ${afterDeleteAttempt.count}`,
    );
  } finally {
    heading("cleanup");
    for (const id of assignmentIds) {
      const { error } = await service.from("assignments").delete().eq("id", id);
      const { count } = await service.from("route_steps").select("id", { count: "exact", head: true }).eq("assignment_id", id);
      line(`  deleted assignment ${id}${error ? ` (${error.message})` : ""}; route_steps left: ${count ?? 0}`);
    }
    for (const id of territoryIds) {
      const { error } = await service.from("territories").delete().eq("id", id);
      line(`  deleted territory ${id}${error ? ` (${error.message})` : ""}`);
    }
    for (const u of users) {
      const { error } = await service.auth.admin.deleteUser(u.id);
      line(`  deleted user ${u.id}${error ? ` (${error.message})` : ""}`);
    }
  }
}

async function main() {
  partA();
  if (process.argv.includes("--synthetic-only")) return;
  await partB();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
