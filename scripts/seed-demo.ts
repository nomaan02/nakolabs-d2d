/**
 * Stage 14a demo seed. Service-role, server-side, `scripts/` only.
 * Never import this file from `app/` or `lib/`.
 *
 * How it identifies its own rows
 * ------------------------------
 * Territories whose name starts with `DEMO - `. Reset walks that prefix in
 * foreign-key-safe order, then also deletes observations whose
 * `client_event_id` starts with `seed-demo-` (those tables do not hang off
 * territories).
 *
 * Auth users are never created. Existing `profiles` rows are read and reused.
 *
 * Usage
 *   npx tsx scripts/seed-demo.ts              seed (refuses if demo rows exist)
 *   npx tsx scripts/seed-demo.ts --reset      remove demo rows only
 *   npx tsx scripts/seed-demo.ts --reset --seed
 */
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SHIFT_DOORS, ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import { rotationForVisit, type Slot } from "../lib/geo/rotation";
import { orderKnockableBySweep, uniqueVertices, type SweepDoor } from "../lib/geo/snapshot";
import type { Database } from "../lib/supabase/types";
import type { KnockOutcome } from "../lib/sync/ops";
import { loadEnvLocal, requiredEnv } from "./lib/env";

const TERRITORY_PREFIX = "DEMO - ";
const CLIENT_EVENT_PREFIX = "seed-demo-";
const RNG_SEED = 0x14a014a0;

/** Fixed window: two working weeks ending Friday 18 September 2026. */
const CREATED_AT = "2026-09-01T08:00:00.000Z";

const LEAD_STATUSES = [
  "pending",
  "re_app",
  "sale",
  "pm",
  "blowout",
  "utc",
  "btc",
  "cancelled",
] as const;
type LeadStatus = (typeof LEAD_STATUSES)[number];

const OUTCOME_WEIGHTS: [KnockOutcome, number][] = [
  ["no_answer", 57],
  ["answered", 20],
  ["no_opportunity", 10],
  ["lead", 5],
  ["refused", 4],
  ["do_not_call", 2],
  ["inaccessible", 1],
  ["callback", 1],
];

const HOUSE_NUMBERS = ["7", "12A", "3", "18", "24", "9", "11", "2"] as const;

type PropSpec = {
  key: "bishopston" | "southville" | "clifton";
  name: string;
  ring: Ring;
  dates: string[];
  /** Fraction of allowed snapshot doors to work, one per visit. */
  workFraction: number[];
  /** Leave a contiguous tail of visit-1's snapshot untouched on every visit. */
  unfinishedTail: number;
};

/**
 * Real Bristol boxes, counted against `properties` before this script was
 * written. Knockable counts at that count: Bishopston 69, Southville 138,
 * Clifton 133 — all inside the 40–150 shift window.
 */
const PROPS: PropSpec[] = [
  {
    key: "bishopston",
    name: `${TERRITORY_PREFIX}Bishopston (Monmouth Road)`,
    ring: [
      [-2.5955, 51.4786],
      [-2.5925, 51.4786],
      [-2.5925, 51.4794],
      [-2.5955, 51.4794],
    ],
    dates: ["2026-09-08", "2026-09-11", "2026-09-16", "2026-09-18"],
    workFraction: [0.96, 0.94, 0.98, 0.92],
    unfinishedTail: 0,
  },
  {
    key: "southville",
    name: `${TERRITORY_PREFIX}Southville (Stackpool Road)`,
    ring: [
      [-2.608, 51.4425],
      [-2.6055, 51.4425],
      [-2.6055, 51.4433],
      [-2.608, 51.4433],
    ],
    dates: ["2026-09-07", "2026-09-10", "2026-09-14"],
    workFraction: [1, 0.9, 0.82],
    unfinishedTail: 48,
  },
  {
    key: "clifton",
    name: `${TERRITORY_PREFIX}Clifton (Princess Victoria Street)`,
    ring: [
      [-2.6205, 51.4555],
      [-2.618, 51.4555],
      [-2.618, 51.4563],
      [-2.6205, 51.4563],
    ],
    dates: ["2026-09-09", "2026-09-15", "2026-09-17"],
    workFraction: [0.88, 0.93, 0.91],
    unfinishedTail: 0,
  },
];

