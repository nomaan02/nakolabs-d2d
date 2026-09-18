/**
 * Stage 8b acceptance harness — the server-side half.
 *
 * Drives the real wire path (`sendOp`) from Node with real signed-in JWTs,
 * exactly as the field app would, so the assertions are about what actually
 * reaches Postgres rather than about what the UI claims. The service role is
 * used only for fixtures, verification counts and cleanup.
 *
 * Covers the acceptance items that are decided by the wire and the schema:
 * one row per client_event_id, knock+lead sharing one id, Rented/Council
 * writing the knock and the observation under one id, replay after a partial
 * failure, latest-wins over v_latest_knock, the address observation path and
 * its effect on v_door_label, and the narrowed payload types.
 *
 * The browser-level items (offline log, undo, force-quit promotion, the
 * 400 ms double tap) run in a real browser against the dev server through
 * `window.__d2dSyncDebug` and the UI itself — they need IndexedDB and are
 * reported separately.
 *
 *   npm run verify:stage8b
 *   npx tsx scripts/verify-stage-8b.ts --cleanup
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import { allocateProp } from "../lib/geo/allocate-prop";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import { londonDate, londonInstant } from "../lib/field/london-date";
import { doorPlate, listLabel, mapLabel } from "../lib/field/labels";
import { PRIMARY_OUTCOMES, outcomeSpec, tenureFor } from "../lib/field/outcomes";
import {
  newClientEventId,
  newRowId,
  validateOp,
  KNOCK_OUTCOMES,
  TENURES,
  type AddressObservationOp,
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
const PASSWORD = "stage8b-harness-pw-7c31";
const CLEANUP_ONLY = process.argv.includes("--cleanup");
/** Leave a signed-in-able canvasser and a prop behind for the browser pass. */
const KEEP = process.argv.includes("--keep");
const TERRITORY_NAME = "STAGE 8B TEST PROP — DELETE ME";
const EMAIL_PREFIX = "stage8b-";

/** Bishopston-ish block; large enough to hold a handful of real UPRNs. */
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
  client: Client;
};

async function createUser(role: "admin" | "canvasser", label: string): Promise<HarnessUser> {
  const email = `${EMAIL_PREFIX}${label}-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Stage 8b ${label}` },
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

// ---------------------------------------------------------------------------
// Op builders — the same shapes lib/field/log-outcome.ts produces.
// ---------------------------------------------------------------------------

type DoorFields = {
  assignmentId: string;
  canvasserId: string;
  uprn: number;
  sequence: number | null;
};

function knockOp(
  fields: DoorFields,
  outcome: KnockEventWrite["outcome"],
  options: {
    clientEventId?: string;
    knockId?: string;
    notes?: string | null;
    bookedFor?: string | null;
    occurredAt?: string;
  } = {},
): KnockEventOp {
  const clientEventId = options.clientEventId ?? newClientEventId();
  const knockId = options.knockId ?? newRowId();
  const occurredAt = options.occurredAt ?? new Date().toISOString();

  const knock: KnockEventWrite = {
    id: knockId,
    client_event_id: clientEventId,
    assignment_id: fields.assignmentId,
    canvasser_id: fields.canvasserId,
    uprn: fields.uprn,
    outcome,
    sequence_position: fields.sequence,
    occurred_at: occurredAt,
    notes: options.notes ?? null,
  };

  const payload: KnockEventOp["payload"] = { knock };

  if (outcome === "lead") {
    const lead: CanvasserLeadInsert = {
      id: newRowId(),
      client_event_id: clientEventId,
      knock_event_id: knockId,
      uprn: fields.uprn,
      canvasser_id: fields.canvasserId,
      booked_for: options.bookedFor ?? null,
      notes: null,
    };
    payload.lead = lead;
  }

  const tenure = tenureFor(outcome);
  if (tenure) {
    payload.observation = {
      id: newRowId(),
      client_event_id: clientEventId,
      uprn: fields.uprn,
      canvasser_id: fields.canvasserId,
      tenure,
      observed_at: occurredAt,
    };
  }

  return {
    kind: "knock_event",
    client_event_id: clientEventId,
    assignment_id: fields.assignmentId,
    canvasser_id: fields.canvasserId,
    payload,
  };
}

