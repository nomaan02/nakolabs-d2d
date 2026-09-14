/**
 * Stage 4 acceptance harness for `count_knockable`.
 *
 * Runs against the deployed Supabase project over HTTPS as real signed-in
 * users — an admin, an office user and a canvasser — plus anon and the service
 * role. Nothing here uses `postgres` or bypasses RLS, because the point is to
 * exercise the same path the admin map will use.
 *
 * Creates three throwaway users, runs every case, prints request and response
 * for each, then deletes the users and returns `nccz_zones` to empty.
 *
 *   npm run verify:stage4
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import { countKnockable } from "../lib/geo/count-knockable";
import { DOT_CAP, propertiesInPolygon } from "../lib/geo/properties-in-polygon";
import { propWarnings } from "../lib/geo/prop-warnings";
import { ringToEwkt, type Ring } from "../lib/geo/prop-polygon";
import type { Database } from "../lib/supabase/types";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "stage4-harness-pw-9f3a";

// Bristol test props. Bishopston, the area the brief's own example uses.
const RINGS: Record<string, Ring> = {
  street: [
    [-2.5955, 51.4786],
    [-2.5925, 51.4786],
    [-2.5925, 51.4794],
    [-2.5955, 51.4794],
  ],
  doors_300: [
    [-2.596, 51.478],
    [-2.5915, 51.478],
    [-2.5915, 51.4798],
    [-2.596, 51.4798],
  ],
  doors_1800: [
    [-2.5995, 51.4762],
    [-2.5885, 51.4762],
    [-2.5885, 51.4818],
    [-2.5995, 51.4818],
  ],
  doors_2300: [
    [-2.6, 51.4758],
    [-2.5878, 51.4758],
    [-2.5878, 51.4822],
    [-2.6, 51.4822],
  ],
  // Bowtie: a ring that crosses itself. Parses as WKT, invalid under OGC.
  bowtie: [
    [-2.596, 51.478],
    [-2.5915, 51.4798],
    [-2.5915, 51.478],
    [-2.596, 51.4798],
  ],
  two_points: [
    [-2.596, 51.478],
    [-2.5915, 51.4798],
  ],
};

const NCCZ_TEST_ZONE = {
  name: "STAGE 4 TEST ZONE — DELETE ME",
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
  source: "stage-4-acceptance-harness",
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

/** Raw PostgREST call, so the HTTP status is visible and not swallowed. */
async function rpcRaw(
  token: string,
  poly: unknown,
  fn = "count_knockable",
  extra: object = {},
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ poly, ...extra }),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    status: response.status,
    body,
    bytes: Buffer.byteLength(text),
    contentRange: response.headers.get("content-range"),
  };
}

async function rawCase(
  label: string,
  token: string,
  poly: unknown,
  fn = "count_knockable",
  extra: object = {},
) {
  const { status, body, bytes } = await rpcRaw(token, poly, fn, extra);
  const shown = typeof poly === "string" && poly.length > 96 ? `${poly.slice(0, 93)}...` : poly;
  const rendered = JSON.stringify(body);
  line(`${label}`);
  line(`  poly     ${JSON.stringify(shown)}${Object.keys(extra).length ? ` + ${JSON.stringify(extra)}` : ""}`);
  line(`  HTTP     ${status}`);
  line(
    `  response ${rendered.length > 220 ? `${rendered.slice(0, 200)}... (${bytes} bytes)` : rendered}`,
  );
  return { status, body, bytes };
}

async function createUser(role: "admin" | "office" | "canvasser") {
  const email = `stage4-${role}-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Stage 4 ${role}` },
  });
  if (error || !data.user) throw new Error(`createUser ${role}: ${error?.message}`);

  // The Stage 3 trigger writes a canvasser profile; promote where needed.
  if (role !== "canvasser") {
    const { error: roleError } = await service
      .from("profiles")
      .update({ role })
      .eq("id", data.user.id);
    if (roleError) throw new Error(`promote ${role}: ${roleError.message}`);
  }

  const auth = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } = await auth.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError || !session.session) {
    throw new Error(`signIn ${role}: ${signInError?.message}`);
  }

  const client = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });

  return { id: data.user.id, email, role, token: session.session.access_token, client };
}