const SLOT_START: Record<Slot, { hour: number; minute: number }> = {
  early: { hour: 10, minute: 0 },
  mid: { hour: 13, minute: 0 },
  late: { hour: 16, minute: 30 },
};

type Profile = { id: string; role: string; full_name: string | null; created_at: string };

class DemoRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uuid(): string {
    const bytes = Array.from({ length: 16 }, () => Math.floor(this.next() * 256));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  clientEventId(): string {
    return `${CLIENT_EVENT_PREFIX}${this.uuid()}`;
  }

  shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const a = out[i]!;
      const b = out[j]!;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }
}

function line(text = "") {
  console.log(text);
}

function heading(text: string) {
  line();
  line(`── ${text} ${"─".repeat(Math.max(0, 68 - text.length))}`);
}

function londonIso(date: string, hour: number, minute: number, second = 0): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  return `${date}T${hh}:${mm}:${ss}+01:00`;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function pointCoord(geom: unknown): [number, number] {
  if (geom && typeof geom === "object") {
    const coordinates = (geom as { coordinates?: unknown }).coordinates;
    if (
      Array.isArray(coordinates) &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      return [coordinates[0], coordinates[1]];
    }
  }
  if (typeof geom === "string") {
    const match = geom.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (match) return [Number(match[1]), Number(match[2])];
  }
  throw new Error(`Could not read a point geometry: ${JSON.stringify(geom)}`);
}

function outcomeBag(n: number, rng: DemoRng): KnockOutcome[] {
  if (n === 0) return [];
  const rows = OUTCOME_WEIGHTS.map(([outcome, weight]) => {
    const exact = (weight / 100) * n;
    return { outcome, n: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let leftover = n - rows.reduce((sum, row) => sum + row.n, 0);
  const ranked = [...rows].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < leftover; i += 1) ranked[i]!.n += 1;
  const bag: KnockOutcome[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.n; i += 1) bag.push(row.outcome);
  }
  return rng.shuffle(bag);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function leadBookedFor(status: LeadStatus, workDate: string, index: number): string | null {
  if (status === "pending") {
    return index % 2 === 0 ? londonIso(workDate, 16, 0) : null;
  }
  if (status === "re_app") {
    return londonIso(addDays(workDate, 7), 14, 0);
  }
  if (status === "utc" || status === "btc" || status === "cancelled") {
    return index % 3 === 0 ? null : londonIso(workDate, 17, 30);
  }
  return londonIso(workDate, 17, 0);
}

async function insertChunk<T extends Record<string, unknown>>(
  supabase: SupabaseClient<Database>,
  table: keyof Database["public"]["Tables"],
  rows: T[],
  chunk = 200,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await supabase.from(table).insert(slice as never);
    if (error) {
      throw new Error(`${String(table)} insert failed: ${error.message}`);
    }
  }
}

function pgError(prefix: string, error: { message: string; code?: string; details?: string; hint?: string }): Error {
  return new Error(
    [prefix, error.code, error.message, error.details, error.hint].filter(Boolean).join(" | "),
  );
}

async function countTable(
  supabase: SupabaseClient<Database>,
  table: keyof Database["public"]["Tables"],
): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) throw pgError(`count ${String(table)}`, error);
  return count ?? 0;
}

async function countMembers(supabase: SupabaseClient<Database>): Promise<number> {
  const { count, error } = await supabase
    .from("assignment_members")
    .select("assignment_id", { count: "exact", head: true });
  if (error) throw pgError("count assignment_members", error);
  return count ?? 0;
}

