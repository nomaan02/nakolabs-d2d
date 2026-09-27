/**
 * Robust walkline offset, Session B2 — the only writer for the re-save and
 * the two re-freezes.
 *
 * Hard-coded allow-list. No arguments. Refuses anything else, including
 * redland_test, any "DEMO -" prop, and any assignment with knocks.
 *
 * Re-saves REF - Speedwell, TEST - dry run and Northville.
 * Re-freezes c14aa0d1 (TEST - dry run, best) and 3cdbb911 (Northville,
 * best_reversed). Does not re-freeze 0de4d001 (49 knocks, closed) or
 * 0c32a933 (closed, reallocated). Owner decision N, 2026-09-27.
 *
 * Run from the repo root in PowerShell, only after `npm run verify:geom`
 * and `npm run verify:geom -- --live` have been compared to the pinned set:
 *
 *   npx tsx scripts/route-geom-apply.ts
 */

import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import type { Database } from "@/lib/supabase/types";
import { makeProjection, type LonLat } from "@/lib/geo/route-graph";
import { saveTerritoryRoutes } from "@/lib/geo/walk/save";
import { freezeAssignmentRoute } from "@/lib/geo/walk/freeze";
import type { WalkVariant } from "@/lib/geo/walk/types";
import type { GeometryIssue } from "@/lib/geo/walk/validate";
import { lineCoordinates } from "@/lib/map/route-layers";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const service = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TERRITORIES = ["REF - Speedwell", "TEST - dry run", "Northville"] as const;

const REFREEZE = [
  {
    id: "c14aa0d1-8675-4204-80c4-a1c428c95f2f",
    territory: "TEST - dry run",
    key: "best",
  },
  {
    id: "3cdbb911-f148-4de7-848e-086b120190d8",
    territory: "Northville",
    key: "best_reversed",
  },
] as const;

/** Closed or worked. A re-freeze here is refused even if someone adds the id above. */
const NEVER_REFREEZE = [
  "0de4d001-f004-412c-80f5-0c297bc02526",
  "0c32a933-6111-4db1-9402-841f8b3bb65b",
] as const;

/** The Session A3 pinned set, metres to 2 decimal places. Compared as a set. */
const PINNED_NORTHVILLE = [
  "(alt_1, 365, V3, 10.97)",
  "(alt_1, 366, V4, 0.89)",
  "(alt_4, 281, V3, 10.97)",
  "(alt_4, 282, V4, 0.89)",
  "(best, 305, V3, 10.97)",
  "(best, 306, V4, 0.89)",
];

type Status = "PASS" | "FAIL";
const results: { item: string; status: Status; evidence: string }[] = [];

function record(item: string, status: Status, evidence: string): void {
  results.push({ item, status, evidence });
  console.log(`  [${status}] ${item}\n         ${evidence.replace(/\n/g, "\n         ")}`);
}

function heading(title: string): void {
  console.log(`\n== ${title}`);
}

function md5(value: unknown): string {
  return createHash("md5").update(JSON.stringify(value)).digest("hex");
}

function issueLine(issue: GeometryIssue): string {
  return `(${issue.variant}, ${issue.step}, ${issue.check}, ${issue.metres.toFixed(2)})`;
}

function sameSet(actual: string[], expected: string[]): { missing: string[]; extra: string[] } {
  const got = new Set(actual);
  const want = new Set(expected);
  return {
    missing: expected.filter((line) => !got.has(line)),
    extra: actual.filter((line) => !want.has(line)),
  };
}

type AssignmentRow = {
  id: string;
  territory_id: string;
  route_variant_key: string | null;
  work_date: string;
  visit_number: number;
  closed_at: string | null;
};

type RouteRow = {
  id: string;
  variant_key: string;
  rank_cost_m: number;
  door_order: number[];
};

type StoredStep = {
  step_index: number;
  kind: string;
  side: string;
  street_name: string | null;
  first_seq: number | null;
  last_seq: number | null;
  instruction: string;
  is_dead_end: boolean;
  segment_id: number | null;
  length_m: number;
  walkline: unknown;
};

