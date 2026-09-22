/**
 * Stage 5b (R2) — route storage, freeze on allocation, visit numbering:
 * verification harness.
 *
 * Signs in as the existing admin, canvasser and office users (magic link +
 * OTP, as seed-demo.ts does — no users are created), and checks migration
 * 020's acceptance list against real query results. Every row it creates is
 * a throwaway on a prop with no assignments (default "REF - Speedwell"), plus
 * ONE allocation of redland to prove visit_number = 3, and all of them are
 * deleted in `finally`. redland_test and the DEMO props are never written.
 *
 * What it leaves behind, deliberately: the saved variant set of the test
 * prop in territory_routes / territory_route_steps. That is R2's intended
 * state for a prop and is regenerable.
 *
 * Prints counts, keys and md5s only — never geometries, door orders or steps.
 *
 *   npm run verify:stage5b-r2
 *   npm run verify:stage5b-r2 -- --prop="REF - Speedwell"
 */

import { createHash } from "node:crypto";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import type { Database } from "@/lib/supabase/types";
import { fetchWalkInputs } from "@/lib/geo/walk/inputs";
import { generateWalk } from "@/lib/geo/walk/generate";
import { saveTerritoryRoutes } from "@/lib/geo/walk/save";
import { freezeAssignmentRoute } from "@/lib/geo/walk/freeze";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const argProp = process.argv.find((a) => a.startsWith("--prop="))?.slice("--prop=".length);
const TEST_PROP = argProp?.trim() || "REF - Speedwell";
const REDLAND = "redland";
const NEVER_TOUCH = ["redland_test"];
/** The frozen props whose route_steps must not move. */
const FROZEN_PROPS = [
  "DEMO - Bishopston (Monmouth Road)",
  "DEMO - Clifton (Princess Victoria Street)",
  "DEMO - Southville (Stackpool Road)",
  "Northville",
  "redland",
  "redland_test",
];
/** Far-future dates so no real allocation can collide. */
const DATES = { a: "2027-01-04", b: "2027-01-05", redland: "2027-01-06" };

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
  return createHash("md5").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}
function describe(error: PostgrestError | null | undefined): string {
  if (!error) return "no error";
  return [error.code, error.hint, error.message].filter(Boolean).join(" | ");
}
function must<T>(label: string, r: { data: T; error: PostgrestError | null }): NonNullable<T> {
  if (r.error) throw new Error(`${label}: ${describe(r.error)}`);
  if (r.data === null || r.data === undefined) throw new Error(`${label}: no data`);
  return r.data as NonNullable<T>;
}
/** For writes without `.select()`: data is always null, only the error matters. */
function ok(label: string, r: { error: PostgrestError | null }): void {
  if (r.error) throw new Error(`${label}: ${describe(r.error)}`);
}

// ---------------------------------------------------------------------------
// Sessions (no users created)
// ---------------------------------------------------------------------------

type Session = { client: SupabaseClient<Database>; userId: string; signOut: () => Promise<void> };

async function sessionFor(role: "admin" | "canvasser" | "office"): Promise<Session> {
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, role, active, created_at")
    .eq("role", role)
    .eq("active", true)
    .order("created_at")
    .limit(1);
  if (error || !profiles || profiles.length === 0) throw new Error(`no active ${role} profile: ${error?.message ?? "none"}`);
  const userId = profiles[0].id;
  const { data: userData, error: userError } = await service.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userError || !email) throw new Error(`${role} has no email: ${userError?.message ?? ""}`);
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new Error(`magic link failed for ${role}: ${linkError?.message ?? "no token"}`);
  const client = createClient<Database>(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (verifyError || !verified.session) throw new Error(`verifyOtp failed for ${role}: ${verifyError?.message ?? "no session"}`);
  return {
    client,
    userId,
    signOut: async () => {
      await client.auth.signOut({ scope: "local" });
    },
  };
}

// ---------------------------------------------------------------------------
// Reads (service role — bypasses RLS; used for evidence and cleanup only)
// ---------------------------------------------------------------------------

async function territoryId(name: string): Promise<string> {
  const rows = must(`territory ${name}`, await service.from("territories").select("id").eq("name", name));
  if (rows.length !== 1) throw new Error(`expected exactly one territory named "${name}", found ${rows.length}`);
  return rows[0].id;
}

async function assignmentIds(tid: string): Promise<string[]> {
  return must("assignments", await service.from("assignments").select("id").eq("territory_id", tid)).map((r) => r.id);
}