type TableCounts = {
  territories: number;
  assignments: number;
  assignment_members: number;
  knock_events: number;
  leads: number;
  property_observations: number;
  address_observations: number;
};

async function allCounts(supabase: SupabaseClient<Database>): Promise<TableCounts> {
  return {
    territories: await countTable(supabase, "territories"),
    assignments: await countTable(supabase, "assignments"),
    assignment_members: await countMembers(supabase),
    knock_events: await countTable(supabase, "knock_events"),
    leads: await countTable(supabase, "leads"),
    property_observations: await countTable(supabase, "property_observations"),
    address_observations: await countTable(supabase, "address_observations"),
  };
}

function printCounts(label: string, counts: TableCounts) {
  line(`${label}:`);
  for (const [name, value] of Object.entries(counts)) {
    line(`  ${name.padEnd(24)} ${value}`);
  }
}

/**
 * PostgREST 14 has no `st_within` filter. `ov` is PostGIS `&&` (bounding-box
 * overlap). For these rectangular props that is the candidate set; a strict
 * interior test then matches `allocate_prop`'s `ST_Within` (boundary excluded).
 */
function isInteriorPoint(coord: [number, number], ring: Ring): boolean {
  const vertices = uniqueVertices(ring);
  const xs = vertices.map((p) => p[0]);
  const ys = vertices.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return coord[0] > minX && coord[0] < maxX && coord[1] > minY && coord[1] < maxY;
}

async function fetchDoors(
  supabase: SupabaseClient<Database>,
  ring: Ring,
): Promise<{ all: SweepDoor[]; knockable: SweepDoor[] }> {
  const ewkt = ringToEwkt(ring);
  const { data, error } = await supabase
    .from("properties")
    .select("uprn, geom, is_nccz")
    .filter("geom", "ov", ewkt)
    .limit(3000);
  if (error) throw pgError("properties bbox", error);

  const inside = (data ?? [])
    .map((row) => ({
      uprn: row.uprn,
      coord: pointCoord(row.geom),
      is_nccz: row.is_nccz,
    }))
    .filter((row) => isInteriorPoint(row.coord, ring));

  const all: SweepDoor[] = inside.map((row) => ({ uprn: row.uprn, coord: row.coord }));
  const knockable: SweepDoor[] = inside
    .filter((row) => !row.is_nccz)
    .map((row) => ({ uprn: row.uprn, coord: row.coord }));
  return { all, knockable };
}