async function countAsServiceRole(ring: Ring) {
  const { data, error } = await service.rpc("count_knockable", {
    poly: ringToEwkt(ring),
  });
  return { data, error };
}

async function main() {
  const users: { id: string }[] = [];
  let zoneId: string | undefined;

  try {
    heading("fixtures");
    const admin = await createUser("admin");
    const office = await createUser("office");
    const canvasser = await createUser("canvasser");
    users.push(admin, office, canvasser);
    for (const u of [admin, office, canvasser]) {
      line(`  ${u.role.padEnd(9)} ${u.id}  ${u.email}`);
    }

    heading("1. count as an authenticated admin (through lib/geo/count-knockable.ts)");
    for (const label of ["street", "doors_300", "doors_1800", "doors_2300"]) {
      const started = Date.now();
      const result = await countKnockable(admin.client, RINGS[label]);
      const ms = Date.now() - started;
      line(`${label}`);
      line(`  ewkt     ${ringToEwkt(RINGS[label])}`);
      line(`  result   ${JSON.stringify(result)}`);
      line(`  warnings ${JSON.stringify(result.ok ? propWarnings(result.count) : [])}`);
      line(`  round trip ${ms}ms`);
    }

    heading("2. timing — three consecutive runs each, round trip from Node");
    for (const label of ["doors_1800", "doors_2300"]) {
      const timings: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const started = Date.now();
        const result = await countKnockable(admin.client, RINGS[label]);
        timings.push(Date.now() - started);
        if (!result.ok) throw new Error(`timing run failed: ${result.message}`);
      }
      line(`${label}  ${timings.map((t) => `${t}ms`).join("  ")}`);
    }

    heading("3. self-intersecting polygon");
    const bowtieWrapped = await countKnockable(admin.client, RINGS.bowtie);
    line("through the wrapper");
    line(`  ewkt     ${ringToEwkt(RINGS.bowtie)}`);
    line(`  result   ${JSON.stringify(bowtieWrapped)}`);
    await rawCase("raw PostgREST, admin token", admin.token, ringToEwkt(RINGS.bowtie));

    heading("4. other malformed input");
    line("ring with two corners — rejected locally, no network call");
    line(`  result   ${JSON.stringify(await countKnockable(admin.client, RINGS.two_points))}`);
    await rawCase("null polygon", admin.token, null);
    await rawCase(
      "multipolygon",
      admin.token,
      "SRID=4326;MULTIPOLYGON(((-2.596 51.478,-2.5915 51.478,-2.5915 51.4798,-2.596 51.4798,-2.596 51.478)))",
    );
    await rawCase(
      "srid 27700",
      admin.token,
      "SRID=27700;POLYGON((358000 173000,358500 173000,358500 173500,358000 173500,358000 173000))",
    );
    await rawCase("empty polygon", admin.token, "SRID=4326;POLYGON EMPTY");
    await rawCase("not geometry at all", admin.token, "this is not a polygon");

    heading("5. who may call it");
    await rawCase("canvasser token", canvasser.token, ringToEwkt(RINGS.street));
    line("canvasser through the wrapper");
    line(`  result   ${JSON.stringify(await countKnockable(canvasser.client, RINGS.street))}`);
    await rawCase("office token", office.token, ringToEwkt(RINGS.street));
    await rawCase("anon key, no session", ANON, ringToEwkt(RINGS.street));
    await rawCase("service role key", SERVICE, ringToEwkt(RINGS.street));
    line("service role through supabase-js");
    line(`  result   ${JSON.stringify(await countAsServiceRole(RINGS.street))}`);

    heading("6. door dots — properties_in_polygon");
    for (const label of ["street", "doors_2300"]) {
      const count = await countKnockable(admin.client, RINGS[label]);
      const started = Date.now();
      const doors = await propertiesInPolygon(admin.client, RINGS[label]);
      const ms = Date.now() - started;
      if (!count.ok || !doors.ok) {
        line(`${label}  count=${JSON.stringify(count)} doors=${JSON.stringify(doors)}`);
        continue;
      }
      const features = doors.doors.features;
      const unique = new Set(features.map((f) => f.properties.uprn)).size;
      line(`${label}  cap=${DOT_CAP}`);
      line(
        `  count RPC   total=${count.count.total} knockable=${count.count.knockable} excluded=${count.count.excluded}`,
      );
      line(
        `  dot RPC     features=${features.length} unique uprns=${unique} ` +
          `is_nccz=true ${features.filter((f) => f.properties.is_nccz).length} in ${ms}ms`,
      );
      line(
        `  features === count.total  ${features.length === count.count.total} ` +
          `(truncated ${features.length < count.count.total})`,
      );
      line(`  first feature ${JSON.stringify(features[0])}`);
      line(
        `  payload     ${doors.doors.type} bytes=${Buffer.byteLength(JSON.stringify(doors.doors))}`,
      );
    }

    heading("6b. PostgREST's 1000-row ceiling no longer applies to the document");
    const headerProbes: Record<string, string>[] = [{}, { Range: "0-2999" }];
    for (const headers of headerProbes) {
      const probe = await rpcRaw(
        admin.token,
        ringToEwkt(RINGS.doors_2300),
        "properties_in_polygon",
        { cap: 3000 },
        headers,
      );
      const body = probe.body as { features?: unknown[] } | null;
      line(
        `  headers ${JSON.stringify(headers).padEnd(20)} HTTP ${probe.status} ` +
          `features=${body?.features?.length ?? "n/a"} ` +
          `content-range=${probe.contentRange ?? "none"} bytes=${probe.bytes}`,
      );
    }

    heading("7. the cap, and that truncation is stable and declared");
    const capped = await propertiesInPolygon(admin.client, RINGS.doors_2300, 100);
    const cappedAgain = await propertiesInPolygon(admin.client, RINGS.doors_2300, 100);
    const firstUprns = capped.ok
      ? capped.doors.features.map((f) => f.properties.uprn).join(",")
      : "error";
    const secondUprns = cappedAgain.ok
      ? cappedAgain.doors.features.map((f) => f.properties.uprn).join(",")
      : "error";
    line(`doors_2300 with cap 100`);
    line(`  features returned          ${capped.ok ? capped.doors.features.length : capped.code}`);
    line(`  identical set on re-run    ${firstUprns === secondUprns}`);
    line(
      `  UI would say               "Map is showing ${capped.ok ? capped.doors.features.length : 0} of 2,353 doors"`,
    );
    await rawCase("cap 0", admin.token, ringToEwkt(RINGS.street), "properties_in_polygon", {
      cap: 0,
    });
    await rawCase("cap 20000", admin.token, ringToEwkt(RINGS.street), "properties_in_polygon", {
      cap: 20000,
    });
    await rawCase(
      "self-intersecting polygon",
      admin.token,
      ringToEwkt(RINGS.bowtie),
      "properties_in_polygon",
    );
    await rawCase(
      "canvasser token",
      canvasser.token,
      ringToEwkt(RINGS.street),
      "properties_in_polygon",
    );
    await rawCase("anon key, no session", ANON, ringToEwkt(RINGS.street), "properties_in_polygon");
    await rawCase("service role key", SERVICE, ringToEwkt(RINGS.street), "properties_in_polygon");

    heading("8. NCCZ exclusion");
    const before = await service.from("nccz_zones").select("id", { count: "exact", head: true });
    const flaggedBefore = await service
      .from("properties")
      .select("uprn", { count: "exact", head: true })
      .eq("is_nccz", true);
    line(`before: nccz_zones=${before.count} properties.is_nccz=true count=${flaggedBefore.count}`);
    const baseline = await countKnockable(admin.client, RINGS.street);
    line(`before: count as admin ${JSON.stringify(baseline)}`);

    const { data: newZoneId, error: zoneError } = await service.rpc("insert_nccz_zone", {
      p_name: NCCZ_TEST_ZONE.name,
      p_geojson: NCCZ_TEST_ZONE.geojson,
      p_source: NCCZ_TEST_ZONE.source,
    });
    if (zoneError) throw new Error(`insert_nccz_zone: ${zoneError.message}`);
    zoneId = newZoneId as string;
    line(`inserted temporary zone ${zoneId}`);

    const { data: flagged, error: flagError } = await service.rpc("apply_nccz_flags");
    if (flagError) throw new Error(`apply_nccz_flags: ${flagError.message}`);
    line(`apply_nccz_flags() -> ${flagged} properties flagged is_nccz across the whole table`);

    const during = await countKnockable(admin.client, RINGS.street);
    line(`during: count as admin ${JSON.stringify(during)}`);

    // Cross-check with a number computed a different way. The test zone sits
    // wholly inside the street ring, so every is_nccz row in the whole table
    // is inside this prop — apply_nccz_flags()'s table-wide count must equal
    // the prop's `excluded`, and `knockable` must have dropped by exactly that.
    if (baseline.ok && during.ok) {
      line(
        `cross-check: table-wide flagged=${flagged} excluded=${during.count.excluded} ` +
          `total ${baseline.count.total}->${during.count.total} ` +
          `knockable ${baseline.count.knockable}->${during.count.knockable}`,
      );
      line(
        `cross-check: knockable+excluded=${during.count.knockable + during.count.excluded} ` +
          `(total ${during.count.total}) | ` +
          `flagged==excluded ${flagged === during.count.excluded} | ` +
          `knockable fell by ${baseline.count.knockable - during.count.knockable}`,
      );
    }

    const dotsDuring = await propertiesInPolygon(admin.client, RINGS.street);
    if (dotsDuring.ok) {
      const f = dotsDuring.doors.features;
      line(
        `during: dot features=${f.length} ` +
          `is_nccz=true ${f.filter((d) => d.properties.is_nccz).length} ` +
          `is_nccz=false ${f.filter((d) => !d.properties.is_nccz).length} ` +
          `(the map draws these two states differently)`,
      );
    }

    heading("9. clear the test zone back to empty");
    const { error: deleteError } = await service.from("nccz_zones").delete().eq("id", zoneId);
    if (deleteError) throw new Error(`delete zone: ${deleteError.message}`);
    zoneId = undefined;
    const { data: reflagged } = await service.rpc("apply_nccz_flags");
    line(`apply_nccz_flags() -> ${reflagged} properties flagged`);
    const after = await service.from("nccz_zones").select("id", { count: "exact", head: true });
    const flaggedAfter = await service
      .from("properties")
      .select("uprn", { count: "exact", head: true })
      .eq("is_nccz", true);
    line(`after: nccz_zones=${after.count} properties.is_nccz=true count=${flaggedAfter.count}`);
    line(`after: count as admin ${JSON.stringify(await countKnockable(admin.client, RINGS.street))}`);
  } finally {
    heading("cleanup");
    if (zoneId) {
      await service.from("nccz_zones").delete().eq("id", zoneId);
      await service.rpc("apply_nccz_flags");
      line("removed the test zone after a failure");
    }
    for (const u of users) {
      const { error } = await service.auth.admin.deleteUser(u.id);
      line(`deleted user ${u.id}${error ? ` (${error.message})` : ""}`);
    }
    const zones = await service.from("nccz_zones").select("id", { count: "exact", head: true });
    const flagged = await service
      .from("properties")
      .select("uprn", { count: "exact", head: true })
      .eq("is_nccz", true);
    const props = await service
      .from("properties")
      .select("uprn", { count: "exact", head: true });
    line(
      `final: nccz_zones=${zones.count} is_nccz=true ${flagged.count} properties=${props.count}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
