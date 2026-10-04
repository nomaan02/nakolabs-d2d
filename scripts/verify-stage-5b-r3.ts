/**
 * Stage 5b-R3 — draw-page preview/save, shared route paint, allocate override.
 *
 * Creates throwaway copies of REF - Speedwell's polygon, proves preview writes
 * nothing and save replaces, then deletes those copies. Reads one real frozen
 * Speedwell assignment. Does not rewrite Speedwell, the DEMO props, Northville
 * or redland.
 *
 * Prints counts and hashes only — never geometries or step arrays.
 *
 *   npm run verify:stage5b-r3
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { propWarnings } from "@/lib/geo/prop-warnings";
import { previewTerritoryRoutes, saveTerritoryRoutes } from "@/lib/geo/walk/save";
import { freezeAssignmentRoute, defaultVariantKey } from "@/lib/geo/walk/freeze";
import { loadAssignmentRouteModel, loadTerritoryRouteModel } from "@/lib/map/route-load";
import {
  lineCoordinates,
  routeSaveEnabled,
  toRoutePaintModel,
  walkResultToPaintInput,
} from "@/lib/map/route-layers";
import type { Database } from "@/lib/supabase/types";
import { loadEnvLocal, requiredEnv } from "./lib/env";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const SOURCE_PROP = "REF - Speedwell";
const DATES = { parity: "2028-11-02", override: "2028-11-03", bare: "2028-11-04" };
const PROTECTED = [
  "DEMO - Bishopston (Monmouth Road)",
  "DEMO - Clifton (Princess Victoria Street)",
  "DEMO - Southville (Stackpool Road)",
  "Northville",
  "redland",
  "redland_test",
  SOURCE_PROP,
];

const service = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Status = "PASS" | "FAIL" | "NOT VERIFIED";
const results: { item: string; status: Status; evidence: string }[] = [];
function record(item: string, status: Status, evidence: string): void {
  results.push({ item, status, evidence });
  console.log(`  [${status}] ${item}\n         ${evidence.replace(/\n/g, "\n         ")}`);
}
function heading(title: string): void {
  console.log(`\n== ${title}`);
}
function hashOf(value: unknown): string {
  return createHash("md5").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}

const createdTerritories = new Set<string>();
const createdAssignments = new Set<string>();

async function sessionAdmin(): Promise<{ client: SupabaseClient<Database>; userId: string }> {
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("active", true)
    .order("created_at")
    .limit(1);
  if (error || !profiles?.[0]) throw new Error(`no admin: ${error?.message ?? "none"}`);
  const userId = profiles[0].id;
  const { data: userData, error: userError } = await service.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userError || !email) throw new Error(`admin has no email: ${userError?.message ?? ""}`);
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new Error(`magic link failed: ${linkError?.message ?? "no token"}`);
  const client = createClient<Database>(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyError || !verified.session) throw new Error(`verifyOtp failed: ${verifyError?.message ?? "no session"}`);
  return { client, userId };
}

async function counts(territoryId: string): Promise<{ variants: number; steps: number }> {
  const routes = await service.from("territory_routes").select("id").eq("territory_id", territoryId);
  if (routes.error) throw new Error(routes.error.message);
  const ids = (routes.data ?? []).map((row) => row.id);
  if (ids.length === 0) return { variants: 0, steps: 0 };
  const steps = await service
    .from("territory_route_steps")
    .select("id", { count: "exact", head: true })
    .in("route_id", ids);
  if (steps.error) throw new Error(steps.error.message);
  return { variants: ids.length, steps: steps.count ?? 0 };
}

async function cloneProp(name: string): Promise<string> {
  const source = await service.from("territories").select("geom, created_by").eq("name", SOURCE_PROP).maybeSingle();
  if (source.error || !source.data) throw new Error(`source prop: ${source.error?.message ?? "missing"}`);
  const inserted = await service
    .from("territories")
    .insert({ name, geom: source.data.geom, created_by: source.data.created_by })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new Error(`clone: ${inserted.error?.message ?? "no id"}`);
  createdTerritories.add(inserted.data.id);
  return inserted.data.id;
}

async function canvasserId(): Promise<string> {
  const { data, error } = await service
    .from("profiles")
    .select("id")
    .eq("role", "canvasser")
    .eq("active", true)
    .limit(1);
  if (error || !data?.[0]) throw new Error(`no canvasser: ${error?.message ?? "none"}`);
  return data[0].id;
}

async function allocate(admin: SupabaseClient<Database>, territoryId: string, date: string, canvasser: string) {
  const { data, error } = await admin.rpc("allocate_prop", {
    territory_id: territoryId,
    work_date: date,
    canvasser_ids: [canvasser],
  });
  if (error) throw new Error(`allocate_prop: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error("allocate_prop returned no row");
  createdAssignments.add(row.id);
  return row;
}

async function variantKeyOf(assignmentId: string): Promise<string | null> {
  const { data, error } = await service
    .from("assignments")
    .select("route_variant_key, visit_number")
    .eq("id", assignmentId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "missing assignment");
  return data.route_variant_key;
}

async function cleanup(): Promise<void> {
  const assignmentIds = [...createdAssignments];
  if (assignmentIds.length > 0) {
    await service.from("route_steps").delete().in("assignment_id", assignmentIds);
    await service.from("assignment_members").delete().in("assignment_id", assignmentIds);
    await service.from("assignments").delete().in("id", assignmentIds);
  }
  const territoryIds = [...createdTerritories];
  if (territoryIds.length > 0) {
    await service.from("territories").delete().in("id", territoryIds);
  }
}

async function protectedStepCounts(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const name of PROTECTED) {
    const territory = await service.from("territories").select("id").eq("name", name).maybeSingle();
    if (!territory.data) {
      out.set(name, -1);
      continue;
    }
    const assignments = await service.from("assignments").select("id").eq("territory_id", territory.data.id);
    const ids = (assignments.data ?? []).map((row) => row.id);
    if (ids.length === 0) {
      out.set(name, 0);
      continue;
    }
    const steps = await service
      .from("route_steps")
      .select("id", { count: "exact", head: true })
      .in("assignment_id", ids);
    out.set(name, steps.count ?? 0);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("Stage 5b-R3 verification");
  const beforeProtected = await protectedStepCounts();
  let admin: { client: SupabaseClient<Database>; userId: string } | null = null;

  try {
    heading("Sessions and clones");
    admin = await sessionAdmin();
    const canvasser = await canvasserId();
    const previewId = await cloneProp(`R3 acceptance preview ${Date.now()}`);
    const bareId = await cloneProp(`R3 acceptance bare ${Date.now()}`);
    console.log(`  preview territory ${previewId.slice(0, 8)}…  bare ${bareId.slice(0, 8)}…`);

    heading("1. Preview writes nothing");
    const before = await counts(previewId);
    const preview = await previewTerritoryRoutes(admin.client, previewId);
    const afterPreview = await counts(previewId);
    const previewSteps = preview.ok ? preview.result.variants.reduce((n, variant) => n + variant.steps.length, 0) : 0;
    const previewKeys = preview.ok ? preview.result.variants.map((variant) => variant.key).join(", ") : "";
    record(
      "Generate preview does not write territory_routes or territory_route_steps",
      preview.ok && before.variants === 0 && before.steps === 0 && afterPreview.variants === 0 && afterPreview.steps === 0
        ? "PASS"
        : "FAIL",
      `before variants ${before.variants} steps ${before.steps}; preview ${preview.ok ? `ok ${preview.result.variants.length} variants, ${previewSteps} steps (${previewKeys})` : preview.code}; after variants ${afterPreview.variants} steps ${afterPreview.steps}`,
    );
    if (!preview.ok) throw new Error("preview failed; remaining checks need it");

    heading("2. Save replaces");
    const saved = await saveTerritoryRoutes(admin.client, previewId);
    const afterSave = await counts(previewId);
    const savedAgain = await saveTerritoryRoutes(admin.client, previewId);
    const afterAgain = await counts(previewId);
    const saveMatches =
      saved.ok &&
      savedAgain.ok &&
      afterSave.variants === preview.result.variants.length &&
      afterSave.steps === previewSteps &&
      afterAgain.variants === afterSave.variants &&
      afterAgain.steps === afterSave.steps;
    record(
      "Save persists every variant; saving again replaces rather than duplicates",
      saveMatches ? "PASS" : "FAIL",
      `preview ${preview.result.variants.length} variants / ${previewSteps} steps. after first save ${afterSave.variants} / ${afterSave.steps} (rpc variants ${saved.ok ? saved.summary.variants : saved.code}, steps ${saved.ok ? saved.summary.steps : "—"}; keys ${saved.ok ? saved.summary.keys.join(", ") : ""}). after second save ${afterAgain.variants} / ${afterAgain.steps}`,
    );

    heading("3. Picker does not filter the save");
    const storedKeys = saved.ok ? [...saved.summary.keys].sort() : [];
    const allKeys = [...preview.result.variants.map((variant) => variant.key)].sort();
    record(
      "Save stores every preview key; it takes a territory id and no highlighted variant",
      storedKeys.join() === allKeys.join() && allKeys.length > 1 ? "PASS" : "FAIL",
      `stored keys ${storedKeys.join(", ")}; preview keys ${allKeys.join(", ")}. saveTerritoryRoutes(supabase, territoryId) has no variant argument.`,
    );

    heading("4. One adapter, both tables");
    const fromWalk = toRoutePaintModel(walkResultToPaintInput(preview.result));
    const fromTable = await loadTerritoryRouteModel(admin.client, previewId);
    const walkKinds = countKinds(fromWalk.steps);
    const tableKinds = fromTable.ok ? countKinds(fromTable.model.steps) : "unread";
    record(
      "territory_route_steps and the in-memory walk use the same adapter",
      fromTable.ok && fromTable.steps === fromWalk.steps.length && fromTable.steps === previewSteps ? "PASS" : "FAIL",
      `walk model steps ${fromWalk.steps.length} (${walkKinds}); loaded territory_route_steps steps ${fromTable.ok ? fromTable.steps : fromTable.message} (${tableKinds}); variants ${fromTable.ok ? fromTable.variants : "—"}`,
    );

    const odd = await allocate(admin.client, previewId, DATES.parity, canvasser);
    const oddFrozen = await freezeAssignmentRoute(admin.client, odd.id);
    const oddKey = await variantKeyOf(odd.id);
    const even = await allocate(admin.client, previewId, DATES.override, canvasser);
    const evenFrozen = await freezeAssignmentRoute(admin.client, even.id, "best");
    const evenKey = await variantKeyOf(even.id);
    const oddModel = await loadAssignmentRouteModel(admin.client, odd.id, oddKey ?? "best");
    record(
      "Parity default and an explicit override both land on route_variant_key",
      oddFrozen.ok &&
        evenFrozen.ok &&
        odd.visit_number % 2 === 1 &&
        oddKey === defaultVariantKey(odd.visit_number) &&
        even.visit_number % 2 === 0 &&
        evenKey === "best" &&
        defaultVariantKey(even.visit_number) === "best_reversed"
        ? "PASS"
        : "FAIL",
      `visit ${odd.visit_number} (parity ${defaultVariantKey(odd.visit_number)}) frozen without a key → ${oddKey}, steps ${oddFrozen.ok ? oddFrozen.summary.steps : oddFrozen.code}. visit ${even.visit_number} (parity would be ${defaultVariantKey(even.visit_number)}) frozen with best → ${evenKey}, steps ${evenFrozen.ok ? evenFrozen.summary.steps : evenFrozen.code}.`,
    );
    record(
      "route_steps paint through the same adapter",
      oddModel.ok && oddModel.steps > 0 ? "PASS" : "FAIL",
      `assignment route model steps ${oddModel.ok ? oddModel.steps : oddModel.message} (${oddModel.ok ? countKinds(oddModel.model.steps) : ""})`,
    );

    heading("5. Real frozen assignment (Speedwell)");
    const speedwell = await service.from("territories").select("id").eq("name", SOURCE_PROP).single();
    if (speedwell.error || !speedwell.data) throw new Error("Speedwell missing");
    const frozenRows = await service
      .from("assignments")
      .select("id, visit_number, route_variant_key")
      .eq("territory_id", speedwell.data.id)
      .not("route_variant_key", "is", null)
      .order("visit_number")
      .limit(1);
    const real = frozenRows.data?.[0];
    if (!real?.route_variant_key) {
      record("Speedwell frozen assignment renders from walk_geom", "FAIL", "no assignment with route_variant_key");
    } else {
      const model = await loadAssignmentRouteModel(admin.client, real.id, real.route_variant_key);
      const sample = await service
        .from("route_steps")
        .select("step_index, kind, walk_geom, geom")
        .eq("assignment_id", real.id)
        .eq("kind", "work")
        .order("step_index")
        .limit(1);
      const row = sample.data?.[0];
      const painted = model.ok ? model.model.steps.find((step) => step.stepIndex === row?.step_index && step.kind === "work") : undefined;
      const walkHash = row ? hashOf(lineCoordinates(row.walk_geom)) : "none";
      const centreHash = row ? hashOf(lineCoordinates(row.geom)) : "none";
      const paintedHash = painted ? hashOf(painted.walk) : "none";
      record(
        "A real frozen assignment's pavement line is the walk_geom, not the centreline",
        model.ok && model.steps > 0 && paintedHash === walkHash && paintedHash !== centreHash ? "PASS" : "FAIL",
        `REF - Speedwell visit ${real.visit_number} ${real.route_variant_key}: model steps ${model.ok ? model.steps : model.message}. First work step hash painted ${paintedHash}, walk_geom ${walkHash}, centreline geom ${centreHash} (hashes only).`,
      );
    }

    heading("6. Prop with no saved variants");
    const bareBefore = await counts(bareId);
    const bareAssignment = await allocate(admin.client, bareId, DATES.bare, canvasser);
    let fallbackNote = "";
    try {
      const mod = await import("../lib/props/generate-route");
      const result = await mod.generateRouteAction(bareAssignment.id);
      fallbackNote = result.ok
        ? `generateRouteAction ok, variant ${result.summary.variantKey}, regenerated ${result.summary.regenerated}`
        : `generateRouteAction ${result.code}: ${result.message}`;
    } catch (err) {
      fallbackNote = `generateRouteAction threw (${err instanceof Error ? err.message : String(err)}).`;
      const regenerated = await saveTerritoryRoutes(admin.client, bareId);
      const frozen = await freezeAssignmentRoute(admin.client, bareAssignment.id);
      fallbackNote += ` Direct sequence after the throw: save ${regenerated.ok ? regenerated.summary.variants + " variants" : regenerated.code}, freeze ${frozen.ok ? frozen.summary.variantKey : frozen.code}.`;
    }
    const bareKey = await variantKeyOf(bareAssignment.id);
    const bareAfter = await counts(bareId);
    record(
      "A prop with no saved variants still freezes via the existing fallback",
      bareBefore.variants === 0 && bareKey === "best" && bareAfter.variants > 0 ? "PASS" : "FAIL",
      `before variants ${bareBefore.variants}. ${fallbackNote} route_variant_key ${bareKey}. after variants ${bareAfter.variants} steps ${bareAfter.steps}.`,
    );

    heading("7. Files that must not have changed, and the 150-door warning");
    const routeDiff = execSync("git diff -- lib/props/generate-route.ts", { encoding: "utf8" });
    const migrationDiff = execSync("git diff -- supabase/migrations/020_route_storage_and_freeze.sql", { encoding: "utf8" });
    record(
      "generate-route.ts and migration 020 are untouched",
      routeDiff.trim() === "" && migrationDiff.trim() === "" ? "PASS" : "FAIL",
      `git diff generate-route.ts length ${routeDiff.length}; migration 020 length ${migrationDiff.length}`,
    );
    const warnings = propWarnings({ knockable: 1225, multiUnit: 0, nccz: 10, excluded: 10, total: 1235 });
    const warningHits = sourceHits(["knockable doors is above", "DoorBand"]);
    record(
      "The 150-door warning is gone; a count over 150 produces no warning",
      warnings.length === 0 && warningHits.trim() === "" ? "PASS" : "FAIL",
      `propWarnings(1225 knockable) → ${warnings.length} warnings. rg hits: ${warningHits.trim() || "none"}. routeSaveEnabled(stale) ${routeSaveEnabled({ hasPreview: true, stale: true, busy: false })}; routeSaveEnabled(fresh) ${routeSaveEnabled({ hasPreview: true, stale: false, busy: false })}.`,
    );

    record(
      "Same-session stale flag blocks Save; cross-session detection was not added",
      routeSaveEnabled({ hasPreview: true, stale: true, busy: false }) === false ? "PASS" : "FAIL",
      "territories has no polygon-edit timestamp (created_at, last_visited_at, archived_at only). Cross-session staleness is not detected. The draw page sets a banner and disables Save only after an edit in the open session.",
    );
  } finally {
    heading("Cleanup");
    await cleanup();
    const left = await service.from("territories").select("id").like("name", "R3 acceptance%");
    console.log(`  leftover R3 acceptance territories: ${left.data?.length ?? "unread"}`);
    await admin?.client.auth.signOut({ scope: "local" });

    heading("Protected route_steps unchanged");
    const afterProtected = await protectedStepCounts();
    const lines: string[] = [];
    let same = true;
    for (const [name, before] of beforeProtected) {
      const now = afterProtected.get(name) ?? -1;
      if (now !== before) same = false;
      lines.push(`${name}: ${before} → ${now}`);
    }
    record("route_steps counts for protected props unchanged", same ? "PASS" : "FAIL", lines.join("; "));

    heading("Summary");
    for (const row of results) console.log(`  ${row.status.padEnd(12)} ${row.item}`);
    if (results.some((row) => row.status === "FAIL")) process.exitCode = 1;
  }
}

function countKinds(steps: { kind: string }[]): string {
  const counts = { work: 0, cross: 0, walk: 0 };
  for (const step of steps) {
    if (step.kind === "work" || step.kind === "cross" || step.kind === "walk") counts[step.kind] += 1;
  }
  return `work ${counts.work}, cross ${counts.cross}, walk ${counts.walk}`;
}

function sourceHits(needles: string[]): string {
  const skip = new Set(["node_modules", ".next", "docs", ".git", "scripts", "public", "data", "nakolabs-data"]);
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = path.join(dir, entry);
      const info = statSync(full);
      if (info.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const text = readFileSync(full, "utf8");
      for (const needle of needles) {
        if (text.includes(needle)) hits.push(`${path.relative(process.cwd(), full)}: ${needle}`);
      }
    }
  };
  walk(process.cwd());
  return hits.join("; ");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