function addressOp(fields: DoorFields, houseNumber: string): AddressObservationOp {
  const clientEventId = newClientEventId();
  return {
    kind: "address_observation",
    client_event_id: clientEventId,
    assignment_id: fields.assignmentId,
    canvasser_id: fields.canvasserId,
    payload: {
      address: {
        client_event_id: clientEventId,
        uprn: fields.uprn,
        canvasser_id: fields.canvasserId,
        house_number: houseNumber,
        observed_at: new Date().toISOString(),
      },
    },
  };
}

async function countByClientEventId(clientEventId: string) {
  const [k, l, po, ao] = await Promise.all([
    service
      .from("knock_events")
      .select("id", { count: "exact", head: true })
      .eq("client_event_id", clientEventId),
    service
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("client_event_id", clientEventId),
    service
      .from("property_observations")
      .select("id", { count: "exact", head: true })
      .eq("client_event_id", clientEventId),
    service
      .from("address_observations")
      .select("id", { count: "exact", head: true })
      .eq("client_event_id", clientEventId),
  ]);
  return {
    knocks: k.count ?? 0,
    leads: l.count ?? 0,
    observations: po.count ?? 0,
    addresses: ao.count ?? 0,
  };
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
    const obs = await service
      .from("property_observations")
      .delete()
      .in("canvasser_id", ids)
      .select("id");
    const addr = await service
      .from("address_observations")
      .delete()
      .in("canvasser_id", ids)
      .select("id");
    line(
      `  deleted leads=${leads.data?.length ?? 0} knock_events=${knocks.data?.length ?? 0} ` +
        `property_observations=${obs.data?.length ?? 0} address_observations=${addr.data?.length ?? 0}`,
    );
  }

  const { data: territories } = await service
    .from("territories")
    .select("id")
    .eq("name", TERRITORY_NAME);
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

// ---------------------------------------------------------------------------
// Pure checks — no network.
// ---------------------------------------------------------------------------

