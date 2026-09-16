/**
 * Address-label ingest. Server-side, service role key.
 *
 * This does NOT go through lib/sync/queue.ts — that rule governs field
 * writes only. This script is an operator ingest, the same class as
 * ingest-uprn.ts.
 *
 * Four passes, run in order. Stage 1c implements --pass=epc only.
 * Later passes never overwrite a higher-confidence earlier pass
 * (exact > inferred > spatial_approx > street_only). 'inferred' is
 * reserved for Track B and is never written here.
 *
 * The EPC pass resolves street per row (last address field with a
 * street-type suffix, except a trailing WEAK suffix yields to an earlier
 * STRONG field that has a house number). There is no cross-row majority
 * vote and no named-locality stop-list. A postcode street check is a flag
 * only — it never rewrites street_name.
 */
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import {
  assertKnownExamples,
  chooseStreetFieldIndex,
  collapseWs,
  isBetterCertificate,
  lastSuffixFieldIndex,
  normalisePostcode,
  parseAddressRow,
  parseCsvLine,
  parseWhen,
  resolveColumn,
  resolveDateColumn,
  resolveUprnColumn,
  standardiseSt,
  stripLeadingHouseNumber,
  toTitleCase,
} from "./lib/epc-address";
import { createIngestClient, rpc, withRetry } from "./lib/supabase";

const BATCH_SIZE = 750;
const UPRN_PAGE = 20000;
/** PostgREST db-max-rows is 1000; keyset pages must not exceed it. */
const ADDRESS_PAGE = 1000;

const EPC_CSV = path.resolve(
  process.cwd(),
  "data",
  "raw",
  "epc-bristol",
  "certificates.csv",
);

const TRACK_B_PASSES = ["osm", "linked_ids", "land_registry"] as const;
const ALL_PASSES = ["epc", ...TRACK_B_PASSES] as const;
type Pass = (typeof ALL_PASSES)[number];

type EpcRow = {
  uprn: number;
  address1: string;
  address2: string;
  address3: string;
  postcode: string;
  when: number;
  property_type: string;
  uprn_source: string;
};

type MatchConfidence = "exact" | "spatial_approx" | "street_only";

type AddressInsert = {
  uprn: number;
  house_number: string | null;
  building_name: string | null;
  sub_building: string | null;
  street_name: string | null;
  postcode: string | null;
  source: "epc";
  match_confidence: MatchConfidence;
  property_type: string | null;
  uprn_source: string | null;
};

function parsePass(argv: string[]): Pass {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--pass=")) {
      return asPass(arg.slice("--pass=".length));
    }
    if (arg === "--pass") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw usageError();
      }
      return asPass(next);
    }
  }
  throw usageError();
}

function asPass(value: string): Pass {
  if ((ALL_PASSES as readonly string[]).includes(value)) {
    return value as Pass;
  }
  throw usageError();
}

function usageError(): Error {
  return new Error(
    "Usage: tsx scripts/ingest-addresses.ts --pass=epc|osm|linked_ids|land_registry",
  );
}

function parseUprn(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function asUprnPage(data: unknown): number[] {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!Array.isArray(parsed)) {
    throw new Error(`list_property_uprns returned ${typeof parsed}, expected array`);
  }
  return parsed.map(Number);
}

