/**
 * Stage 10 acceptance harness.
 *
 * Amended 2026-09-28 (owner, UI item 1). Claims, Take and reserve are
 * removed (reversing the 2026-09-26 deviation). Pure A1/B1/C1/heartbeat
 * checks, then three real Realtime sessions on one trio assignment, a
 * canvasser who is not on it, and two knocks of the same UPRN. Service role
 * is fixtures and counts only.
 *
 *   npm run verify:stage10
 *   npx tsx scripts/verify-stage-10.ts --cleanup
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import { allocateProp } from "../lib/geo/allocate-prop";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import { londonDate } from "../lib/field/london-date";
import {
  applyPerson,
  assignmentTopic,
  DOOR_EVENT,
  doorSignal,
  emptyPeople,
  formatTeammateLine,
  HEARTBEAT_STALE_MS,
  hereSignal,
  parseDoorSignal,
  teammateKnocks,
  teammateRows,
  type DoorSignal,
  type PersonState,
} from "../lib/field/door-signals";
import { nextOpenIndex } from "../lib/field/cursor";
import type { SequenceDoor } from "../lib/field/sequence";
import { sharedKnockMessage, uprnsSharedWithTeammate } from "../lib/field/shared-knock";
import { newClientEventId, newRowId, type KnockEventOp, type KnockEventWrite } from "../lib/sync/ops";
import { sendOp } from "../lib/sync/queue";
import type { Database } from "../lib/supabase/types";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "stage10-harness-pw-9k24";
const CLEANUP_ONLY = process.argv.includes("--cleanup");
const KEEP = process.argv.includes("--keep");
const TERRITORY_NAME = "STAGE 10 TEST PROP — DELETE ME";
const SOLO_NAME = "STAGE 10 SOLO PROP — DELETE ME";
const EMAIL_PREFIX = "stage10-";

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
/** Raw payload types seen on the wire, across every channel opened below. Must stay 0/0. */
let claimSeen = 0;
let releaseSeen = 0;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function door(uprn: number, position: number): SequenceDoor {
  return { uprn, position, lngLat: [0, 0] };
}

/** Every channel's raw broadcast listener runs this first, before parseDoorSignal. */
function noteRawType(payload: unknown) {
  const raw = payload as { type?: unknown } | null;
  if (raw?.type === "claim") claimSeen += 1;
  if (raw?.type === "release") releaseSeen += 1;
}

type HarnessUser = {
  id: string;
  email: string;
  name: string;
  client: Client;
};