function unitChecks() {
  heading("A. outcome mapping — the canonical table");

  check(
    "KNOCK_OUTCOMES has the nine values in the 014 CHECK",
    KNOCK_OUTCOMES.length === 9 && KNOCK_OUTCOMES.includes("no_opportunity"),
    KNOCK_OUTCOMES.join(","),
  );
  check(
    "TENURES includes no_opportunity",
    TENURES.length === 6 && TENURES.includes("no_opportunity"),
    TENURES.join(","),
  );

  const mapping: Array<[string, string]> = [
    ["Lead", "lead"],
    ["Contact", "answered"],
    ["No Answer", "no_answer"],
    ["Rented/Council", "no_opportunity"],
  ];
  for (const [button, outcome] of mapping) {
    const spec = PRIMARY_OUTCOMES.find((s) => s.label === button);
    check(`${button} → ${outcome}`, spec?.outcome === outcome, spec?.outcome ?? "missing");
  }
  check(
    "Rented/Council is the only button that writes a tenure",
    PRIMARY_OUTCOMES.filter((s) => tenureFor(s.outcome) !== null).length === 1 &&
      tenureFor("no_opportunity") === "no_opportunity",
  );
  check(
    "Rented/Council wording is the same on the button, sequence list and legend",
    outcomeSpec("no_opportunity").label === "Rented/Council" &&
      outcomeSpec("no_opportunity").logged === "Rented/Council",
  );
  check(
    "do_not_call is a real enum value, not free text",
    KNOCK_OUTCOMES.includes("do_not_call") && outcomeSpec("do_not_call").label.length > 0,
  );

  heading("B. button order and sizes — the brief's diagram");
  const order = PRIMARY_OUTCOMES.map((s) => `${s.key}:${s.heightPx}`).join(" ");
  check(
    "bottom-up order is No Answer 96, Contact 80, Rented/Council 72, Lead 72",
    order === "no_answer:96 answered:80 no_opportunity:72 lead:72",
    order,
  );

  heading("C. validateOp — the payload traps");
  const fields: DoorFields = {
    assignmentId: newRowId(),
    canvasserId: newRowId(),
    uprn: 1,
    sequence: 0,
  };

  const goodLead = knockOp(fields, "lead");
  check("well-formed knock+lead accepted", validateOp(goodLead) === null, validateOp(goodLead) ?? "");
  check(
    "knock and lead share ONE client_event_id",
    goodLead.payload.lead!.client_event_id === goodLead.payload.knock.client_event_id,
  );

  const withImmediate = knockOp(fields, "lead");
  (withImmediate.payload.lead as Record<string, unknown>).is_immediate = true;
  check(
    "lead payload carrying is_immediate rejected (the trigger owns it)",
    validateOp(withImmediate) !== null,
    validateOp(withImmediate) ?? "",
  );

  const withStatus = knockOp(fields, "lead");
  (withStatus.payload.lead as Record<string, unknown>).status = "sale";
  check("lead payload carrying status rejected", validateOp(withStatus) !== null);

  const noOpp = knockOp(fields, "no_opportunity");
  check("Rented/Council op accepted", validateOp(noOpp) === null, validateOp(noOpp) ?? "");
  check(
    "knock and tenure observation share ONE client_event_id",
    noOpp.payload.observation!.client_event_id === noOpp.payload.knock.client_event_id,
  );

  const strayObservation = knockOp(fields, "no_answer");
  strayObservation.payload.observation = {
    id: newRowId(),
    client_event_id: strayObservation.client_event_id,
    uprn: fields.uprn,
    canvasser_id: fields.canvasserId,
    tenure: "no_opportunity",
    observed_at: new Date().toISOString(),
  };
  check(
    "a tenure observation on a non-no_opportunity knock is rejected",
    validateOp(strayObservation) !== null,
    validateOp(strayObservation) ?? "",
  );

  const longNotes = knockOp(fields, "no_answer", { notes: "x".repeat(281) });
  check("notes over 280 characters rejected before the wire", validateOp(longNotes) !== null);
  const maxNotes = knockOp(fields, "no_answer", { notes: "x".repeat(280) });
  check("notes of exactly 280 accepted", validateOp(maxNotes) === null);

  const address = addressOp(fields, "14A");
  check("address observation op accepted", validateOp(address) === null, validateOp(address) ?? "");
  check(
    "address observation carries its OWN client_event_id",
    address.client_event_id !== goodLead.client_event_id,
  );
  const tooLong = addressOp(fields, "1234567890123");
  check("house number over 12 characters rejected", validateOp(tooLong) !== null);
  const empty = addressOp(fields, "   ");
  check("blank house number rejected", validateOp(empty) !== null);

  heading("D. the label ladder");
  check('"38" on Small Street → plate "38"', doorPlate({ uprn: 1, house_number: "38", building_name: null, street_name: "Small Street" }) === "38");
  check(
    'building only → plate "St. Giles Court"',
    doorPlate({ uprn: 1, house_number: null, building_name: "St. Giles Court", street_name: null }) ===
      "St. Giles Court",
  );
  check('no label at all → plate "—", never "Unknown"', doorPlate(undefined) === "—");
  check(
    'map ladder: number + street → "9 Small Street"',
    mapLabel({ uprn: 1, house_number: "9", building_name: null, street_name: "Small Street" }) ===
      "9 Small Street",
  );
  check(
    'map ladder: building + street → "St. Giles Court, Small Street"',
    mapLabel({
      uprn: 1,
      house_number: null,
      building_name: "St. Giles Court",
      street_name: "Small Street",
    }) === "St. Giles Court, Small Street",
  );
  check("map ladder: nothing → no text at all", mapLabel(undefined) === null);
  check('list ladder falls back to "Door {n}"', listLabel(undefined, 24) === "Door 24");

  heading("E. londonInstant — the lead sheet's quick chips");
  const todayPm = londonInstant(0, 18);
  check(
    "Today PM lands on today's London date",
    londonDate(new Date(todayPm)) === londonDate(),
    `${todayPm} → ${londonDate(new Date(todayPm))}`,
  );
  const shown = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  }).format(new Date(todayPm));
  check("Today PM is 18:00 London wall clock, not 18:00 UTC", shown === "18:00", shown);
  const tomorrowAm = londonInstant(1, 10);
  check(
    "Tomorrow AM is the next London day",
    londonDate(new Date(tomorrowAm)) !== londonDate(),
    londonDate(new Date(tomorrowAm)),
  );
}

