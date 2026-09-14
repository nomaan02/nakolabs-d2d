/**
 * Stage 5 acceptance harness for `allocate_prop`.
 *
 * Runs against the deployed Supabase project over HTTPS as real signed-in
 * users. Nothing here uses `postgres` or bypasses RLS for the RPC itself —
 * visit_count is only written by the service role between calls, to simulate
 * Stage 12b closing an assignment. `allocate_prop` must not increment it.
 *
 *   npm run verify:stage5
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import { allocateProp } from "../lib/geo/allocate-prop";
import { propertiesInPolygon } from "../lib/geo/properties-in-polygon";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import { rotationForVisit, type SweepDirection } from "../lib/geo/rotation";
import type { Database } from "../lib/supabase/types";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "stage5-harness-pw-4c1e";

const STREET: Ring = [
  [-2.5955, 51.4786],
  [-2.5925, 51.4786],
  [-2.5925, 51.4794],
  [-2.5955, 51.4794],
];

const WIDER: Ring = [
  [-2.596, 51.478],
  [-2.5915, 51.478],
  [-2.5915, 51.4798],
  [-2.596, 51.4798],
];

const NCCZ_TEST_ZONE = {
  name: "STAGE 5 TEST ZONE — DELETE ME",
  geojson: {
    type: "Polygon",
    coordinates: [
      [
        [-2.5955, 51.4786],
        [-2.594, 51.4786],
        [-2.594, 51.4794],
        [-2.5955, 51.4794],
        [-2.5955, 51.4786],
      ],
    ],
  },
  source: "stage-5-acceptance-harness",
};

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

async function rpcRaw(
  token: string,
  body: unknown,
  fn = "allocate_prop",
) {
  const response = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
  const email = `stage5-${label}-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Stage 5 ${label}` },
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

function planarAzimuth(from: [number, number], to: [number, number]): number {
  const angle = Math.atan2(to[0] - from[0], to[1] - from[1]);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

function relativeAngle(azimuth: number, entryAzimuth: number, direction: SweepDirection): number {
  const twoPi = 2 * Math.PI;
  const raw = direction === "cw" ? azimuth - entryAzimuth : entryAzimuth - azimuth;
  return ((raw % twoPi) + twoPi) % twoPi;
}

function centroidOf(ring: Ring): [number, number] {
  const open =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  const lon = open.reduce((sum, p) => sum + p[0], 0) / open.length;
  const lat = open.reduce((sum, p) => sum + p[1], 0) / open.length;
  return [lon, lat];
}

function uniqueVertices(ring: Ring): Ring {
  const open =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  return open;
}

function expectedSweep(
  doors: { uprn: number; coord: [number, number] }[],
  ring: Ring,
  entryVertexIndex: number,
  direction: SweepDirection,
): number[] {
  const centre = centroidOf(ring);
  const vertices = uniqueVertices(ring);
  const entry = vertices[entryVertexIndex];
  const entryAz = planarAzimuth(centre, entry);
  return [...doors]
    .map((door) => ({
      uprn: door.uprn,
      key: relativeAngle(planarAzimuth(centre, door.coord), entryAz, direction),
    }))
    .sort((a, b) => a.key - b.key || a.uprn - b.uprn)
    .map((row) => row.uprn);
}

function sweepIsMonotonic(
  ordered: { uprn: number; coord: [number, number] }[],
  ring: Ring,
  entryVertexIndex: number,
  direction: SweepDirection,
): boolean {
  const centre = centroidOf(ring);
  const vertices = uniqueVertices(ring);
  const entryAz = planarAzimuth(centre, vertices[entryVertexIndex]);
  let previous = -1;
  let previousUprn = -1;
  for (const door of ordered) {
    const key = relativeAngle(planarAzimuth(centre, door.coord), entryAz, direction);
    if (key < previous - 1e-12) return false;
    if (Math.abs(key - previous) < 1e-12 && door.uprn < previousUprn) return false;
    previous = key;
    previousUprn = door.uprn;
  }
  return true;
}

async function visitCountOf(territoryId: string): Promise<number> {
  const { data, error } = await service
    .from("territories")
    .select("visit_count")
    .eq("id", territoryId)
    .single();
  if (error || data == null) throw new Error(`visit_count: ${error?.message}`);
  return data.visit_count;
}

async function assignmentRow(id: string) {
  const { data, error } = await service
    .from("assignments")
    .select(
      "id, territory_id, work_date, visit_number, entry_vertex_index, sweep_direction, slot, uprn_snapshot",
    )
    .eq("id", id)
    .single();
  if (error || !data) throw new Error(`assignment ${id}: ${error?.message}`);
  return data;
}

async function main() {
  const users: HarnessUser[] = [];
  let territoryId: string | undefined;
  let zoneId: string | undefined;
  const assignmentIds: string[] = [];

  try {
    heading("fixtures");
    const admin = await createUser("admin", "admin");
    const office = await createUser("office", "office");
    const c1 = await createUser("canvasser", "c1");
    const c2 = await createUser("canvasser", "c2");
    const c3 = await createUser("canvasser", "c3");
    const c4 = await createUser("canvasser", "c4");
    users.push(admin, office, c1, c2, c3, c4);
    for (const u of users) line(`  ${u.role.padEnd(9)} ${u.id}  ${u.email}`);

    const { data: saved, error: saveError } = await admin.client
      .from("territories")
      .insert({
        name: "STAGE 5 TEST PROP — DELETE ME",
        geom: ringToEwkt(STREET),
        created_by: admin.id,
      })
      .select("id")
      .single();
    if (saveError || !saved) throw new Error(`save territory: ${saveError?.message}`);
    territoryId = saved.id;
    const vertices = uniqueVertices(STREET).length;
    line(`  territory ${territoryId}  vertices=${vertices}  visit_count=${await visitCountOf(territoryId)}`);

    heading("1. three allocations of the same prop — visit_count bumped only in the test, as Stage 12b would");
    const dates = ["2099-01-15", "2099-01-16", "2099-01-17"] as const;
    const rotations: {
      date: string;
      visitCountBefore: number;
      visitCountAfter: number;
      visitNumber: number;
      entryVertexIndex: number;
      sweepDirection: string;
      slot: string;
      knockableDoors: number;
      expected: ReturnType<typeof rotationForVisit>;
    }[] = [];

    for (let i = 0; i < 3; i += 1) {
      const visitCountBefore = await visitCountOf(territoryId);
      if (visitCountBefore !== i) {
        throw new Error(`expected visit_count=${i} before allocation ${i + 1}, got ${visitCountBefore}`);
      }
      const expected = rotationForVisit(visitCountBefore + 1, vertices);
      const result = await allocateProp(admin.client, {
        territoryId,
        workDate: dates[i],
        canvasserIds: [c1.id],
      });
      if (!result.ok) {
        const raw = await rpcRaw(admin.token, {
          territory_id: territoryId,
          work_date: dates[i],
          canvasser_ids: [c1.id],
        });
        line(`  FAIL ${dates[i]}  ${result.code}  ${result.message}`);
        line(`  detail ${result.detail ?? "(none)"}`);
        line(`  raw HTTP ${raw.status}  ${JSON.stringify(raw.body)}`);
        throw new Error(`allocate ${dates[i]}: ${result.message} (${result.code})`);
      }
      assignmentIds.push(result.allocation.id);
      const visitCountAfter = await visitCountOf(territoryId);
      rotations.push({
        date: dates[i],
        visitCountBefore,
        visitCountAfter,
        visitNumber: result.allocation.visitNumber,
        entryVertexIndex: result.allocation.entryVertexIndex,
        sweepDirection: result.allocation.sweepDirection,
        slot: result.allocation.slot,
        knockableDoors: result.allocation.knockableDoors,
        expected,
      });
      line(
        `  ${dates[i]}  visit_count ${visitCountBefore}→${visitCountAfter}  ` +
          `n=${result.allocation.visitNumber}  vertex=${result.allocation.entryVertexIndex}  ` +
          `dir=${result.allocation.sweepDirection}  slot=${result.allocation.slot}  ` +
          `doors=${result.allocation.knockableDoors}`,
      );
      line(
        `           expected n=${expected.visitNumber} vertex=${expected.entryVertexIndex} ` +
          `dir=${expected.sweepDirection} slot=${expected.slot}  ` +
          `match=${
            result.allocation.visitNumber === expected.visitNumber &&
            result.allocation.entryVertexIndex === expected.entryVertexIndex &&
            result.allocation.sweepDirection === expected.sweepDirection &&
            result.allocation.slot === expected.slot
          }`,
      );
      if (visitCountAfter !== visitCountBefore) {
        throw new Error("allocate_prop incremented visit_count — it must only read it");
      }
      // Simulate Stage 12b close so the next allocation rotates. Not part of allocate_prop.
      const { error: bumpError } = await service
        .from("territories")
        .update({ visit_count: visitCountBefore + 1 })
        .eq("id", territoryId);
      if (bumpError) throw new Error(`simulate close: ${bumpError.message}`);
    }

    const verticesSeen = rotations.map((r) => r.entryVertexIndex);
    const dirsSeen = rotations.map((r) => r.sweepDirection);
    line(`  entry vertices: ${verticesSeen.join(", ")}`);
    line(`  directions:     ${dirsSeen.join(", ")}`);
    line(
      `  three different vertices: ${new Set(verticesSeen).size === 3}  ` +
        `alternating dirs: ${dirsSeen[0] !== dirsSeen[1] && dirsSeen[1] !== dirsSeen[2] && dirsSeen[0] === dirsSeen[2]}`,
    );

    heading("2. same visit_number always gives the same entry vertex");
    const { error: resetError } = await service
      .from("territories")
      .update({ visit_count: 0 })
      .eq("id", territoryId);
    if (resetError) throw new Error(`reset visit_count: ${resetError.message}`);
    const repeat = await allocateProp(admin.client, {
      territoryId,
      workDate: "2099-01-18",
      canvasserIds: [c1.id],
    });
    if (!repeat.ok) throw new Error(`repro allocate: ${repeat.message}`);
    assignmentIds.push(repeat.allocation.id);
    line(
      `  first  n=${rotations[0].visitNumber} vertex=${rotations[0].entryVertexIndex} dir=${rotations[0].sweepDirection}`,
    );
    line(
      `  repeat n=${repeat.allocation.visitNumber} vertex=${repeat.allocation.entryVertexIndex} dir=${repeat.allocation.sweepDirection}`,
    );
    line(
      `  same vertex: ${repeat.allocation.entryVertexIndex === rotations[0].entryVertexIndex}  ` +
        `same dir: ${repeat.allocation.sweepDirection === rotations[0].sweepDirection}  ` +
        `same slot: ${repeat.allocation.slot === rotations[0].slot}`,
    );
    const stillZero = await visitCountOf(territoryId);
    line(`  visit_count after repeat (must still be 0): ${stillZero}`);

    heading("3. uprn_snapshot excludes NCCZ and follows the angular sweep, not row order");
    const first = await assignmentRow(assignmentIds[0]);
    const doors = await propertiesInPolygon(admin.client, STREET);
    if (!doors.ok) throw new Error(`doors: ${doors.message}`);
    const knockable = doors.doors.features
      .filter((f) => !f.properties.is_nccz)
      .map((f) => ({
        uprn: f.properties.uprn,
        coord: f.geometry.coordinates as [number, number],
      }));
    const ncczUprns = new Set(
      doors.doors.features.filter((f) => f.properties.is_nccz).map((f) => f.properties.uprn),
    );
    const snapshot = first.uprn_snapshot;
    const knockableSet = new Set(knockable.map((d) => d.uprn));
    const byUprn = [...knockable].map((d) => d.uprn).sort((a, b) => a - b);
    const expectedOrder = expectedSweep(
      knockable,
      STREET,
      first.entry_vertex_index,
      first.sweep_direction as SweepDirection,
    );
    const orderedCoords = snapshot.map((uprn) => {
      const door = knockable.find((d) => d.uprn === uprn);
      if (!door) throw new Error(`snapshot UPRN ${uprn} is not knockable`);
      return door;
    });
    line(`  snapshot length ${snapshot.length}  knockable dots ${knockable.length}  nccz dots ${ncczUprns.size}`);
    line(`  set equality with knockable: ${snapshot.length === knockableSet.size && snapshot.every((u) => knockableSet.has(u))}`);
    line(`  none of the snapshot is NCCZ: ${snapshot.every((u) => !ncczUprns.has(u))}`);
    line(`  matches independent angular sweep: ${snapshot.join(",") === expectedOrder.join(",")}`);
    line(
      `  differs from order-by-uprn: ${snapshot.join(",") !== byUprn.join(",")}  ` +
        `(first snapshot=${snapshot[0]} first-by-uprn=${byUprn[0]})`,
    );
    line(
      `  sweep monotonic from entry vertex ${first.entry_vertex_index} ${first.sweep_direction}: ${sweepIsMonotonic(
        orderedCoords,
        STREET,
        first.entry_vertex_index,
        first.sweep_direction as SweepDirection,
      )}`,
    );

    heading("3b. NCCZ doors must drop out of a later snapshot");
    const { data: newZoneId, error: zoneError } = await service.rpc("insert_nccz_zone", {
      p_name: NCCZ_TEST_ZONE.name,
      p_geojson: NCCZ_TEST_ZONE.geojson,
      p_source: NCCZ_TEST_ZONE.source,
    });
    if (zoneError) throw new Error(`insert_nccz_zone: ${zoneError.message}`);
    zoneId = newZoneId as string;
    const { data: flagged, error: flagError } = await service.rpc("apply_nccz_flags");
    if (flagError) throw new Error(`apply_nccz_flags: ${flagError.message}`);
    line(`  flagged ${flagged} properties is_nccz`);

    const { error: bump2 } = await service.from("territories").update({ visit_count: 4 }).eq("id", territoryId);
    if (bump2) throw new Error(bump2.message);
    const withNccz = await allocateProp(admin.client, {
      territoryId,
      workDate: "2099-01-19",
      canvasserIds: [c1.id],
    });
    if (!withNccz.ok) throw new Error(`nccz allocate: ${withNccz.message}`);
    assignmentIds.push(withNccz.allocation.id);
    const ncczRow = await assignmentRow(withNccz.allocation.id);
    const doorsDuring = await propertiesInPolygon(admin.client, STREET);
    if (!doorsDuring.ok) throw new Error(doorsDuring.message);
    const excluded = doorsDuring.doors.features.filter((f) => f.properties.is_nccz).map((f) => f.properties.uprn);
    const overlap = ncczRow.uprn_snapshot.filter((u) => excluded.includes(u));
    line(`  snapshot ${ncczRow.uprn_snapshot.length}  excluded dots ${excluded.length}  overlap ${overlap.length}`);
    line(`  knockable_doors from RPC ${withNccz.allocation.knockableDoors}`);
    line(`  first snapshot (no zone) had ${snapshot.length} doors; this one has ${ncczRow.uprn_snapshot.length}`);

    const { error: delZone } = await service.from("nccz_zones").delete().eq("id", zoneId);
    if (delZone) throw new Error(`delete zone: ${delZone.message}`);
    zoneId = undefined;
    await service.rpc("apply_nccz_flags");

    heading("4. two allocations for the same prop on the same date are rejected");
    const dup = await allocateProp(admin.client, {
      territoryId,
      workDate: dates[0],
      canvasserIds: [c2.id],
    });
    const dupRaw = await rpcRaw(admin.token, {
      territory_id: territoryId,
      work_date: dates[0],
      canvasser_ids: [c2.id],
    });
    line(`  wrapper: ok=${dup.ok} ${dup.ok ? "" : `${dup.code} ${dup.message}`}`);
    line(`  raw HTTP ${dupRaw.status}  ${JSON.stringify(dupRaw.body)}`);
    const { count: sameDateCount } = await service
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("territory_id", territoryId)
      .eq("work_date", dates[0]);
    line(`  rows for ${dates[0]}: ${sameDateCount}`);

    heading("5. editing the prop polygon does not alter an existing snapshot");
    const beforeEdit = [...(await assignmentRow(assignmentIds[0])).uprn_snapshot];
    const { error: editError } = await admin.client
      .from("territories")
      .update({ geom: ringToEwkt(WIDER) })
      .eq("id", territoryId);
    if (editError) throw new Error(`edit geom: ${editError.message}`);
    const afterEdit = (await assignmentRow(assignmentIds[0])).uprn_snapshot;
    line(`  snapshot before ${beforeEdit.length} doors  after ${afterEdit.length}`);
    line(`  unchanged: ${beforeEdit.join(",") === afterEdit.join(",")}`);

    heading("6. three canvassers succeed; a fourth is rejected by Stage 2's trigger");
    const { error: bump3 } = await service.from("territories").update({ visit_count: 5 }).eq("id", territoryId);
    if (bump3) throw new Error(bump3.message);
    const trio = await allocateProp(admin.client, {
      territoryId,
      workDate: "2099-03-01",
      canvasserIds: [c1.id, c2.id, c3.id],
    });
    if (!trio.ok) throw new Error(`trio: ${trio.message}`);
    assignmentIds.push(trio.allocation.id);
    const { data: trioMembers, error: trioErr } = await service
      .from("assignment_members")
      .select("canvasser_id")
      .eq("assignment_id", trio.allocation.id);
    if (trioErr) throw new Error(trioErr.message);
    line(`  trio allocate ok  members=${trioMembers?.length}  ids=${(trioMembers ?? []).map((m) => m.canvasser_id).join(",")}`);

    const beforeFourth = await service
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("territory_id", territoryId);
    const fourth = await allocateProp(admin.client, {
      territoryId,
      workDate: "2099-03-02",
      canvasserIds: [c1.id, c2.id, c3.id, c4.id],
    });
    const fourthRaw = await rpcRaw(admin.token, {
      territory_id: territoryId,
      work_date: "2099-03-02",
      canvasser_ids: [c1.id, c2.id, c3.id, c4.id],
    });
    const afterFourth = await service
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("territory_id", territoryId);
    const orphan = await service
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("territory_id", territoryId)
      .eq("work_date", "2099-03-02");
    line(`  wrapper: ok=${fourth.ok} ${fourth.ok ? "" : `${fourth.code} ${fourth.message}`}`);
    line(`  raw HTTP ${fourthRaw.status}  ${JSON.stringify(fourthRaw.body)}`);
    line(
      `  assignments before=${beforeFourth.count} after=${afterFourth.count}  ` +
        `rows on 2099-03-02=${orphan.count} (must be 0 — no orphaned assignment)`,
    );

    heading("7. who may call it");
    const payload = {
      territory_id: territoryId,
      work_date: "2099-04-01",
      canvasser_ids: [c1.id],
    };
    const asCanvasser = await rpcRaw(c1.token, payload);
    const asOffice = await rpcRaw(office.token, payload);
    const asAnon = await rpcRaw(ANON, payload);
    const asService = await rpcRaw(SERVICE, payload);
    line(`  canvasser HTTP ${asCanvasser.status}  ${JSON.stringify(asCanvasser.body)}`);
    line(`  office     HTTP ${asOffice.status}  ${JSON.stringify(asOffice.body)}`);
    line(`  anon       HTTP ${asAnon.status}  ${JSON.stringify(asAnon.body)}`);
    line(`  service    HTTP ${asService.status}  ${JSON.stringify(asService.body)}`);
    const wrappedCanvasser = await allocateProp(c1.client, {
      territoryId,
      workDate: "2099-04-01",
      canvasserIds: [c1.id],
    });
    line(`  canvasser wrapper: ok=${wrappedCanvasser.ok} ${wrappedCanvasser.ok ? "" : wrappedCanvasser.message}`);

    heading("8. empty team is rejected before an assignment row exists");
    const empty = await allocateProp(admin.client, {
      territoryId,
      workDate: "2099-04-02",
      canvasserIds: [],
    });
    const emptyRaw = await rpcRaw(admin.token, {
      territory_id: territoryId,
      work_date: "2099-04-02",
      canvasser_ids: [],
    });
    line(`  wrapper: ok=${empty.ok} ${empty.ok ? "" : `${empty.code} ${empty.message}`}`);
    line(`  raw HTTP ${emptyRaw.status}  ${JSON.stringify(emptyRaw.body)}`);
  } finally {
    heading("cleanup");
    if (zoneId) {
      await service.from("nccz_zones").delete().eq("id", zoneId);
      await service.rpc("apply_nccz_flags");
      line("removed the test zone after a failure");
    }
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