async function adminClient(): Promise<{
  client: SupabaseClient<Database>;
  email: string;
  userId: string;
  signOut: () => Promise<void>;
}> {
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, role, active, created_at")
    .eq("role", "admin")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error || !profiles || profiles.length === 0) {
    throw new Error(`no active admin profile: ${error?.message ?? "none"}`);
  }
  const adminId = profiles[0].id;
  const { data: userData, error: userError } = await service.auth.admin.getUserById(adminId);
  const email = userData?.user?.email;
  if (userError || !email) throw new Error(`admin has no email: ${userError?.message ?? ""}`);
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new Error(`magic link failed: ${linkError?.message ?? "no token"}`);
  const client = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyError || !verified.session || !verified.user) {
    throw new Error(`verifyOtp failed: ${verifyError?.message ?? "no session"}`);
  }
  console.log(
    `session created: admin magic link for ${email}, user ${verified.user.id}. Password, profile and role were not changed. Local sign-out at the end.`,
  );
  return {
    client,
    email,
    userId: verified.user.id,
    signOut: async () => {
      await client.auth.signOut({ scope: "local" });
    },
  };
}

async function territoryId(name: string): Promise<string> {
  if (name === "redland_test" || name.startsWith("DEMO -")) {
    throw new Error(`refusing territory ${name}`);
  }
  if (!TERRITORIES.includes(name as (typeof TERRITORIES)[number])) {
    throw new Error(`refusing territory ${name}: not on the allow-list`);
  }
  const { data, error } = await service.from("territories").select("id, name").eq("name", name);
  if (error) throw new Error(`${name}: ${error.message}`);
  if (!data || data.length !== 1) throw new Error(`${name}: expected 1 row, found ${data?.length ?? 0}`);
  return data[0].id;
}

async function knockCount(assignmentId: string): Promise<number> {
  const { count, error } = await service
    .from("knock_events")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);
  if (error || count === null) throw new Error(`knock count ${assignmentId}: ${error?.message ?? "null"}`);
  return count;
}

async function loadAssignment(id: string): Promise<AssignmentRow> {
  const { data, error } = await service
    .from("assignments")
    .select("id, territory_id, route_variant_key, work_date, visit_number, closed_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error(`assignment ${id}: ${error?.message ?? "missing"}`);
  return data;
}

type PropCounts = {
  routes: number;
  steps: number;
};

async function propCounts(territoryIdValue: string): Promise<PropCounts> {
  const { data, error } = await service.from("territory_routes").select("id").eq("territory_id", territoryIdValue);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => row.id);
  let steps = 0;
  for (const routeId of ids) {
    const counted = await service
      .from("territory_route_steps")
      .select("id", { count: "exact", head: true })
      .eq("route_id", routeId);
    if (counted.error || counted.count === null) throw new Error(counted.error?.message ?? "step count null");
    steps += counted.count;
  }
  return { routes: ids.length, steps };
}

type StepIdStats = { count: number; minId: string | null };

async function routeStepStats(assignmentId: string): Promise<StepIdStats> {
  const counted = await service
    .from("route_steps")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);
  if (counted.error || counted.count === null) throw new Error(counted.error?.message ?? "route_steps count null");
  const min = await service
    .from("route_steps")
    .select("id")
    .eq("assignment_id", assignmentId)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (min.error) throw new Error(min.error.message);
  return { count: counted.count, minId: min.data ? String(min.data.id) : null };
}

function section2Key(index: number, step: {
  kind: string;
  side: string;
  street_name: string | null;
  first_seq: number | null;
  last_seq: number | null;
  instruction: string;
  is_dead_end: boolean;
  segment_id: number | null;
  length_m: number;
}): string {
  return [
    index,
    step.kind,
    step.side,
    step.street_name,
    step.first_seq,
    step.last_seq,
    step.instruction,
    step.is_dead_end,
    step.segment_id,
    step.length_m,
  ].join("|");
}

async function fetchStoredSteps(routeId: string): Promise<StoredStep[]> {
  const page = 1000;
  const out: StoredStep[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await service
      .from("territory_route_steps")
      .select(
        "step_index, kind, side, street_name, first_seq, last_seq, instruction, is_dead_end, segment_id, length_m, walkline",
      )
      .eq("route_id", routeId)
      .order("step_index", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as StoredStep[];
    for (const row of rows) out.push({ ...row, length_m: Number(row.length_m) });
    if (rows.length < page) break;
  }
  return out;
}

function rawCounts(lines: [number, number][][]): { gaps: number; crossing: number; selfCrossing: number } {
  const origin = lines.find((line) => line.length > 0)?.[0] ?? ([0, 0] as LonLat);
  const project = makeProjection(origin);
  const xy = lines.map((line) => line.map((point) => project(point)));
  let gaps = 0;
  let crossing = 0;
  let selfCrossing = 0;
  const edgesCross = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
    d: { x: number; y: number },
  ): boolean => {
    const side = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
      Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  };
  for (let i = 0; i < xy.length; i += 1) {
    const line = xy[i];
    let selfHit = false;
    for (let p = 0; p + 1 < line.length && !selfHit; p += 1) {
      for (let q = p + 2; q + 1 < line.length && !selfHit; q += 1) {
        if (edgesCross(line[p], line[p + 1], line[q], line[q + 1])) selfHit = true;
      }
    }
    if (selfHit) selfCrossing += 1;
    if (i + 1 < xy.length) {
      const next = xy[i + 1];
      if (line.length > 0 && next.length > 0) {
        const gap = Math.hypot(line[line.length - 1].x - next[0].x, line[line.length - 1].y - next[0].y);
        if (gap > 0.5) {
          gaps += 1;
          let crosses = false;
          for (let p = 0; p + 1 < line.length && !crosses; p += 1) {
            for (let q = 0; q + 1 < next.length && !crosses; q += 1) {
              if (edgesCross(line[p], line[p + 1], next[q], next[q + 1])) crosses = true;
            }
          }
          if (crosses) crossing += 1;
        }
      }
    }
  }
  return { gaps, crossing, selfCrossing };
}

