/**
 * Stage 5c-b checks that need a database: assignment_member_add, the cap on
 * the clear-left_at path, the double-booking guard, canvasser denial, and a
 * knock sent at an assignment that has been hard-deleted.
 *
 *   npx tsx scripts/verify-stage-5c-b.ts
 *   npx tsx scripts/verify-stage-5c-b.ts --cleanup
 *   npx tsx scripts/verify-stage-5c-b.ts --knocks <assignment-id> <count>
 *
 * Throwaways only. Refuses to start unless the rotation threshold is 50.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { allocateProp } from "../lib/geo/allocate-prop";
import { parseVisitThreshold } from "../lib/geo/reallocation";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import type { Database } from "../lib/supabase/types";
import { sendOp } from "../lib/sync/queue";
import { loadEnvLocal, requiredEnv } from "./lib/env";

loadEnvLocal();

const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "5cb-harness-pw-9k2m";
const EMAIL_PREFIX = "5cb-";
const PROP_A = "5cb throwaway A";
const PROP_B = "5cb throwaway B";
const PROP_UI = "5cb throwaway";

const RING: Ring = [
  [-2.6208, 51.479565],
  [-2.619533, 51.479565],
  [-2.619533, 51.48091],
  [-2.6208, 51.48091],
];

type Client = SupabaseClient<Database>;
type Role = "admin" | "canvasser";

const service: Client = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function line(text = "") {
  console.log(text);
}

function heading(text: string) {
  line();
  line(`── ${text}`);
}

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  line(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

type HarnessUser = { id: string; email: string; name: string; client: Client };

async function createUser(role: Role, label: string, name: string): Promise<HarnessUser> {
  const email = `${EMAIL_PREFIX}${label}-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);

  if (role === "admin") {
    const { error: roleError } = await service.from("profiles").update({ role }).eq("id", data.user.id);
    if (roleError) throw new Error(`promote ${label}: ${roleError.message}`);
  }

  const auth = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } = await auth.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError || !session.session) throw new Error(`signIn ${label}: ${signInError?.message}`);

  const client = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });
  return { id: data.user.id, email, name, client };
}

async function ourUserIds(): Promise<string[]> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.filter((user) => user.email?.startsWith(EMAIL_PREFIX)).map((user) => user.id);
}

async function restoreThreshold() {
  const { error } = await service
    .from("app_settings")
    .update({
      value: { visit_threshold_pct: 50 },
      updated_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("key", "rotation");
  if (error) throw new Error(`restore threshold: ${error.message}`);
}

async function cleanup() {
  heading("cleanup");
  const ids = await ourUserIds();
  const { data: territories } = await service.from("territories").select("id, name").like("name", "5cb throwaway%");
  const territoryIds = (territories ?? []).map((row) => row.id);

  if (territoryIds.length > 0) {
    const { data: assignments } = await service
      .from("assignments")
      .select("id")
      .in("territory_id", territoryIds);
    const assignmentIds = (assignments ?? []).map((row) => row.id);
    if (assignmentIds.length > 0) {
      await service.from("knock_events").delete().in("assignment_id", assignmentIds);
      await service.from("assignments").delete().in("id", assignmentIds);
    }
    await service.from("territories").delete().in("id", territoryIds);
  }

  await restoreThreshold();

  for (const id of ids) {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) line(`  user delete failed ${id.slice(0, 8)}: ${error.message}`);
  }

  const leftUsers = (await ourUserIds()).length;
  const { count: leftProps } = await service
    .from("territories")
    .select("id", { count: "exact", head: true })
    .like("name", "5cb throwaway%");
  line(`  removed ${ids.length} user(s), ${territoryIds.length} prop(s)`);
  line(`  leftover 5cb users ${leftUsers}, leftover 5cb props ${leftProps ?? 0}`);
  const { data: setting } = await service.from("app_settings").select("value").eq("key", "rotation").single();
  const parsed = parseVisitThreshold(setting?.value);
  line(`  threshold now ${parsed.pct} (${parsed.source})`);
}

async function assertThresholdIs50() {
  const { data, error } = await service.from("app_settings").select("value").eq("key", "rotation").single();
  if (error) throw new Error(error.message);
  const parsed = parseVisitThreshold(data.value);
  if (parsed.source !== "setting" || parsed.pct !== 50) {
    throw new Error(`rotation threshold is ${parsed.pct} (${parsed.source}); refusing to run`);
  }
}

async function insertProp(name: string, createdBy: string): Promise<string> {
  const { data, error } = await service
    .from("territories")
    .insert({ name, geom: ringToEwkt(RING), created_by: createdBy })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insert prop: ${error?.message}`);
  return data.id;
}

async function memberState(assignmentId: string, canvasserId: string) {
  const { data, error } = await service
    .from("assignment_members")
    .select("left_at")
    .eq("assignment_id", assignmentId)
    .eq("canvasser_id", canvasserId);
  if (error) throw new Error(error.message);
  const { count, error: countError } = await service
    .from("assignment_members")
    .select("canvasser_id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId)
    .is("left_at", null);
  if (countError) throw new Error(countError.message);
  return { rows: data?.length ?? 0, leftAt: data?.[0]?.left_at ?? null, active: count ?? 0 };
}

async function insertKnocks(assignmentId: string, canvasserId: string, n: number) {
  const { data: territory } = await service
    .from("assignments")
    .select("territory_id, uprn_snapshot")
    .eq("id", assignmentId)
    .single();
  if (!territory) throw new Error("assignment missing");
  const { data: prop } = await service.from("territories").select("name").eq("id", territory.territory_id).single();
  if (!prop?.name.startsWith("5cb throwaway")) throw new Error("refusing to knock a prop that is not a 5cb throwaway");
  const uprns = territory.uprn_snapshot.slice(0, n);
  if (uprns.length < n) throw new Error(`snapshot has ${uprns.length} doors, need ${n}`);
  for (const uprn of uprns) {
    const { error } = await service.from("knock_events").insert({
      id: randomUUID(),
      client_event_id: randomUUID(),
      assignment_id: assignmentId,
      canvasser_id: canvasserId,
      uprn,
      outcome: "no_answer",
      occurred_at: new Date().toISOString(),
      sequence_position: 0,
    });
    if (error) throw new Error(`knock: ${error.message}`);
  }
  line(`  inserted ${n} knocks on ${assignmentId.slice(0, 8)}`);
}

async function counts() {
  const { count: assignments } = await service
    .from("assignments")
    .select("id", { count: "exact", head: true });
  const { count: knocks } = await service.from("knock_events").select("id", { count: "exact", head: true });
  return { assignments: assignments ?? 0, knocks: knocks ?? 0 };
}

async function main() {
  if (process.argv.includes("--cleanup")) {
    await cleanup();
    return;
  }

  const knocksFlag = process.argv.indexOf("--knocks");
  if (knocksFlag !== -1) {
    const assignmentId = process.argv[knocksFlag + 1] ?? "";
    const n = Number(process.argv[knocksFlag + 2]);
    const { data: member } = await service
      .from("assignment_members")
      .select("canvasser_id")
      .eq("assignment_id", assignmentId)
      .is("left_at", null)
      .limit(1);
    const canvasserId = member?.[0]?.canvasser_id;
    if (!canvasserId) throw new Error("no active member on that assignment");
    await insertKnocks(assignmentId, canvasserId, n);
    return;
  }

  await assertThresholdIs50();
  await cleanup();
  const before = await counts();

  heading("fixtures");
  const admin = await createUser("admin", "admin", "5cb Admin");
  const c1 = await createUser("canvasser", "c1", "5cb C1");
  const c2 = await createUser("canvasser", "c2", "5cb C2");
  const c3 = await createUser("canvasser", "c3", "5cb C3");
  const c4 = await createUser("canvasser", "c4", "5cb C4");
  const c5 = await createUser("canvasser", "c5", "5cb C5");
  const propA = await insertProp(PROP_A, admin.id);
  const propB = await insertProp(PROP_B, admin.id);
  line(`  props ${propA.slice(0, 8)} and ${propB.slice(0, 8)}`);

  heading("brand-new member and re-add");
  const first = await allocateProp(admin.client, {
    territoryId: propA,
    workDate: "2099-03-01",
    canvasserIds: [c1.id, c2.id],
  });
  if (!first.ok) throw new Error(first.message);
  const removed = await admin.client.rpc("assignment_member_remove", {
    p_assignment_id: first.allocation.id,
    p_canvasser_id: c2.id,
  });
  check("remove C2 leaves the visit open", !removed.error && removed.data !== null, removed.error?.message);

  const readded = await admin.client.rpc("assignment_member_add", {
    p_assignment_id: first.allocation.id,
    p_canvasser_id: c2.id,
  });
  const readdedRow = readded.data as { action?: string; active_members?: number } | null;
  check(
    "re-add returns readded",
    !readded.error && readdedRow?.action === "readded",
    readded.error?.message ?? readdedRow?.action ?? "",
  );
  const c2State = await memberState(first.allocation.id, c2.id);
  check("re-add cleared left_at and did not duplicate", c2State.rows === 1 && c2State.leftAt === null, `rows ${c2State.rows}`);

  const added = await admin.client.rpc("assignment_member_add", {
    p_assignment_id: first.allocation.id,
    p_canvasser_id: c3.id,
  });
  const addedRow = added.data as { action?: string } | null;
  check("brand-new member returns added", !added.error && addedRow?.action === "added", added.error?.message ?? "");
  const c3State = await memberState(first.allocation.id, c3.id);
  check("brand-new member is one active row", c3State.rows === 1 && c3State.leftAt === null, `rows ${c3State.rows}`);

  const again = await admin.client.rpc("assignment_member_add", {
    p_assignment_id: first.allocation.id,
    p_canvasser_id: c1.id,
  });
  check(
    "already active is an error",
    again.error?.hint === "already_member",
    again.error?.hint ?? again.error?.message ?? "no error",
  );

  heading("cap on the clear-left_at path");
  const trio = await allocateProp(admin.client, {
    territoryId: propA,
    workDate: "2099-03-02",
    canvasserIds: [c1.id, c2.id, c3.id],
  });
  if (!trio.ok) throw new Error(trio.message);
  const dropC3 = await admin.client.rpc("assignment_member_remove", {
    p_assignment_id: trio.allocation.id,
    p_canvasser_id: c3.id,
  });
  check("C3 left the trio", !dropC3.error, dropC3.error?.message);
  const addC4 = await admin.client.rpc("assignment_member_add", {
    p_assignment_id: trio.allocation.id,
    p_canvasser_id: c4.id,
  });
  const addC4Row = addC4.data as { action?: string; active_members?: number } | null;
  check(
    "fourth person fills the team",
    !addC4.error && addC4Row?.action === "added" && addC4Row.active_members === 3,
    addC4.error?.message ?? `active ${addC4Row?.active_members}`,
  );
  const readdC3 = await admin.client.rpc("assignment_member_add", {
    p_assignment_id: trio.allocation.id,
    p_canvasser_id: c3.id,
  });
  check(
    "re-add of a fourth active member is refused",
    readdC3.error?.hint === "team_too_large" && (readdC3.error?.message ?? "").includes("one to three"),
    `${readdC3.error?.code ?? ""} ${readdC3.error?.hint ?? ""} ${readdC3.error?.message ?? "no error"}`,
  );
  const afterCap = await memberState(trio.allocation.id, c3.id);
  check(
    "refused re-add left the row departed and the team at 3",
    afterCap.rows === 1 && afterCap.leftAt !== null && afterCap.active === 3,
    `rows ${afterCap.rows} active ${afterCap.active} left ${afterCap.leftAt ? "set" : "null"}`,
  );

  heading("double booking");
  const booked = await allocateProp(admin.client, {
    territoryId: propB,
    workDate: "2099-03-01",
    canvasserIds: [c1.id],
  });
  check(
    "allocate_prop refuses C1 on the same date",
    !booked.ok && booked.code === "canvasser_double_booked",
    booked.ok ? "allocated" : `${booked.code} ${booked.message}`,
  );
  const host = await allocateProp(admin.client, {
    territoryId: propB,
    workDate: "2099-03-01",
    canvasserIds: [c5.id],
  });
  if (!host.ok) throw new Error(host.message);
  const addBooked = await admin.client.rpc("assignment_member_add", {
    p_assignment_id: host.allocation.id,
    p_canvasser_id: c1.id,
  });
  check(
    "assignment_member_add refuses C1 on the same date",
    addBooked.error?.hint === "canvasser_double_booked",
    addBooked.error?.hint ?? addBooked.error?.message ?? "no error",
  );
  const otherDay = await allocateProp(admin.client, {
    territoryId: propB,
    workDate: "2099-04-02",
    canvasserIds: [c1.id],
  });
  check("a different date is allowed", otherDay.ok, otherDay.ok ? `visit ${otherDay.allocation.visitNumber}` : otherDay.message);

  heading("canvasser denied");
  const denied = await c1.client.rpc("assignment_member_add", {
    p_assignment_id: first.allocation.id,
    p_canvasser_id: c4.id,
  });
  check(
    "canvasser cannot add a member",
    denied.error?.code === "42501" && denied.error?.hint === "not_admin",
    `${denied.error?.code ?? "ok"} ${denied.error?.hint ?? ""}`,
  );

  heading("sync against a deleted assignment");
  const doomed = await allocateProp(admin.client, {
    territoryId: propA,
    workDate: "2099-05-01",
    canvasserIds: [c5.id],
  });
  if (!doomed.ok) throw new Error(doomed.message);
  const { data: snap } = await service
    .from("assignments")
    .select("uprn_snapshot")
    .eq("id", doomed.allocation.id)
    .single();
  const uprn = snap?.uprn_snapshot[0];
  if (uprn === undefined) throw new Error("snapshot empty");
  const removedAssignment = await admin.client.rpc("assignment_remove", {
    p_assignment_id: doomed.allocation.id,
  });
  const removedBody = removedAssignment.data as { action?: string } | null;
  check("0-knock remove deleted the row", !removedAssignment.error && removedBody?.action === "deleted", removedAssignment.error?.message ?? removedBody?.action ?? "");
  const { count: gone } = await service
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("id", doomed.allocation.id);
  check("assignment row is gone", gone === 0, `count ${gone}`);

  const clientEventId = randomUUID();
  const sent = await sendOp(c5.client, {
    kind: "knock_event",
    payload: {
      knock: {
        id: randomUUID(),
        client_event_id: clientEventId,
        assignment_id: doomed.allocation.id,
        canvasser_id: c5.id,
        uprn,
        outcome: "no_answer",
        sequence_position: 0,
        notes: null,
        occurred_at: new Date().toISOString(),
      },
    },
  });
  line(
    `  sendOp outcome ${sent.outcome} step ${sent.step} status ${sent.error?.status ?? "-"} code ${sent.error?.code ?? "-"}`,
  );
  line(`  sendOp message: ${sent.error?.message ?? "-"}`);
  check(
    "deleted-assignment knock is a permanent failure",
    sent.outcome === "permanent" && (sent.error?.status ?? 0) >= 400 && (sent.error?.status ?? 0) < 500,
    sent.outcome,
  );
  const { count: knockLanded } = await service
    .from("knock_events")
    .select("id", { count: "exact", head: true })
    .eq("client_event_id", clientEventId);
  check("the knock was not inserted", knockLanded === 0, `count ${knockLanded}`);

  heading("cleanup after backend");
  await cleanup();
  const after = await counts();
  check("assignment count restored", before.assignments === after.assignments, `${before.assignments} -> ${after.assignments}`);
  check("knock count restored", before.knocks === after.knocks, `${before.knocks} -> ${after.knocks}`);

  if (failures > 0) {
    line();
    line(`${failures} check(s) failed; UI seed skipped`);
    process.exit(1);
  }

  heading("UI seed");
  const uiAdmin = await createUser("admin", "ui-admin", "5cb Admin");
  const ada = await createUser("canvasser", "ada", "5cb Ada");
  const ben = await createUser("canvasser", "ben", "5cb Ben");
  const cy = await createUser("canvasser", "cy", "5cb Cy");
  const uiProp = await insertProp(PROP_UI, uiAdmin.id);
  const seeded = await allocateProp(uiAdmin.client, {
    territoryId: uiProp,
    workDate: "2099-07-01",
    canvasserIds: [ada.id, ben.id],
  });
  if (!seeded.ok) throw new Error(seeded.message);
  await insertKnocks(seeded.allocation.id, ada.id, 5);
  line(`  prop ${PROP_UI} ${uiProp}`);
  line(`  assignment ${seeded.allocation.id} visit ${seeded.allocation.visitNumber} doors ${seeded.allocation.knockableDoors} knocks 5`);
  line(`  admin ${uiAdmin.email}`);
  line(`  password ${PASSWORD}`);
  line(`  canvassers ${ada.name}, ${ben.name}, ${cy.name}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
