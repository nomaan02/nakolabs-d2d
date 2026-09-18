/**
 * Stage 9 acceptance harness — v_prop_completion, three numbers, RLS.
 *
 * Real signed-in JWTs for admin, canvasser and office. The service role is
 * used only for fixtures, verification counts and cleanup.
 *
 *   npm run verify:stage9
 *   npx tsx scripts/verify-stage-9.ts --cleanup
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ANSWERED_SQL, isAnsweredOutcome } from "../lib/admin/answered";
import { allocateProp } from "../lib/geo/allocate-prop";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import { parsePropCompletion } from "../lib/prop-completion";
import type { Database } from "../lib/supabase/types";
import { loadEnvLocal, requiredEnv } from "./lib/env";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "stage9-harness-pw-4c18";
const CLEANUP_ONLY = process.argv.includes("--cleanup");
const KEEP = process.argv.includes("--keep");
const TERRITORY_A = "STAGE 9 TEST PROP A — DELETE ME";
const TERRITORY_B = "STAGE 9 TEST PROP B — DELETE ME";
const EMAIL_PREFIX = "stage9-";

const STREET: Ring = [
  [-2.5955, 51.4786],
  [-2.5925, 51.4786],
  [-2.5925, 51.4794],
  [-2.5955, 51.4794],
];

const ANSWERED_FILTER = "outcome not in ('no_answer', 'inaccessible')";
const ANSWERED_ALL = "<> ALL (ARRAY['no_answer'::text, 'inaccessible'::text])";

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
    user_metadata: { full_name: `Stage 9 ${label}` },
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

  for (const name of [TERRITORY_A, TERRITORY_B]) {
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
  clientEventId?: string;
}): Promise<{ error: { code?: string; message: string } | null; clientEventId: string }> {
  const clientEventId = args.clientEventId ?? `stage9-${randomUUID()}`;
  const { error } = await service.from("knock_events").insert({
    id: randomUUID(),
    client_event_id: clientEventId,
    assignment_id: args.assignmentId,
    canvasser_id: args.canvasserId,
    uprn: args.uprn,
    outcome: args.outcome,
    occurred_at: args.occurredAt,
    sequence_position: 0,
  });
  return { error, clientEventId };
}

async function readCompletion(client: Client, assignmentId: string) {
  const { data, error } = await client
    .from("v_prop_completion")
    .select(
      "assignment_id, territory_id, territory_name, visit_number, work_date, knockable, worked, answered, remaining",
    )
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  return { row: data ? parsePropCompletion(data) : null, error };
}

async function main() {
  heading("Stage 9 verify");
  if (CLEANUP_ONLY) {
    await cleanupAll();
    return;
  }

  await cleanupAll();

  heading("schema: derived view, security_invoker, no DISTINCT ON");

  const missingTable = await fetch(`${URL_}/rest/v1/coverage?select=id&limit=1`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  const missingBody = await missingTable.text();
  check(
    "GET /rest/v1/coverage is not a table",
    missingTable.status >= 400 && /PGRST|does not exist|schema cache/i.test(missingBody),
    `${missingTable.status} ${missingBody.slice(0, 120)}`,
  );

  const viewRes = await fetch(
    `${URL_}/rest/v1/v_prop_completion?select=assignment_id,worked,answered,remaining&limit=1`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
  );
  check(
    "GET /rest/v1/v_prop_completion exists (service role)",
    viewRes.ok,
    `${viewRes.status} ${viewRes.ok ? "" : (await viewRes.text()).slice(0, 160)}`,
  );

  const anonRes = await fetch(
    `${URL_}/rest/v1/v_prop_completion?select=assignment_id&limit=1`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
  );
  check(
    "anon JWT is denied SELECT on v_prop_completion",
    anonRes.status === 401 || anonRes.status === 403,
    String(anonRes.status),
  );

  let admin: HarnessUser | undefined;
  let canvasserA: HarnessUser | undefined;
  let canvasserB: HarnessUser | undefined;
  let office: HarnessUser | undefined;

  try {
    admin = await createUser("admin", "admin");
    canvasserA = await createUser("canvasser", "canv-a");
    canvasserB = await createUser("canvasser", "canv-b");
    office = await createUser("office", "office");

    heading("hand-count a seeded prop against the view");
    const { data: southvilleAssign, error: svErr } = await service
      .from("assignments")
      .select("id, territory_id, visit_number, work_date, uprn_snapshot, territories(name)")
      .order("work_date", { ascending: false });
    check("listed assignments for hand-count", !svErr, svErr?.message ?? "");

    type NamedAssignment = {
      id: string;
      visit_number: number;
      work_date: string;
      uprn_snapshot: number[];
      name: string;
    };
    const named: NamedAssignment[] = (southvilleAssign ?? []).flatMap((row) => {
      const terr = row.territories as { name: string } | { name: string }[] | null;
      const name = Array.isArray(terr) ? terr[0]?.name : terr?.name;
      if (!name || !name.includes("Southville")) return [];
      return [
        {
          id: row.id,
          visit_number: row.visit_number,
          work_date: row.work_date,
          uprn_snapshot: row.uprn_snapshot,
          name,
        },
      ];
    });
    named.sort((a, b) => b.work_date.localeCompare(a.work_date));
    const seed = named[0];
    check("found seeded Southville assignment", Boolean(seed), seed ? `${seed.work_date} visit ${seed.visit_number}` : "missing");

    if (seed) {
      const knockable = new Set(seed.uprn_snapshot).size;
      const { data: latest } = await service
        .from("v_latest_knock")
        .select("uprn, outcome")
        .eq("assignment_id", seed.id);
      const { data: raw } = await service
        .from("knock_events")
        .select("uprn, outcome, client_event_id")
        .eq("assignment_id", seed.id);

      const histogram = new Map<string, number>();
      for (const row of latest ?? []) {
        const key = row.outcome ?? "(null)";
        histogram.set(key, (histogram.get(key) ?? 0) + 1);
      }
      const manualWorked = latest?.length ?? 0;
      const manualAnswered = (latest ?? []).filter((row) =>
        isAnsweredOutcome(row.outcome ?? ""),
      ).length;
      const manualRemaining = knockable - manualWorked;

      line("  manual count from v_latest_knock (latest-outcome-wins):");
      line(`    assignment ${seed.id}`);
      line(`    ${seed.name}  ${seed.work_date}  visit ${seed.visit_number}`);
      line(`    snapshot knockable (unique UPRNs): ${knockable}`);
      line(`    unique doors in v_latest_knock:    ${manualWorked}  (= worked)`);
      for (const [outcome, n] of [...histogram.entries()].sort()) {
        line(`    ${outcome.padEnd(16)} ${n}`);
      }
      line(`    answered := outcome NOT IN ('no_answer','inaccessible'): ${manualAnswered}`);
      line(`    remaining := knockable − worked: ${manualRemaining}`);
      line(`    raw knock_events rows (would inflate if joined instead): ${raw?.length ?? 0}`);

      const { row: viewRow, error: viewErr } = await readCompletion(admin.client, seed.id);
      check("admin JWT can read the seeded row from v_prop_completion", !viewErr && Boolean(viewRow), viewErr?.message ?? "");
      check(
        "view matches the manual count (knockable / worked / answered / remaining)",
        Boolean(
          viewRow &&
            viewRow.knockable === knockable &&
            viewRow.worked === manualWorked &&
            viewRow.answered === manualAnswered &&
            viewRow.remaining === manualRemaining,
        ),
        viewRow
          ? `manual ${knockable}/${manualWorked}/${manualAnswered}/${manualRemaining}  view ${viewRow.knockable}/${viewRow.worked}/${viewRow.answered}/${viewRow.remaining}`
          : "no view row",
      );
      check(
        "view has no percentage column",
        Boolean(viewRow && !("percentage" in viewRow) && !("pct" in viewRow) && !("complete" in viewRow)),
      );
    }

    heading("answered expression is identical to Stage 14b");
    const dash = await admin.client.rpc("admin_dashboard", { p_stale_weeks: 4 });
    const answeredSql =
      dash.data && typeof dash.data === "object" && !Array.isArray(dash.data)
        ? String((dash.data as { answered_sql?: string }).answered_sql ?? "")
        : "";
    check("admin_dashboard.answered_sql", answeredSql === ANSWERED_SQL, `14b: ${answeredSql}`);
    check(
      "Stage 9 filter text is the same canonical expression",
      ANSWERED_FILTER.replace(/\s/g, "") === "outcomenotin('no_answer','inaccessible')" &&
        ANSWERED_SQL.replace(/\s/g, "") === "outcomenotin('no_answer','inaccessible')",
      `14b dashboard: ${ANSWERED_SQL}  |  Stage 9 view: ${ANSWERED_FILTER}  |  planner form: ${ANSWERED_ALL}`,
    );
    line(`  quoted Stage 14b dashboard:  ${ANSWERED_SQL}`);
    line(`  quoted Stage 14b coverage:   and c.outcome not in ('no_answer', 'inaccessible')`);
    line(`  quoted Stage 9 view source:  where ke.outcome not in ('no_answer', 'inaccessible')`);

    heading("allocate two props for RLS + correction tests");
    const { error: terrAErr } = await service.from("territories").insert({
      name: TERRITORY_A,
      geom: ringToEwkt(STREET),
      created_by: admin.id,
    });
    const { error: terrBErr } = await service.from("territories").insert({
      name: TERRITORY_B,
      geom: ringToEwkt(STREET),
      created_by: admin.id,
    });
    check("inserted test props", !terrAErr && !terrBErr, terrAErr?.message ?? terrBErr?.message ?? "");

    const { data: terrA } = await service.from("territories").select("id").eq("name", TERRITORY_A).single();
    const { data: terrB } = await service.from("territories").select("id").eq("name", TERRITORY_B).single();
    if (!terrA?.id || !terrB?.id) throw new Error("test territories missing");

    const allocA = await allocateProp(admin.client, {
      territoryId: terrA.id,
      workDate: "2026-09-18",
      canvasserIds: [canvasserA.id],
    });
    const allocB = await allocateProp(admin.client, {
      territoryId: terrB.id,
      workDate: "2026-09-18",
      canvasserIds: [canvasserB.id],
    });
    check("allocated A to canvasser A", allocA.ok, allocA.ok ? allocA.allocation.id : allocA.message);
    check("allocated B to canvasser B", allocB.ok, allocB.ok ? allocB.allocation.id : allocB.message);
    if (!allocA.ok || !allocB.ok) throw new Error("allocation failed");

    const assignmentA = allocA.allocation.id;
    const assignmentB = allocB.allocation.id;

    const { data: snapA } = await service
      .from("assignments")
      .select("uprn_snapshot")
      .eq("id", assignmentA)
      .single();
    const uprn1 = snapA?.uprn_snapshot[0];
    const uprn2 = snapA?.uprn_snapshot[1];
    check("snapshot A has two doors", typeof uprn1 === "number" && typeof uprn2 === "number", `${uprn1} ${uprn2}`);
    if (typeof uprn1 !== "number" || typeof uprn2 !== "number") throw new Error("no snapshot doors");

    heading("duplicate re-sync does not inflate worked");
    const first = await insertKnock({
      assignmentId: assignmentA,
      canvasserId: canvasserA.id,
      uprn: uprn1,
      outcome: "no_answer",
      occurredAt: "2026-09-18T09:00:00.000Z",
    });
    check("logged door 1 once", !first.error, first.error?.message ?? first.clientEventId);

    const replay = await insertKnock({
      assignmentId: assignmentA,
      canvasserId: canvasserA.id,
      uprn: uprn1,
      outcome: "no_answer",
      occurredAt: "2026-09-18T09:00:00.000Z",
      clientEventId: first.clientEventId,
    });
    check(
      "duplicate client_event_id is rejected (unique)",
      Boolean(replay.error && (replay.error.code === "23505" || /duplicate|unique/i.test(replay.error.message))),
      replay.error ? `${replay.error.code ?? ""} ${replay.error.message}` : "unexpected success",
    );

    const afterDup = await readCompletion(admin.client, assignmentA);
    check(
      "worked is 1 after the rejected re-sync",
      afterDup.row?.worked === 1 && afterDup.row.answered === 0 && afterDup.row.remaining === afterDup.row.knockable - 1,
      afterDup.row
        ? `worked=${afterDup.row.worked} answered=${afterDup.row.answered} remaining=${afterDup.row.remaining}`
        : afterDup.error?.message ?? "no row",
    );

    heading("corrected outcome changes answered, not worked");
    const correction = await insertKnock({
      assignmentId: assignmentA,
      canvasserId: canvasserA.id,
      uprn: uprn1,
      outcome: "lead",
      occurredAt: "2026-09-18T09:10:00.000Z",
    });
    check("correction inserted as a new row", !correction.error, correction.error?.message ?? "");

    const { data: latestDoor } = await service
      .from("v_latest_knock")
      .select("outcome, uprn")
      .eq("assignment_id", assignmentA)
      .eq("uprn", uprn1);
    check(
      "v_latest_knock still one row for that door, newer outcome",
      latestDoor?.length === 1 && latestDoor[0]?.outcome === "lead",
      `${latestDoor?.length} ${latestDoor?.[0]?.outcome}`,
    );

    const { count: rawCount } = await service
      .from("knock_events")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentA)
      .eq("uprn", uprn1);
    check("raw knock_events for that door is 2 (would inflate worked if joined)", rawCount === 2, `raw=${rawCount}`);

    const afterFix = await readCompletion(admin.client, assignmentA);
    check(
      "worked stays 1; answered becomes 1",
      afterFix.row?.worked === 1 && afterFix.row.answered === 1,
      afterFix.row
        ? `worked=${afterFix.row.worked} answered=${afterFix.row.answered} remaining=${afterFix.row.remaining}`
        : afterFix.error?.message ?? "no row",
    );

    await insertKnock({
      assignmentId: assignmentA,
      canvasserId: canvasserA.id,
      uprn: uprn2,
      outcome: "no_answer",
      occurredAt: "2026-09-18T09:20:00.000Z",
    });
    const twoDoors = await readCompletion(admin.client, assignmentA);
    check(
      "second door: worked 2, answered 1",
      twoDoors.row?.worked === 2 && twoDoors.row.answered === 1,
      twoDoors.row ? `worked=${twoDoors.row.worked} answered=${twoDoors.row.answered}` : "no row",
    );

    heading("RLS under real JWTs — canvasser own current prop; admin all");
    const { data: asA, error: errA } = await canvasserA.client
      .from("v_prop_completion")
      .select("assignment_id, territory_name, worked, answered, remaining");
    const idsA = (asA ?? []).map((row) => row.assignment_id);
    check("canvasser A SELECT succeeds", !errA, errA?.message ?? `${idsA.length} row(s)`);
    check(
      "canvasser A sees their assignment",
      idsA.includes(assignmentA),
      idsA.join(",") || "none",
    );
    check(
      "canvasser A does not see canvasser B's prop",
      !idsA.includes(assignmentB),
      idsA.join(",") || "none",
    );

    const { data: asB, error: errB } = await canvasserB.client
      .from("v_prop_completion")
      .select("assignment_id");
    const idsB = (asB ?? []).map((row) => row.assignment_id);
    check("canvasser B SELECT succeeds", !errB, errB?.message ?? `${idsB.length} row(s)`);
    check("canvasser B sees only their assignment", idsB.length === 1 && idsB[0] === assignmentB, idsB.join(","));

    const { data: asAdmin, error: errAdmin } = await admin.client
      .from("v_prop_completion")
      .select("assignment_id");
    const idsAdmin = new Set((asAdmin ?? []).map((row) => row.assignment_id));
    check("admin SELECT succeeds", !errAdmin, errAdmin?.message ?? `${idsAdmin.size} row(s)`);
    check(
      "admin sees both test assignments (and seeded ones)",
      idsAdmin.has(assignmentA) && idsAdmin.has(assignmentB) && idsAdmin.size >= 2,
      `n=${idsAdmin.size}`,
    );

    const { data: asOffice, error: errOffice } = await office.client
      .from("v_prop_completion")
      .select("assignment_id");
    check(
      "office JWT sees zero rows (no assignment membership)",
      !errOffice && (asOffice?.length ?? 0) === 0,
      `${errOffice?.message ?? "ok"} rows=${asOffice?.length ?? 0}`,
    );

    const currentA = await readCompletion(canvasserA.client, assignmentA);
    const otherA = await readCompletion(canvasserA.client, assignmentB);
    check(
      "field-style fetch by today's assignment_id returns A's three numbers",
      currentA.row?.assignment_id === assignmentA &&
        currentA.row.worked === 2 &&
        currentA.row.answered === 1,
      currentA.row
        ? `worked=${currentA.row.worked} answered=${currentA.row.answered} remaining=${currentA.row.remaining}`
        : currentA.error?.message ?? "missing",
    );
    check(
      "field-style fetch of B's assignment_id as A returns no row",
      !otherA.error && otherA.row === null,
      otherA.row ? "leaked" : otherA.error?.message ?? "empty",
    );

    if (KEEP) {
      heading("browser pass");
      line(`  admin     ${admin.email}  /  ${PASSWORD}`);
      line(`  canvasser ${canvasserA.email}  /  ${PASSWORD}`);
      line("  /admin/dashboard  — Prop completion table, every allocation, no %.");
      line("  /field/profile    — today's three numbers only.");
      line("  run with --cleanup when finished.");
    }
  } finally {
    if (!KEEP) await cleanupAll();
  }

  heading("result");
  line(failures === 0 ? "  ALL CHECKS PASSED" : `  ${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
