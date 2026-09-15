/**
 * Stage 7 acceptance harness — the server-side half.
 *
 * Drives the queue's real wire path (`sendOp`) from Node with real signed-in
 * JWTs. Nothing here uses `postgres` or bypasses RLS for the inserts; the
 * service role is used only for fixtures, row counts and cleanup.
 *
 * Covers: classify + backoff unit checks, validateOp, same client_event_id
 * twice → one row, replay after a partial knock/lead failure, every 4xx
 * class the queue can meet, network and timeout → retryable.
 *
 * The browser-level items (50 events flush, mid-flush kill, browser restart)
 * run in a real browser via `window.__d2dSyncDebug` (development only). Use
 * `--keep` to leave the fixtures in place for that pass, then `--cleanup`.
 *
 *   npm run verify:stage7
 *   npx tsx scripts/verify-stage-7.ts --keep
 *   npx tsx scripts/verify-stage-7.ts --cleanup
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import { allocateProp } from "../lib/geo/allocate-prop";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import { londonDate } from "../lib/field/london-date";
import { BACKOFF_BASE_MS, BACKOFF_CAP_MS, delayMs } from "../lib/sync/backoff";
import { classify, type SendClass, type SendFailure } from "../lib/sync/classify";
import {
  newClientEventId,
  newRowId,
  validateOp,
  type CanvasserLeadInsert,
  type KnockEventOp,
  type KnockEventWrite,
} from "../lib/sync/ops";
import { sendOp } from "../lib/sync/queue";
import type { Database } from "../lib/supabase/types";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "stage7-harness-pw-4e8b";
const KEEP = process.argv.includes("--keep");
const CLEANUP_ONLY = process.argv.includes("--cleanup");
const TERRITORY_NAME = "STAGE 7 TEST PROP — DELETE ME";
const EMAIL_PREFIX = "stage7-";
/** Above the 12-digit OS UPRN range; asserted absent before use. */
const GHOST_UPRN = 999_999_999_999;

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
  role: "admin" | "canvasser";
  token: string;
  client: Client;
};

async function createUser(role: "admin" | "canvasser", label: string): Promise<HarnessUser> {
  const email = `${EMAIL_PREFIX}${label}-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Stage 7 ${label}` },
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);

  if (role !== "canvasser") {
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

  return { id: data.user.id, email, role, token: session.session.access_token, client };
}

