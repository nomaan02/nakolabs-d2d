/**
 * Read-only checks for building outlines and per-door slices.
 * PASS/FAIL. Exits 1 on any FAIL.
 *
 * Coverage under 80% is not a failure. The script prints it and stops
 * so the owner can decide (OSM outlines are missing there).
 *
 *   npx tsx scripts/verify-door-footprints.ts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../lib/supabase/types";
import { loadEnvLocal, requiredEnv } from "./lib/env";

loadEnvLocal();

const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const CANVASSER_X = "576c4ce7-5fe0-489f-bd7f-42912925951a";
const TERRITORIES = ["REF - Speedwell", "TEST - dry run", "Whitechurch Lane - Hartcliffe"] as const;
const COVERAGE_TARGET = 80;

type Client = SupabaseClient<Database>;

const service: Client = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
let coverageStop = false;

function line(text = "") {
  console.log(text);
}

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  line(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

type Report = {
  name: string;
  found: boolean;
  buildings: number;
  doors: number;
  doors_with_slice: number;
  single_slices: number;
  shared_slices: number;
  shared_doors: number;
  invalid: number;
  overlaps: number;
  split_buildings: number;
  area_fail: number;
  assignment_id: string | null;
  assignment_open: boolean;
  assignment_work_date: string | null;
  assignment_single_slices: number;
};

function sqlReport(): Report[] {
  const names = TERRITORIES.map((name) => `'${name.replace(/'/g, "''")}'`).join(", ");
  const query = `
with names as (
  select unnest(array[${names}]::text[]) as name
),
terr as (
  select t.id, t.name, t.geom
  from public.territories t
  join names n on n.name = t.name
),
doors as (
  select t.name, p.uprn
  from terr t
  join public.properties p on ST_Intersects(t.geom, p.geom)
),
loaded as (
  select t.name, bf.osm_id, bf.geom
  from terr t
  join public.building_footprints bf
    on ST_Intersects(
      bf.geom,
      ST_MakeEnvelope(
        ST_XMin(t.geom) - 0.0008,
        ST_YMin(t.geom) - 0.0008,
        ST_XMax(t.geom) + 0.0008,
        ST_YMax(t.geom) + 0.0008,
        4326
      )
    )
),
slice_rows as (
  select d.name, df.uprn, df.osm_id, df.shared, df.geom
  from doors d
  join public.door_footprints df on df.uprn = d.uprn
),
distinct_slices as (
  select distinct s.name, s.osm_id, ST_AsBinary(s.geom) as bin, s.geom
  from slice_rows s
),
per_building as (
  select
    d.name,
    d.osm_id,
    count(*) as nslice,
    sum(ST_Area(ST_Transform(d.geom, 27700))) as slice_m2
  from distinct_slices d
  group by d.name, d.osm_id
),
area_cmp as (
  select
    p.name,
    p.osm_id,
    p.slice_m2,
    ST_Area(ST_Transform(bf.geom, 27700)) as bldg_m2
  from per_building p
  join public.building_footprints bf on bf.osm_id = p.osm_id
  where p.nslice > 1
),
open_asg as (
  select distinct on (t.name)
    t.name,
    a.id,
    a.work_date,
    true as open
  from terr t
  join public.assignments a on a.territory_id = t.id
  where a.closed_at is null
  order by t.name, a.work_date desc
),
latest_asg as (
  select distinct on (t.name)
    t.name,
    a.id,
    a.work_date,
    a.closed_at is null as open
  from terr t
  join public.assignments a on a.territory_id = t.id
  order by t.name, a.work_date desc
),
chosen as (
  select
    n.name,
    coalesce(o.id, l.id) as id,
    coalesce(o.work_date, l.work_date) as work_date,
    coalesce(o.open, false) as open
  from names n
  left join open_asg o on o.name = n.name
  left join latest_asg l on l.name = n.name
)
select coalesce(jsonb_agg(jsonb_build_object(
  'name', n.name,
  'found', t.id is not null,
  'buildings', (select count(*) from loaded l where l.name = n.name),
  'doors', (select count(*) from doors d where d.name = n.name),
  'doors_with_slice', (select count(*) from slice_rows s where s.name = n.name),
  'single_slices', (select count(*) from slice_rows s where s.name = n.name and not s.shared),
  'shared_slices', (
    select count(*) from (
      select distinct ST_AsBinary(s.geom)
      from slice_rows s
      where s.name = n.name and s.shared
    ) g
  ),
  'shared_doors', (select count(*) from slice_rows s where s.name = n.name and s.shared),
  'invalid',
    (select count(*) from slice_rows s where s.name = n.name and not ST_IsValid(s.geom))
    + (select count(*) from loaded l where l.name = n.name and not ST_IsValid(l.geom)),
  'overlaps', (
    select count(*)
    from slice_rows a
    join slice_rows b
      on b.name = a.name
     and a.uprn < b.uprn
     and not a.shared
     and not b.shared
     and a.geom && b.geom
    where a.name = n.name
      and ST_Area(ST_Intersection(ST_Transform(a.geom, 27700), ST_Transform(b.geom, 27700))) > 0.5
  ),
  'split_buildings', (select count(*) from area_cmp c where c.name = n.name),
  'area_fail', (
    select count(*)
    from area_cmp c
    where c.name = n.name
      and c.bldg_m2 > 0
      and abs(c.slice_m2 - c.bldg_m2) / c.bldg_m2 > 0.01
  ),
  'assignment_id', c.id,
  'assignment_open', coalesce(c.open, false),
  'assignment_work_date', c.work_date,
  'assignment_single_slices', (
    select count(*)
    from public.door_footprints df
    join public.assignments a on a.id = c.id
    where df.uprn = any (a.uprn_snapshot)
      and not df.shared
  )
) order by n.name), '[]'::jsonb) as report
from names n
left join terr t on t.name = n.name
left join chosen c on c.name = n.name;
`;
  const dir = mkdtempSync(path.join(tmpdir(), "footprints-"));
  const file = path.join(dir, "q.sql");
  writeFileSync(file, query, "utf8");
  // npx is a .cmd shim on Windows. Spawn it as one command so Node does not
  // refuse the shim, and so the arguments are not passed beside shell: true.
  const quoted = file.replace(/"/g, "");
  const out = execFileSync(`npx supabase db query --linked -o json --file "${quoted}"`, {
    encoding: "utf8",
    shell: true,
    windowsHide: true,
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`no json from supabase db query: ${out.slice(0, 400)}`);
  const parsed = JSON.parse(out.slice(start, end + 1)) as { rows?: { report?: Report[] }[] };
  const report = parsed.rows?.[0]?.report;
  if (!Array.isArray(report)) throw new Error("verify query returned no report");
  return report;
}

type FeatureCollection = {
  type?: string;
  features?: {
    properties?: {
      shared?: boolean;
      uprn?: number | null;
    };
  }[];
};

async function canvasserClient(): Promise<{ client: Client; expiresAt: number | null; signOut: () => Promise<void> }> {
  const { data: userData, error: userError } = await service.auth.admin.getUserById(CANVASSER_X);
  const email = userData?.user?.email;
  if (userError || !email) throw new Error(`CanvasserX has no email: ${userError?.message ?? ""}`);
  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new Error(`magic link failed: ${linkError?.message ?? "no token"}`);
  const client = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyError || !verified.session) {
    throw new Error(`verifyOtp failed: ${verifyError?.message ?? "no session"}`);
  }
  return {
    client,
    expiresAt: verified.session.expires_at ?? null,
    signOut: async () => {
      await client.auth.signOut({ scope: "local" });
    },
  };
}

function singleFeatureCount(data: Json): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const features = (data as FeatureCollection).features;
  if (!Array.isArray(features)) return null;
  return features.filter((feature) => feature.properties?.shared === false).length;
}

async function main(): Promise<void> {
  line("door footprints");
  const reports = sqlReport();
  const byName = new Map(reports.map((row) => [row.name, row]));

  for (const name of TERRITORIES) {
    const row = byName.get(name);
    line();
    line(name);
    if (!row || !row.found) {
      check("territory exists", false, "missing");
      continue;
    }
    const pct = row.doors === 0 ? 0 : (100 * row.doors_with_slice) / row.doors;
    line(`  buildings loaded ${row.buildings}`);
    line(`  doors in the territory ${row.doors}`);
    line(`  doors with a slice ${row.doors_with_slice} (${pct.toFixed(1)}%)`);
    line(`  slices: single ${row.single_slices}, shared ${row.shared_slices}; shared doors ${row.shared_doors}`);
    check("invalid geometries 0", row.invalid === 0, String(row.invalid));
    check("single-door overlaps over 0.5 m2 0", row.overlaps === 0, String(row.overlaps));
    check(
      "split building slice area within 1%",
      row.area_fail === 0,
      `${row.area_fail} of ${row.split_buildings} split buildings`,
    );
    if (pct < COVERAGE_TARGET) {
      coverageStop = true;
      line(`  coverage ${pct.toFixed(1)}% is below ${COVERAGE_TARGET}%. Not a failure.`);
    }
  }

  line();
  line("RPC assignment_door_footprints");
  const before = await service.from("profiles").select("role, full_name, active").eq("id", CANVASSER_X).single();
  if (before.error || !before.data) throw new Error(before.error?.message ?? "CanvasserX profile missing");
  check(
    "CanvasserX is an active canvasser",
    before.data.role === "canvasser" && before.data.active === true && before.data.full_name === "CanvasserX",
    `${before.data.full_name} ${before.data.role} active=${before.data.active}`,
  );

  const session = await canvasserClient();
  line(`  magic link for CanvasserX ${CANVASSER_X} expires_at ${session.expiresAt ?? "unknown"}`);
  try {
    for (const name of TERRITORIES) {
      const row = byName.get(name);
      if (!row?.assignment_id) {
        check(`${name} assignment`, false, "none");
        continue;
      }
      const openLabel = row.assignment_open ? "open" : "closed";
      line(
        `  ${name} ${openLabel} assignment ${row.assignment_id} work_date ${row.assignment_work_date ?? "unknown"}`,
      );
      const { data, error } = await session.client.rpc("assignment_door_footprints", {
        p_assignment: row.assignment_id,
      });
      if (error) {
        check(`${name} RPC`, false, error.message);
        continue;
      }
      const singles = singleFeatureCount(data);
      check(
        `${name} single-door features equal doors with a single slice`,
        singles === row.assignment_single_slices,
        `features ${singles ?? "not a collection"}, slices ${row.assignment_single_slices}`,
      );
    }
  } finally {
    await session.signOut();
  }

  const after = await service.from("profiles").select("role, full_name, active").eq("id", CANVASSER_X).single();
  if (after.error || !after.data) throw new Error(after.error?.message ?? "CanvasserX profile missing after");
  check(
    "CanvasserX profile unchanged",
    after.data.role === before.data.role &&
      after.data.full_name === before.data.full_name &&
      after.data.active === before.data.active,
    `${after.data.full_name} ${after.data.role} active=${after.data.active}`,
  );

  line();
  if (coverageStop) {
    line(`STOP. At least one territory is below ${COVERAGE_TARGET}% of doors with a slice. Not a failure. Owner decides.`);
  }
  if (failures > 0) {
    line(`FAIL ${failures}`);
    process.exit(1);
  }
  line("PASS");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