async function knockChecksum(supabase: SupabaseClient<Database>): Promise<string> {
  const { data, error } = await supabase
    .from("knock_events")
    .select("id, client_event_id, assignment_id, uprn, outcome, occurred_at, sequence_position")
    .like("client_event_id", `${CLIENT_EVENT_PREFIX}%`)
    .order("client_event_id");
  if (error) throw new Error(`checksum select: ${error.message}`);
  const canonical = (data ?? [])
    .map(
      (row) =>
        `${row.id}|${row.client_event_id}|${row.assignment_id}|${row.uprn}|${row.outcome}|${row.occurred_at}|${row.sequence_position}`,
    )
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

async function resetDemo(supabase: SupabaseClient<Database>): Promise<void> {
  heading("Reset (demo rows only)");

  const { data: territories, error: terrError } = await supabase
    .from("territories")
    .select("id, name")
    .like("name", `${TERRITORY_PREFIX}%`);
  if (terrError) throw new Error(`reset territories: ${terrError.message}`);
  const territoryIds = (territories ?? []).map((row) => row.id);

  let assignmentIds: string[] = [];
  if (territoryIds.length > 0) {
    const { data: assignments, error: asgError } = await supabase
      .from("assignments")
      .select("id")
      .in("territory_id", territoryIds);
    if (asgError) throw new Error(`reset assignments: ${asgError.message}`);
    assignmentIds = (assignments ?? []).map((row) => row.id);
  }

  {
    const { count, error } = await supabase
      .from("leads")
      .delete({ count: "exact" })
      .like("client_event_id", `${CLIENT_EVENT_PREFIX}%`);
    if (error) throw new Error(`reset leads: ${error.message}`);
    line(`  deleted leads                    ${count ?? 0}`);
  }
  {
    const { count, error } = await supabase
      .from("knock_events")
      .delete({ count: "exact" })
      .like("client_event_id", `${CLIENT_EVENT_PREFIX}%`);
    if (error) throw new Error(`reset knock_events: ${error.message}`);
    line(`  deleted knock_events             ${count ?? 0}`);
  }
  {
    const { count, error } = await supabase
      .from("property_observations")
      .delete({ count: "exact" })
      .like("client_event_id", `${CLIENT_EVENT_PREFIX}%`);
    if (error) throw new Error(`reset property_observations: ${error.message}`);
    line(`  deleted property_observations    ${count ?? 0}`);
  }
  {
    const { count, error } = await supabase
      .from("address_observations")
      .delete({ count: "exact" })
      .like("client_event_id", `${CLIENT_EVENT_PREFIX}%`);
    if (error) throw new Error(`reset address_observations: ${error.message}`);
    line(`  deleted address_observations     ${count ?? 0}`);
  }
  if (assignmentIds.length > 0) {
    const { count, error } = await supabase
      .from("assignment_members")
      .delete({ count: "exact" })
      .in("assignment_id", assignmentIds);
    if (error) throw new Error(`reset assignment_members: ${error.message}`);
    line(`  deleted assignment_members       ${count ?? 0}`);
    const { count: asgCount, error: asgDel } = await supabase
      .from("assignments")
      .delete({ count: "exact" })
      .in("id", assignmentIds);
    if (asgDel) throw new Error(`reset assignments delete: ${asgDel.message}`);
    line(`  deleted assignments              ${asgCount ?? 0}`);
  } else {
    line("  deleted assignment_members       0");
    line("  deleted assignments              0");
  }
  if (territoryIds.length > 0) {
    const { count, error } = await supabase
      .from("territories")
      .delete({ count: "exact" })
      .in("id", territoryIds);
    if (error) throw new Error(`reset territories delete: ${error.message}`);
    line(`  deleted territories              ${count ?? 0}`);
  } else {
    line("  deleted territories              0");
  }
}

async function seedDemo(supabase: SupabaseClient<Database>): Promise<void> {
  heading("Profiles (existing — no auth users created)");
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, full_name, created_at")
    .eq("active", true)
    .order("created_at")
    .order("id");
  if (profileError) throw new Error(`profiles: ${profileError.message}`);
  const rows = (profiles ?? []) as Profile[];
  const canvassers = rows.filter((p) => p.role === "canvasser");
  const admins = rows.filter((p) => p.role === "admin");
  const office = rows.filter((p) => p.role === "office");

  if (canvassers.length === 0) {
    throw new Error(
      "No active canvasser profile exists. Create one in the Supabase Dashboard, then re-run. This script will not create auth users.",
    );
  }
  if (office.length === 0) {
    throw new Error(
      "No active office profile exists, so lead statuses cannot be set by the office. Create one in the Supabase Dashboard, then re-run.",
    );
  }

  const team = canvassers.slice(0, Math.min(2, canvassers.length)).map((p) => p.id);
  const adminId = admins[0]?.id ?? null;
  const officeId = office[0]!.id;

  for (const p of rows) {
    line(`  ${p.role.padEnd(10)} ${p.id}  ${p.full_name ?? "(no name)"}`);
  }
  if (canvassers.length < 2) {
    line();
    line(
      "  WARNING: only one canvasser profile exists, so every demo team is a solo. Create a second canvasser in the Supabase Dashboard if you want a duo in the demo.",
    );
  } else {
    line(`  team: duo (${team.length})`);
  }

  const { data: existingDemo, error: existError } = await supabase
    .from("territories")
    .select("id")
    .like("name", `${TERRITORY_PREFIX}%`);
  if (existError) throw new Error(existError.message);
  if ((existingDemo ?? []).length > 0) {
    throw new Error(
      `Demo territories already exist (${existingDemo!.length}). Re-run with --reset to replace them.`,
    );
  }

  const rng = new DemoRng(RNG_SEED);

  heading("Doors inside each prop");
  const prepared: {
    spec: PropSpec;
    knockable: SweepDoor[];
    vertices: Ring;
    territoryId: string;
  }[] = [];

  for (const spec of PROPS) {
    const doors = await fetchDoors(supabase, spec.ring);
    const knockable = doors.knockable;
    line(
      `  ${spec.name}: total ${doors.all.length}, knockable ${knockable.length}, NCCZ ${doors.all.length - knockable.length}`,
    );
    if (knockable.length < SHIFT_DOORS.min || knockable.length > SHIFT_DOORS.max) {
      throw new Error(
        `${spec.name} has ${knockable.length} knockable doors; demo props must sit between ${SHIFT_DOORS.min} and ${SHIFT_DOORS.max}.`,
      );
    }
    prepared.push({
      spec,
      knockable,
      vertices: uniqueVertices(spec.ring),
      territoryId: rng.uuid(),
    });
  }

  type KnockInsert = {
    id: string;
    client_event_id: string;
    assignment_id: string;
    canvasser_id: string;
    uprn: number;
    outcome: KnockOutcome;
    sequence_position: number;
    occurred_at: string;
    synced_at: string;
    notes: string | null;
  };
  type LeadInsert = {
    id: string;
    client_event_id: string;
    knock_event_id: string;
    uprn: number;
    canvasser_id: string;
    booked_for: string | null;
    notes: string | null;
    status: LeadStatus;
    status_set_at: string | null;
    status_set_by: string | null;
  };
  type ObsInsert = {
    id: string;
    client_event_id: string;
    uprn: number;
    canvasser_id: string;
    tenure: "no_opportunity";
    observed_at: string;
  };
  type AddrInsert = {
    id: string;
    client_event_id: string;
    uprn: number;
    canvasser_id: string;
    house_number: string;
    observed_at: string;
  };

  const territoryRows: {
    id: string;
    name: string;
    geom: string;
    visit_count: number;
    last_visited_at: string | null;
    created_by: string | null;
    created_at: string;
  }[] = [];
  const assignmentRows: {
    id: string;
    territory_id: string;
    work_date: string;
    visit_number: number;
    entry_vertex_index: number;
    sweep_direction: "cw" | "ccw";
    slot: Slot;
    uprn_snapshot: number[];
    started_at: string;
    closed_at: string;
    created_by: string | null;
    created_at: string;
  }[] = [];
  const memberRows: { assignment_id: string; canvasser_id: string }[] = [];
  const knockRows: KnockInsert[] = [];
  const leadRows: LeadInsert[] = [];
  const obsRows: ObsInsert[] = [];
  const addrRows: AddrInsert[] = [];

  const coverage: {
    name: string;
    knockable: number;
    everWorked: number;
    lastWorked: number;
  }[] = [];

  let leadIndex = 0;

  heading("Allocations, rotation, knocks");
  for (const prop of prepared) {
    const skip = new Set<number>();
    const ever = new Set<number>();
    let lastWorked = 0;
    let lastClosed: string | null = null;

    for (let visit = 0; visit < prop.spec.dates.length; visit += 1) {
      const visitNumber = visit + 1;
      const workDate = prop.spec.dates[visit]!;
      const rotation = rotationForVisit(visitNumber, prop.vertices.length);
      const snapshot = orderKnockableBySweep(
        prop.knockable,
        prop.spec.ring,
        rotation.entryVertexIndex,
        rotation.sweepDirection,
      );

      if (visit === 0 && prop.spec.unfinishedTail > 0) {
        for (const uprn of snapshot.slice(-prop.spec.unfinishedTail)) skip.add(uprn);
      }

      const allowed = snapshot.filter((uprn) => !skip.has(uprn));
      const nWork = Math.max(0, Math.min(allowed.length, Math.round(allowed.length * prop.spec.workFraction[visit]!)));
      const worked = allowed.slice(0, nWork);
      lastWorked = worked.length;
      for (const uprn of worked) ever.add(uprn);

      const assignmentId = rng.uuid();
      const start = SLOT_START[rotation.slot];
      const startedAt = londonIso(workDate, start.hour, start.minute);
      const outcomes = outcomeBag(worked.length, rng);

      worked.forEach((uprn, workI) => {
        const sequencePosition = snapshot.indexOf(uprn);
        const canvasserId = team[workI % team.length]!;
        const occurredAt = addMinutes(startedAt, workI * 2);
        const clientEventId = rng.clientEventId();
        const knockId = rng.uuid();
        const outcome = outcomes[workI]!;
        knockRows.push({
          id: knockId,
          client_event_id: clientEventId,
          assignment_id: assignmentId,
          canvasser_id: canvasserId,
          uprn,
          outcome,
          sequence_position: sequencePosition,
          occurred_at: occurredAt,
          synced_at: addMinutes(occurredAt, 1),
          notes: null,
        });
        if (outcome === "lead") {
          const status = LEAD_STATUSES[leadIndex % LEAD_STATUSES.length]!;
          const bookedFor = leadBookedFor(status, workDate, leadIndex);
          const settled = status !== "pending";
          leadRows.push({
            id: rng.uuid(),
            client_event_id: clientEventId,
            knock_event_id: knockId,
            uprn,
            canvasser_id: canvasserId,
            booked_for: bookedFor,
            notes: null,
            status,
            status_set_at: settled ? addMinutes(occurredAt, 90) : null,
            status_set_by: settled ? officeId : null,
            // is_immediate is owned by leads_is_immediate_biu — not sent.
          });
          leadIndex += 1;
        }
        if (outcome === "no_opportunity") {
          obsRows.push({
            id: rng.uuid(),
            client_event_id: clientEventId,
            uprn,
            canvasser_id: canvasserId,
            tenure: "no_opportunity",
            observed_at: occurredAt,
          });
        }
      });

      const lastKnock = knockRows.filter((k) => k.assignment_id === assignmentId).at(-1);
      const closedAt = lastKnock ? addMinutes(lastKnock.occurred_at, 8) : addMinutes(startedAt, 30);
      lastClosed = closedAt;

      assignmentRows.push({
        id: assignmentId,
        territory_id: prop.territoryId,
        work_date: workDate,
        visit_number: rotation.visitNumber,
        entry_vertex_index: rotation.entryVertexIndex,
        sweep_direction: rotation.sweepDirection,
        slot: rotation.slot,
        uprn_snapshot: snapshot,
        started_at: startedAt,
        closed_at: closedAt,
        created_by: adminId,
        created_at: startedAt,
      });
      for (const canvasserId of team) {
        memberRows.push({ assignment_id: assignmentId, canvasser_id: canvasserId });
      }

      line(
        `  ${prop.spec.key}  ${workDate}  visit ${visitNumber}  vertex=${rotation.entryVertexIndex}  ` +
          `${rotation.sweepDirection}  ${rotation.slot}  snapshot=${snapshot.length}  worked=${worked.length}`,
      );
    }

    territoryRows.push({
      id: prop.territoryId,
      name: prop.spec.name,
      geom: ringToEwkt(prop.spec.ring),
      visit_count: prop.spec.dates.length,
      last_visited_at: lastClosed,
      created_by: adminId,
      created_at: CREATED_AT,
    });
    coverage.push({
      name: prop.spec.name,
      knockable: prop.knockable.length,
      everWorked: ever.size,
      lastWorked,
    });
  }

  const addrSources = prepared.map((prop) => {
    const first = rotationForVisit(1, prop.vertices.length);
    return orderKnockableBySweep(
      prop.knockable,
      prop.spec.ring,
      first.entryVertexIndex,
      first.sweepDirection,
    );
  });
  const addrUprns = [
    addrSources[0]?.[0],
    addrSources[0]?.[3],
    addrSources[0]?.[6],
    addrSources[1]?.[1],
    addrSources[1]?.[4],
    addrSources[1]?.[8],
    addrSources[2]?.[2],
    addrSources[2]?.[5],
  ].filter((uprn): uprn is number => typeof uprn === "number");
  addrUprns.forEach((uprn, i) => {
    addrRows.push({
      id: rng.uuid(),
      client_event_id: rng.clientEventId(),
      uprn,
      canvasser_id: team[i % team.length]!,
      house_number: HOUSE_NUMBERS[i]!,
      observed_at: londonIso("2026-09-08", 11, i),
    });
  });

  heading("Insert");
  await insertChunk(supabase, "territories", territoryRows);
  await insertChunk(supabase, "assignments", assignmentRows);
  await insertChunk(supabase, "assignment_members", memberRows);
  await insertChunk(supabase, "knock_events", knockRows);
  await insertChunk(supabase, "leads", leadRows);
  await insertChunk(supabase, "property_observations", obsRows);
  await insertChunk(supabase, "address_observations", addrRows);
  line(
    `  wrote territories=${territoryRows.length} assignments=${assignmentRows.length} ` +
      `members=${memberRows.length} knocks=${knockRows.length} leads=${leadRows.length} ` +
      `tenure obs=${obsRows.length} address obs=${addrRows.length}`,
  );

  heading("Seed summary");
  const outcomeDist = new Map<string, number>();
  for (const row of knockRows) {
    outcomeDist.set(row.outcome, (outcomeDist.get(row.outcome) ?? 0) + 1);
  }
  line("  knock outcomes:");
  for (const [outcome, n] of [...outcomeDist.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = ((n / knockRows.length) * 100).toFixed(1);
    line(`    ${outcome.padEnd(16)} ${String(n).padStart(5)}  ${pct}%`);
  }
  const leadDist = new Map<string, number>();
  for (const row of leadRows) {
    leadDist.set(row.status, (leadDist.get(row.status) ?? 0) + 1);
  }
  line("  lead statuses:");
  for (const status of LEAD_STATUSES) {
    line(`    ${status.padEnd(16)} ${leadDist.get(status) ?? 0}`);
  }
  line(`  no_opportunity knocks:          ${outcomeDist.get("no_opportunity") ?? 0}`);
  line(`  matching tenure observations:   ${obsRows.length}`);
  line("  coverage (ever-worked unique UPRNs vs knockable):");
  for (const row of coverage) {
    line(
      `    ${row.name}: knockable ${row.knockable}, ever worked ${row.everWorked}, last visit ${row.lastWorked}`,
    );
  }

  const checksum = await knockChecksum(supabase);
  line();
  line(`  knock_events checksum (ordered by client_event_id): ${checksum}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const doReset = args.has("--reset");
  const doSeed = !doReset || args.has("--seed");

  loadEnvLocal();
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  line("Stage 14a demo seed");
  line(`Territory prefix: "${TERRITORY_PREFIX}"`);
  line(`client_event_id prefix: "${CLIENT_EVENT_PREFIX}"`);
  line(`RNG seed: 0x${RNG_SEED.toString(16)}`);

  const before = await allCounts(supabase);
  printCounts("Counts before", before);

  if (doReset) await resetDemo(supabase);
  if (doSeed) await seedDemo(supabase);

  const after = await allCounts(supabase);
  printCounts("Counts after", after);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
