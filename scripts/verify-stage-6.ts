/**
 * Stage 6 acceptance harness for `todays_assignment`.
 *
 * Real signed-in JWTs over HTTPS. Nothing here uses `postgres` or bypasses
 * RLS for the RPC. Compass is checked against the same centroid → entry
 * vertex ST_Azimuth expression allocate_prop uses (009).
 *
 *   npm run verify:stage6
 *   npx tsx scripts/verify-stage-6.ts --keep
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import { allocateProp } from "../lib/geo/allocate-prop";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import {
  fetchTodaysAssignment,
  formatAssignmentHeader,
  parseTodaysAssignment,
} from "../lib/geo/todays-assignment";
import { londonDate } from "../lib/field/london-date";
import type { Database, Json } from "../lib/supabase/types";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "stage6-harness-pw-9a2c";
const KEEP = process.argv.includes("--keep");

const STREET: Ring = [
  [-2.5955, 51.4786],
  [-2.5925, 51.4786],
  [-2.5925, 51.4794],
  [-2.5955, 51.4794],
];

const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

const service = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function line(text = "") {
  console.log(text);
}

function heading(text: string) {
  line();
  line(`── ${text} ${"─".repeat(Math.max(0, 68 - text.length))}`);
}

function addDays(iso: string, delta: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
}

function compassFromAzimuth(az: number): string {
  const octant = ((Math.floor((az * (180 / Math.PI) + 360 + 22.5) / 45) % 8) + 8) % 8;
  return COMPASS[octant];
}

function planarAzimuth(from: [number, number], to: [number, number]): number {
  const angle = Math.atan2(to[0] - from[0], to[1] - from[1]);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

async function rpcRaw(token: string) {
  const response = await fetch(`${URL_}/rest/v1/rpc/todays_assignment`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, bytes: Buffer.byteLength(text) };
}

type HarnessUser = {
  id: string;
  email: string;
  role: "admin" | "office" | "canvasser";
  token: string;
  client: ReturnType<typeof createClient<Database>>;
};

async function createUser(role: "admin" | "office" | "canvasser", label: string): Promise<HarnessUser> {
  const email = `stage6-${label}-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Stage 6 ${label}` },
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
  if (signInError || !session.session) {
    throw new Error(`signIn ${label}: ${signInError?.message}`);
  }

  const client = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });

  return { id: data.user.id, email, role, token: session.session.access_token, client };
}

async function liveAzimuth(from: [number, number], to: [number, number]): Promise<number | null> {
  const response = await fetch(`${URL_}/rest/v1/rpc/st_azimuth`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      geom1: `SRID=4326;POINT(${from[0]} ${from[1]})`,
      geom2: `SRID=4326;POINT(${to[0]} ${to[1]})`,
    }),
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return typeof body === "number" ? body : null;
}

async function main() {
  const users: HarnessUser[] = [];
  let territoryId: string | undefined;

  try {
    heading("fixtures");
    const admin = await createUser("admin", "admin");
    const office = await createUser("office", "office");
    const canvasser = await createUser("canvasser", "c1");
    const other = await createUser("canvasser", "c2");
    const idle = await createUser("canvasser", "idle");
    users.push(admin, office, canvasser, other, idle);
    for (const u of users) line(`  ${u.role.padEnd(9)} ${u.id}  ${u.email}`);

    const { data: saved, error: saveError } = await admin.client
      .from("territories")
      .insert({
        name: "STAGE 6 TEST PROP — DELETE ME",
        geom: ringToEwkt(STREET),
        created_by: admin.id,
      })
      .select("id")
      .single();
    if (saveError || !saved) throw new Error(`save territory: ${saveError?.message}`);
    territoryId = saved.id;
    line(`  territory ${territoryId}`);

    const today = londonDate();
    const yesterday = addDays(today, -1);
    line(`  Europe/London today=${today} yesterday=${yesterday}`);

    const todayAlloc = await allocateProp(admin.client, {
      territoryId,
      workDate: today,
      canvasserIds: [canvasser.id],
    });
    if (!todayAlloc.ok) throw new Error(`allocate today: ${todayAlloc.message}`);
    line(
      `  today ${todayAlloc.allocation.id}  visit=${todayAlloc.allocation.visitNumber} ` +
        `vertex=${todayAlloc.allocation.entryVertexIndex} dir=${todayAlloc.allocation.sweepDirection} ` +
        `slot=${todayAlloc.allocation.slot} doors=${todayAlloc.allocation.knockableDoors}`,
    );

    const yAlloc = await allocateProp(admin.client, {
      territoryId,
      workDate: yesterday,
      canvasserIds: [other.id],
    });
    if (!yAlloc.ok) throw new Error(`allocate yesterday: ${yAlloc.message}`);
    line(`  yesterday ${yAlloc.allocation.id} for other canvasser`);

    heading("ACL — anon and service_role have no EXECUTE");
    const asAnon = await rpcRaw(ANON);
    const asService = await rpcRaw(SERVICE);
    line(`  anon    HTTP ${asAnon.status}  ${JSON.stringify(asAnon.body).slice(0, 220)}`);
    line(`  service HTTP ${asService.status}  ${JSON.stringify(asService.body).slice(0, 220)}`);

    heading("1. canvasser JWT — payload, snapshot order, no colour properties");
    const asCanvasser = await rpcRaw(canvasser.token);
    line(`  HTTP ${asCanvasser.status}  bytes=${asCanvasser.bytes}`);
    if (asCanvasser.status !== 200) throw new Error(`canvasser RPC HTTP ${asCanvasser.status}`);
    const parsed = parseTodaysAssignment(asCanvasser.body as Json);
    if (!parsed) throw new Error("canvasser got JSON null — expected a payload");

    const { data: row, error: rowErr } = await service
      .from("assignments")
      .select("uprn_snapshot, entry_vertex_index, visit_number, sweep_direction, slot")
      .eq("id", todayAlloc.allocation.id)
      .single();
    if (rowErr || !row) throw new Error(rowErr?.message ?? "missing assignment row");

    const featureUprns = parsed.doors.features.map((f) => f.properties.uprn);
    const sequences = parsed.doors.features.map((f) => f.properties.sequence);
    const hasNccz = parsed.doors.features.some((f) => "is_nccz" in f.properties);
    line(`  assignment_id ${parsed.assignment_id}`);
    line(`  header: ${formatAssignmentHeader(parsed)}`);
    line(
      `  visit=${parsed.visit_number} dir=${parsed.sweep_direction} slot=${parsed.slot} ` +
        `vertex=${parsed.entry_vertex_index} compass=${parsed.entry_compass}`,
    );
    line(
      `  door_count ${parsed.door_count}  features ${parsed.doors.features.length}  snapshot ${row.uprn_snapshot.length}`,
    );
    line(`  feature order matches snapshot: ${featureUprns.join(",") === row.uprn_snapshot.join(",")}`);
    line(`  sequences 0..n-1: ${sequences.every((s, i) => s === i)}`);
    line(`  no is_nccz on features: ${!hasNccz}`);
    line(`  first UPRN ${featureUprns[0]}  last ${featureUprns[featureUprns.length - 1]}`);

    const wrapper = await fetchTodaysAssignment(canvasser.client);
    line(
      `  wrapper ok=${wrapper.ok} ` +
        `${wrapper.ok ? `id=${wrapper.assignment?.assignment_id ?? "null"}` : wrapper.message}`,
    );

    heading("1b. compass reuses Stage 5 centroid → entry-vertex azimuth");
    const open =
      STREET[0][0] === STREET[STREET.length - 1][0] && STREET[0][1] === STREET[STREET.length - 1][1]
        ? STREET.slice(0, -1)
        : STREET;
    const centroid: [number, number] = [
      open.reduce((sum, p) => sum + p[0], 0) / open.length,
      open.reduce((sum, p) => sum + p[1], 0) / open.length,
    ];
    const entry = open[row.entry_vertex_index] as [number, number];
    const live = await liveAzimuth(centroid, entry);
    const az = live ?? planarAzimuth(centroid, entry);
    const expected = compassFromAzimuth(az);
    line(`  entry vertex ${row.entry_vertex_index}  centroid ${centroid.join(",")}  entry ${entry.join(",")}`);
    line(`  azimuth source: ${live === null ? "planar fallback" : "ST_Azimuth RPC"}  radians=${az}`);
    line(`  degrees=${((az * 180) / Math.PI).toFixed(2)}  expected octant=${expected}`);
    line(`  RPC entry_compass=${parsed.entry_compass}  match=${parsed.entry_compass === expected}`);

    heading("2. honest empty — not a member of today's assignment");
    const asOther = await rpcRaw(other.token);
    const asIdle = await rpcRaw(idle.token);
    const asOffice = await rpcRaw(office.token);
    const asAdmin = await rpcRaw(admin.token);
    line(`  other (yesterday only) HTTP ${asOther.status} body=${JSON.stringify(asOther.body)}`);
    line(`  idle  (no assignment)  HTTP ${asIdle.status} body=${JSON.stringify(asIdle.body)}`);
    line(`  office                 HTTP ${asOffice.status} body=${JSON.stringify(asOffice.body)}`);
    line(`  admin (not a member)   HTTP ${asAdmin.status} body=${JSON.stringify(asAdmin.body)}`);

    const otherWrapped = await fetchTodaysAssignment(other.client);
    const idleWrapped = await fetchTodaysAssignment(idle.client);
    const officeWrapped = await fetchTodaysAssignment(office.client);
    line(
      `  wrappers: other=${label(otherWrapped)} idle=${label(idleWrapped)} office=${label(officeWrapped)}`,
    );

    heading("3. canvasser JWT cannot read the other assignment");
    const { data: seen, error: seenErr } = await canvasser.client.from("assignments").select("id, work_date");
    if (seenErr) throw new Error(seenErr.message);
    const ids = (seen ?? []).map((r) => r.id);
    line(`  visible ids: ${ids.join(",") || "(none)"}`);
    line(`  includes own today: ${ids.includes(todayAlloc.allocation.id)}`);
    line(`  includes other's yesterday: ${ids.includes(yAlloc.allocation.id)}`);

    heading("4. no app_role gate — office gets null, not 42501");
    const officeIsForbidden = asOffice.status === 403 || JSON.stringify(asOffice.body).includes("42501");
    const officeIsNull = asOffice.status === 200 && asOffice.body === null;
    line(`  office HTTP ${asOffice.status}  null=${officeIsNull}  forbidden=${officeIsForbidden}`);
    line(`  admin HTTP ${asAdmin.status}  null=${asAdmin.body === null}`);

    if (KEEP) {
      heading("KEEP — fixtures left for the browser pass");
      line(`  canvasser email    ${canvasser.email}`);
      line(`  canvasser password ${PASSWORD}`);
      line(`  assignment_id      ${todayAlloc.allocation.id}`);
      line(`  door_count         ${parsed.door_count}`);
      line(`  header             ${formatAssignmentHeader(parsed)}`);
      line("  re-run without --keep to delete these rows and users");
    }
  } finally {
    if (!KEEP) {
      heading("cleanup");
      if (territoryId) {
        await service.from("assignments").delete().eq("territory_id", territoryId);
        const { error } = await service.from("territories").delete().eq("id", territoryId);
        line(`deleted territory ${territoryId}${error ? ` (${error.message})` : ""}`);
      }
      for (const u of users) {
        const { error } = await service.auth.admin.deleteUser(u.id);
        line(`deleted user ${u.id}${error ? ` (${error.message})` : ""}`);
      }
    }
  }
}

function label(result: Awaited<ReturnType<typeof fetchTodaysAssignment>>): string {
  if (!result.ok) return `error:${result.message}`;
  return result.assignment ? `payload:${result.assignment.assignment_id}` : "null";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