async function loadExistingStreets(): Promise<Map<number, string | null>> {
  const supabase = createIngestClient();
  const out = new Map<number, string | null>();
  let after = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("property_addresses")
      .select("uprn, street_name")
      .gt("uprn", after)
      .order("uprn", { ascending: true })
      .limit(ADDRESS_PAGE);
    if (error) throw new Error(`load existing streets: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      out.set(Number(row.uprn), row.street_name);
    }
    after = Number(rows[rows.length - 1].uprn);
    if (rows.length < ADDRESS_PAGE) break;
  }
  return out;
}

async function loadPropertyUprns(): Promise<Set<number>> {
  const uprns = new Set<number>();
  let after = 0;
  for (;;) {
    const page = asUprnPage(
      await withRetry(`list_property_uprns after ${after}`, () =>
        rpc<unknown>("list_property_uprns", {
          p_after: after,
          p_limit: UPRN_PAGE,
        }),
      ),
    );
    if (page.length === 0) break;
    for (const uprn of page) {
      uprns.add(uprn);
    }
    after = page[page.length - 1];
    if (page.length < UPRN_PAGE) break;
    console.log(`loaded ${uprns.size.toLocaleString("en-GB")} property UPRNs`);
  }
  return uprns;
}

async function flush(batch: AddressInsert[]): Promise<number> {
  if (batch.length === 0) return 0;
  const rows = batch.splice(0, batch.length);
  return withRetry(`upsert_property_addresses x${rows.length}`, () =>
    rpc<number>("upsert_property_addresses", { p_rows: rows }),
  );
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Street name the previous ingest would have written (last suffix field,
 * single list). Used only to report what this tier split changed.
 */
const PREVIOUS_SUFFIX_RE = new RegExp(
  "\\b(?:Street|Road|Avenue|Lane|Close|Drive|Crescent|Way|Gardens|Grove|Hill|Park|Place|Terrace|Walk|Court|Crest|Rise|View|Square|Parade|Row|Mews|Circus|Quay|Wharf|Broadway|Vale|Green|Yard|Promenade|Steps|Mount|Villas|Mead|Path|Gate|End|Causeway)\\b(?:\\s+(?:North|South|East|West))?\\.?$",
  "i",
);

const WEAK_NAME_RE = /\b(?:Park|Vale|Green|Hill|Cross|Gate|Barton|View|Rise|Mead|Bridge|Paddock|Hollow)\b(?:\s+(?:North|South|East|West))?\.?$/i;

function fieldStreetName(raw: string): string | null {
  const s = collapseWs(raw).replace(/[,/]+$/g, "").trim();
  if (!s) return null;
  const { rest } = stripLeadingHouseNumber(s);
  return rest ? standardiseSt(toTitleCase(rest)) : null;
}

function previousRunStreetName(
  address1: string,
  address2: string,
  address3: string,
): string | null {
  const fields = [address1, address2, address3].map((f) => collapseWs(f));
  for (let i = 2; i >= 0; i -= 1) {
    const s = fields[i].replace(/[,/]+$/g, "").trim();
    if (!s) continue;
    const { rest } = stripLeadingHouseNumber(s);
    const probe = (rest || s).replace(/[,/]+$/g, "").trim();
    if (!PREVIOUS_SUFFIX_RE.test(probe)) continue;
    return rest ? standardiseSt(toTitleCase(rest)) : null;
  }
  return null;
}

/** Unique modal street, or null when the postcode has a tie for first place. */
function modalStreet(counts: Map<string, number>): {
  modal: string | null;
  distinct: number;
} {
  let best: string | null = null;
  let bestN = 0;
  let secondN = 0;
  for (const [name, n] of counts) {
    if (n > bestN) {
      secondN = bestN;
      bestN = n;
      best = name;
    } else if (n > secondN) {
      secondN = n;
    }
  }
  const distinct = counts.size;
  if (!best || (distinct > 1 && bestN === secondN)) {
    return { modal: null, distinct };
  }
  return { modal: best, distinct };
}

async function ingestEpc(): Promise<void> {
  assertKnownExamples();

  try {
    await access(EPC_CSV);
  } catch {
    throw new Error(`EPC extract not found: ${EPC_CSV}`);
  }

  const supabase = createIngestClient();
  console.log("Loading property UPRNs (Bristol filter / FK set)…");
  const propertyUprns = await loadPropertyUprns();
  console.log(
    `properties UPRNs loaded: ${propertyUprns.size.toLocaleString("en-GB")}`,
  );
  if (propertyUprns.size === 0) {
    throw new Error("properties is empty — run ingest:uprn before this pass");
  }

  const { count: existingBefore, error: beforeErr } = await supabase
    .from("property_addresses")
    .select("*", { count: "exact", head: true });
  if (beforeErr) throw new Error(`count property_addresses: ${beforeErr.message}`);

  console.log(`Streaming ${EPC_CSV}`);
  const rl = readline.createInterface({
    input: createReadStream(EPC_CSV, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let cols:
    | {
        uprn: number;
        address1: number;
        address2: number;
        address3: number;
        postcode: number;
        date: number;
        dateName: string;
        propertyType: number;
        uprnSource: number;
      }
    | undefined;

  let rowsRead = 0;
  let usableUprn = 0;
  let matchedProperties = 0;
  let yieldHouseStreet = 0;
  let yieldStreetOnly = 0;
  let yieldNeither = 0;
  let ambiguousAll = 0;
  const bestByUprn = new Map<number, EpcRow>();
  const streetsByPostcode = new Map<string, Map<string, number>>();
  let preferredMatchedOverNewer = 0;
  let multiCertUprns = 0;
  const certCount = new Map<number, number>();

  for await (const line of rl) {
    if (!cols) {
      const headers = parseCsvLine(line.replace(/^\uFEFF/, "")).map((h) =>
        h.trim(),
      );
      const dateIdx = resolveDateColumn(headers);
      cols = {
        uprn: resolveUprnColumn(headers),
        address1: resolveColumn(headers, "address1"),
        address2: resolveColumn(headers, "address2"),
        address3: resolveColumn(headers, "address3"),
        postcode: resolveColumn(headers, "postcode"),
        date: dateIdx,
        dateName: headers[dateIdx],
        propertyType: resolveColumn(headers, "property_type"),
        uprnSource: resolveColumn(headers, "uprn_source"),
      };
      console.log(
        `columns: uprn=${headers[cols.uprn]} address1=${headers[cols.address1]} address2=${headers[cols.address2]} address3=${headers[cols.address3]} postcode=${headers[cols.postcode]} date=${cols.dateName} property_type=${headers[cols.propertyType]} uprn_source=${headers[cols.uprnSource]}`,
      );
      continue;
    }
    if (!line) continue;
    rowsRead += 1;

    const cells = parseCsvLine(line);
    const parsed = parseAddressRow(
      cells[cols.address1] ?? "",
      cells[cols.address2] ?? "",
      cells[cols.address3] ?? "",
    );
    if (parsed.ambiguous) ambiguousAll += 1;
    if (parsed.house_number && parsed.street_name && !parsed.ambiguous) {
      yieldHouseStreet += 1;
    } else if (parsed.street_name) {
      yieldStreetOnly += 1;
    } else {
      yieldNeither += 1;
    }
    if (parsed.street_name) {
      const pc = normalisePostcode(cells[cols.postcode] ?? "");
      if (pc) {
        let bucket = streetsByPostcode.get(pc);
        if (!bucket) {
          bucket = new Map();
          streetsByPostcode.set(pc, bucket);
        }
        bump(bucket, parsed.street_name);
      }
    }

    const uprn = parseUprn(cells[cols.uprn] ?? "");
    if (uprn === null) continue;
    usableUprn += 1;
    if (!propertyUprns.has(uprn)) continue;
    matchedProperties += 1;
    certCount.set(uprn, (certCount.get(uprn) ?? 0) + 1);

    const row: EpcRow = {
      uprn,
      address1: cells[cols.address1] ?? "",
      address2: cells[cols.address2] ?? "",
      address3: cells[cols.address3] ?? "",
      postcode: cells[cols.postcode] ?? "",
      when: parseWhen(cells[cols.date] ?? ""),
      property_type: collapseWs(cells[cols.propertyType] ?? ""),
      uprn_source: collapseWs(cells[cols.uprnSource] ?? ""),
    };
    const prev = bestByUprn.get(uprn);
    if (!prev) {
      bestByUprn.set(uprn, row);
    } else if (isBetterCertificate(row, prev)) {
      if (
        row.uprn_source === "Address Matched" &&
        prev.uprn_source !== "Address Matched" &&
        row.when < prev.when
      ) {
        preferredMatchedOverNewer += 1;
      }
      bestByUprn.set(uprn, row);
    }

    if (rowsRead % 50_000 === 0) {
      console.log(
        `read ${rowsRead.toLocaleString("en-GB")}, usable ${usableUprn.toLocaleString("en-GB")}, matched ${matchedProperties.toLocaleString("en-GB")}, distinct ${bestByUprn.size.toLocaleString("en-GB")}`,
      );
    }
  }

  for (const n of certCount.values()) {
    if (n > 1) multiCertUprns += 1;
  }

  const uniqueStreetPostcodes = [...streetsByPostcode.values()].filter(
    (b) => b.size === 1,
  ).length;
  const postcodesWithStreet = streetsByPostcode.size;
  const uniqueStreetShare =
    postcodesWithStreet > 0
      ? (uniqueStreetPostcodes / postcodesWithStreet) * 100
      : 0;

  const filtered = [...bestByUprn.values()];
  console.log(
    `filtered set (one row per UPRN, in properties): ${filtered.length.toLocaleString("en-GB")}`,
  );

  const toWrite: AddressInsert[] = [];
  let exact = 0;
  let spatialApprox = 0;
  let streetOnly = 0;
  let droppedNeither = 0;
  let ambiguousWritten = 0;
  let withHouseNumber = 0;
  const streetCounts = new Map<string, number>();

  for (const row of filtered) {
    const parsed = parseAddressRow(row.address1, row.address2, row.address3);
    const pc = normalisePostcode(row.postcode);
    if (!parsed.street_name) {
      droppedNeither += 1;
      continue;
    }
    if (parsed.ambiguous) ambiguousWritten += 1;

    const house = parsed.ambiguous ? null : parsed.house_number;
    let match_confidence: MatchConfidence;
    if (!house) {
      match_confidence = "street_only";
      streetOnly += 1;
    } else {
      withHouseNumber += 1;
      const bucket = pc ? streetsByPostcode.get(pc) : undefined;
      const { modal, distinct } = bucket
        ? modalStreet(bucket)
        : { modal: null, distinct: 0 };
      const checkFails =
        distinct === 1 && modal !== null && parsed.street_name !== modal;
      if (checkFails) {
        match_confidence = "spatial_approx";
        spatialApprox += 1;
      } else if (distinct > 1 && modal !== null && parsed.street_name !== modal) {
        match_confidence = "spatial_approx";
        spatialApprox += 1;
      } else {
        match_confidence = "exact";
        exact += 1;
      }
    }

    bump(streetCounts, parsed.street_name);
    toWrite.push({
      uprn: row.uprn,
      house_number: house,
      building_name: parsed.building_name,
      sub_building: parsed.sub_building,
      street_name: parsed.street_name,
      postcode: pc || null,
      source: "epc",
      match_confidence,
      property_type: row.property_type || null,
      uprn_source: row.uprn_source || null,
    });
  }

  const previousStreets = await loadExistingStreets();
  type ChangeEx = {
    uprn: number;
    a1: string;
    a2: string;
    a3: string;
    before: string | null;
    after: string | null;
    promoted: boolean;
  };
  const streetChanges: ChangeEx[] = [];
  const promotions: ChangeEx[] = [];
  let renamedVs132977 = 0;
  let gainedVs132977 = 0;
  let lostVs132977 = 0;
  for (const row of filtered) {
    const fields = [row.address1, row.address2, row.address3].map((f) =>
      collapseWs(f),
    );
    const next = parseAddressRow(row.address1, row.address2, row.address3);
    const lastIdx = lastSuffixFieldIndex(fields);
    const chosenIdx = chooseStreetFieldIndex(fields);
    const promoted = lastIdx >= 0 && chosenIdx !== lastIdx;
    if (promoted) {
      promotions.push({
        uprn: row.uprn,
        a1: row.address1,
        a2: row.address2,
        a3: row.address3,
        before: lastIdx >= 0 ? fieldStreetName(fields[lastIdx]) : null,
        after: next.street_name,
        promoted: true,
      });
    }
    const before132977 = previousRunStreetName(
      row.address1,
      row.address2,
      row.address3,
    );
    const after = next.street_name;
    if (before132977 === after) continue;
    if (before132977 && after) renamedVs132977 += 1;
    else if (!before132977 && after) gainedVs132977 += 1;
    else lostVs132977 += 1;
    streetChanges.push({
      uprn: row.uprn,
      a1: row.address1,
      a2: row.address2,
      a3: row.address3,
      before: before132977,
      after,
      promoted,
    });
  }
  promotions.sort((a, b) => a.uprn - b.uprn);
  streetChanges.sort((a, b) => {
    const aWeak = a.before && WEAK_NAME_RE.test(a.before) ? 0 : 1;
    const bWeak = b.before && WEAK_NAME_RE.test(b.before) ? 0 : 1;
    if (aWeak !== bWeak) return aWeak - bWeak;
    return a.uprn - b.uprn;
  });
  const promotionExamples: ChangeEx[] = promotions.slice(0, 30);
  if (promotionExamples.length < 30) {
    for (const ch of streetChanges) {
      if (promotionExamples.length >= 30) break;
      if (promotionExamples.some((e) => e.uprn === ch.uprn)) continue;
      promotionExamples.push(ch);
    }
  }
  let dbStreetChanged = 0;
  let lostVsCurrentTable = 0;
  const writeUprnSet = new Set(toWrite.map((r) => r.uprn));
  for (const row of toWrite) {
    const prev = previousStreets.get(row.uprn);
    if (prev !== undefined && prev !== row.street_name) dbStreetChanged += 1;
  }
  for (const [uprn, prev] of previousStreets) {
    if (prev && !writeUprnSet.has(uprn)) lostVsCurrentTable += 1;
  }

  const writeUprns = new Set(toWrite.map((r) => r.uprn));

  const { count: existingEpcCount, error: existingEpcErr } = await supabase
    .from("property_addresses")
    .select("*", { count: "exact", head: true })
    .eq("source", "epc");
  if (existingEpcErr) {
    throw new Error(`count existing epc: ${existingEpcErr.message}`);
  }

  // Replace this pass's previous output. Previously-rejected UPRNs are then
  // a first INSERT, not an UPDATE of a missing row. Track B rows (other
  // source values) are left alone.
  const { count: deletedEpc, error: delErr } = await supabase
    .from("property_addresses")
    .delete({ count: "exact" })
    .eq("source", "epc");
  if (delErr) throw new Error(`delete previous epc rows: ${delErr.message}`);

  console.log(`writing ${toWrite.length.toLocaleString("en-GB")} rows…`);
  const batch: AddressInsert[] = [];
  let written = 0;
  for (const row of toWrite) {
    batch.push(row);
    if (batch.length >= BATCH_SIZE) {
      written += await flush(batch);
      if (written % 15_000 === 0) {
        console.log(`upserted ${written.toLocaleString("en-GB")}`);
      }
    }
  }
  written += await flush(batch);

  const { count: addressCount, error: addressErr } = await supabase
    .from("property_addresses")
    .select("*", { count: "exact", head: true });
  if (addressErr) throw new Error(`count property_addresses: ${addressErr.message}`);

  const { count: propertyCount, error: propErr } = await supabase
    .from("properties")
    .select("*", { count: "exact", head: true });
  if (propErr) throw new Error(`count properties: ${propErr.message}`);

  const { count: exactCount, error: exactErr } = await supabase
    .from("property_addresses")
    .select("*", { count: "exact", head: true })
    .eq("match_confidence", "exact");
  if (exactErr) throw new Error(`count exact: ${exactErr.message}`);

  const { count: spatialCount, error: spatialErr } = await supabase
    .from("property_addresses")
    .select("*", { count: "exact", head: true })
    .eq("match_confidence", "spatial_approx");
  if (spatialErr) throw new Error(`count spatial_approx: ${spatialErr.message}`);

  const { count: streetOnlyCount, error: soErr } = await supabase
    .from("property_addresses")
    .select("*", { count: "exact", head: true })
    .eq("match_confidence", "street_only");
  if (soErr) throw new Error(`count street_only: ${soErr.message}`);

  const { count: inferredCount, error: infErr } = await supabase
    .from("property_addresses")
    .select("*", { count: "exact", head: true })
    .eq("match_confidence", "inferred");
  if (infErr) throw new Error(`count inferred: ${infErr.message}`);

  const { count: neitherCount, error: neitherErr } = await supabase
    .from("property_addresses")
    .select("*", { count: "exact", head: true })
    .is("house_number", null)
    .is("street_name", null);
  if (neitherErr) throw new Error(`count neither: ${neitherErr.message}`);

  const coverage =
    propertyCount && propertyCount > 0
      ? ((addressCount ?? 0) / propertyCount) * 100
      : 0;
  const exactCoverage =
    propertyCount && propertyCount > 0
      ? ((exactCount ?? 0) / propertyCount) * 100
      : 0;

  const topStreets = [...streetCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20);

  const houseStreetPct =
    rowsRead > 0 ? (yieldHouseStreet / rowsRead) * 100 : 0;
  const distinctWithHousePct =
    filtered.length > 0 ? (withHouseNumber / filtered.length) * 100 : 0;

  console.log("---");
  console.log(`rows read: ${rowsRead}`);
  console.log(`rows with usable uprn: ${usableUprn}`);
  console.log(`rows matched to properties: ${matchedProperties}`);
  console.log(
    `rows yielding house number + street: ${yieldHouseStreet} (${houseStreetPct.toFixed(2)}%)`,
  );
  console.log(`rows yielding street only (all certificates): ${yieldStreetOnly}`);
  console.log(`rows with neither street nor number: ${yieldNeither}`);
  console.log(`ambiguous double-number rows (all certificates): ${ambiguousAll}`);
  console.log(
    `distinct UPRNs with a house number: ${withHouseNumber} (${distinctWithHousePct.toFixed(2)}% of ${filtered.length})`,
  );
  console.log(`distinct UPRNs written: ${addressCount ?? toWrite.length}`);
  console.log(
    `coverage of properties: ${coverage.toFixed(2)}% any label, ${exactCoverage.toFixed(2)}% exact`,
  );
  console.log(`exact: ${exactCount ?? exact}`);
  console.log(`spatial_approx: ${spatialCount ?? spatialApprox}`);
  console.log(`street_only: ${streetOnlyCount ?? streetOnly}`);
  console.log(`inferred (must be 0): ${inferredCount ?? 0}`);
  console.log(`rows with neither house_number nor street_name: ${neitherCount ?? 0}`);
  console.log(
    `postcodes with exactly one parsed street: ${uniqueStreetPostcodes}/${postcodesWithStreet} (${uniqueStreetShare.toFixed(2)}%)`,
  );
  console.log(`multi-certificate UPRNs in properties: ${multiCertUprns}`);
  console.log(
    `selected Address Matched over a newer Energy Assessor row: ${preferredMatchedOverNewer}`,
  );
  console.log(`ambiguous among written UPRNs: ${ambiguousWritten}`);
  console.log(`rows dropped (no street): ${droppedNeither}`);
  console.log(`property_addresses before this run: ${existingBefore ?? 0}`);
  console.log(`existing epc rows before write: ${existingEpcCount ?? 0}`);
  console.log(`previous epc rows deleted (so this pass INSERTs): ${deletedEpc ?? 0}`);
  console.log(`upsert row_count this run: ${written}`);
  console.log(`write set size: ${writeUprns.size}`);
  console.log(
    `promotion rule fired (weak last → numbered earlier strong): ${promotions.length} (was 2,014 unguarded renames)`,
  );
  console.log(
    `vs 132,977-run parser (last suffix, old list): ${renamedVs132977} renamed, ${gainedVs132977} gained a street, ${lostVs132977} lost a street`,
  );
  console.log(
    `street_name vs table before this write (132,391-run): ${dbStreetChanged} of ${previousStreets.size} existing rows renamed; ${lostVsCurrentTable} existing rows no longer written`,
  );
  if (promotionExamples.length > 0) {
    console.log(
      "30 promotion before/after examples (last-suffix street → chosen street):",
    );
    for (const ex of promotionExamples) {
      console.log(
        `  ${ex.uprn}\t${JSON.stringify(ex.a1)} | ${JSON.stringify(ex.a2)} | ${JSON.stringify(ex.a3)}\t${ex.before ?? "(none)"} → ${ex.after ?? "(none)"}`,
      );
    }
  }
  const stillWestbury = streetCounts.get("Westbury Park") ?? 0;
  const stillAnnes =
    (streetCounts.get("St. Annes Park") ?? 0) +
    (streetCounts.get("St Annes Park") ?? 0);
  console.log(`remaining Westbury Park as street_name: ${stillWestbury}`);
  console.log(`remaining St. Annes Park / St Annes Park as street_name: ${stillAnnes}`);
  console.log("20 most common street_name values:");
  for (const [name, n] of topStreets) {
    console.log(`  ${n}\t${name}`);
  }
}

async function main(): Promise<void> {
  const pass = parsePass(process.argv.slice(2));
  if (pass !== "epc") {
    console.log(`${pass}: not implemented, Track B`);
    return;
  }
  await ingestEpc();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