async function routeStepsFor(tid: string): Promise<number> {
  const ids = await assignmentIds(tid);
  if (ids.length === 0) return 0;
  const { count, error } = await service.from("route_steps").select("id", { count: "exact", head: true }).in("assignment_id", ids);
  if (error) throw new Error(`route_steps count: ${error.message}`);
  return count ?? 0;
}

async function routeStepsByProp(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const name of FROZEN_PROPS) out.set(name, await routeStepsFor(await territoryId(name)));
  return out;
}

async function savedVariants(tid: string): Promise<{ routes: { id: string; variant_key: string; hand: string; door_order: number[]; stranded_count: number }[]; steps: number }> {
  const routes = must(
    "territory_routes",
    await service.from("territory_routes").select("id, variant_key, hand, door_order, stranded_count").eq("territory_id", tid).order("variant_key"),
  );
  const ids = routes.map((r) => r.id);
  let steps = 0;
  if (ids.length > 0) {
    const { count, error } = await service.from("territory_route_steps").select("id", { count: "exact", head: true }).in("route_id", ids);
    if (error) throw new Error(`territory_route_steps count: ${error.message}`);
    steps = count ?? 0;
  }
  return { routes: routes.map((r) => ({ ...r, door_order: (r.door_order ?? []).map(Number) })), steps };
}

type AssignmentRow = {
  id: string;
  visit_number: number;
  route_variant_key: string | null;
  route_source_id: string | null;
  route_length_m: number | null;
  route_stranded_count: number;
  uprn_snapshot: number[];
};

async function assignmentRow(id: string): Promise<AssignmentRow> {
  const row = must(
    `assignment ${id}`,
    await service
      .from("assignments")
      .select("id, visit_number, route_variant_key, route_source_id, route_length_m, route_stranded_count, uprn_snapshot")
      .eq("id", id)
      .single(),
  );
  return { ...row, route_length_m: row.route_length_m === null ? null : Number(row.route_length_m), uprn_snapshot: (row.uprn_snapshot ?? []).map(Number) };
}

async function routeStepRows(assignmentId: string) {
  return must(
    "route_steps rows",
    await service
      .from("route_steps")
      .select("step_index, kind, side, is_spur, is_dead_end, cumulative_m, first_seq, last_seq, walk_geom, geom")
      .eq("assignment_id", assignmentId)
      .order("step_index"),
  );
}

