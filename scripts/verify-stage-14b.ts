/**
 * Stage 14b acceptance harness — schema, RLS, derived coverage, answered rule.
 *
 * Real signed-in JWTs for admin, canvasser and office. The service role is
 * used only for fixtures, verification counts and cleanup.
 *
 *   npm run verify:stage14b
 *   npx tsx scripts/verify-stage-14b.ts --cleanup
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ANSWERED_SQL, isAnsweredOutcome } from "../lib/admin/answered";
import { parseCoveragePayload } from "../lib/admin/coverage";
import { parseDashboardPayload } from "../lib/admin/dashboard";
import { allocateProp } from "../lib/geo/allocate-prop";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import type { Database } from "../lib/supabase/types";
import { loadEnvLocal, requiredEnv } from "./lib/env";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "stage14b-harness-pw-9e22";
const CLEANUP_ONLY = process.argv.includes("--cleanup");
const KEEP = process.argv.includes("--keep");
const TERRITORY_NAME = "STAGE 14B TEST PROP — DELETE ME";
const ARCHIVED_NAME = "STAGE 14B ARCHIVED PROP — DELETE ME";
const EMAIL_PREFIX = "stage14b-";

const STREET: Ring = [
  [-2.5955, 51.4786],
  [-2.5925, 51.4786],
  [-2.5925, 51.4794],
  [-2.5955, 51.4794],
];

type Client = SupabaseClient<Database>;

const service: Client = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function line(text = "") {
  console.log(text);
}

function heading(text: string) {
  line();
  line(`── ${text} ${"─".repeat(Math.max(0, 68 - text.length))}`);
}

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  line(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

type HarnessUser = {
  id: string;
  email: string;
  role: "admin" | "canvasser" | "office";
  client: Client;
};

async function createUser(role: HarnessUser["role"], label: string): Promise<HarnessUser> {
  const email = `${EMAIL_PREFIX}${label}-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Stage 14b ${label}` },
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);

  if (role !== "canvasser") {
    const { error: roleError } = await service
      .from("profiles")
      .update({ role })
      .eq("id", data.user.id);
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

  return { id: data.user.id, email, role, client };
}

async function cleanupAll() {
  heading("cleanup");
  const { data: users, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  const ours = users.users.filter((u) => u.email?.startsWith(EMAIL_PREFIX));
  const ids = ours.map((u) => u.id);

  if (ids.length > 0) {
    await service.from("leads").delete().in("canvasser_id", ids);
    await service.from("knock_events").delete().in("canvasser_id", ids);
  }

  for (const name of [TERRITORY_NAME, ARCHIVED_NAME]) {
    const { data: territories } = await service.from("territories").select("id").eq("name", name);
    for (const t of territories ?? []) {
      const { data: assignments } = await service
        .from("assignments")
        .select("id")
        .eq("territory_id", t.id);
      const assignmentIds = (assignments ?? []).map((row) => row.id);
      if (assignmentIds.length > 0) {
        await service.from("knock_events").delete().in("assignment_id", assignmentIds);
        await service.from("assignment_members").delete().in("assignment_id", assignmentIds);
        await service.from("assignments").delete().in("id", assignmentIds);
      }
      await service.from("territories").delete().eq("id", t.id);
    }
    line(`  removed territories named "${name}"`);
  }

  for (const user of ours) {
    await service.auth.admin.deleteUser(user.id);
  }
  line(`  deleted ${ours.length} harness user(s)`);
}

async function insertKnock(args: {
  assignmentId: string;
  canvasserId: string;
  uprn: number;
  outcome: string;
  occurredAt: string;
}) {
  const { error } = await service.from("knock_events").insert({
    id: randomUUID(),
    client_event_id: `stage14b-${randomUUID()}`,
    assignment_id: args.assignmentId,
    canvasser_id: args.canvasserId,
    uprn: args.uprn,
    outcome: args.outcome,
    occurred_at: args.occurredAt,
    sequence_position: 0,
  });
  if (error) throw new Error(`insert knock: ${error.message}`);
}

async function main() {
  heading("Stage 14b verify");
  if (CLEANUP_ONLY) {
    await cleanupAll();
    return;
  }

  await cleanupAll();

  heading("schema: no coverage table, view is security_invoker");
  const missingTable = await fetch(`${URL_}/rest/v1/coverage?select=id&limit=1`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const missingBody = await missingTable.text();
  check(
    "GET /rest/v1/coverage is not a table",
    missingTable.status >= 400 && /PGRST|does not exist|schema cache/i.test(missingBody),
    `${missingTable.status} ${missingBody.slice(0, 120)}`,
  );

  const serviceRpc = await service.rpc("coverage_map_payload");
  check(
    "service_role cannot EXECUTE coverage_map_payload (grant is authenticated only)",
    Boolean(serviceRpc.error),
    serviceRpc.error?.message ?? "unexpected success",
  );

  let admin: HarnessUser | undefined;
  let canvasser: HarnessUser | undefined;
  let office: HarnessUser | undefined;
  let territoryId: string | undefined;

  try {
    admin = await createUser("admin", "admin");
    canvasser = await createUser("canvasser", "canvasser");
    office = await createUser("office", "office");

    heading("RLS under real JWTs");
    const { data: invokerRows, error: invokerErr } = await admin.client
      .from("v_coverage_latest")
      .select("uprn")
      .limit(1);
    check(
      "admin JWT can SELECT v_coverage_latest",
      !invokerErr,
      invokerErr?.message ?? `${invokerRows?.length ?? 0} row(s) sample`,
    );

    const { data: officeRows, error: officeViewError } = await office.client
      .from("v_coverage_latest")
      .select("uprn");
    check(
      "office JWT can SELECT the view but RLS returns zero rows",
      !officeViewError && (officeRows?.length ?? 0) === 0,
      `${officeViewError?.message ?? "ok"} rows=${officeRows?.length ?? 0}`,
    );

    const { error: canvasserRpc } = await canvasser.client.rpc("coverage_map_payload");
    check(
      "canvasser JWT cannot call coverage_map_payload",
      canvasserRpc?.code === "42501",
      `${canvasserRpc?.code ?? ""} ${canvasserRpc?.message ?? ""}`,
    );

    const { error: officeRpc } = await office.client.rpc("admin_dashboard", { p_stale_weeks: 4 });
    check(
      "office JWT cannot call admin_dashboard",
      Boolean(officeRpc) && officeRpc?.code === "42501",
      `${officeRpc?.code ?? ""} ${officeRpc?.message ?? ""}`,
    );

    heading("admin payload against seeded data");
    const mapRes = await admin.client.rpc("coverage_map_payload");
    check("admin coverage_map_payload succeeds", !mapRes.error, mapRes.error?.message ?? "");
    let payload = mapRes.data ? parseCoveragePayload(mapRes.data) : null;
    check("payload parses", payload !== null, payload ? `${payload.doors.features.length} doors` : "");

    const southville = payload?.props.find((row) => row.name.includes("Southville"));
    check(
      "unfinished seeded prop is present with remaining doors",
      Boolean(southville && southville.remaining > 0),
      southville
        ? `worked ${southville.worked} answered ${southville.answered} remaining ${southville.remaining} of ${southville.knockable}`
        : "Southville missing",
    );

    const archived = payload?.props.some((row) => /redland/i.test(row.name));
    check("archived prop is not on the coverage map", archived === false, archived ? "present" : "absent");

    const dashboardRes = await admin.client.rpc("admin_dashboard", { p_stale_weeks: 4 });
    check("admin admin_dashboard succeeds", !dashboardRes.error, dashboardRes.error?.message ?? "");
    const dashboard = dashboardRes.data ? parseDashboardPayload(dashboardRes.data) : null;
    check(
      "dashboard answered_sql is the canonical expression",
      dashboard?.answered_sql === ANSWERED_SQL,
      dashboard?.answered_sql ?? "",
    );
    check(
      "dashboard has three coverage numbers per prop",
      Boolean(
        dashboard &&
          dashboard.coverage.length > 0 &&
          dashboard.coverage.every(
            (row) =>
              typeof row.worked === "number" &&
              typeof row.answered === "number" &&
              typeof row.remaining === "number",
          ),
      ),
    );
    check(
      "dashboard lead panel has sale/pm/blowout/utc/btc",
      dashboard?.lead_outcomes.map((row) => row.status).join(",") === "sale,pm,blowout,utc,btc",
      dashboard?.lead_outcomes.map((row) => row.status).join(",") ?? "",
    );
    check(
      "archived redland_test is not in last-visit list",
      dashboard?.props_last_visit.every((row) => !/redland/i.test(row.name)) ?? false,
    );

    if (payload && southville) {
      const { data: latest } = await admin.client
        .from("v_coverage_latest")
        .select("uprn, outcome")
        .eq("territory_id", southville.id);
      const worked = latest?.length ?? 0;
      const answered = (latest ?? []).filter((row) => isAnsweredOutcome(row.outcome ?? "")).length;
      check(
        "Southville answered matches outcome NOT IN (no_answer, inaccessible)",
        southville.worked === worked && southville.answered === answered,
        `view worked=${worked} answered=${answered} payload worked=${southville.worked} answered=${southville.answered}`,
      );
    }

    heading("latest-wins: two knocks, newer outcome");
    const { error: terrError } = await service.from("territories").insert({
      name: TERRITORY_NAME,
      geom: ringToEwkt(STREET),
      created_by: admin.id,
    });
    if (terrError) throw new Error(`insert territory: ${terrError.message}`);
    const { data: terr } = await service
      .from("territories")
      .select("id")
      .eq("name", TERRITORY_NAME)
      .single();
    territoryId = terr?.id;
    if (!territoryId) throw new Error("test territory missing");

    const allocated = await allocateProp(admin.client, {
      territoryId,
      workDate: "2026-09-19",
      canvasserIds: [canvasser.id],
    });
    check("allocate test prop", allocated.ok, allocated.ok ? allocated.allocation.id : allocated.message);
    if (!allocated.ok) throw new Error(allocated.message);

    const assignmentId = allocated.allocation.id;
    const { data: asg } = await service
      .from("assignments")
      .select("uprn_snapshot")
      .eq("id", assignmentId)
      .single();
    const uprn = asg?.uprn_snapshot[0];
    check("snapshot has a door", typeof uprn === "number", String(uprn ?? "none"));
    if (typeof uprn !== "number") throw new Error("no snapshot door");

    await insertKnock({
      assignmentId,
      canvasserId: canvasser.id,
      uprn,
      outcome: "no_answer",
      occurredAt: "2026-09-19T09:00:00.000Z",
    });
    await insertKnock({
      assignmentId,
      canvasserId: canvasser.id,
      uprn,
      outcome: "lead",
      occurredAt: "2026-09-19T09:10:00.000Z",
    });

    const { data: latestOne } = await admin.client
      .from("v_latest_knock")
      .select("outcome, occurred_at")
      .eq("assignment_id", assignmentId)
      .eq("uprn", uprn);
    check(
      "v_latest_knock is one row, newer outcome",
      latestOne?.length === 1 && latestOne[0]?.outcome === "lead",
      `${latestOne?.length} ${latestOne?.[0]?.outcome}`,
    );

    const { data: coverageOne } = await admin.client
      .from("v_coverage_latest")
      .select("outcome")
      .eq("uprn", uprn);
    check(
      "v_coverage_latest shows the newer outcome",
      coverageOne?.length === 1 && coverageOne[0]?.outcome === "lead",
      `${coverageOne?.length} ${coverageOne?.[0]?.outcome}`,
    );

    const mapAfter = await admin.client.rpc("coverage_map_payload");
    payload = mapAfter.data ? parseCoveragePayload(mapAfter.data) : null;
    const outcomeRow = payload?.outcomes.find((row) => row.uprn === uprn);
    check(
      "coverage payload feature-state source is the newer outcome, not both",
      outcomeRow?.outcome === "lead",
      outcomeRow?.outcome ?? "missing",
    );
    const feature = payload?.doors.features.find((row) => row.properties.uprn === uprn);
    check(
      "outcome is not baked into the GeoJSON properties",
      Boolean(feature && !("outcome" in feature.properties)),
    );

    heading("archived props stay out of coverage");
    const { data: archTerr, error: archErr } = await service
      .from("territories")
      .insert({
        name: ARCHIVED_NAME,
        geom: ringToEwkt(STREET),
        created_by: admin.id,
      })
      .select("id")
      .single();
    check("inserted a live prop that will be archived", !archErr && Boolean(archTerr?.id), archErr?.message ?? "");
    if (archTerr?.id) {
      const archAlloc = await allocateProp(admin.client, {
        territoryId: archTerr.id,
        workDate: "2026-09-20",
        canvasserIds: [canvasser.id],
      });
      check("allocated the soon-to-be-archived prop", archAlloc.ok, archAlloc.ok ? "" : archAlloc.message);
      const { error: freezeErr } = await service
        .from("territories")
        .update({ archived_at: "2026-09-01T00:00:00.000Z" })
        .eq("id", archTerr.id);
      check("archived it", !freezeErr, freezeErr?.message ?? "");
    }
    const mapArch = await admin.client.rpc("coverage_map_payload");
    const parsedArch = mapArch.data ? parseCoveragePayload(mapArch.data) : null;
    check(
      "archived test prop is absent from coverage props",
      parsedArch?.props.every((row) => row.name !== ARCHIVED_NAME) ?? false,
    );
    const dashArch = await admin.client.rpc("admin_dashboard", { p_stale_weeks: 4 });
    const parsedDash = dashArch.data ? parseDashboardPayload(dashArch.data) : null;
    check(
      "archived test prop is absent from dashboard last-visit",
      parsedDash?.props_last_visit.every((row) => row.name !== ARCHIVED_NAME) ?? false,
    );

    heading("no second copy of coverage");
    check(
      "payload is derived (GeoJSON + outcomes); nothing named coverage is stored",
      payload !== null,
      payload ? `${payload.doors.features.length} doors, ${payload.outcomes.length} outcomes` : "no payload",
    );

    if (KEEP) {
      heading("browser pass");
      line(`  sign in at /login as  ${admin.email}  /  ${PASSWORD}`);
      line("  /admin/coverage  then  /admin/dashboard");
      line("  /admin/coverage?stress=2000  for the 2,000-dot check");
      line("  run with --cleanup when finished.");
    }
  } finally {
    if (!KEEP) await cleanupAll();
    if (territoryId && !KEEP) {
      const { count } = await service
        .from("territories")
        .select("id", { count: "exact", head: true })
        .eq("name", TERRITORY_NAME);
      line(`  territories left named "${TERRITORY_NAME}": ${count ?? 0}`);
    }
  }

  heading("result");
  line(failures === 0 ? "  ALL CHECKS PASSED" : `  ${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
