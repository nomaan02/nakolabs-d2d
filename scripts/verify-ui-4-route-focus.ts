/**
 * UI item 4 — route line focus.
 *
 *   npm run verify:ui4
 *   npx tsx scripts/verify-ui-4-route-focus.ts --fixture
 *   npx tsx scripts/verify-ui-4-route-focus.ts --cleanup
 *
 * Default is read-only. --fixture copies REF - Speedwell's polygon into a
 * throwaway prop. --cleanup removes only ui4- rows. Real props are not written.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { allocateProp } from "../lib/geo/allocate-prop";
import { londonDate } from "../lib/field/london-date";
import { freezeAssignmentRoute } from "../lib/geo/walk/freeze";
import { saveTerritoryRoutes } from "../lib/geo/walk/save";
import { ROUTE_TIER_COLOURS, routeValidationStyle, toRoutePaintModel, type RouteStepInput } from "../lib/map/route-layers";
import {
  computeRouteTiers,
  legLengthsM,
  routeLegs,
  type ProgressStep,
  type RouteTier,
  type RouteTiers,
} from "../lib/map/route-progress";
import type { Database } from "../lib/supabase/types";
import { loadEnvLocal, requiredEnv } from "./lib/env";

loadEnvLocal();

const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "ui4-harness-pw-9k24";
const TERRITORY_NAME = "UI4 ROUTE FOCUS — DELETE ME";
const EMAIL_PREFIX = "ui4-";
const SOURCE_PROP = "REF - Speedwell";
const SPEEDWELL = "0512c982-bd97-4745-be5a-0d9791585e6f";
const DRY_RUN = "0d48a75b-b01b-4bdd-abee-79b4740523c9";
const PROTECTED_ASSIGNMENTS = [
  SPEEDWELL,
  "e318dd39-7c34-46ea-9452-5041de560a02",
  DRY_RUN,
  "df71b74d-7fdc-4c47-abe0-54832b42eb06",
] as const;
const EXPECTED_TOTALS = {
  knock_events: 936,
  assignments: 26,
  users: 4,
  territories: 17,
} as const;
const EXPECTED_TEST_KNOCKS = 17;
const STATE_PATH = path.join(tmpdir(), "nakolabs-d2d-ui4.json");

const FIXTURE = process.argv.includes("--fixture");
const CLEANUP = process.argv.includes("--cleanup");

type Client = SupabaseClient<Database>;

const service: Client = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function line(text = "") {
  console.log(text);
}

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  line(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

function seq(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n += 1) out.push(n);
  return out;
}

function same(actual: number[], expected: number[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function ofTier(tiers: RouteTiers, tier: RouteTier): number[] {
  return [...tiers.entries()]
    .filter(([, value]) => value === tier)
    .map(([index]) => index)
    .sort((a, b) => a - b);
}

type StepRow = {
  step_index: number;
  kind: string | null;
  street_name: string | null;
  first_seq: number | null;
  last_seq: number | null;
  walk_geom?: unknown;
  walkline?: unknown;
};

async function loadSteps(assignmentId: string): Promise<StepRow[]> {
  const { data, error } = await service
    .from("route_steps")
    .select("step_index, kind, street_name, first_seq, last_seq, walk_geom")
    .eq("assignment_id", assignmentId)
    .order("step_index", { ascending: true });
  if (error) throw new Error(`${assignmentId} route_steps: ${error.message}`);
  return data ?? [];
}

function directSteps(rows: StepRow[]): ProgressStep[] {
  return rows.map((row) => ({
    stepIndex: row.step_index,
    kind: row.kind ?? "",
    street: row.street_name,
    firstSeq: row.first_seq,
    lastSeq: row.last_seq,
  }));
}

function modelSteps(rows: StepRow[], geometry: "walk_geom" | "walkline"): ProgressStep[] {
  const input: RouteStepInput[] = rows.map((row) => ({
    step_index: row.step_index,
    kind: row.kind,
    street_name: row.street_name,
    first_seq: row.first_seq,
    last_seq: row.last_seq,
    walk_geom: geometry === "walk_geom" ? row.walk_geom : undefined,
    walkline: geometry === "walkline" ? row.walkline : undefined,
    variant_key: "route",
  }));
  return toRoutePaintModel({ steps: input, variantKey: "route" }).steps.map((step) => ({
    stepIndex: step.stepIndex,
    kind: step.kind,
    street: step.street,
    firstSeq: step.firstSeq,
    lastSeq: step.lastSeq,
    variantKey: step.variantKey,
    walk: step.walk,
  }));
}

async function acceptance(): Promise<void> {
  line("UI 4 route focus — read-only asserts");
  line(`  londonDate() = ${londonDate()} (allocation date; compare with timezone('Europe/London', now()))`);

  const speedwellRows = await loadSteps(SPEEDWELL);
  const dryRows = await loadSteps(DRY_RUN);
  const speedwellDirect = directSteps(speedwellRows);
  const speedwellModel = modelSteps(speedwellRows, "walk_geom");
  const dryDirect = directSteps(dryRows);
  const dryModel = modelSteps(dryRows, "walk_geom");

  const speedwellLegs = routeLegs(speedwellDirect);
  const dryLegs = routeLegs(dryDirect);
  const expectedLegs = [
    [0, 1, 2],
    [3],
    [4],
    [5, 6],
    [7, 8],
    [9, 10, 11],
    [12],
    [13],
    [14, 15],
    [16],
  ];
  line(`  Speedwell legs: ${JSON.stringify(speedwellLegs)}`);
  line(`  Speedwell model legs: ${JSON.stringify(routeLegs(speedwellModel))}`);
  check(
    "Speedwell has 10 legs",
    same(speedwellLegs.flat(), expectedLegs.flat()) &&
      speedwellLegs.length === 10 &&
      expectedLegs.every((leg, index) => same(speedwellLegs[index] ?? [], leg)),
    `${speedwellLegs.length} legs`,
  );
  check(
    "Speedwell direct and paint-model legs match",
    JSON.stringify(speedwellLegs) === JSON.stringify(routeLegs(speedwellModel)),
  );

  line(`  dry run legs: ${JSON.stringify(dryLegs)}`);
  line(`  dry run leg 1: ${JSON.stringify(dryLegs[1] ?? [])}`);
  check("dry run has 13 legs", dryLegs.length === 13, `${dryLegs.length} legs`);
  check("dry run leg 1 is steps 1 to 6", same(dryLegs[1] ?? [], [1, 2, 3, 4, 5, 6]), JSON.stringify(dryLegs[1] ?? []));
  check(
    "dry run direct and paint-model legs match",
    JSON.stringify(dryLegs) === JSON.stringify(routeLegs(dryModel)),
  );

  const cases: { label: string; position: number | null; done: number[]; focus: number[]; near: number[]; far: number[] }[] = [
    { label: "0", position: 0, done: [], focus: seq(0, 3), near: [4], far: seq(5, 16) },
    { label: "8", position: 8, done: [0], focus: seq(1, 3), near: [4], far: seq(5, 16) },
    { label: "30", position: 30, done: seq(0, 3), focus: seq(4, 6), near: seq(7, 8), far: seq(9, 16) },
    { label: "150", position: 150, done: seq(0, 14), focus: seq(15, 16), near: [], far: [] },
    { label: "181", position: 181, done: seq(0, 15), focus: [16], near: [], far: [] },
    { label: "null", position: null, done: seq(0, 16), focus: [], near: [], far: [] },
  ];

  for (const item of cases) {
    const tiers = computeRouteTiers(speedwellDirect, item.position);
    if (!tiers) {
      check(`Speedwell pos ${item.label}`, false, "returned null");
      continue;
    }
    const done = ofTier(tiers, "done");
    const focus = ofTier(tiers, "focus");
    const near = ofTier(tiers, "near");
    const far = ofTier(tiers, "far");
    line(
      `  pos ${item.label}: done ${JSON.stringify(done)} focus ${JSON.stringify(focus)} near ${JSON.stringify(near)} far ${JSON.stringify(far)}`,
    );
    check(
      `Speedwell tiers at ${item.label}`,
      same(done, item.done) && same(focus, item.focus) && same(near, item.near) && same(far, item.far),
    );
  }

  const undefinedTiers = computeRouteTiers(speedwellDirect, undefined);
  line(`  pos undefined: ${undefinedTiers === null ? "null" : "not null"}`);
  check("undefined position returns null", undefinedTiers === null);
  check("empty route returns null", computeRouteTiers([], 0) === null);
  check(
    "two variants return null",
    computeRouteTiers(
      [
        { stepIndex: 0, kind: "work", variantKey: "best", firstSeq: 0, lastSeq: 1 },
        { stepIndex: 0, kind: "work", variantKey: "best_reversed", firstSeq: 0, lastSeq: 1 },
      ],
      0,
    ) === null,
  );

  const speedwellPaint = toRoutePaintModel({
    steps: speedwellRows.map((row) => ({
      step_index: row.step_index,
      kind: row.kind,
      walk_geom: row.walk_geom,
      street_name: row.street_name,
      first_seq: row.first_seq,
      last_seq: row.last_seq,
      variant_key: "best_reversed",
    })),
    variantKey: "best_reversed",
  });
  const crossPoints = speedwellPaint.points.filter((point) => point.role !== "start" && point.role !== "end");
  line(`  cross points: ${crossPoints.length}`);
  check("no cross points", crossPoints.length === 0, `points ${speedwellPaint.points.map((point) => point.role).join(",")}`);

  line(`  near ${ROUTE_TIER_COLOURS.near} far ${ROUTE_TIER_COLOURS.far} focus ${ROUTE_TIER_COLOURS.focus} done ${ROUTE_TIER_COLOURS.done}`);
  check("near mix is #dc9476", ROUTE_TIER_COLOURS.near === "#dc9476", ROUTE_TIER_COLOURS.near);
  check("far mix is #e7b9a5", ROUTE_TIER_COLOURS.far === "#e7b9a5", ROUTE_TIER_COLOURS.far);

  await validateStyle();
}

async function validateStyle(): Promise<void> {
  try {
    const spec = await import("@maplibre/maplibre-gl-style-spec");
    const validate = spec.validateStyleMin;
    if (typeof validate !== "function") {
      line("  style spec: validateStyleMin is not a function. Left to the browser check.");
      return;
    }
    const errors = validate(routeValidationStyle() as never) as { message?: string }[];
    if (!Array.isArray(errors)) {
      line("  style spec: validateStyleMin did not return an array. Left to the browser check.");
      return;
    }
    if (errors.length === 0) {
      check("route layer style validates", true, "0 errors");
      return;
    }
    for (const error of errors) line(`  style error: ${error.message ?? JSON.stringify(error)}`);
    const zoom = errors.filter((error) => (error.message ?? "").toLowerCase().includes("zoom"));
    check("route layer style has no nested-zoom errors", zoom.length === 0, `${zoom.length} zoom errors, ${errors.length} total`);
    if (zoom.length === 0 && errors.length > 0) {
      check("route layer style validates", false, `${errors.length} non-zoom errors — see lines above`);
    }
  } catch (err) {
    line(`  style spec: import failed (${err instanceof Error ? err.message : String(err)}). Left to the browser check.`);
  }
}

type Totals = { knock_events: number; assignments: number; users: number; territories: number };

async function headCount(table: "knock_events" | "assignments" | "territories"): Promise<number> {
  const { count, error } = await service.from(table).select("id", { count: "exact", head: true });
  if (error || count === null) throw new Error(`${table} count: ${error?.message ?? "null"}`);
  return count;
}

async function authUserCount(): Promise<number> {
  const users = await listAuthUsers();
  return users.length;
}

async function listAuthUsers() {
  const users: { id: string; email?: string }[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    users.push(...data.users.map((user) => ({ id: user.id, email: user.email })));
    if (data.users.length < 200) break;
  }
  return users;
}

async function totals(): Promise<Totals> {
  return {
    knock_events: await headCount("knock_events"),
    assignments: await headCount("assignments"),
    users: await authUserCount(),
    territories: await headCount("territories"),
  };
}

function totalsMatch(actual: Totals): boolean {
  return (
    actual.knock_events === EXPECTED_TOTALS.knock_events &&
    actual.assignments === EXPECTED_TOTALS.assignments &&
    actual.users === EXPECTED_TOTALS.users &&
    actual.territories === EXPECTED_TOTALS.territories
  );
}

async function countAssignmentRows(table: "route_steps" | "knock_events", assignmentId: string): Promise<number> {
  const { count, error } = await service
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);
  if (error || count === null) throw new Error(`${table} ${assignmentId}: ${error?.message ?? "null"}`);
  return count;
}

async function countLatestKnocks(assignmentId: string): Promise<number> {
  const { count, error } = await service
    .from("v_latest_knock")
    .select("*", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);
  if (error || count === null) throw new Error(`v_latest_knock ${assignmentId}: ${error?.message ?? "null"}`);
  return count;
}

type StateFile = {
  totals: Totals;
  routeSteps: Record<string, number>;
  testKnocks: number;
  assignmentId?: string;
};

async function protectedSnapshots(): Promise<Pick<StateFile, "routeSteps" | "testKnocks">> {
  const routeSteps: Record<string, number> = {};
  for (const id of PROTECTED_ASSIGNMENTS) {
    routeSteps[id] = await countAssignmentRows("route_steps", id);
  }
  const testKnocks = await countAssignmentRows("knock_events", DRY_RUN);
  return { routeSteps, testKnocks };
}

async function mustDelete(label: string, result: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await result;
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function cleanupUi4(): Promise<string[]> {
  line("cleanup ui4");
  const users = (await listAuthUsers()).filter((user) => user.email?.startsWith(EMAIL_PREFIX));
  const userIds = users.map((user) => user.id);
  const { data: territories, error: territoryError } = await service
    .from("territories")
    .select("id")
    .eq("name", TERRITORY_NAME);
  if (territoryError) throw new Error(territoryError.message);
  const territoryIds = (territories ?? []).map((row) => row.id);

  const assignmentIds: string[] = [];
  if (territoryIds.length > 0) {
    const { data: assignments, error } = await service
      .from("assignments")
      .select("id")
      .in("territory_id", territoryIds);
    if (error) throw new Error(error.message);
    assignmentIds.push(...(assignments ?? []).map((row) => row.id));
  }

  if (userIds.length > 0) {
    await mustDelete("leads by canvasser", service.from("leads").delete().in("canvasser_id", userIds));
  }
  if (assignmentIds.length > 0) {
    const { data: knocks, error: knockListError } = await service
      .from("knock_events")
      .select("id")
      .in("assignment_id", assignmentIds);
    if (knockListError) throw new Error(knockListError.message);
    const knockIds = (knocks ?? []).map((row) => row.id);
    if (knockIds.length > 0) {
      await mustDelete("leads by knock", service.from("leads").delete().in("knock_event_id", knockIds));
    }
    await mustDelete(
      "knock_events by assignment",
      service.from("knock_events").delete().in("assignment_id", assignmentIds),
    );
  }
  if (userIds.length > 0) {
    await mustDelete(
      "knock_events by canvasser",
      service.from("knock_events").delete().in("canvasser_id", userIds),
    );
    await mustDelete(
      "property_observations",
      service.from("property_observations").delete().in("canvasser_id", userIds),
    );
    await mustDelete(
      "address_observations",
      service.from("address_observations").delete().in("canvasser_id", userIds),
    );
  }
  if (assignmentIds.length > 0) {
    await mustDelete(
      "assignment_members",
      service.from("assignment_members").delete().in("assignment_id", assignmentIds),
    );
    await mustDelete("route_steps", service.from("route_steps").delete().in("assignment_id", assignmentIds));
    await mustDelete("assignments", service.from("assignments").delete().in("id", assignmentIds));
  }
  if (territoryIds.length > 0) {
    const { data: routes, error: routeError } = await service
      .from("territory_routes")
      .select("id")
      .in("territory_id", territoryIds);
    if (routeError) throw new Error(routeError.message);
    const routeIds = (routes ?? []).map((row) => row.id);
    if (routeIds.length > 0) {
      await mustDelete(
        "territory_route_steps",
        service.from("territory_route_steps").delete().in("route_id", routeIds),
      );
    }
    await mustDelete(
      "territory_routes",
      service.from("territory_routes").delete().in("territory_id", territoryIds),
    );
    await mustDelete("territories", service.from("territories").delete().in("id", territoryIds));
  }
  for (const user of users) {
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`deleteUser ${user.email}: ${error.message}`);
  }
  line(`  removed ${territoryIds.length} territor${territoryIds.length === 1 ? "y" : "ies"}, ${users.length} user(s)`);
  if (assignmentIds.length > 0) {
    for (const id of assignmentIds) line(`  REALTIME_CHECK topic assignment:${id}`);
  }
  return assignmentIds;
}

function firstDoor(steps: ProgressStep[], indexes: number[]): number | null {
  for (const index of indexes) {
    const step = steps.find((row) => row.stepIndex === index && row.kind === "work");
    if (step && typeof step.firstSeq === "number") return step.firstSeq;
  }
  return null;
}

function logsUntilFocus(steps: ProgressStep[], legIndex: number): number | null {
  const legs = routeLegs(steps);
  const members = new Set(legs[legIndex] ?? []);
  let max = 0;
  for (const step of steps) {
    if (typeof step.lastSeq === "number" && step.lastSeq > max) max = step.lastSeq;
  }
  for (let position = 0; position <= max; position += 1) {
    const tiers = computeRouteTiers(steps, position);
    if (!tiers) continue;
    for (const index of members) {
      if (tiers.get(index) === "focus") return position;
    }
  }
  return null;
}

function printLegs(steps: ProgressStep[], lengths: number[]): void {
  const legs = routeLegs(steps);
  legs.forEach((indexes, index) => {
    const work = indexes
      .map((stepIndex) => steps.find((step) => step.stepIndex === stepIndex && step.kind === "work"))
      .filter((step): step is ProgressStep => Boolean(step));
    const seqs = work.flatMap((step) => [step.firstSeq, step.lastSeq]).filter((value): value is number => typeof value === "number");
    const range = seqs.length > 0 ? `${Math.min(...seqs)}-${Math.max(...seqs)}` : "none";
    const metres = lengths[index] ?? 0;
    line(`  leg ${index}: steps [${indexes.join(",")}] seq ${range} ${metres.toFixed(1)} m`);
  });
}

async function variantRows(territoryId: string, variantKey: string): Promise<StepRow[]> {
  const { data: route, error } = await service
    .from("territory_routes")
    .select("id")
    .eq("territory_id", territoryId)
    .eq("variant_key", variantKey)
    .maybeSingle();
  if (error || !route) throw new Error(error?.message ?? `missing ${variantKey}`);
  const { data, error: stepError } = await service
    .from("territory_route_steps")
    .select("step_index, kind, street_name, first_seq, last_seq, walkline")
    .eq("route_id", route.id)
    .order("step_index", { ascending: true });
  if (stepError) throw new Error(stepError.message);
  return data ?? [];
}

async function createFixture(): Promise<void> {
  const actual = await totals();
  line(
    `  protected totals: knock_events ${actual.knock_events}, assignments ${actual.assignments}, auth.users ${actual.users}, territories ${actual.territories}`,
  );
  if (!totalsMatch(actual)) {
    line("  STOP. Protected totals differ from 936 / 26 / 4 / 17. Nothing was created.");
    failures += 1;
    return;
  }

  const before = await protectedSnapshots();
  line(`  REF/TEST route_steps before: ${JSON.stringify(before.routeSteps)}`);
  line(`  TEST knock_events before: ${before.testKnocks}`);
  if (before.testKnocks !== EXPECTED_TEST_KNOCKS) {
    line(`  STOP. TEST - dry run knocks are ${before.testKnocks}, expected ${EXPECTED_TEST_KNOCKS}. Nothing was created.`);
    failures += 1;
    return;
  }
  const state: StateFile = { totals: actual, ...before };
  writeFileSync(STATE_PATH, JSON.stringify(state), "utf8");

  await cleanupUi4();

  const stamp = Date.now().toString(36);
  const adminEmail = `${EMAIL_PREFIX}admin-${stamp}@nakolabs-test.com`;
  const canvasserEmail = `${EMAIL_PREFIX}canvasser-${stamp}@nakolabs-test.com`;

  const adminUser = await service.auth.admin.createUser({
    email: adminEmail,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "UI4 Admin" },
  });
  if (adminUser.error || !adminUser.data.user) throw new Error(adminUser.error?.message ?? "admin user");
  const { error: roleError } = await service
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", adminUser.data.user.id);
  if (roleError) throw new Error(roleError.message);

  const canvasserUser = await service.auth.admin.createUser({
    email: canvasserEmail,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "UI4 Canvasser" },
  });
  if (canvasserUser.error || !canvasserUser.data.user) throw new Error(canvasserUser.error?.message ?? "canvasser user");

  const adminClient = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await adminClient.auth.signInWithPassword({
    email: adminEmail,
    password: PASSWORD,
  });
  if (signInError) throw new Error(signInError.message);

  const source = await service.from("territories").select("geom").eq("name", SOURCE_PROP).maybeSingle();
  if (source.error || !source.data) throw new Error(source.error?.message ?? "REF - Speedwell missing");
  const inserted = await service
    .from("territories")
    .insert({
      name: TERRITORY_NAME,
      geom: source.data.geom,
      created_by: adminUser.data.user.id,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "territory insert");

  const saved = await saveTerritoryRoutes(adminClient, inserted.data.id);
  if (!saved.ok) throw new Error(`${saved.code} ${saved.message} ${saved.detail ?? ""}`);

  const workDate = londonDate();
  line(`  work date ${workDate}`);
  const allocated = await allocateProp(adminClient, {
    territoryId: inserted.data.id,
    workDate,
    canvasserIds: [canvasserUser.data.user.id],
  });
  if (!allocated.ok) throw new Error(`${allocated.code} ${allocated.message}`);
  if (allocated.allocation.visitNumber !== 1) {
    throw new Error(`expected visit 1, got ${allocated.allocation.visitNumber}`);
  }

  const bestRows = await variantRows(inserted.data.id, "best");
  const bestSteps = modelSteps(bestRows, "walkline");
  const bestLegs = routeLegs(bestSteps);
  const logsToLeg2 = firstDoor(bestSteps, bestLegs[1] ?? []);
  if (logsToLeg2 === null) throw new Error("best has no second leg");
  let variant: "best" | "best_reversed" = "best";
  let chosen = bestSteps;
  if (logsToLeg2 > 15) {
    line(`  DEVIATION: best needs ${logsToLeg2} logs; froze best_reversed`);
    variant = "best_reversed";
    chosen = modelSteps(await variantRows(inserted.data.id, "best_reversed"), "walkline");
  }

  const frozen = await freezeAssignmentRoute(adminClient, allocated.allocation.id, variant);
  if (!frozen.ok) throw new Error(`${frozen.code} ${frozen.message}`);

  state.assignmentId = allocated.allocation.id;
  writeFileSync(STATE_PATH, JSON.stringify(state), "utf8");

  const legs = routeLegs(chosen);
  const lengths = legLengthsM(chosen);
  let shortest = 0;
  lengths.forEach((metres, index) => {
    if (metres < (lengths[shortest] ?? Infinity)) shortest = index;
  });
  const focusAt = logsUntilFocus(chosen, shortest);
  const leg2Door = firstDoor(chosen, legs[1] ?? []);

  line("");
  line(`  assignment ${allocated.allocation.id}`);
  line(`  variant ${variant}`);
  line(`  doors ${allocated.allocation.knockableDoors}`);
  printLegs(chosen, lengths);
  line(
    `  shortest leg ${shortest}: steps [${(legs[shortest] ?? []).join(",")}] ${(lengths[shortest] ?? 0).toFixed(1)} m; in focus after ${focusAt} logs (next-door position ${focusAt})`,
  );
  line(`  tier counts at 0 logs: ${tierCount(chosen, 0)}`);
  line(`  tier counts at 3 logs: ${tierCount(chosen, 3)}`);
  line(`  tier counts at first door of leg 2 (position ${leg2Door}): ${leg2Door === null ? "none" : tierCount(chosen, leg2Door)}`);
  line(`  login canvasser ${canvasserEmail}`);
  line(`  login admin ${adminEmail}`);
  line(`  password ${PASSWORD}`);
  line("  Fixture left in place for the browser pass. Run --cleanup in this same session.");
}

function tierCount(steps: ProgressStep[], position: number): string {
  const tiers = computeRouteTiers(steps, position);
  if (!tiers) return "null";
  const done = ofTier(tiers, "done").length;
  const focus = ofTier(tiers, "focus").length;
  const near = ofTier(tiers, "near").length;
  const far = ofTier(tiers, "far").length;
  return `done:${done},focus:${focus},near:${near},far:${far}`;
}

async function finishCleanup(): Promise<void> {
  const assignmentIds = await cleanupUi4();
  const state: StateFile | null = existsSync(STATE_PATH)
    ? (JSON.parse(readFileSync(STATE_PATH, "utf8")) as StateFile)
    : null;
  const after = await totals();
  line(
    `  protected totals after: knock_events ${after.knock_events}, assignments ${after.assignments}, auth.users ${after.users}, territories ${after.territories}`,
  );
  check("protected totals restored", totalsMatch(after), "expected 936 / 26 / 4 / 17");

  const watched = new Set<string>(assignmentIds);
  if (state?.assignmentId) watched.add(state.assignmentId);
  for (const id of watched) {
    const left = await countLatestKnocks(id);
    check(`v_latest_knock has no row for ${id}`, left === 0, String(left));
  }

  const snaps = await protectedSnapshots();
  line(`  REF/TEST route_steps after: ${JSON.stringify(snaps.routeSteps)}`);
  line(`  TEST knock_events after: ${snaps.testKnocks}`);
  if (!state) {
    check("REF/TEST counts compared with the before-file", false, "no state file");
  } else {
    for (const id of PROTECTED_ASSIGNMENTS) {
      check(
        `route_steps unchanged ${id.slice(0, 8)}`,
        snaps.routeSteps[id] === state.routeSteps[id],
        `before ${state.routeSteps[id]} after ${snaps.routeSteps[id]}`,
      );
    }
    check(
      "TEST knocks unchanged",
      snaps.testKnocks === state.testKnocks && snaps.testKnocks === EXPECTED_TEST_KNOCKS,
      `before ${state.testKnocks} after ${snaps.testKnocks}`,
    );
  }
  if (failures === 0 && existsSync(STATE_PATH)) unlinkSync(STATE_PATH);
}

async function main(): Promise<void> {
  if (CLEANUP) {
    await finishCleanup();
  } else {
    await acceptance();
    if (FIXTURE && failures === 0) {
      try {
        await createFixture();
      } catch (err) {
        line(`  fixture failed: ${err instanceof Error ? err.message : String(err)}`);
        failures += 1;
        try {
          await cleanupUi4();
        } catch (cleanupErr) {
          line(`  cleanup after failure also failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
          failures += 1;
        }
      }
    } else if (FIXTURE) {
      line("  --fixture skipped because the read-only asserts failed.");
    }
  }
  line("");
  line(failures === 0 ? "OK" : `FAILED ${failures}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