// ---------------------------------------------------------------------------

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
    users.push(admin, canvasser);
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
    line(
      `  territory ${territoryId}  assignment ${assignmentId}  doors ${snapshot.length}  date ${today}`,
    );
    if (snapshot.length < 6) throw new Error("test prop has too few doors for this harness");

    const at = (i: number): DoorFields => ({
      assignmentId,
      canvasserId: canvasser.id,
      uprn: snapshot[i],
      sequence: i,
    });

    // -- 1. one tap, one row -------------------------------------------------
    heading("1. a logged knock produces exactly one row");
    const simple = knockOp(at(0), "no_answer", { notes: "Dog · Side entrance" });
    const first = await sendOp(canvasser.client, simple);
    const firstCount = await countByClientEventId(simple.client_event_id);
    check("no_answer sent ok", first.outcome === "ok", `${first.outcome} at ${first.step}`);
    check("exactly one knock_events row", firstCount.knocks === 1, `${firstCount.knocks}`);
    const { data: notesRow } = await service
      .from("knock_events")
      .select("notes, sequence_position")
      .eq("client_event_id", simple.client_event_id)
      .single();
    check("notes reached the row", notesRow?.notes === "Dog · Side entrance", notesRow?.notes ?? "");
    check("sequence_position reached the row", notesRow?.sequence_position === 0);

    // -- 2. replay is idempotent --------------------------------------------
    heading("2. replaying the same client_event_id");
    const replay = await sendOp(canvasser.client, simple);
    const afterReplay = await countByClientEventId(simple.client_event_id);
    check("replay classified as duplicate, not an error", replay.outcome === "duplicate");
    check("still exactly one row", afterReplay.knocks === 1, `${afterReplay.knocks}`);

    // -- 3. lead: one id, two rows ------------------------------------------
    heading("3. Lead → one knock_events row and one leads row, one client_event_id");
    const leadOp = knockOp(at(1), "lead", { bookedFor: londonInstant(0, 18) });
    const leadSend = await sendOp(canvasser.client, leadOp);
    const leadCount = await countByClientEventId(leadOp.client_event_id);
    check("lead sent ok", leadSend.outcome === "ok", `${leadSend.outcome} at ${leadSend.step}`);
    check("one knock and one lead", leadCount.knocks === 1 && leadCount.leads === 1, JSON.stringify(leadCount));
    const { data: leadRow } = await service
      .from("leads")
      .select("is_immediate, status, client_event_id, knock_event_id")
      .eq("client_event_id", leadOp.client_event_id)
      .single();
    check(
      "both rows share the op's client_event_id",
      leadRow?.client_event_id === leadOp.client_event_id,
    );
    check(
      "leads.knock_event_id references the device-generated knock id",
      leadRow?.knock_event_id === leadOp.payload.knock.id,
    );
    check(
      "is_immediate derived true for a same-day booking, without the client sending it",
      leadRow?.is_immediate === true,
      String(leadRow?.is_immediate),
    );
    check("lead lands as pending", leadRow?.status === "pending", leadRow?.status ?? "");

    heading("3b. replay of a lead after a partial failure");
    const leadReplay = await sendOp(canvasser.client, leadOp);
    const leadAfter = await countByClientEventId(leadOp.client_event_id);
    check("replay completes cleanly", leadReplay.outcome === "duplicate", leadReplay.outcome);
    check(
      "no duplicate knock and no duplicate lead",
      leadAfter.knocks === 1 && leadAfter.leads === 1,
      JSON.stringify(leadAfter),
    );

    // Simulate the knock landing but the lead failing: send a knock-only op,
    // then the full op with the same ids, exactly as the queue would retry.
    const partialId = newClientEventId();
    const partialKnockId = newRowId();
    const knockOnly = knockOp(at(2), "lead", {
      clientEventId: partialId,
      knockId: partialKnockId,
      bookedFor: londonInstant(1, 10),
    });
    const leadPayload = knockOnly.payload.lead!;
    delete knockOnly.payload.lead;
    await sendOp(canvasser.client, knockOnly);
    knockOnly.payload.lead = leadPayload;
    const recovered = await sendOp(canvasser.client, knockOnly);
    const recoveredCount = await countByClientEventId(partialId);
    check(
      "knock already there (23505) → carries on to the lead",
      recovered.outcome === "ok" && recovered.step === "lead",
      `${recovered.outcome} at ${recovered.step}`,
    );
    check(
      "one knock, one lead after recovery",
      recoveredCount.knocks === 1 && recoveredCount.leads === 1,
      JSON.stringify(recoveredCount),
    );
    const { data: nextWeek } = await service
      .from("leads")
      .select("is_immediate")
      .eq("client_event_id", partialId)
      .single();
    check(
      "a next-day booking is not an immediate",
      nextWeek?.is_immediate === false,
      String(nextWeek?.is_immediate),
    );

    // -- 4. Rented/Council ---------------------------------------------------
    heading("4. Rented/Council → knock + property_observations, one client_event_id");
    const rented = knockOp(at(3), "no_opportunity");
    const rentedSend = await sendOp(canvasser.client, rented);
    const rentedCount = await countByClientEventId(rented.client_event_id);
    check("sent ok", rentedSend.outcome === "ok", `${rentedSend.outcome} at ${rentedSend.step}`);
    check(
      "one knock and one observation",
      rentedCount.knocks === 1 && rentedCount.observations === 1,
      JSON.stringify(rentedCount),
    );
    const { data: rentedRows } = await service
      .from("knock_events")
      .select("outcome")
      .eq("client_event_id", rented.client_event_id)
      .single();
    const { data: tenureRow } = await service
      .from("property_observations")
      .select("tenure, client_event_id")
      .eq("client_event_id", rented.client_event_id)
      .single();
    check("knock_events.outcome = no_opportunity", rentedRows?.outcome === "no_opportunity");
    check("property_observations.tenure = no_opportunity", tenureRow?.tenure === "no_opportunity");
    check(
      "the two rows share one client_event_id",
      tenureRow?.client_event_id === rented.client_event_id,
    );

    // -- 5. latest-wins ------------------------------------------------------
    heading("5. logging the same door twice");
    const doorFour = at(4);
    const originalTime = new Date(Date.now() - 10 * 60_000).toISOString();
    const original = knockOp(doorFour, "no_answer", { occurredAt: originalTime });
    await sendOp(canvasser.client, original);
    const correction = knockOp(doorFour, "answered");
    await sendOp(canvasser.client, correction);

    const { count: rawCount } = await service
      .from("knock_events")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId)
      .eq("uprn", doorFour.uprn);
    const { data: latest } = await canvasser.client
      .from("v_latest_knock")
      .select("outcome, occurred_at")
      .eq("assignment_id", assignmentId)
      .eq("uprn", doorFour.uprn);
    check("two knock_events rows on the door", rawCount === 2, String(rawCount));
    check("exactly one v_latest_knock row", latest?.length === 1, String(latest?.length));
    check(
      "and it is the newer outcome (answered)",
      latest?.[0]?.outcome === "answered",
      latest?.[0]?.outcome ?? "",
    );
    check(
      "the correction carried a NEW client_event_id",
      correction.client_event_id !== original.client_event_id,
    );

    // -- 6. address observation ---------------------------------------------
    heading("6. typing a house number");
    const doorFive = at(5);
    const { data: beforeLabel } = await canvasser.client
      .rpc("addresses_for_assignment", { p_assignment_id: assignmentId })
      .then((r) => ({ data: r.data?.find((row) => row.uprn === doorFive.uprn) }));

    const numberOp = addressOp(doorFive, "38");
    const numberSend = await sendOp(canvasser.client, numberOp);
    const numberCount = await countByClientEventId(numberOp.client_event_id);
    check("sent ok", numberSend.outcome === "ok", `${numberSend.outcome} at ${numberSend.step}`);
    check("exactly one address_observations row", numberCount.addresses === 1);
    check(
      "and no knock, lead or property_observation was written",
      numberCount.knocks === 0 && numberCount.leads === 0 && numberCount.observations === 0,
      JSON.stringify(numberCount),
    );

    const { data: afterRows } = await canvasser.client.rpc("addresses_for_assignment", {
      p_assignment_id: assignmentId,
    });
    const afterLabel = afterRows?.find((row) => row.uprn === doorFive.uprn);
    check(
      "the label updates from v_door_label on the next read",
      afterLabel?.house_number === "38",
      `${beforeLabel?.house_number ?? "null"} → ${afterLabel?.house_number ?? "null"}`,
    );
    check(
      "addresses_for_assignment returns no sub_building",
      afterLabel !== undefined && !("sub_building" in afterLabel),
      Object.keys(afterLabel ?? {}).join(","),
    );

    const replaceOp = addressOp(doorFive, "38A");
    await sendOp(canvasser.client, replaceOp);
    const { data: correctedRows } = await canvasser.client.rpc("addresses_for_assignment", {
      p_assignment_id: assignmentId,
    });
    check(
      "a second number is a new row and the newest wins",
      correctedRows?.find((row) => row.uprn === doorFive.uprn)?.house_number === "38A",
    );

    // -- 7. the field may not touch leads ------------------------------------
    heading("7. a canvasser still cannot settle a lead");
    const { data: updated, error: updateError } = await canvasser.client
      .from("leads")
      .update({ status: "sale" })
      .eq("client_event_id", leadOp.client_event_id)
      .select("id");
    const { data: stillPending } = await service
      .from("leads")
      .select("status")
      .eq("client_event_id", leadOp.client_event_id)
      .single();
    check(
      "the update matches zero rows and returns NO error — a silent no-op",
      !updateError && (updated?.length ?? 0) === 0,
      `error=${updateError?.code ?? "none"} rows=${updated?.length ?? 0}`,
    );
    check("status is untouched", stillPending?.status === "pending", stillPending?.status ?? "");
    line("  → this is why no field code path may ever write to leads.");

    const { error: deleteError } = await canvasser.client
      .from("knock_events")
      .delete()
      .eq("client_event_id", simple.client_event_id)
      .select("id");
    const afterDelete = await countByClientEventId(simple.client_event_id);
    check(
      "a canvasser DELETE on knock_events removes nothing",
      afterDelete.knocks === 1,
      `error=${deleteError?.code ?? "none"} rows=${afterDelete.knocks}`,
    );

    // -- 8. invalid values still bounce --------------------------------------
    heading("8. the CHECK constraints are still the backstop");
    const bogus = knockOp(at(0), "no_answer");
    (bogus.payload.knock as Record<string, unknown>).outcome = "definitely_not_an_outcome";
    const bogusSend = await sendOp(canvasser.client, bogus);
    check(
      "an outcome outside the enum is a permanent failure, not a retry loop",
      bogusSend.outcome === "permanent",
      `${bogusSend.outcome} ${bogusSend.error?.code ?? ""}`,
    );
    if (KEEP) {
      heading("browser pass");
      line(`  sign in at /login as  ${canvasser.email}  /  ${PASSWORD}`);
      line(`  assignment ${assignmentId} · ${snapshot.length} doors · ${today}`);
      line("  run with --cleanup when finished.");
    }
  } finally {
    if (!KEEP) await cleanupAll();
    if (territoryId && !KEEP) {
      // Cleanup already removed it; this is a belt-and-braces count.
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
