/**
 * Stage 10 acceptance harness.
 *
 * Pure next-door / claim / teammate checks, then three real Realtime
 * sessions on one trio assignment, a canvasser who is not on it, and two
 * knocks of the same UPRN. Service role is fixtures and counts only.
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
  claimIsLive,
  DOOR_EVENT,
  doorSignal,
  emptyPeople,
  formatTeammateLine,
  parseDoorSignal,
  reserveDecision,
  shownDoor,
  teammateRows,
  winningHolds,
  type DoorSignal,
  type PersonState,
} from "../lib/field/door-signals";
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
const FAST = process.argv.includes("--fast");
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
  heading("next door, claims, teammate lines");
  const sequence = [door(100, 0), door(101, 1), door(102, 2)];
  const me = "00000000-0000-4000-8000-000000000001";
  const ada = "00000000-0000-4000-8000-00000000000a";
  const ben = "00000000-0000-4000-8000-00000000000b";
  const cid = "00000000-0000-4000-8000-00000000000c";
  const now = Date.now();

  const offline = shownDoor(sequence, new Set(), emptyPeople(), me, now, false);
  check("offline, nothing knocked: first snapshot door", offline?.uprn === 100 && offline.position === 0);

  const afterLocal = shownDoor(sequence, new Set([100]), emptyPeople(), me, now, false);
  check("offline, Dexie knock on the first door: the next one", afterLocal?.uprn === 101);

  const blocked = applyPerson(
    emptyPeople(),
    doorSignal("claim", ada, 100, 0, new Date(now).toISOString()),
  );
  const ignoresClaim = shownDoor(sequence, new Set(), blocked, me, now, false);
  check("offline ignores a teammate claim", ignoresClaim?.uprn === 100);

  const liveSkip = shownDoor(sequence, new Set(), blocked, me, now, true);
  check("live skips a door a teammate holds", liveSkip?.uprn === 101);

  const members = [
    { canvasser_id: ada, full_name: "Ada", route_position_m: null, route_position_at: null },
    { canvasser_id: ben, full_name: "Ben", route_position_m: null, route_position_at: null },
    { canvasser_id: cid, full_name: "Cid", route_position_m: null, route_position_at: null },
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
    "nothing knocked and no claim is an empty line",
    emptyTrio.every((row) => row.empty) &&
      emptyTrio.every((row) => formatTeammateLine(row, undefined, now).endsWith("no door yet")),
  );
  check(
    "names are Ben and Cid",
    emptyTrio.map((row) => row.name).join(",") === "Ben,Cid",
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

  const labelled = formatTeammateLine(
    {
      canvasserId: ben,
      name: "Ben",
      uprn: 101,
      sequencePosition: 15,
      at: new Date(now).toISOString(),
      stale: false,
      empty: false,
    },
    { house_number: "9", building_name: null, street_name: "Small Street" },
    now,
  );
  check("address ladder before the hash", labelled === "Ben · 9 Small Street", labelled);

  const hashed = formatTeammateLine(
    {
      canvasserId: ben,
      name: "Ben",
      uprn: 101,
      sequencePosition: 15,
      at: new Date(now).toISOString(),
      stale: false,
      empty: false,
    },
    undefined,
    now,
  );
  check("no label falls back to on #16", hashed === "Ben · on #16", hashed);

  const staleRow = teammateRows({
    selfId: ada,
    members,
    people: applyPerson(emptyPeople(), doorSignal("claim", ben, 102, 2, new Date(now).toISOString())),
    serverKnocks: [],
    now,
    connectionLive: false,
  }).find((row) => row.canvasserId === ben);
  const staleText = staleRow ? formatTeammateLine(staleRow, undefined, now) : "";
  check("stale claim is marked stale", staleRow?.stale === true && staleRow.empty === false);
  check("stale claim says when it was heard", staleText.includes("last heard"), staleText);

  const fresh = doorSignal("claim", ada, 100, 0, new Date(now).toISOString());
  check("a new claim is live", claimIsLive(fresh, now + 1_000));
  check("still live at 2 min 59 sec", claimIsLive(fresh, now + 179_000));
  check("expired at 3 min 1 sec", !claimIsLive(fresh, now + 181_000));
  const expiredPeople = applyPerson(emptyPeople(), fresh);
  check(
    "expired claim is not a hold",
    winningHolds(expiredPeople, now + 181_000).length === 0,
  );

  check(
    "one shared door",
    sharedKnockMessage(1, "door 4") ===
      "You and a teammate both logged door 4. It still counts once.",
  );
  check(
    "back out does not reserve again",
    reserveDecision({
      wantReserve: false,
      connectionLive: true,
      sequence,
      knocked: new Set(),
      people: emptyPeople(),
      selfId: me,
      now,
    }).action === "none",
  );
}

type Actor = {
  user: HarnessUser;
  channel: RealtimeChannel;
  people: Map<string, PersonState>;
  wantReserve: boolean;
  heard: Set<string>;
  sequence: SequenceDoor[];
  knocked: Set<number>;
  lastSent: number | null;
};

function step(actor: Actor) {
  const now = Date.now();
  const latest = actor.people.get(actor.user.id)?.latest ?? null;
  const holds = winningHolds(actor.people, now).filter((hold) => !actor.knocked.has(hold.uprn));
  if (!holds.some((hold) => hold.canvasser_id === actor.user.id)) {
    if (latest?.type === "claim" && claimIsLive(latest, now)) actor.wantReserve = true;
  }
  const decision = reserveDecision({
    wantReserve: actor.wantReserve,
    connectionLive: true,
    sequence: actor.sequence,
    knocked: actor.knocked,
    people: actor.people,
    selfId: actor.user.id,
    now,
  });
  if (decision.action === "hold") {
    actor.wantReserve = false;
    return;
  }
  if (decision.action !== "claim") return;
  if (actor.lastSent === decision.uprn && latest?.type === "claim" && latest.uprn === decision.uprn) {
    return;
  }
  actor.lastSent = decision.uprn;
  const signal = doorSignal("claim", actor.user.id, decision.uprn, decision.sequence_position);
  actor.people = applyPerson(actor.people, signal);
  void actor.channel.send({ type: "broadcast", event: DOOR_EVENT, payload: signal });
}

function onSignal(actor: Actor, signal: DoorSignal) {
  actor.people = applyPerson(actor.people, signal);
  if (!actor.heard.has(signal.canvasser_id)) {
    actor.heard.add(signal.canvasser_id);
    const mine = winningHolds(actor.people, Date.now()).find(
      (hold) => hold.canvasser_id === actor.user.id,
    );
    if (mine) void actor.channel.send({ type: "broadcast", event: DOOR_EVENT, payload: mine });
  }
  step(actor);
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

async function main() {
  if (CLEANUP_ONLY) {
    await cleanupAll();
    return;
  }

  const timedAt = Date.now();
  const timedClaim = doorSignal("claim", "timer", 1, 0, new Date(timedAt).toISOString());
  const timedPeople = applyPerson(emptyPeople(), timedClaim);

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
  const ben = await createUser("ben", "Ben Holt");
  const cid = await createUser("cid", "Cid Moss");
  const outsider = await createUser("out", "Out Rider");
  const sol = await createUser("sol", "Sol Page");
  line(`  trio ${ada.name}, ${ben.name}, ${cid.name}; outsider is a different canvasser`);

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
    canvasserIds: [ada.id, ben.id, cid.id],
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
  check("snapshot order has a first door", sequence.length >= 3, `first UPRN ${sequence[0]?.uprn ?? "none"}`);

  const offlineSnapshot = shownDoor(sequence, new Set(), emptyPeople(), ada.id, Date.now(), false);
  check(
    "offline next door is snapshot position 0",
    offlineSnapshot?.uprn === sequence[0]?.uprn && offlineSnapshot?.position === 0,
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
  const { data: benProfile } = await ada.client.from("profiles").select("full_name").eq("id", ben.id).maybeSingle();
  check("Ada can read Ben's name", benProfile?.full_name === "Ben Holt", benProfile?.full_name ?? "none");
  const { data: hidden } = await outsider.client
    .from("profiles")
    .select("full_name")
    .eq("id", ben.id)
    .maybeSingle();
  check("outsider cannot read Ben's name", hidden === null);

  const { data: positions } = await service
    .from("assignment_members")
    .select("route_position_m, route_position_at")
    .eq("assignment_id", assignmentId);
  const positionCount = (positions ?? []).filter(
    (row) => row.route_position_m !== null || row.route_position_at !== null,
  ).length;
  check("route_position_m and route_position_at are null", positionCount === 0, `non-null ${positionCount}`);

  heading("three connected sessions");
  const actors: Actor[] = [];
  for (const user of [ada, ben, cid]) {
    const channel = user.client.channel(assignmentTopic(assignmentId), {
      config: { private: true, broadcast: { self: false } },
    });
    const actor: Actor = {
      user,
      channel,
      people: emptyPeople(),
      wantReserve: true,
      heard: new Set(),
      sequence,
      knocked: new Set(),
      lastSent: null,
    };
    channel.on("broadcast", { event: DOOR_EVENT }, (message) => {
      const signal = parseDoorSignal(message.payload);
      if (!signal || signal.canvasser_id === user.id) return;
      onSignal(actor, signal);
    });
    actors.push(actor);
  }

  const joined = await Promise.all(actors.map((actor) => subscribe(actor.channel)));
  joined.forEach((status, index) => {
    check(`${actors[index].user.name} subscribed`, status === "SUBSCRIBED", status);
  });
  for (const actor of actors) step(actor);

  let distinct = 0;
  let example = 0;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const shown = actors.map((actor) => shownDoor(actor.sequence, actor.knocked, actor.people, actor.user.id, Date.now(), true));
    const ids = shown.map((item) => item?.uprn ?? 0);
    distinct = new Set(ids.filter((id) => id !== 0)).size;
    example = ids.find((id) => id !== 0) ?? 0;
    if (distinct === 3 && shown.every((item) => item !== null)) break;
    await sleep(200);
  }
  check("three sessions show three different next doors", distinct === 3, `distinct ${distinct}, example UPRN ${example}`);

  heading("canvasser not on the assignment");
  let outsiderMessages = 0;
  const outsiderChannel = outsider.client.channel(assignmentTopic(assignmentId), {
    config: { private: true, broadcast: { self: false } },
  });
  outsiderChannel.on("broadcast", { event: DOOR_EVENT }, () => {
    outsiderMessages += 1;
  });
  const outsiderStatus = await subscribe(outsiderChannel);
  const probe = doorSignal("claim", ada.id, sequence[0].uprn, 0);
  await actors[0].channel.send({ type: "broadcast", event: DOOR_EVENT, payload: probe });
  await sleep(2_000);
  check(
    "outsider did not subscribe",
    outsiderStatus !== "SUBSCRIBED",
    outsiderStatus,
  );
  check("outsider received no claim", outsiderMessages === 0, `messages ${outsiderMessages}`);

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
  publicChannel.on("broadcast", { event: DOOR_EVENT }, () => {
    publicMessages += 1;
  });
  const publicStatus = await subscribe(publicChannel, 8_000);
  await actors[0].channel.send({ type: "broadcast", event: DOOR_EVENT, payload: probe });
  await sleep(2_000);
  check(
    "public join is not a way in",
    publicStatus !== "SUBSCRIBED" || publicMessages === 0,
    `${publicStatus}, messages ${publicMessages}`,
  );

  heading("two offline knocks, one covered door");
  const uprn = sequence[0].uprn;
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
  const second = await sendOp(ben.client, knock(ben, new Date(Date.now() + 1_000).toISOString()));
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

  const shared = await uprnsSharedWithTeammate(ben.client, assignmentId, [uprn], ben.id);
  check("resync flags the shared door", shared.has(uprn));

  const { data: positionsAfter } = await service
    .from("assignment_members")
    .select("route_position_m, route_position_at")
    .eq("assignment_id", assignmentId);
  const written = (positionsAfter ?? []).filter(
    (row) => row.route_position_m !== null || row.route_position_at !== null,
  ).length;
  check("route position still unread-only null", written === 0, `non-null ${written}`);

  for (const actor of actors) {
    await actor.user.client.removeChannel(actor.channel);
  }
  await outsider.client.removeChannel(outsiderChannel);
  await publicClient.removeChannel(publicChannel);

  if (!FAST) {
    heading("claim left open for three minutes");
    const remain = timedAt + 181_000 - Date.now();
    if (remain > 0) {
      line(`  waiting ${Math.ceil(remain / 1000)}s`);
      await sleep(remain);
    }
    const age = Date.now() - timedAt;
    check("waited past three minutes", age > 180_000, `${age}ms`);
    check("that claim is no longer live", !claimIsLive(timedClaim, Date.now()));
    check("the door is not held", winningHolds(timedPeople, Date.now()).length === 0);
  }

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