function maxPointDeltaM(stored: [number, number][], generated: LonLat[]): { points: string; maxM: number | null } {
  if (stored.length !== generated.length) {
    return { points: `${stored.length} stored vs ${generated.length} generated`, maxM: null };
  }
  if (stored.length === 0) return { points: "0", maxM: 0 };
  const project = makeProjection(generated[0]);
  let max = 0;
  for (let i = 0; i < stored.length; i += 1) {
    const a = project(stored[i]);
    const b = project(generated[i]);
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance > max) max = distance;
  }
  return { points: String(stored.length), maxM: max };
}

async function main(): Promise<void> {
  const extra = process.argv.slice(2);
  if (extra.length > 0) {
    throw new Error("route-geom-apply.ts takes no arguments. The allow-list is hard-coded.");
  }

  const ids = new Map<string, string>();
  for (const name of TERRITORIES) ids.set(name, await territoryId(name));

  heading("Gates before any write");
  const gateFailures: string[] = [];
  for (const banned of NEVER_REFREEZE) {
    if (REFREEZE.some((target) => target.id === banned)) {
      gateFailures.push(`${banned} is on the never-re-freeze list`);
    }
  }
  console.log(`  Not re-freezing: ${NEVER_REFREEZE.join(", ")}`);

  for (const target of REFREEZE) {
    const row = await loadAssignment(target.id);
    const knocks = await knockCount(target.id);
    const territoryName = [...ids.entries()].find(([, id]) => id === row.territory_id)?.[0] ?? "(other)";
    console.log(
      `  ${target.id} territory ${territoryName} work_date ${row.work_date} visit ${row.visit_number} key ${row.route_variant_key ?? "null"} closed_at ${row.closed_at ?? "null"} knocks ${knocks}`,
    );
    if (territoryName !== target.territory) {
      gateFailures.push(`${target.id} is on ${territoryName}, not ${target.territory}`);
    }
    if (row.route_variant_key !== target.key) {
      gateFailures.push(`${target.id} key is ${row.route_variant_key ?? "null"}, not ${target.key}`);
    }
    if (knocks !== 0) {
      gateFailures.push(`${target.id} has ${knocks} knocks`);
    }
    if (row.closed_at !== null) {
      gateFailures.push(`${target.id} is closed (${row.closed_at})`);
    }
  }
  if (gateFailures.length > 0) {
    throw new Error(`Nothing written.\n${gateFailures.map((line) => `- ${line}`).join("\n")}`);
  }

  heading("Row counts before");
  const beforeProps = new Map<string, PropCounts>();
  for (const name of TERRITORIES) {
    const counts = await propCounts(ids.get(name)!);
    beforeProps.set(name, counts);
    console.log(`  ${name}: territory_routes ${counts.routes}, territory_route_steps ${counts.steps}`);
  }
  const beforeSteps = new Map<string, StepIdStats>();
  for (const target of REFREEZE) {
    const stats = await routeStepStats(target.id);
    beforeSteps.set(target.id, stats);
    console.log(`  route_steps ${target.id}: count ${stats.count}, min id ${stats.minId ?? "none"}`);
  }

  const admin = await adminClient();
  const savedByName = new Map<string, WalkVariant[]>();
  const issuesByName = new Map<string, GeometryIssue[]>();
  try {
    heading("Re-save territory variants");
    for (const name of TERRITORIES) {
      const saved = await saveTerritoryRoutes(admin.client, ids.get(name)!);
      if (!saved.ok) {
        throw new Error(`${name} save failed: ${saved.code} ${saved.message} ${saved.detail ?? ""}`);
      }
      savedByName.set(name, saved.result.variants);
      issuesByName.set(name, saved.issues);
      console.log(
        `  saved ${name}: ${saved.summary.variants} variants, ${saved.summary.steps} steps, keys ${saved.summary.keys.join(", ")}`,
      );
    }

    heading("Re-freeze");
    for (const target of REFREEZE) {
      const knocks = await knockCount(target.id);
      const row = await loadAssignment(target.id);
      console.log(
        `  recount ${target.id}: knocks ${knocks}, key ${row.route_variant_key ?? "null"}, closed_at ${row.closed_at ?? "null"}`,
      );
      if (knocks !== 0) throw new Error(`${target.id} has ${knocks} knocks at freeze time. Freeze skipped.`);
      if (row.closed_at !== null) {
        throw new Error(`${target.id} is closed (${row.closed_at}) at freeze time. Freeze skipped.`);
      }
      if (row.route_variant_key !== target.key) {
        throw new Error(`${target.id} key changed to ${row.route_variant_key ?? "null"}. Freeze skipped.`);
      }
      const frozen = await freezeAssignmentRoute(admin.client, target.id, target.key);
      if (!frozen.ok) {
        throw new Error(`${target.id} freeze failed: ${frozen.code} ${frozen.message} ${frozen.detail ?? ""}`);
      }
      console.log(
        `  froze ${target.id}: key ${frozen.summary.variantKey}, steps ${frozen.summary.steps}, route ${frozen.summary.routeId}`,
      );
    }

    heading("Row counts after");
    for (const name of TERRITORIES) {
      const counts = await propCounts(ids.get(name)!);
      const before = beforeProps.get(name);
      console.log(
        `  ${name}: territory_routes ${before?.routes ?? "?"} → ${counts.routes}, territory_route_steps ${before?.steps ?? "?"} → ${counts.steps}`,
      );
    }
    for (const target of REFREEZE) {
      const stats = await routeStepStats(target.id);
      const before = beforeSteps.get(target.id);
      const rose =
        before?.minId !== null &&
        before?.minId !== undefined &&
        stats.minId !== null &&
        BigInt(stats.minId) > BigInt(before.minId);
      console.log(
        `  route_steps ${target.id}: count ${before?.count ?? "?"} → ${stats.count}, min id ${before?.minId ?? "none"} → ${stats.minId ?? "none"}`,
      );
      record(
        `${target.territory} route_steps min id rose`,
        rose && stats.count > 0 ? "PASS" : "FAIL",
        `count ${before?.count} → ${stats.count}; min id ${before?.minId} → ${stats.minId}`,
      );
    }

    heading("Stored rows against the saved variants");
    for (const name of TERRITORIES) {
      const variants = savedByName.get(name) ?? [];
      const issues = issuesByName.get(name) ?? [];
      const lines = issues
        .map(issueLine)
        .sort((a, b) => a.localeCompare(b));
      const expected = name === "Northville" ? [...PINNED_NORTHVILLE].sort((a, b) => a.localeCompare(b)) : [];
      const diff = sameSet(lines, expected);
      const ok = diff.missing.length === 0 && diff.extra.length === 0;
      record(
        `${name}: validator issue set`,
        ok ? "PASS" : "FAIL",
        lines.length === 0
          ? "0 issues"
          : `${lines.join("\n")}\nmissing: ${diff.missing.join("; ") || "none"}\nextra: ${diff.extra.join("; ") || "none"}`,
      );

      const routes = await service
        .from("territory_routes")
        .select("id, variant_key, rank_cost_m, door_order")
        .eq("territory_id", ids.get(name)!);
      if (routes.error) throw new Error(routes.error.message);
      const byKey = new Map<string, RouteRow>();
      for (const row of routes.data ?? []) {
        byKey.set(row.variant_key, {
          id: row.id,
          variant_key: row.variant_key,
          rank_cost_m: Number(row.rank_cost_m),
          door_order: (row.door_order ?? []).map(Number),
        });
      }

      let gaps = 0;
      let crossing = 0;
      let selfCrossing = 0;
      let maxDelta = 0;
      let maxDeltaWhere = "no steps";
      const spec2: string[] = [];
      for (const variant of variants) {
        const storedRoute = byKey.get(variant.key);
        if (!storedRoute) {
          spec2.push(`${variant.key}: no stored route`);
          continue;
        }
        const storedSteps = await fetchStoredSteps(storedRoute.id);
        const storedKeys = storedSteps.map((step) => section2Key(step.step_index, step));
        const generatedKeys = variant.steps.map((step, index) => section2Key(index, step));
        if (
          md5(storedKeys) !== md5(generatedKeys) ||
          storedRoute.rank_cost_m !== variant.rank_cost_m ||
          md5(storedRoute.door_order) !== md5(variant.door_order)
        ) {
          spec2.push(
            `${variant.key}: step md5 ${md5(storedKeys)} vs ${md5(generatedKeys)} (${storedKeys.length} vs ${generatedKeys.length}); rank ${storedRoute.rank_cost_m} vs ${variant.rank_cost_m}; door_order md5 ${md5(storedRoute.door_order)} vs ${md5(variant.door_order)}`,
          );
        }
        const linesForRaw: [number, number][][] = [];
        for (let i = 0; i < storedSteps.length; i += 1) {
          const storedLine = lineCoordinates(storedSteps[i].walkline) ?? [];
          linesForRaw.push(storedLine);
          const generated = variant.steps[i]?.walkline ?? [];
          const delta = maxPointDeltaM(storedLine, generated);
          if (delta.maxM === null || delta.maxM >= maxDelta) {
            maxDelta = delta.maxM ?? Number.POSITIVE_INFINITY;
            maxDeltaWhere = `${variant.key} step ${i}: ${delta.points}, max ${delta.maxM === null ? "point-count mismatch" : `${delta.maxM.toFixed(3)} m`}`;
          }
        }
        const raw = rawCounts(linesForRaw);
        gaps += raw.gaps;
        crossing += raw.crossing;
        selfCrossing += raw.selfCrossing;
      }
      record(
        `${name}: stored walkline raw counts`,
        gaps === 0 && crossing === 0 && selfCrossing === 0 ? "PASS" : "FAIL",
        `gaps ${gaps}, crossing-next-step ${crossing}, self-crossing ${selfCrossing}`,
      );
      record(
        `${name}: §2 fields match the saved variant`,
        spec2.length === 0 ? "PASS" : "FAIL",
        spec2.length === 0 ? `${variants.length} variants` : spec2.join("\n"),
      );
      record(
        `${name}: stored walkline matches the saved variant`,
        Number.isFinite(maxDelta) && maxDelta <= 0.05 ? "PASS" : "FAIL",
        maxDeltaWhere,
      );
    }

    heading("Frozen route_steps raw counts");
    for (const target of REFREEZE) {
      const page = 1000;
      const lines: [number, number][][] = [];
      for (let from = 0; ; from += page) {
        const { data, error } = await service
          .from("route_steps")
          .select("step_index, walk_geom")
          .eq("assignment_id", target.id)
          .order("step_index", { ascending: true })
          .range(from, from + page - 1);
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        for (const row of rows) lines.push(lineCoordinates(row.walk_geom) ?? []);
        if (rows.length < page) break;
      }
      const raw = rawCounts(lines);
      const savedVariant = (savedByName.get(target.territory) ?? []).find((variant) => variant.key === target.key);
      let maxDelta = 0;
      let where = `no saved ${target.key} variant`;
      if (savedVariant) {
        if (savedVariant.steps.length !== lines.length) {
          maxDelta = Number.POSITIVE_INFINITY;
          where = `${lines.length} frozen steps vs ${savedVariant.steps.length} saved ${target.key} steps`;
        } else {
          where = "0 m";
          for (let i = 0; i < lines.length; i += 1) {
            const delta = maxPointDeltaM(lines[i], savedVariant.steps[i].walkline);
            if (delta.maxM === null || delta.maxM > maxDelta) {
              maxDelta = delta.maxM ?? Number.POSITIVE_INFINITY;
              where = `step ${i}: ${delta.points}, max ${delta.maxM === null ? "point-count mismatch" : `${delta.maxM.toFixed(3)} m`}`;
            }
          }
        }
      }
      record(
        `${target.territory} frozen route_steps`,
        raw.gaps === 0 && raw.crossing === 0 && raw.selfCrossing === 0 && maxDelta <= 0.05 ? "PASS" : "FAIL",
        `${lines.length} steps: gaps ${raw.gaps}, crossing-next-step ${raw.crossing}, self-crossing ${raw.selfCrossing}; vs saved ${target.key}: ${where}`,
      );
    }
  } finally {
    await admin.signOut();
    console.log("session signed out: admin, scope local.");
  }

  heading("Summary");
  for (const row of results) console.log(`  ${row.status.padEnd(4)} ${row.item}`);
  if (results.some((row) => row.status === "FAIL")) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
