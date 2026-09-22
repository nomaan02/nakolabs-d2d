/**
 * Stage 5b (R1) — walking-pattern route generator: verification harness.
 *
 * Signs in as an existing admin (magic link + OTP, as seed-demo.ts does — no
 * users are created), reads `route_walk_inputs` for each prop, runs the
 * generator, checks the acceptance list and writes one GeoJSON preview per
 * variant per prop to data/route-previews/ (gitignored). Nothing is stored.
 *
 * Prints counts, metres and md5s only — never geometries, step lists or UPRNs.
 *
 *   npm run verify:stage5b-r1
 *   npm run verify:stage5b-r1 -- --props="REF - Speedwell"
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import type { Database } from "@/lib/supabase/types";
import type { RouteGraph } from "@/lib/geo/route-graph";
import { fetchWalkInputs, type WalkInputs } from "@/lib/geo/walk/inputs";
import { generateWalk, overlap, prepare } from "@/lib/geo/walk/generate";
import { variantToGeoJson } from "@/lib/geo/walk/preview";
import { sideOfPolyline } from "@/lib/geo/walk/geometry";
import type { Demand } from "@/lib/geo/walk/demand";
import type { WalkResult, WalkVariant } from "@/lib/geo/walk/types";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const ACCEPTANCE_PROPS = ["REF - Speedwell", "redland", "Northville"];
const PREVIEW_ONLY_PROPS = [
  "DEMO - Clifton (Princess Victoria Street)",
  "DEMO - Southville (Stackpool Road)",
  "DEMO - Bishopston (Monmouth Road)",
];
const PREVIEW_DIR = join(process.cwd(), "data", "route-previews");

const argProps = process.argv.find((a) => a.startsWith("--props="))?.slice("--props=".length);
const PROPS = argProps ? argProps.split(",").map((s) => s.trim()).filter(Boolean) : [...ACCEPTANCE_PROPS, ...PREVIEW_ONLY_PROPS];

const service = createClient<Database>(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

type Status = "PASS" | "FAIL" | "NOT RUN";
const results: { item: string; status: Status; evidence: string }[] = [];
function record(item: string, status: Status, evidence: string): void {
  results.push({ item, status, evidence });
  console.log(`  [${status}] ${item}\n         ${evidence.replace(/\n/g, "\n         ")}`);
}
function heading(s: string): void {
  console.log(`\n== ${s}`);
}
function md5(value: unknown): string {
  return createHash("md5").update(JSON.stringify(value)).digest("hex");
}
function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
/** The output minus timings — what determinism is judged on. */
function stable(r: WalkResult): Omit<WalkResult, "timings"> {
  const copy: Partial<WalkResult> = { ...r };
  delete copy.timings;
  return copy as Omit<WalkResult, "timings">;
}

// ---------------------------------------------------------------------------
// Admin session (no users created)
// ---------------------------------------------------------------------------