async function createUser(label: string, name: string): Promise<HarnessUser> {
  const email = `${EMAIL_PREFIX}${label}-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);

  const client = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError || !session.session) throw new Error(`signIn ${label}: ${signInError?.message}`);
  client.realtime.setAuth(session.session.access_token);

  return { id: data.user.id, email, name, client };
}

async function cleanupAll() {
  heading("cleanup");
  const { data: users, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  const ours = users.users.filter((user) => user.email?.startsWith(EMAIL_PREFIX));
  const ids = ours.map((user) => user.id);

  if (ids.length > 0) {
    await service.from("leads").delete().in("canvasser_id", ids);
    await service.from("knock_events").delete().in("canvasser_id", ids);
    await service.from("property_observations").delete().in("canvasser_id", ids);
    await service.from("address_observations").delete().in("canvasser_id", ids);
  }

  for (const name of [TERRITORY_NAME, SOLO_NAME]) {
    const { data: territories } = await service.from("territories").select("id").eq("name", name);
    for (const territory of territories ?? []) {
      const { data: assignments } = await service
        .from("assignments")
        .select("id")
        .eq("territory_id", territory.id);
      const assignmentIds = (assignments ?? []).map((row) => row.id);
      if (assignmentIds.length > 0) {
        await service.from("knock_events").delete().in("assignment_id", assignmentIds);
        await service.from("assignment_members").delete().in("assignment_id", assignmentIds);
        await service.from("route_steps").delete().in("assignment_id", assignmentIds);
        await service.from("assignments").delete().in("id", assignmentIds);
      }
      await service.from("territories").delete().eq("id", territory.id);
    }
    line(`  removed territories named "${name}"`);
  }

  for (const user of ours) {
    await service.auth.admin.deleteUser(user.id);
  }
  line(`  deleted ${ours.length} harness user(s)`);
}

function pureChecks() {
  heading("A1: forward-wrap next open door");
  const sequence = [door(100, 0), door(101, 1), door(102, 2), door(103, 3), door(104, 4)];

  check("lands on the next open door after the cursor", nextOpenIndex(sequence, new Set(), 1) === 2);
  check(
    "skips a door already knocked, lands on 3",
    nextOpenIndex(sequence, new Set([102]), 1) === 3,
  );
  check(
    "wraps to the lowest open door when nothing is open ahead",
    nextOpenIndex(sequence, new Set([102, 103, 104]), 3) === 0,
  );
  check(
    "-1 when every door is knocked",
    nextOpenIndex(sequence, new Set([100, 101, 102, 103, 104]), 2) === -1,
  );
  check(
    "skips a door known only from a server knock (no broadcast needed)",
    nextOpenIndex(sequence, new Set([103]), 2) === 4,
  );
  check(
    "offline, nothing knocked: first snapshot door (no realtime needed)",
    nextOpenIndex(sequence, new Set(), -1) === 0,
  );
  check(
    "offline, Dexie knock on the first door: the next one",
    nextOpenIndex(sequence, new Set([100]), -1) === 1,
  );

  heading("teammate lines: knocked/unknocked only, first names");
  const ada = "00000000-0000-4000-8000-00000000000a";
  const tom = "00000000-0000-4000-8000-00000000000b";
  const cid = "00000000-0000-4000-8000-00000000000c";
  const now = Date.now();

  const members = [
    { canvasser_id: ada, full_name: "Ada Lane", route_position_m: null, route_position_at: null },
    { canvasser_id: tom, full_name: "Tom Holt", route_position_m: null, route_position_at: null },
    { canvasser_id: cid, full_name: "Cid Moss", route_position_m: null, route_position_at: null },
  ];

  const emptyTrio = teammateRows({
    selfId: ada,
    members,
    people: emptyPeople(),
    serverKnocks: [],
    now,
    connectionLive: true,
  });
  check("trio is two lines", emptyTrio.length === 2, `count ${emptyTrio.length}`);
  check(
    "nothing knocked and not stale is an empty line",
    emptyTrio.every((row) => row.empty && !row.stale) &&
      emptyTrio.every((row) => formatTeammateLine(row, undefined, now).endsWith("no door yet")),
  );
  check(
    "first names only, alphabetical: Cid then Tom",
    emptyTrio.map((row) => row.name).join(",") === "Cid,Tom",
    emptyTrio.map((row) => row.name).join(","),
  );

  const solo = teammateRows({
    selfId: ada,
    members: [members[0]],
    people: emptyPeople(),
    serverKnocks: [],
    now,
    connectionLive: true,
  });
  check("solo has no teammate line", solo.length === 0);

  heading("C1: #N is the plate, else the door's own number");
  const plateAt = new Date(now).toISOString();
  const withPlate = teammateRows({
    selfId: ada,
    members,
    people: applyPerson(emptyPeople(), doorSignal("knocked", tom, 5099080, 79, plateAt)),
    serverKnocks: [],
    now,
    connectionLive: true,
  }).find((row) => row.canvasserId === tom)!;
  const plateLine = formatTeammateLine(
    withPlate,
    { house_number: "80", building_name: null, street_name: "Filton Road" },
    now,
  );
  check('plate known: "Tom · last knocked #80"', plateLine === "Tom · last knocked #80", plateLine);

  const noPlateRow = teammateRows({
    selfId: ada,
    members,
    people: applyPerson(emptyPeople(), doorSignal("knocked", tom, 999, 11, plateAt)),
    serverKnocks: [],
    now,
    connectionLive: true,
  }).find((row) => row.canvasserId === tom)!;
  const noPlateLine = formatTeammateLine(noPlateRow, undefined, now);
  check(
    'no plate: falls back to the door number, "Tom · last knocked #12"',
    noPlateLine === "Tom · last knocked #12",
    noPlateLine,
  );

  heading("heartbeat: 15 s / 45 s (agent proposal, owner ACCEPTED)");
  const silent44 = teammateRows({
    selfId: ada,
    members,
    people: applyPerson(emptyPeople(), hereSignal(tom, new Date(now - 44_000).toISOString())),
    serverKnocks: [],
    now,
    connectionLive: true,
  }).find((row) => row.canvasserId === tom)!;
  check("silent 44s is not stale", silent44.stale === false);

  const silent46 = teammateRows({
    selfId: ada,
    members,
    people: applyPerson(emptyPeople(), hereSignal(tom, new Date(now - HEARTBEAT_STALE_MS - 1_000).toISOString())),
    serverKnocks: [],
    now,
    connectionLive: true,
  }).find((row) => row.canvasserId === tom)!;
  check("silent 46s is stale", silent46.stale === true);

  const minuteAgo = new Date(now - 61_000).toISOString();
  const minuteRow = teammateRows({
    selfId: ada,
    members,
    people: applyPerson(emptyPeople(), hereSignal(tom, minuteAgo)),
    serverKnocks: [],
    now,
    connectionLive: true,
  }).find((row) => row.canvasserId === tom)!;
  const minuteText = formatTeammateLine(minuteRow, undefined, now);
  check('reads "last heard 1 min"', minuteText === "Tom · last heard 1 min", minuteText);

  const here = hereSignal(ada, new Date(now).toISOString());
  check(
    'the "here" payload keys are exactly type, canvasser_id, at',
    Object.keys(here).sort().join(",") === "at,canvasser_id,type",
    Object.keys(here).sort().join(","),
  );

  heading("parseDoorSignal rejects claim and release");
  check(
    "claim payload rejected",
    parseDoorSignal({ type: "claim", canvasser_id: ada, uprn: 1, sequence_position: 0, at: new Date().toISOString() }) ===
      null,
  );
  check(
    "release payload rejected",
    parseDoorSignal({ type: "release", canvasser_id: ada, uprn: 1, sequence_position: 0, at: new Date().toISOString() }) ===
      null,
  );
  check(
    "knocked payload accepted",
    parseDoorSignal(doorSignal("knocked", ada, 1, 0)) !== null,
  );

  check(
    "one shared door",
    sharedKnockMessage(1, "door 4") === "You and a teammate both logged door 4. It still counts once.",
  );
}

type Actor = {
  user: HarnessUser;
  channel: RealtimeChannel;
  people: Map<string, PersonState>;
};

function listen(actor: Actor) {
  actor.channel.on("broadcast", { event: DOOR_EVENT }, (message) => {
    noteRawType(message.payload);
    const signal = parseDoorSignal(message.payload);
    if (!signal || signal.canvasser_id === actor.user.id) return;
    actor.people = applyPerson(actor.people, signal);
  });
}

function subscribe(channel: RealtimeChannel, ms = 10_000): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), ms);
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        const message = err && typeof err === "object" && "message" in err ? String(err.message) : "";
        resolve(message ? `${status} ${message}` : status);
      }
    });
  });
}

function send(channel: RealtimeChannel, signal: DoorSignal) {
  return channel.send({ type: "broadcast", event: DOOR_EVENT, payload: signal });
}

async function main() {
  if (CLEANUP_ONLY) {
    await cleanupAll();
    return;
  }

  pureChecks();

  heading("fixture");
  const adminEmail = `${EMAIL_PREFIX}admin-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data: adminUser, error: adminError } = await service.auth.admin.createUser({
    email: adminEmail,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Stage 10 Admin" },
  });
  if (adminError || !adminUser.user) throw new Error(adminError?.message ?? "admin");
  const { error: roleError } = await service
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", adminUser.user.id);
  if (roleError) throw new Error(roleError.message);

  const adminClient = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: adminSignIn } = await adminClient.auth.signInWithPassword({
    email: adminEmail,
    password: PASSWORD,
  });
  if (adminSignIn) throw new Error(adminSignIn.message);

  const ada = await createUser("ada", "Ada Lane");
  const tom = await createUser("tom", "Tom Holt");
  const cid = await createUser("cid", "Cid Moss");
  const outsider = await createUser("out", "Out Rider");
  const sol = await createUser("sol", "Sol Page");
  line(`  trio ${ada.name}, ${tom.name}, ${cid.name}; outsider is a different canvasser`);

  const { error: terrError } = await service.from("territories").insert({
    name: TERRITORY_NAME,
    geom: ringToEwkt(STREET),
    created_by: adminUser.user.id,
  });
  if (terrError) throw new Error(terrError.message);
  const { data: territory } = await service.from("territories").select("id").eq("name", TERRITORY_NAME).single();
  if (!territory) throw new Error("territory missing");

  const allocated = await allocateProp(adminClient, {
    territoryId: territory.id,
    workDate: londonDate(),
    canvasserIds: [ada.id, tom.id, cid.id],
  });
  if (!allocated.ok) throw new Error(`${allocated.code} ${allocated.message}`);
  const assignmentId = allocated.allocation.id;
  check("trio allocated", allocated.allocation.knockableDoors >= 3, `${allocated.allocation.knockableDoors} doors`);

  const { data: snapshot } = await service
    .from("assignments")
    .select("uprn_snapshot")
    .eq("id", assignmentId)
    .single();
  const uprns = snapshot?.uprn_snapshot ?? [];
  const sequence = uprns.map((uprn, position) => door(uprn, position));
  check("snapshot order has a first door", sequence.length >= 5, `first UPRN ${sequence[0]?.uprn ?? "none"}`);

  check(
    "offline (no realtime yet): next door is snapshot position 0",
    nextOpenIndex(sequence, new Set(), -1) === 0,
  );

  const { error: soloTerrError } = await service.from("territories").insert({
    name: SOLO_NAME,
    geom: ringToEwkt(STREET),
    created_by: adminUser.user.id,
  });
  if (soloTerrError) throw new Error(soloTerrError.message);
  const { data: soloTerritory } = await service.from("territories").select("id").eq("name", SOLO_NAME).single();
  if (!soloTerritory) throw new Error("solo territory missing");
  const soloAlloc = await allocateProp(adminClient, {
    territoryId: soloTerritory.id,
    workDate: londonDate(),
    canvasserIds: [sol.id],
  });
  check("solo allocated", soloAlloc.ok, soloAlloc.ok ? "" : soloAlloc.message);

  heading("teammate names and route position");
  const { data: tomProfile } = await ada.client.from("profiles").select("full_name").eq("id", tom.id).maybeSingle();
  check("Ada can read Tom's name", tomProfile?.full_name === "Tom Holt", tomProfile?.full_name ?? "none");
  const { data: hidden } = await outsider.client
    .from("profiles")
    .select("full_name")
    .eq("id", tom.id)
    .maybeSingle();
  check("outsider cannot read Tom's name", hidden === null);

  const { data: positions } = await service
    .from("assignment_members")
    .select("route_position_m, route_position_at")
    .eq("assignment_id", assignmentId);
  const positionCount = (positions ?? []).filter(
    (row) => row.route_position_m !== null || row.route_position_at !== null,
  ).length;
  check("route_position_m and route_position_at are null", positionCount === 0, `non-null ${positionCount}`);

  heading("three connected sessions: knocked/unknocked, no claims");
  const actors: Actor[] = [ada, tom, cid].map((user) => ({
    user,
    channel: user.client.channel(assignmentTopic(assignmentId), {
      config: { private: true, broadcast: { self: false } },
    }),
    people: emptyPeople(),
  }));
  for (const actor of actors) listen(actor);

  const joined = await Promise.all(actors.map((actor) => subscribe(actor.channel)));
  joined.forEach((status, index) => {
    check(`${actors[index].user.name} subscribed`, status === "SUBSCRIBED", status);
  });

  const [adaActor, tomActor, cidActor] = actors;
  await Promise.all(actors.map((actor) => send(actor.channel, hereSignal(actor.user.id))));

  const d0 = sequence[0]!;
  const d1 = sequence[1]!;
  await send(adaActor.channel, doorSignal("knocked", ada.id, d0.uprn, d0.position));
  await send(cidActor.channel, doorSignal("knocked", cid.id, d1.uprn, d1.position));

  let seenBoth = false;
  const deadline1 = Date.now() + 5_000;
  while (Date.now() < deadline1) {
    seenBoth =
      (tomActor.people.get(ada.id)?.knocks.has(d0.uprn) ?? false) &&
      (tomActor.people.get(cid.id)?.knocks.has(d1.uprn) ?? false);
    if (seenBoth) break;
    await sleep(100);
  }
  check("live: Tom sees both knocks within 5s", seenBoth);

  const membersReal = [ada, tom, cid].map((user) => ({
    canvasser_id: user.id,
    full_name: user.name,
    route_position_m: null,
    route_position_at: null,
  }));

  const tomKnocked = new Set<number>([
    ...(tomActor.people.get(ada.id)?.knocks.keys() ?? []),
    ...(tomActor.people.get(cid.id)?.knocks.keys() ?? []),
  ]);
  const tomIndex = nextOpenIndex(sequence, tomKnocked, -1);
  check("A1: Tom's next open door skips both, lands on the third", tomIndex === 2, `index ${tomIndex}`);

  const knockedByForTom = teammateKnocks(tomActor.people, [], tom.id, membersReal);
  check(
    "B1: the door Ada knocked is tagged Ada",
    knockedByForTom.get(d0.uprn)?.firstName === "Ada",
    knockedByForTom.get(d0.uprn)?.firstName ?? "none",
  );

  const rowsForTom = teammateRows({
    selfId: tom.id,
    members: membersReal,
    people: tomActor.people,
    serverKnocks: [],
    now: Date.now(),
    connectionLive: true,
  });
  const adaRow = rowsForTom.find((row) => row.canvasserId === ada.id)!;
  const c1Line = formatTeammateLine(adaRow, undefined, Date.now());
  const expectedC1Line = `Ada · last knocked #${d0.position + 1}`;
  check("C1: Tom's line for Ada", c1Line === expectedC1Line, c1Line);

  await send(adaActor.channel, doorSignal("unknocked", ada.id, d0.uprn, d0.position));
  let reopened = false;
  const deadline2 = Date.now() + 5_000;
  while (Date.now() < deadline2) {
    reopened = !(tomActor.people.get(ada.id)?.knocks.has(d0.uprn) ?? false);
    if (reopened) break;
    await sleep(100);
  }
  check("undo: unknocked removes it from Tom's record", reopened);
  const tomKnockedAfterUndo = new Set<number>(tomActor.people.get(cid.id)?.knocks.keys() ?? []);
  const tomIndexAfterUndo = nextOpenIndex(sequence, tomKnockedAfterUndo, -1);
  check("the door reopens: Tom's next open door is d0 again", tomIndexAfterUndo === 0, `index ${tomIndexAfterUndo}`);

  const heardAt = tomActor.people.get(ada.id)?.lastHeardAt ?? null;
  check("heartbeats arrive: Tom recorded when Ada was last heard", heardAt !== null, heardAt ?? "none");
  if (heardAt) {
    const staleRows = teammateRows({
      selfId: tom.id,
      members: membersReal,
      people: tomActor.people,
      serverKnocks: [],
      now: Date.parse(heardAt) + HEARTBEAT_STALE_MS + 1_000,
      connectionLive: true,
    });
    const staleAda = staleRows.find((row) => row.canvasserId === ada.id);
    check("a stopped actor goes stale 46s after its last signal", staleAda?.stale === true);
  }

  for (const actor of actors) {
    await actor.user.client.removeChannel(actor.channel);
  }

  heading("canvasser not on the assignment");
  let outsiderMessages = 0;
  const outsiderChannel = outsider.client.channel(assignmentTopic(assignmentId), {
    config: { private: true, broadcast: { self: false } },
  });
  outsiderChannel.on("broadcast", { event: DOOR_EVENT }, (message) => {
    noteRawType(message.payload);
    outsiderMessages += 1;
  });
  const outsiderStatus = await subscribe(outsiderChannel);
  const insiderChannel = ada.client.channel(assignmentTopic(assignmentId), {
    config: { private: true, broadcast: { self: false } },
  });
  await subscribe(insiderChannel);
  await send(insiderChannel, doorSignal("knocked", ada.id, sequence[0]!.uprn, 0));
  await sleep(2_000);
  check("outsider did not subscribe", outsiderStatus !== "SUBSCRIBED", outsiderStatus);
  check("outsider received no message", outsiderMessages === 0, `messages ${outsiderMessages}`);
  await outsider.client.removeChannel(outsiderChannel);

  let publicMessages = 0;
  const publicClient = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: publicSession, error: publicSignIn } = await publicClient.auth.signInWithPassword({
    email: outsider.email,
    password: PASSWORD,
  });
  if (publicSignIn || !publicSession.session) throw new Error(publicSignIn?.message ?? "public sign-in");
  publicClient.realtime.setAuth(publicSession.session.access_token);
  const publicChannel = publicClient.channel(assignmentTopic(assignmentId));
  publicChannel.on("broadcast", { event: DOOR_EVENT }, (message) => {
    noteRawType(message.payload);
    publicMessages += 1;
  });
  const publicStatus = await subscribe(publicChannel, 8_000);
  await send(insiderChannel, doorSignal("knocked", ada.id, sequence[0]!.uprn, 0));
  await sleep(2_000);
  check(
    "public join is not a way in",
    publicStatus !== "SUBSCRIBED" || publicMessages === 0,
    `${publicStatus}, messages ${publicMessages}`,
  );
  await ada.client.removeChannel(insiderChannel);
  await publicClient.removeChannel(publicChannel);

  heading("two offline knocks, one covered door");
  const uprn = sequence[0]!.uprn;
  const knock = (user: HarnessUser, when: string): KnockEventOp => {
    const clientEventId = newClientEventId();
    const row: KnockEventWrite = {
      id: newRowId(),
      client_event_id: clientEventId,
      assignment_id: assignmentId,
      canvasser_id: user.id,
      uprn,
      outcome: "no_answer",
      sequence_position: 0,
      occurred_at: when,
      notes: null,
    };
    return {
      kind: "knock_event",
      client_event_id: clientEventId,
      assignment_id: assignmentId,
      canvasser_id: user.id,
      payload: { knock: row },
    };
  };
  const first = await sendOp(ada.client, knock(ada, new Date().toISOString()));
  const second = await sendOp(tom.client, knock(tom, new Date(Date.now() + 1_000).toISOString()));
  check("both knocks inserted", first.outcome === "ok" && second.outcome === "ok", `${first.outcome} ${second.outcome}`);

  const { data: knockRows } = await service
    .from("knock_events")
    .select("uprn, canvasser_id")
    .eq("assignment_id", assignmentId)
    .eq("uprn", uprn);
  const rowCount = knockRows?.length ?? 0;
  const doorCount = new Set((knockRows ?? []).map((row) => row.uprn)).size;
  check("two rows, one UPRN", rowCount === 2 && doorCount === 1, `rows ${rowCount}, doors ${doorCount}`);

  const { count: latestCount } = await service
    .from("v_latest_knock")
    .select("uprn", { count: "exact", head: true })
    .eq("assignment_id", assignmentId)
    .eq("uprn", uprn);
  check("coverage view has one row for that door", latestCount === 1, `v_latest_knock ${latestCount ?? "null"}`);

  const shared = await uprnsSharedWithTeammate(tom.client, assignmentId, [uprn], tom.id);
  check("resync flags the shared door", shared.has(uprn));

  const { data: positionsAfter } = await service
    .from("assignment_members")
    .select("route_position_m, route_position_at")
    .eq("assignment_id", assignmentId);
  const written = (positionsAfter ?? []).filter(
    (row) => row.route_position_m !== null || row.route_position_at !== null,
  ).length;
  check("route position still read-only null", written === 0, `non-null ${written}`);

  check("claim received during the run: 0", claimSeen === 0, `claim ${claimSeen}`);
  check("release received during the run: 0", releaseSeen === 0, `release ${releaseSeen}`);

  if (KEEP) {
    line();
    line(`  kept trio ${ada.email}`);
    line(`  kept solo ${sol.email}`);
    line(`  assignment ${assignmentId}`);
  }
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error(error instanceof Error ? error.message : error);
  })
  .finally(async () => {
    if (!KEEP && !CLEANUP_ONLY) {
      await cleanupAll().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
      });
    }
    line();
    line(failures === 0 ? "OK" : `${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