function bearerClient(url: string, token: string): Client {
  return createClient<Database>(url, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function knockOp(
  fields: { assignmentId: string; canvasserId: string; uprn: number; sequence: number },
  withLead: boolean,
  clientEventId = newClientEventId(),
  knockId = newRowId(),
): KnockEventOp {
  const knock: KnockEventWrite = {
    id: knockId,
    client_event_id: clientEventId,
    assignment_id: fields.assignmentId,
    canvasser_id: fields.canvasserId,
    uprn: fields.uprn,
    outcome: withLead ? "lead" : "no_answer",
    sequence_position: fields.sequence,
    occurred_at: new Date().toISOString(),
  };
  const lead: CanvasserLeadInsert | undefined = withLead
    ? {
        client_event_id: clientEventId,
        knock_event_id: knockId,
        uprn: fields.uprn,
        canvasser_id: fields.canvasserId,
        booked_for: new Date(Date.now() + 3 * 3600_000).toISOString(),
        is_immediate: true,
        notes: "stage 7 harness",
      }
    : undefined;
  return {
    kind: "knock_event",
    client_event_id: clientEventId,
    assignment_id: fields.assignmentId,
    canvasser_id: fields.canvasserId,
    payload: lead ? { knock, lead } : { knock },
  };
}

async function countRows(clientEventId: string): Promise<{ knocks: number; leads: number }> {
  const [k, l] = await Promise.all([
    service.from("knock_events").select("id", { count: "exact", head: true }).eq("client_event_id", clientEventId),
    service.from("leads").select("id", { count: "exact", head: true }).eq("client_event_id", clientEventId),
  ]);
  if (k.error) throw new Error(k.error.message);
  if (l.error) throw new Error(l.error.message);
  return { knocks: k.count ?? 0, leads: l.count ?? 0 };
}

async function cleanupAll() {
  heading("cleanup");
  const { data: users, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  const ours = users.users.filter((u) => u.email?.startsWith(EMAIL_PREFIX));
  const ids = ours.map((u) => u.id);

  if (ids.length > 0) {
    const leads = await service.from("leads").delete().in("canvasser_id", ids).select("id");
    const knocks = await service.from("knock_events").delete().in("canvasser_id", ids).select("id");
    line(`  deleted leads=${leads.data?.length ?? 0} knock_events=${knocks.data?.length ?? 0}` +
      `${leads.error ? ` (${leads.error.message})` : ""}${knocks.error ? ` (${knocks.error.message})` : ""}`);
  }

  const { data: territories } = await service.from("territories").select("id").eq("name", TERRITORY_NAME);
  for (const t of territories ?? []) {
    await service.from("assignments").delete().eq("territory_id", t.id);
    const { error: tErr } = await service.from("territories").delete().eq("id", t.id);
    line(`  deleted territory ${t.id}${tErr ? ` (${tErr.message})` : ""}`);
  }

  for (const u of ours) {
    const { error: uErr } = await service.auth.admin.deleteUser(u.id);
    line(`  deleted user ${u.id} ${u.email}${uErr ? ` (${uErr.message})` : ""}`);
  }
}

function unitChecks() {
  heading("A. classify — pure");
  const cases: Array<[string, SendFailure, SendClass]> = [
    ["23505 unique (HTTP 409)", { status: 409, code: "23505", message: "duplicate key" }, "duplicate"],
    ["23503 foreign key (HTTP 409) is NOT a duplicate", { status: 409, code: "23503", message: "fk" }, "permanent"],
    ["42501 RLS (HTTP 403)", { status: 403, code: "42501", message: "rls" }, "permanent"],
    ["23514 check (HTTP 400)", { status: 400, code: "23514", message: "check" }, "permanent"],
    ["422", { status: 422, message: "unprocessable" }, "permanent"],
    ["401", { status: 401, message: "jwt" }, "auth"],
    ["PGRST301 expired JWT", { status: 401, code: "PGRST301", message: "JWT expired" }, "auth"],
    ["500", { status: 500, message: "boom" }, "retryable"],
    ["503", { status: 503, message: "unavailable" }, "retryable"],
    ["429", { status: 429, message: "slow down" }, "retryable"],
    ["408", { status: 408, message: "timeout" }, "retryable"],
    ["network status 0", { status: 0, code: "", message: "TypeError: Failed to fetch" }, "retryable"],
    ["AbortError", { status: 0, name: "AbortError", message: "AbortError: aborted" }, "retryable"],
    ["no status at all", { message: "something odd" }, "retryable"],
  ];
  for (const [label, failure, expected] of cases) {
    const got = classify(failure);
    check(`${label} → ${expected}`, got === expected, got === expected ? "" : `got ${got}`);
  }

  heading("B. backoff — pure");
  const lo = (n: number) => delayMs(n, () => 0);
  const hi = (n: number) => delayMs(n, () => 1);
  check("attempt 0 in [1000, 2000]", lo(0) === 1000 && hi(0) === 2000, `${lo(0)}..${hi(0)}`);
  check("attempt 3 in [8000, 16000]", lo(3) === 8000 && hi(3) === 16000, `${lo(3)}..${hi(3)}`);
  check(
    "attempt 20 capped at 5 min",
    hi(20) === BACKOFF_CAP_MS && lo(20) === BACKOFF_CAP_MS / 2,
    `${lo(20)}..${hi(20)}`,
  );
  check("base is 2 s, cap 5 min", BACKOFF_BASE_MS === 2000 && BACKOFF_CAP_MS === 300_000);
  const samples = Array.from({ length: 200 }, () => delayMs(2));
  check(
    "200 random samples at attempt 2 all within [4000, 8000]",
    samples.every((s) => s >= 4000 && s <= 8000),
    `min ${Math.min(...samples)} max ${Math.max(...samples)}`,
  );

  heading("C. validateOp — a lead cannot carry a different client_event_id");
  const fields = { assignmentId: newRowId(), canvasserId: newRowId(), uprn: 1, sequence: 0 };
  const good = knockOp(fields, true);
  check("well-formed knock+lead accepted", validateOp(good) === null, validateOp(good) ?? "");
  const badLead = knockOp(fields, true);
  badLead.payload.lead!.client_event_id = newClientEventId();
  check("lead with its own client_event_id rejected", validateOp(badLead) !== null, validateOp(badLead) ?? "");
  const badFk = knockOp(fields, true);
  badFk.payload.lead!.knock_event_id = newRowId();
  check("lead not referencing knock.id rejected", validateOp(badFk) !== null, validateOp(badFk) ?? "");
  const badKnock = knockOp(fields, false);
  badKnock.payload.knock.client_event_id = newClientEventId();
  check("knock id differing from op id rejected", validateOp(badKnock) !== null, validateOp(badKnock) ?? "");
  const withStatus = knockOp(fields, true);
  (withStatus.payload.lead as Record<string, unknown>).status = "sale";
  check("lead payload carrying status rejected", validateOp(withStatus) !== null, validateOp(withStatus) ?? "");
  const ids = new Set(Array.from({ length: 1000 }, () => newClientEventId()));
  check(
    "newClientEventId: 1000 unique uuid v4",
    ids.size === 1000 && [...ids].every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)),
  );
}

async function main() {
  if (CLEANUP_ONLY) {
    await cleanupAll();
    return;
  }

  unitChecks();

  const users: HarnessUser[] = [];
  let territoryId: string | undefined;

  try {
    heading("fixtures");
    const admin = await createUser("admin", "admin");
    const canvasser = await createUser("canvasser", "c1");
    const other = await createUser("canvasser", "c2");
    users.push(admin, canvasser, other);
    for (const u of users) line(`  ${u.role.padEnd(9)} ${u.id}  ${u.email}`);

    const { data: saved, error: saveError } = await admin.client
      .from("territories")
      .insert({ name: TERRITORY_NAME, geom: ringToEwkt(STREET), created_by: admin.id })
      .select("id")
      .single();
    if (saveError || !saved) throw new Error(`save territory: ${saveError?.message}`);
    territoryId = saved.id;

    const today = londonDate();
    const alloc = await allocateProp(admin.client, {
      territoryId,
      workDate: today,
      canvasserIds: [canvasser.id],
    });
    if (!alloc.ok) throw new Error(`allocate: ${alloc.message}`);
    const assignmentId = alloc.allocation.id;

    const { data: assignment, error: aErr } = await service
      .from("assignments")
      .select("uprn_snapshot")
      .eq("id", assignmentId)
      .single();
    if (aErr || !assignment) throw new Error(aErr?.message ?? "missing assignment");
    const snapshot = assignment.uprn_snapshot as number[];
    line(`  territory ${territoryId}  assignment ${assignmentId}  doors ${snapshot.length}  date ${today}`);

    const base = { assignmentId, canvasserId: canvasser.id };
    const door = (i: number) => ({ ...base, uprn: snapshot[i], sequence: i });

    heading("D1. same client_event_id twice → one knock row, one lead row");
    const op1 = knockOp(door(0), true);
    const first = await sendOp(canvasser.client, op1);
    const second = await sendOp(canvasser.client, op1);
    const rows1 = await countRows(op1.client_event_id);
    check("first send ok", first.outcome === "ok", `${first.outcome}/${first.step}`);
    check(
      "second send classified duplicate (success, not error)",
      second.outcome === "duplicate",
      `${second.outcome}/${second.step} ${second.error?.code ?? ""}`,
    );
    check("exactly one knock_events row", rows1.knocks === 1, `knocks=${rows1.knocks}`);
    check("exactly one leads row", rows1.leads === 1, `leads=${rows1.leads}`);

    heading("D2. replay after partial failure (knock inserted, lead not)");
    const op2full = knockOp(door(1), true);
    const op2knockOnly: KnockEventOp = {
      ...op2full,
      payload: { knock: { ...op2full.payload.knock } },
    };
    const partial = await sendOp(canvasser.client, op2knockOnly);
    const mid = await countRows(op2full.client_event_id);
    const replay = await sendOp(canvasser.client, op2full);
    const rows2 = await countRows(op2full.client_event_id);
    check("knock-only send ok", partial.outcome === "ok", `${partial.outcome}`);
    check("after partial: 1 knock, 0 leads", mid.knocks === 1 && mid.leads === 0, `knocks=${mid.knocks} leads=${mid.leads}`);
    check(
      "replay completes: knock 23505 swallowed, lead inserted",
      replay.outcome === "ok" && replay.step === "lead",
      `${replay.outcome}/${replay.step}`,
    );
    check("after replay: 1 knock, 1 lead — no duplicate knock", rows2.knocks === 1 && rows2.leads === 1, `knocks=${rows2.knocks} leads=${rows2.leads}`);
    const replayAgain = await sendOp(canvasser.client, op2full);
    const rows2b = await countRows(op2full.client_event_id);
    check(
      "third replay: both steps duplicate, still 1/1",
      replayAgain.outcome === "duplicate" && rows2b.knocks === 1 && rows2b.leads === 1,
      `${replayAgain.outcome}/${replayAgain.step}`,
    );

    heading("D3. 4xx classes — permanent, surfaced, never retried");
    const asOther = knockOp({ ...door(2), canvasserId: other.id }, false);
    const r42501 = await sendOp(canvasser.client, asOther);
    check(
      "canvasser_id of another user → 42501 → permanent",
      r42501.outcome === "permanent" && r42501.error?.code === "42501",
      `${r42501.outcome} HTTP ${r42501.error?.status} ${r42501.error?.code}`,
    );

    const { count: ghostCount } = await service
      .from("properties")
      .select("uprn", { count: "exact", head: true })
      .eq("uprn", GHOST_UPRN);
    check(`ghost UPRN ${GHOST_UPRN} is absent from properties`, ghostCount === 0, `count=${ghostCount}`);
    const badUprn = knockOp({ ...door(3), uprn: GHOST_UPRN }, false);
    const r23503 = await sendOp(canvasser.client, badUprn);
    check(
      "unknown uprn → 23503 (HTTP 409) → permanent, not duplicate",
      r23503.outcome === "permanent" && r23503.error?.code === "23503" && r23503.error?.status === 409,
      `${r23503.outcome} HTTP ${r23503.error?.status} ${r23503.error?.code}`,
    );

    const badOutcome = knockOp(door(4), false);
    (badOutcome.payload.knock as { outcome: string }).outcome = "bogus";
    const r23514 = await sendOp(canvasser.client, badOutcome);
    check(
      "outcome outside the check → 23514 → permanent",
      r23514.outcome === "permanent" && r23514.error?.code === "23514",
      `${r23514.outcome} HTTP ${r23514.error?.status} ${r23514.error?.code}`,
    );

    const leadWithStatus = knockOp(door(5), true);
    (leadWithStatus.payload.lead as Record<string, unknown>).status = "sale";
    const rStatus = await sendOp(canvasser.client, leadWithStatus);
    const rowsStatus = await countRows(leadWithStatus.client_event_id);
    check(
      "lead payload with status → 42501 at the lead step (the generated-type trap)",
      rStatus.outcome === "permanent" && rStatus.step === "lead" && rStatus.error?.code === "42501",
      `${rStatus.outcome}/${rStatus.step} ${rStatus.error?.code}`,
    );
    check("knock landed, lead did not (partial state for a later retry)", rowsStatus.knocks === 1 && rowsStatus.leads === 0, `knocks=${rowsStatus.knocks} leads=${rowsStatus.leads}`);

    const notAssigned = knockOp({ ...door(6), canvasserId: other.id }, false);
    const rOtherJwt = await sendOp(other.client, notAssigned);
    check(
      "member of no assignment → 42501 → permanent",
      rOtherJwt.outcome === "permanent" && rOtherJwt.error?.code === "42501",
      `${rOtherJwt.outcome} ${rOtherJwt.error?.code}`,
    );

    heading("D4. auth — garbage JWT → 401 → auth (pause, not fail)");
    const garbage = bearerClient(URL_, "not.a.jwt");
    const rAuth = await sendOp(garbage, knockOp(door(7), false));
    check("401 → auth", rAuth.outcome === "auth", `${rAuth.outcome} HTTP ${rAuth.error?.status} ${rAuth.error?.code}`);

    heading("D5. connectivity — retryable, row would stay pending");
    const unreachable = bearerClient("http://127.0.0.1:9", canvasser.token);
    const rNet = await sendOp(unreachable, knockOp(door(8), false), 3000);
    check("unreachable host → retryable", rNet.outcome === "retryable", `${rNet.outcome} HTTP ${rNet.error?.status} ${rNet.error?.message.slice(0, 60)}`);
    const rAbort = await sendOp(canvasser.client, knockOp(door(9), false), 1);
    check("1 ms timeout → abort → retryable", rAbort.outcome === "retryable", `${rAbort.outcome} HTTP ${rAbort.error?.status} ${rAbort.error?.message.slice(0, 60)}`);

    heading("D6. totals for this canvasser");
    const { count: knockTotal } = await service
      .from("knock_events")
      .select("id", { count: "exact", head: true })
      .eq("canvasser_id", canvasser.id);
    const { count: leadTotal } = await service
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("canvasser_id", canvasser.id);
    // D1: 1 knock + 1 lead. D2: 1 knock + 1 lead. D3 lead-with-status: 1 knock.
    // The 1 ms abort in D5 may or may not have reached the server.
    check(
      "knock_events total is 3 or 4 (abort race), leads exactly 2",
      (knockTotal === 3 || knockTotal === 4) && leadTotal === 2,
      `knocks=${knockTotal} leads=${leadTotal}`,
    );

    if (KEEP) {
      heading("KEEP — fixtures left for the browser pass");
      line(`  canvasser email    ${canvasser.email}`);
      line(`  canvasser password ${PASSWORD}`);
      line(`  assignment_id      ${assignmentId}`);
      line(`  doors              ${snapshot.length}`);
      line("  run with --cleanup to delete these rows and users");
    }
  } finally {
    if (!KEEP) await cleanupAll();
  }

  heading("result");
  line(`  ${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