async function allocate(admin: SupabaseClient<Database>, tid: string, date: string, team: string[]) {
  const { data, error } = await admin.rpc("allocate_prop", { territory_id: tid, work_date: date, canvasser_ids: team });
  if (error) throw new Error(`allocate_prop: ${describe(error)}`);
  const row = Array.isArray(data) ? data[0] : (data as unknown as { id: string; visit_number: number } | null);
  if (!row) throw new Error("allocate_prop returned no row");
  return row as { id: string; visit_number: number; knockable_doors: number };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const created = { assignments: new Set<string>(), knocks: new Set<string>() };

async function cleanup(): Promise<string[]> {
  const notes: string[] = [];
  if (created.knocks.size > 0) {
    const { count, error } = await service.from("knock_events").delete({ count: "exact" }).in("id", [...created.knocks]);
    notes.push(error ? `knock_events delete FAILED: ${error.message}` : `knock_events deleted ${count ?? 0}`);
  }
  if (created.assignments.size > 0) {
    const ids = [...created.assignments];
    const steps = await service.from("route_steps").delete({ count: "exact" }).in("assignment_id", ids);
    notes.push(steps.error ? `route_steps delete FAILED: ${steps.error.message}` : `route_steps deleted ${steps.count ?? 0}`);
    const members = await service.from("assignment_members").delete({ count: "exact" }).in("assignment_id", ids);
    notes.push(members.error ? `assignment_members delete FAILED: ${members.error.message}` : `assignment_members deleted ${members.count ?? 0}`);
    const asg = await service.from("assignments").delete({ count: "exact" }).in("id", ids);
    notes.push(asg.error ? `assignments delete FAILED: ${asg.error.message}` : `assignments deleted ${asg.count ?? 0}`);
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Stage 5b-R2 verification — test prop "${TEST_PROP}", redland allocation date ${DATES.redland}`);

  const sessions: Session[] = [];
  let baseline: Map<string, number> | null = null;

  try {
    heading("Guard rails");
    const testTid = await territoryId(TEST_PROP);
    const redlandTid = await territoryId(REDLAND);
    if (NEVER_TOUCH.includes(TEST_PROP) || TEST_PROP.startsWith("DEMO - ") || TEST_PROP === REDLAND) {
      throw new Error(`"${TEST_PROP}" is protected; pick a prop with no assignments.`);
    }
    const existing = await assignmentIds(testTid);
    if (existing.length > 0) throw new Error(`"${TEST_PROP}" already has ${existing.length} assignments; this harness needs a prop with none.`);
    const redlandBefore = must("redland assignments", await service.from("assignments").select("id, work_date, visit_number").eq("territory_id", redlandTid).order("work_date"));
    console.log(`  ${TEST_PROP}: 0 assignments. redland: ${redlandBefore.length} assignments, visit numbers ${redlandBefore.map((r) => r.visit_number).join(",")}`);

    heading("Baseline route_steps per frozen prop");
    baseline = await routeStepsByProp();
    for (const [name, n] of baseline) console.log(`  ${name.padEnd(44)} ${n}`);

    heading("Sessions");
    const admin = await sessionFor("admin");
    sessions.push(admin);
    const canvasser = await sessionFor("canvasser");
    sessions.push(canvasser);
    const office = await sessionFor("office");
    sessions.push(office);
    console.log(`  admin ${admin.userId}, canvasser ${canvasser.userId}, office ${office.userId}`);
    const team = [canvasser.userId];

    // -----------------------------------------------------------------------
    heading("1. Save variants twice: stored, reloadable, replaced not duplicated");
    const inputs = await fetchWalkInputs(admin.client, testTid);
    if (!inputs.ok) throw new Error(`route_walk_inputs: ${inputs.message} ${inputs.detail ?? ""}`);
    const generated = generateWalk(inputs.inputs);

    const save1 = await saveTerritoryRoutes(admin.client, testTid);
    if (!save1.ok) throw new Error(`save 1: ${save1.code} ${save1.message} ${save1.detail ?? ""}`);
    const after1 = await savedVariants(testTid);
    const save2 = await saveTerritoryRoutes(admin.client, testTid);
    if (!save2.ok) throw new Error(`save 2: ${save2.code} ${save2.message} ${save2.detail ?? ""}`);
    const after2 = await savedVariants(testTid);

    const ids1 = new Set(after1.routes.map((r) => r.id));
    const idsReplaced = after2.routes.every((r) => !ids1.has(r.id));
    const genSteps = generated.variants.reduce((n, v) => n + v.steps.length, 0);
    const genBest = generated.variants.find((v) => v.key === "best");
    const storedBest = after2.routes.find((r) => r.variant_key === "best");
    const reloadMatches =
      !!genBest && !!storedBest && md5(genBest.door_order) === md5(storedBest.door_order) && storedBest.hand === genBest.hand && storedBest.stranded_count === genBest.stranded_count;

    // Reload through the admin's own session (RLS applies), not the service role.
    const adminReload = must(
      "admin reload",
      await admin.client.from("territory_routes").select("variant_key, door_order").eq("territory_id", testTid),
    );

    const ok1 =
      after1.routes.length === generated.variants.length &&
      after2.routes.length === generated.variants.length &&
      after1.steps === genSteps &&
      after2.steps === genSteps &&
      idsReplaced &&
      reloadMatches &&
      adminReload.length === generated.variants.length;
    record(
      "A real territory's variants are stored and reloadable; saving twice replaces rather than duplicates",
      ok1 ? "PASS" : "FAIL",
      `${TEST_PROP}: generator ${generated.variants.length} variants / ${genSteps} steps / ${generated.doors} doors.\n` +
        `after save 1: territory_routes ${after1.routes.length}, territory_route_steps ${after1.steps}; ` +
        `after save 2: territory_routes ${after2.routes.length}, territory_route_steps ${after2.steps}; ` +
        `every row id replaced: ${idsReplaced}.\n` +
        `keys: ${after2.routes.map((r) => r.variant_key).join(", ")}. ` +
        `best door_order md5 generator ${genBest ? md5(genBest.door_order) : "-"} = stored ${storedBest ? md5(storedBest.door_order) : "-"}; ` +
        `hand ${storedBest?.hand}, stranded ${storedBest?.stranded_count}. Admin-session reload: ${adminReload.length} rows.`,
    );

    // -----------------------------------------------------------------------
    heading("2. Freeze with no variant_key: parity picks best / best_reversed");
    const a = await allocate(admin.client, testTid, DATES.a, team);
    created.assignments.add(a.id);
    const b = await allocate(admin.client, testTid, DATES.b, team);
    created.assignments.add(b.id);

    const fa = await freezeAssignmentRoute(admin.client, a.id);
    const fb = await freezeAssignmentRoute(admin.client, b.id);
    if (!fa.ok) throw new Error(`freeze A: ${fa.code} ${fa.message} ${fa.detail ?? ""}`);
    if (!fb.ok) throw new Error(`freeze B: ${fb.code} ${fb.message} ${fb.detail ?? ""}`);

    const rowA = await assignmentRow(a.id);
    const rowB = await assignmentRow(b.id);
    const bestRow = after2.routes.find((r) => r.variant_key === "best");
    const revRow = after2.routes.find((r) => r.variant_key === "best_reversed");
    const stepsA = await routeStepRows(a.id);
    const stepsB = await routeStepRows(b.id);
    const genRev = generated.variants.find((v) => v.key === "best_reversed");

    // Derived columns on the new rows.
    const spurOk = [...stepsA, ...stepsB].every((s) => s.is_spur === (s.kind === "work" && s.is_dead_end));
    let cumOk = true;
    for (const rows of [stepsA, stepsB]) {
      let prev = -1;
      for (const s of rows) {
        const c = Number(s.cumulative_m);
        if (!(c >= prev)) cumOk = false;
        prev = c;
        if (!s.kind || !s.side || !s.walk_geom || !s.geom) cumOk = false;
      }
    }
    const lastCumA = stepsA.length ? Number(stepsA[stepsA.length - 1].cumulative_m) : NaN;
    const lengthMatchesA = rowA.route_length_m !== null && Math.abs(lastCumA - rowA.route_length_m) < 0.01;

    const ok2 =
      rowA.visit_number === 1 &&
      rowB.visit_number === 2 &&
      rowA.route_variant_key === "best" &&
      rowB.route_variant_key === "best_reversed" &&
      rowA.route_source_id === bestRow?.id &&
      rowB.route_source_id === revRow?.id &&
      !!genBest &&
      !!genRev &&
      md5(rowA.uprn_snapshot) === md5(genBest.door_order) &&
      md5(rowB.uprn_snapshot) === md5(genRev.door_order) &&
      stepsA.length === genBest.steps.length &&
      stepsB.length === genRev.steps.length &&
      spurOk &&
      cumOk &&
      lengthMatchesA;
    record(
      "Freezing with no variant_key picks best / best_reversed by visit_number parity (re-queried from assignments)",
      ok2 ? "PASS" : "FAIL",
      `A (${DATES.a}): visit_number ${rowA.visit_number}, route_variant_key ${rowA.route_variant_key}, route_source_id = saved best row: ${rowA.route_source_id === bestRow?.id}, ` +
        `uprn_snapshot md5 ${md5(rowA.uprn_snapshot)} = best door_order ${genBest ? md5(genBest.door_order) : "-"}, route_steps ${stepsA.length} (variant has ${genBest?.steps.length}), ` +
        `route_length_m ${rowA.route_length_m} = last cumulative_m ${lastCumA.toFixed(2)}: ${lengthMatchesA}.\n` +
        `B (${DATES.b}): visit_number ${rowB.visit_number}, route_variant_key ${rowB.route_variant_key}, route_source_id = saved best_reversed row: ${rowB.route_source_id === revRow?.id}, ` +
        `uprn_snapshot md5 ${md5(rowB.uprn_snapshot)} = best_reversed door_order ${genRev ? md5(genRev.door_order) : "-"}, route_steps ${stepsB.length} (variant has ${genRev?.steps.length}).\n` +
        `new rows: is_spur = (kind='work' and is_dead_end) on every row: ${spurOk}; kind/side/walk_geom/geom non-null and cumulative_m non-decreasing: ${cumOk}.`,
    );

    // -----------------------------------------------------------------------
    heading("3. Freeze rejects an assignment with knocks");
    const knockUprn = rowA.uprn_snapshot[0];
    const knock = must(
      "throwaway knock",
      await service
        .from("knock_events")
        .insert({
          client_event_id: `verify-5b-r2-${Date.now()}`,
          assignment_id: a.id,
          canvasser_id: canvasser.userId,
          uprn: knockUprn,
          outcome: "no_answer",
          sequence_position: 0,
          occurred_at: new Date().toISOString(),
        })
        .select("id")
        .single(),
    );
    created.knocks.add(knock.id);
    const refrozen = await freezeAssignmentRoute(admin.client, a.id, "best_reversed");
    const rowA2 = await assignmentRow(a.id);
    const stepsA2 = await routeStepRows(a.id);
    const ok3 =
      !refrozen.ok &&
      refrozen.code === "frozen" &&
      rowA2.route_variant_key === "best" &&
      stepsA2.length === stepsA.length &&
      md5(rowA2.uprn_snapshot) === md5(rowA.uprn_snapshot);
    record(
      "Freeze rejects an assignment that already has knocks (throwaway assignment, not redland_test)",
      ok3 ? "PASS" : "FAIL",
      `A given 1 knock_event, then assignment_route_freeze(A, 'best_reversed'): ${refrozen.ok ? "SUCCEEDED (wrong)" : `refused, code ${refrozen.code}: "${refrozen.message}"`}.\n` +
        `A re-queried: route_variant_key ${rowA2.route_variant_key}, route_steps ${stepsA2.length}, uprn_snapshot md5 ${md5(rowA2.uprn_snapshot)} (was ${md5(rowA.uprn_snapshot)}).`,
    );

    // -----------------------------------------------------------------------
    heading("4. Freeze rejects a door-set mismatch");
    const shortened = rowB.uprn_snapshot.slice(0, -1);
    ok("shorten B snapshot", await service.from("assignments").update({ uprn_snapshot: shortened }).eq("id", b.id));
    const mismatch = await freezeAssignmentRoute(admin.client, b.id);
    const rowB2 = await assignmentRow(b.id);
    const stepsB2 = await routeStepRows(b.id);
    // Swapped door set, same size: replace the last door with one that is not in the prop.
    const inProp = new Set(rowB.uprn_snapshot);
    const candidates = must("foreign uprn candidates", await service.from("properties").select("uprn").order("uprn").limit(200));
    const foreign = candidates.map((p) => Number(p.uprn)).find((u) => !inProp.has(u));
    if (foreign === undefined) throw new Error("could not find a UPRN outside the prop");
    const swapped = [...rowB.uprn_snapshot.slice(0, -1), foreign];
    ok("swap B snapshot", await service.from("assignments").update({ uprn_snapshot: swapped }).eq("id", b.id));
    const mismatch2 = await freezeAssignmentRoute(admin.client, b.id);
    const ok4 =
      !mismatch.ok && mismatch.code === "snapshot_mismatch" && !mismatch2.ok && mismatch2.code === "snapshot_mismatch" && rowB2.route_variant_key === "best_reversed" && stepsB2.length === stepsB.length;
    record(
      "Freeze rejects a door-set mismatch",
      ok4 ? "PASS" : "FAIL",
      `B's uprn_snapshot cut from ${rowB.uprn_snapshot.length} to ${shortened.length} doors → freeze: ${mismatch.ok ? "SUCCEEDED (wrong)" : `refused, code ${mismatch.code}: "${mismatch.message}"`}.\n` +
        `B's uprn_snapshot same size, one door swapped for a UPRN outside the prop → freeze: ${mismatch2.ok ? "SUCCEEDED (wrong)" : `refused, code ${mismatch2.code}`}.\n` +
        `B re-queried after the first refusal: route_variant_key ${rowB2.route_variant_key}, route_steps ${stepsB2.length} (unchanged from ${stepsB.length}).`,
    );

    // -----------------------------------------------------------------------
    heading("5. redland visit_number = 3 from history");
    const r3 = await allocate(admin.client, redlandTid, DATES.redland, team);
    created.assignments.add(r3.id);
    const r3row = await assignmentRow(r3.id);
    const redlandAfter = must("redland assignments", await service.from("assignments").select("id, work_date, visit_number").eq("territory_id", redlandTid).order("work_date"));
    const untouched = redlandBefore.every((before) => redlandAfter.some((after) => after.id === before.id && after.visit_number === before.visit_number && after.work_date === before.work_date));
    const ok5 = r3row.visit_number === 3 && r3row.route_variant_key === null && untouched;
    record(
      "redland visit_number bug fixed: a new allocation gets visit_number = 3",
      ok5 ? "PASS" : "FAIL",
      `redland before: ${redlandBefore.map((r) => `${r.work_date} v${r.visit_number}`).join(", ")}. ` +
        `allocate_prop(redland, ${DATES.redland}) → assignment ${r3.id.slice(0, 8)}…, visit_number ${r3row.visit_number} (re-queried), ${r3.knockable_doors} doors, not frozen (route_variant_key ${r3row.route_variant_key}). ` +
        `Existing two rows unchanged: ${untouched}. The test allocation is deleted in cleanup below; the two real rows keep visit_number 1 (existing data is not rewritten).`,
    );

    // -----------------------------------------------------------------------
    heading("6. RLS: canvasser and office JWTs");
    const svcRoutes = (await savedVariants(testTid)).routes.length;
    const cRoutes = await canvasser.client.from("territory_routes").select("id", { count: "exact", head: true });
    const cSteps = await canvasser.client.from("territory_route_steps").select("id", { count: "exact", head: true });
    const cSave = await canvasser.client.rpc("territory_routes_save", { p_territory_id: testTid, p_variants: [] });
    const cFreeze = await canvasser.client.rpc("assignment_route_freeze", { p_assignment_id: a.id });
    const cInsert = await canvasser.client.from("territory_routes").insert({
      territory_id: testTid,
      variant_key: "alt_99",
      hand: "right",
      start_node_id: 1,
      end_node_id: 2,
      start_geom: "SRID=4326;POINT(-2.55 51.47)",
      end_geom: "SRID=4326;POINT(-2.55 51.47)",
      total_m: 1,
      working_m: 1,
      non_working_m: 0,
      rank_cost_m: 0,
      end_to_start_m: 0,
      stranded_count: 0,
      door_order: [1],
    } as never);

    const oRouteSteps = await office.client.from("route_steps").select("id", { count: "exact", head: true });
    const svcRouteSteps = await service.from("route_steps").select("id", { count: "exact", head: true });
    const oRoutes = await office.client.from("territory_routes").select("id", { count: "exact", head: true });
    const oSteps = await office.client.from("territory_route_steps").select("id", { count: "exact", head: true });

    const canvasserDenied =
      (cRoutes.count ?? -1) === 0 &&
      (cSteps.count ?? -1) === 0 &&
      !!cSave.error &&
      cSave.error.code === "42501" &&
      !!cFreeze.error &&
      cFreeze.error.code === "42501" &&
      !!cInsert.error;
    const officeShape = (oRouteSteps.count ?? -1) > 0 && oRouteSteps.count === svcRouteSteps.count && (oRoutes.count ?? -1) === 0 && (oSteps.count ?? -1) === 0;
    record(
      "RLS: canvasser JWT reads nothing from territory_routes / territory_route_steps; office JWT reads route_steps but not territory_routes",
      canvasserDenied && officeShape && svcRoutes > 0 ? "PASS" : "FAIL",
      `service role sees territory_routes for ${TEST_PROP}: ${svcRoutes} rows.\n` +
        `canvasser: territory_routes count ${cRoutes.count} (${describe(cRoutes.error)}); territory_route_steps count ${cSteps.count} (${describe(cSteps.error)}); ` +
        `territory_routes_save → ${describe(cSave.error)}; assignment_route_freeze → ${describe(cFreeze.error)}; direct insert → ${describe(cInsert.error)}.\n` +
        `office: route_steps count ${oRouteSteps.count} (service role ${svcRouteSteps.count}); territory_routes count ${oRoutes.count} (${describe(oRoutes.error)}); territory_route_steps count ${oSteps.count}.`,
    );
  } finally {
    heading("Cleanup");
    const notes = await cleanup();
    for (const n of notes) console.log(`  ${n}`);
    for (const s of sessions) {
      await s.signOut();
    }
    console.log(`  ${sessions.length} sessions signed out (scope local).`);

    if (baseline) {
      heading("7. route_steps per frozen prop, before vs after");
      const after = await routeStepsByProp();
      let same = true;
      const lines: string[] = [];
      for (const [name, before] of baseline) {
        const now = after.get(name) ?? -1;
        if (now !== before) same = false;
        lines.push(`${name}: ${before} → ${now}`);
      }
      record("route_steps row counts for the five frozen props + redland_test unchanged", same ? "PASS" : "FAIL", lines.join("; "));
    }

    heading("Summary");
    for (const r of results) console.log(`  ${r.status.padEnd(7)} ${r.item}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