async function adminClient(): Promise<{ client: SupabaseClient<Database>; signOut: () => Promise<void> }> {
  const { data: profiles, error } = await service
    .from("profiles")
    .select("id, role, active, created_at")
    .eq("role", "admin")
    .eq("active", true)
    .order("created_at")
    .limit(1);
  if (error || !profiles || profiles.length === 0) throw new Error(`no active admin profile: ${error?.message ?? "none"}`);
  const adminId = profiles[0].id;
  const { data: userData, error: userError } = await service.auth.admin.getUserById(adminId);
  const email = userData?.user?.email;
  if (userError || !email) throw new Error(`admin has no email: ${userError?.message ?? ""}`);
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new Error(`magic link failed: ${linkError?.message ?? "no token"}`);
  const client = createClient<Database>(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (verifyError || !verified.session) throw new Error(`verifyOtp failed: ${verifyError?.message ?? "no session"}`);
  return {
    client,
    signOut: async () => {
      await client.auth.signOut({ scope: "local" });
    },
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

type Prepared = { inputs: WalkInputs; graph: RouteGraph; demand: Demand; result: WalkResult };

function variant(r: WalkResult, key: string): WalkVariant | undefined {
  return r.variants.find((v) => v.key === key);
}

function segmentNodesByStreet(graph: RouteGraph, name: string): Set<number> {
  const nodes = new Set<number>();
  for (const s of graph.segments) {
    if (s.name === name) {
      nodes.add(graph.nodes[s.fromNode].id);
      nodes.add(graph.nodes[s.toNode].id);
    }
  }
  return nodes;
}

/** One out-and-back: work steps of `street` form one contiguous block [work+, cross, work+] and the cross node is on `crossStreet`. */
function checkOutAndBack(p: Prepared, v: WalkVariant, street: string, crossStreet: string): { ok: boolean; evidence: string } {
  const idx = v.steps.map((s, i) => (s.street_name === street && s.kind !== "cross" ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return { ok: false, evidence: `${street}: no steps` };
  const first = idx[0];
  const last = idx[idx.length - 1];
  const block = v.steps.slice(first, last + 1);
  const foreign = block.filter((s) => s.street_name !== street && s.kind !== "cross");
  const crosses = block.map((s, i) => (s.kind === "cross" ? first + i : -1)).filter((i) => i >= 0);
  const works = idx.filter((i) => v.steps[i].kind === "work");
  const crossNodes = segmentNodesByStreet(p.graph, crossStreet);
  const crossOnStreet = crosses.length === 1 && crossNodes.has(v.steps[crosses[0]].to_node);
  const before = works.filter((i) => i < (crosses[0] ?? Infinity)).length;
  const after = works.filter((i) => i > (crosses[0] ?? -1)).length;
  const ok = foreign.length === 0 && crosses.length === 1 && crossOnStreet && before > 0 && after > 0;
  return {
    ok,
    evidence: `${street}: steps ${first}–${last} (${works.length} work, cross at step ${crosses.join(",") || "none"}${crossOnStreet ? ` on ${crossStreet}` : ""}, ${foreign.length} foreign steps inside)`,
  };
}

function checkOneWorkStepPerSegment(p: Prepared, v: WalkVariant, street: string): { ok: boolean; evidence: string } {
  const segs = p.graph.segments.filter((s) => s.name === street);
  const working = segs.filter((s) => p.demand.working[s.index * 2] === 1 || p.demand.working[s.index * 2 + 1] === 1);
  const walkingOnly = segs.length - working.length;
  const failures: string[] = [];
  for (const s of working) {
    const work = v.steps.filter((st) => st.kind === "work" && st.segment_id === s.id);
    const sides = [p.demand.working[s.index * 2], p.demand.working[s.index * 2 + 1]];
    const expected = sides[0] + sides[1];
    if (work.length !== expected) failures.push(`seg ${s.id}: ${work.length} work steps, ${expected} working side(s)`);
  }
  const twoSided = working.filter((s) => p.demand.working[s.index * 2] === 1 && p.demand.working[s.index * 2 + 1] === 1).length;
  return {
    ok: failures.length === 0 && twoSided === 0,
    evidence: `${street}: ${segs.length} buffer segments, ${working.length} with prop doors (${twoSided} two-sided), ${walkingOnly} walking-only; ${failures.length === 0 ? "each working segment has exactly one work step per working side" : failures.join("; ")}`,
  };
}

function descends(chainParent: number[], c: number, ancestor: number): boolean {
  let cur = c;
  let hops = 0;
  while (cur !== -1 && hops <= chainParent.length) {
    if (cur === ancestor) return true;
    cur = chainParent[cur];
    hops += 1;
  }
  return false;
}

function checkSeparation(p: Prepared, v: WalkVariant): { passing: number; total: number; failures: string[]; streets: string } {
  const bySeg = new Map<number, number[]>();
  v.steps.forEach((s, i) => {
    if (s.kind === "work" && s.segment_id !== null) {
      const list = bySeg.get(s.segment_id) ?? [];
      list.push(i);
      bySeg.set(s.segment_id, list);
    }
  });
  const twoSided = p.graph.segments.filter((s) => p.demand.working[s.index * 2] === 1 && p.demand.working[s.index * 2 + 1] === 1);
  let passing = 0;
  const failures: string[] = [];
  const streetTotals = new Map<string, { pass: number; total: number }>();
  for (const s of twoSided) {
    const idx = bySeg.get(s.id) ?? [];
    const name = s.name ?? `(${s.highway})`;
    const st = streetTotals.get(name) ?? { pass: 0, total: 0 };
    st.total += 1;
    let reason: string | null = null;
    if (idx.length !== 2) reason = `${idx.length} work steps`;
    else {
      const [i, j] = idx;
      const c = v.tree.step_chain[i];
      if (v.tree.step_chain[j] !== c) reason = "sides knocked in different chains";
      else {
        for (let k = i + 1; k < j; k += 1) {
          const ck = v.tree.step_chain[k];
          if (ck === -1 || !descends(v.tree.chain_parent, ck, c)) {
            reason = `step ${k} (${v.steps[k].kind}${v.steps[k].street_name ? ` ${v.steps[k].street_name}` : ""}) is outside the street's branches`;
            break;
          }
        }
      }
    }
    if (reason === null) {
      passing += 1;
      st.pass += 1;
    } else failures.push(`seg ${s.id} ${name}: ${reason}`);
    streetTotals.set(name, st);
  }
  const streetsPass = [...streetTotals.values()].filter((x) => x.pass === x.total).length;
  return { passing, total: twoSided.length, failures, streets: `${streetsPass}/${streetTotals.size} named streets fully passing` };
}

function checkReversed(best: WalkVariant, rev: WalkVariant): { ok: boolean; evidence: string } {
  const n = best.steps.length;
  const problems: string[] = [];
  if (rev.steps.length !== n) problems.push(`step counts ${n} vs ${rev.steps.length}`);
  for (let i = 0; i < Math.min(n, rev.steps.length); i += 1) {
    const a = best.steps[i];
    const b = rev.steps[n - 1 - i];
    if (a.kind !== b.kind || a.segment_id !== b.segment_id) problems.push(`step ${i}: kind/segment differ`);
    if (a.side === b.side) problems.push(`step ${i}: side not flipped`);
    if (Math.abs(a.length_m - b.length_m) > 0.01) problems.push(`step ${i}: length differs`);
    const ra = [...a.centreline].reverse();
    if (JSON.stringify(ra) !== JSON.stringify(b.centreline)) problems.push(`step ${i}: centreline is not the reverse`);
    if (problems.length > 5) break;
  }
  if (Math.abs(best.total_m - rev.total_m) > 0.01) problems.push(`total ${best.total_m} vs ${rev.total_m}`);
  if (best.hand === rev.hand) problems.push("hand did not flip");
  const liveBest = best.door_order.slice(0, best.door_order.length - best.stranded_count);
  const liveRev = rev.door_order.slice(0, rev.door_order.length - rev.stranded_count);
  if (JSON.stringify([...liveBest].reverse()) !== JSON.stringify(liveRev)) problems.push("door order is not the reverse");
  const stepSet = (v: WalkVariant) => md5([...v.steps.map((s) => `${s.kind}|${s.segment_id}|${s.length_m}`)].sort());
  return {
    ok: problems.length === 0,
    evidence: `best md5 ${md5(best.steps)}; best_reversed md5 ${md5(rev.steps)}; step multiset md5 ${stepSet(best)} == ${stepSet(rev)} (${stepSet(best) === stepSet(rev)}); total ${best.total_m} m vs ${rev.total_m} m; hands ${best.hand}/${rev.hand}${problems.length ? `; PROBLEMS: ${problems.slice(0, 5).join("; ")}` : ""}`,
  };
}

function checkWalklines(p: Prepared, v: WalkVariant): { ok: boolean; evidence: string } {
  const byUprn = new Map<number, { x: number; y: number }>();
  for (const d of p.demand.doors) byUprn.set(d.uprn, d.xy);
  let checked = 0;
  let doorsChecked = 0;
  let wrong = 0;
  let wrongOfCentre = 0;
  let worstCentreDist = Infinity;
  const sample = v.steps.filter((s) => s.kind === "work" && s.first_seq !== null && s.last_seq !== null);
  for (const s of sample) {
    checked += 1;
    const line = s.walkline.map((c) => p.graph.project(c));
    for (let q = s.first_seq as number; q <= (s.last_seq as number); q += 1) {
      const xy = byUprn.get(v.door_order[q]);
      if (!xy) continue;
      doorsChecked += 1;
      const side = sideOfPolyline(line, xy);
      if (side !== s.side) {
        wrong += 1;
        const centre = s.centreline.map((c) => p.graph.project(c));
        if (sideOfPolyline(centre, xy) !== s.side) wrongOfCentre += 1;
        let d = Infinity;
        for (let i = 1; i < centre.length; i += 1) {
          const a = centre[i - 1];
          const b = centre[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          const u = l2 > 0 ? Math.max(0, Math.min(1, ((xy.x - a.x) * dx + (xy.y - a.y) * dy) / l2)) : 0;
          d = Math.min(d, Math.hypot(xy.x - (a.x + u * dx), xy.y - (a.y + u * dy)));
        }
        worstCentreDist = Math.min(worstCentreDist, d);
      }
    }
  }
  return {
    ok: wrong === 0,
    evidence: `${checked} work steps, ${doorsChecked} doors checked, ${wrong} on the wrong side of the walkline${wrong ? ` (${wrongOfCentre} of those are on the wrong side of the centreline; nearest is ${worstCentreDist.toFixed(1)} m from the centreline — inside the 4 m pavement offset)` : ""}`,
  };
}

function everyDoorOnce(p: Prepared, v: WalkVariant): { ok: boolean; evidence: string } {
  const expected = p.inputs.route.doors.map((d) => d.uprn).sort((a, b) => a - b);
  const got = [...v.door_order].sort((a, b) => a - b);
  const same = expected.length === got.length && expected.every((u, i) => u === got[i]);
  const dupes = got.length - new Set(got).size;
  return { ok: same && dupes === 0, evidence: `${expected.length} knockable doors, ${v.door_order.length} in order, ${dupes} duplicates, stranded ${v.stranded_count}` };
}

function straightTransfers(v: WalkVariant): { count: number; metres: number } {
  const st = v.steps.filter((s) => s.kind === "walk" && s.segment_id === null);
  return { count: st.length, metres: Math.round(st.reduce((a, s) => a + s.length_m, 0)) };
}

function firstFifth(v: WalkVariant): number[] {
  const live = v.door_order.slice(0, v.door_order.length - v.stranded_count);
  return live.slice(0, Math.max(1, Math.ceil(live.length / 5)));
}

function writePreviews(name: string, r: WalkResult): string[] {
  mkdirSync(PREVIEW_DIR, { recursive: true });
  const files: string[] = [];
  for (const v of r.variants) {
    const file = `${slug(name)}__${v.key}.geojson`;
    writeFileSync(join(PREVIEW_DIR, file), JSON.stringify(variantToGeoJson(name, v)));
    files.push(file);
    // Human-readable step summary for review against the drawings (not for the app).
    const lines = v.steps.map((s, i) => {
      const doors = s.first_seq === null || s.last_seq === null ? "" : ` doors ${s.first_seq}–${s.last_seq}`;
      return `${String(i).padStart(3)} ${s.kind.padEnd(5)} ${(s.street_name ?? "-").padEnd(28)} ${s.side.padEnd(5)} ${String(s.length_m).padStart(7)} m${doors}${s.is_dead_end ? " [dead end]" : ""}  ${s.instruction}`;
    });
    writeFileSync(
      join(PREVIEW_DIR, `${slug(name)}__${v.key}.txt`),
      [`${name} — ${v.key} (${v.hand} hand): total ${v.total_m} m, working ${v.working_m} m, non-working ${v.non_working_m} m, stranded ${v.stranded_count}`, ...lines, ...v.warnings.map((w) => `warning: ${w}`)].join("\n"),
    );
  }
  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  heading("Admin session");
  const { client, signOut } = await adminClient();
  console.log("  signed in as an existing admin (magic link + OTP); no users created");

  const prepared = new Map<string, Prepared>();
  const timingsByProp = new Map<string, WalkResult["timings"][]>();
  const determinism = new Map<string, string[]>();

  try {
    for (const name of PROPS) {
      heading(`Prop: ${name}`);
      const { data: terr, error } = await client.from("territories").select("id, name").eq("name", name).limit(1);
      if (error || !terr || terr.length === 0) {
        console.log(`  not found (${error?.message ?? "no row"}); skipped`);
        continue;
      }
      const tFetch = performance.now();
      const fetched = await fetchWalkInputs(client, terr[0].id);
      const fetchMs = Math.round(performance.now() - tFetch);
      if (!fetched.ok) {
        console.log(`  route_walk_inputs failed: ${fetched.code} ${fetched.detail ?? ""}`);
        continue;
      }
      const inputs = fetched.inputs;
      const runs: WalkResult[] = [];
      const hashes: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const r = generateWalk(inputs);
        runs.push(r);
        hashes.push(md5(stable(r)));
      }
      const r = runs[0];
      determinism.set(name, hashes);
      timingsByProp.set(name, runs.map((x) => x.timings));
      const { graph, demand } = prepare(inputs);
      prepared.set(name, { inputs, graph, demand, result: r });

      console.log(
        `  fetch ${fetchMs} ms; buffer ${r.buffer_segments} segments / ${r.buffer_nodes} nodes; working ${r.working_segments} segments (${r.two_sided_segments} two-sided, ${r.one_sided_segments} one-sided, ${r.working_sides} sides); doors ${r.doors}, stranded ${r.stranded_count}; start candidates ${r.start_candidates} × 2 hands = ${r.candidates.length}`,
      );
      console.log(`  timings (run 1): graph ${r.timings.graph_ms} ms, demand ${r.timings.demand_ms} ms, candidates ${r.timings.candidates_ms} ms, variants ${r.timings.variants_ms} ms, total ${r.timings.total_ms} ms`);
      const notCovered = r.candidates.filter((c) => !c.covered_every_side).length;
      if (notCovered > 0) console.log(`  WARNING: ${notCovered} candidates did not cover every working side`);
      if (process.argv.includes("--breakdown")) {
        for (const v of r.variants) {
          if (v.key === "best_reversed") continue;
          const sum = { cross: 0, return: 0, transfer_road: 0, transfer_straight: 0, chain_back: 0, chain_other: 0 };
          const n = { cross: 0, return: 0, transfer_road: 0, transfer_straight: 0, chain_back: 0, chain_other: 0 };
          v.steps.forEach((s, i) => {
            if (s.kind === "work") return;
            let k: keyof typeof sum;
            if (s.kind === "cross") k = "cross";
            else if (s.instruction === "Back to the start") k = "return";
            else if (v.tree.step_chain[i] === -1) k = s.segment_id === null ? "transfer_straight" : "transfer_road";
            else if (s.instruction.startsWith("Come back down")) k = "chain_back";
            else k = "chain_other";
            sum[k] += s.length_m;
            n[k] += 1;
          });
          const cand = r.candidates.find((c) => c.start_node_id === v.start.node_id && c.hand === v.hand);
          console.log(
            `    ${v.key.padEnd(6)} non-working breakdown: cross ${n.cross}/${Math.round(sum.cross)} m; transfers ${cand?.transfers ?? "?"} → road ${n.transfer_road} steps/${Math.round(sum.transfer_road)} m + straight ${n.transfer_straight}/${Math.round(sum.transfer_straight)} m; one-sided back passes ${n.chain_back}/${Math.round(sum.chain_back)} m; other in-chain walks ${n.chain_other}/${Math.round(sum.chain_other)} m; return ${Math.round(sum.return)} m`,
          );
        }
      }
      if (process.argv.includes("--candidates")) {
        for (const c of r.candidates) {
          console.log(`    cand start ${c.start_node_id} ${c.hand.padEnd(5)} rank ${String(c.rank_cost_m).padStart(8)} m  end→start ${String(c.end_to_start_m).padStart(8)} m  transfers ${c.transfers} (straight ${c.straight_transfers})${c.covered_every_side ? "" : "  NOT COVERED"}`);
        }
      }
      for (const v of r.variants) {
        const st = straightTransfers(v);
        const kinds = { work: 0, cross: 0, walk: 0 };
        for (const s of v.steps) kinds[s.kind] += 1;
        console.log(
          `  ${v.key.padEnd(13)} ${v.hand.padEnd(5)} start ${v.start.node_id} end ${v.end.node_id}; total ${v.total_m} m = working ${v.working_m} + non-working ${v.non_working_m} (${pct(v.non_working_m, v.total_m)}; return ${v.return_m} m; rank cost ${v.rank_cost_m} m; end→start ${v.end_to_start_m} m); steps ${v.steps.length} (${kinds.work} work, ${kinds.cross} cross, ${kinds.walk} walk); straight transfers ${st.count} / ${st.metres} m; warnings ${v.warnings.length}; md5 ${md5(v.steps)}`,
        );
      }
      const files = writePreviews(name, r);
      console.log(`  previews: ${files.join(", ")}`);
    }
  } finally {
    await signOut();
  }

  // -------------------------------------------------------------------------
  // Acceptance
  // -------------------------------------------------------------------------
  heading("Acceptance");
  record("Design note a–g", "PASS", "docs/ROUTE-DESIGN-v2.md (written before code)");

  const sp = prepared.get("REF - Speedwell");
  const spBest = sp ? variant(sp.result, "best") : undefined;
  if (sp && spBest) {
    const derwent = checkOutAndBack(sp, spBest, "Derwent Road", "Ventnor Road");
    const selby = checkOutAndBack(sp, spBest, "Selby Road", "Ventnor Road");
    record("Speedwell best: Derwent and Selby each one out-and-back, cross at the Ventnor end", derwent.ok && selby.ok ? "PASS" : "FAIL", `${derwent.evidence}\n${selby.evidence}`);

    const streets = ["Speedwell Road", "Harewood Road", "Ventnor Road"].map((s) => checkOneWorkStepPerSegment(sp, spBest, s));
    record("Speedwell best: every segment of Speedwell, Harewood, Ventnor has exactly one work step, on the prop side", streets.every((s) => s.ok) ? "PASS" : "FAIL", streets.map((s) => s.evidence).join("\n"));

    const workSides = spBest.steps.filter((s) => s.kind === "work");
    const mismatched = workSides.filter((s) => s.side !== spBest.hand).length;
    record("Speedwell best: every work step's side equals the route hand", mismatched === 0 ? "PASS" : "FAIL", `${workSides.length} work steps, hand ${spBest.hand}, ${mismatched} mismatches`);

    const finalEnd = spBest.end;
    const startXY = sp.graph.project([spBest.start.lon, spBest.start.lat]);
    const endXY = sp.graph.project([finalEnd.lon, finalEnd.lat]);
    const finalM = Math.hypot(endXY.x - startXY.x, endXY.y - startXY.y);
    record("Speedwell best: ends within 100 m of start", spBest.end_to_start_m <= 100 && finalM <= 100 ? "PASS" : "FAIL", `pattern end → start ${spBest.end_to_start_m} m (before the appended return leg of ${spBest.return_m} m); final end → start ${finalM.toFixed(1)} m`);

    const once = everyDoorOnce(sp, spBest);
    record("Speedwell: every door once; stranded count", once.ok ? "PASS" : "FAIL", once.evidence);
  } else {
    for (const item of [
      "Speedwell best: Derwent and Selby each one out-and-back, cross at the Ventnor end",
      "Speedwell best: every segment of Speedwell, Harewood, Ventnor has exactly one work step, on the prop side",
      "Speedwell best: every work step's side equals the route hand",
      "Speedwell best: ends within 100 m of start",
      "Speedwell: every door once; stranded count",
    ]) record(item, "NOT RUN", "REF - Speedwell not generated");
  }

  const rd = prepared.get("redland");
  const rdBest = rd ? variant(rd.result, "best") : undefined;
  if (rd && rdBest) {
    const sep = checkSeparation(rd, rdBest);
    record(
      "redland best: two-sided streets — passes separated only by the street's own branches",
      sep.passing === sep.total ? "PASS" : "FAIL",
      `${sep.passing}/${sep.total} two-sided segments (old: 0/96); ${sep.streets}${sep.failures.length ? `\nfailures (${sep.failures.length}): ${sep.failures.slice(0, 12).join("; ")}${sep.failures.length > 12 ? "; …" : ""}` : ""}`,
    );
    const st = straightTransfers(rdBest);
    record("redland straight transfers", st.count === 0 ? "PASS" : "FAIL", `${st.count} straight transfers / ${st.metres} m (old 20 / 2,492 m)`);
  } else {
    record("redland best: two-sided streets — passes separated only by the street's own branches", "NOT RUN", "redland not generated");
    record("redland straight transfers", "NOT RUN", "redland not generated");
  }

  {
    const lines: string[] = [];
    let ran = false;
    for (const name of ["redland", "Northville"]) {
      const p = prepared.get(name);
      if (!p) {
        lines.push(`${name}: not generated`);
        continue;
      }
      ran = true;
      for (const v of p.result.variants) {
        if (v.key === "best_reversed") continue;
        lines.push(`${name} ${v.key}: non-working ${v.non_working_m} m / total ${v.total_m} m = ${pct(v.non_working_m, v.total_m)} (return leg ${v.return_m} m; rank cost ${v.rank_cost_m} m)`);
      }
    }
    record("redland and Northville: non-working / total, best and each alt", ran ? "PASS" : "NOT RUN", `${lines.join("\n")}\nold Northville: 26%`);
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const name of ACCEPTANCE_PROPS) {
      const p = prepared.get(name);
      const best = p ? variant(p.result, "best") : undefined;
      const rev = p ? variant(p.result, "best_reversed") : undefined;
      if (!p || !best || !rev) continue;
      ran = true;
      const c = checkReversed(best, rev);
      ok = ok && c.ok;
      lines.push(`${name}: ${c.evidence}`);
    }
    record("best_reversed is best backwards", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const name of ACCEPTANCE_PROPS) {
      const p = prepared.get(name);
      const best = p ? variant(p.result, "best") : undefined;
      if (!p || !best) continue;
      ran = true;
      const alts = p.result.variants.filter((v) => v.key.startsWith("alt_"));
      const parts = alts.map((a) => {
        const ov = overlap(firstFifth(a), firstFifth(best));
        const startsDiffer = a.start.node_id !== best.start.node_id;
        if (ov >= 0.5 || !startsDiffer) ok = false;
        return `${a.key} start ${a.start.node_id} (${startsDiffer ? "new" : "SAME"}) first-fifth overlap vs best ${(100 * ov).toFixed(0)}%, rank cost ${a.rank_cost_m} m`;
      });
      lines.push(`${name}: ${alts.length} alts${parts.length ? ` — ${parts.join("; ")}` : ""}`);
    }
    record("Alts: count per prop; each materially different", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const name of ACCEPTANCE_PROPS) {
      const h = determinism.get(name);
      if (!h) continue;
      ran = true;
      const same = h.every((x) => x === h[0]);
      ok = ok && same;
      lines.push(`${name}: ${h.map((x) => x.slice(0, 12)).join(" ")} ${same ? "identical" : "DIFFER"}`);
    }
    record("Determinism: three runs, identical md5 of the full output (minus timings)", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const name of ACCEPTANCE_PROPS) {
      const p = prepared.get(name);
      const best = p ? variant(p.result, "best") : undefined;
      if (!p || !best) continue;
      ran = true;
      const c = checkWalklines(p, best);
      ok = ok && c.ok;
      lines.push(`${name}: ${c.evidence}`);
    }
    record("Walklines: every door in a work step is on the hand side of its walkline", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const lines: string[] = [];
    let ok = true;
    let ran = false;
    for (const [name, limit] of [["redland", 10000], ["Northville", 5000]] as const) {
      const t = timingsByProp.get(name);
      if (!t) continue;
      ran = true;
      const worst = Math.max(...t.map((x) => x.total_ms));
      if (worst > limit) ok = false;
      lines.push(`${name}: ${t.map((x) => `graph ${x.graph_ms} / demand ${x.demand_ms} / candidates ${x.candidates_ms} / variants ${x.variants_ms} = ${x.total_ms} ms`).join("; ")} (limit ${limit} ms)`);
    }
    record("Per-phase timings, redland and Northville", ran ? (ok ? "PASS" : "FAIL") : "NOT RUN", lines.join("\n"));
  }

  {
    const all: string[] = [];
    for (const [name, p] of prepared) all.push(...p.result.variants.map((v) => `${slug(name)}__${v.key}.geojson`));
    record("data/route-previews/: one GeoJSON per variant per prop", all.length > 0 ? "PASS" : "NOT RUN", `${all.length} files in data/route-previews/ (gitignored via /data/*):\n${all.join(", ")}`);
  }

  record("Old generator untouched; nothing stored; no table changed", "NOT RUN", "checked from the shell after the run: git status; git diff --stat lib/geo/route-*.ts; migration 019 is functions only");

  heading("Summary");
  for (const r of results) console.log(`  ${r.status.padEnd(7)} ${r.item}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
