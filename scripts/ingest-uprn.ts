import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import {
  BRISTOL_BBOX,
  createIngestClient,
  rpc,
  withRetry,
} from "./lib/supabase";

const BATCH_SIZE = 1000;
const RAW_DIR = path.resolve(process.cwd(), "data", "raw");

type PropertyRow = { uprn: number; lon: number; lat: number };

async function findUprnCsv(): Promise<string> {
  const names = await readdir(RAW_DIR);
  const matches = names
    .filter((name) => /^osopenuprn_.*\.csv$/i.test(name))
    .sort();
  if (matches.length === 0) {
    throw new Error(`No osopenuprn_*.csv in ${RAW_DIR}`);
  }
  const preferred = matches.find((name) => name === "osopenuprn_202608.csv");
  return path.join(RAW_DIR, preferred ?? matches[matches.length - 1]);
}

function parseHeader(line: string): {
  uprn: number;
  lat: number;
  lon: number;
} {
  const cols = line.replace(/^\uFEFF/, "").split(",");
  const uprn = cols.indexOf("UPRN");
  const lat = cols.indexOf("LATITUDE");
  const lon = cols.indexOf("LONGITUDE");
  if (uprn < 0 || lat < 0 || lon < 0) {
    throw new Error(`Unexpected UPRN CSV header: ${line}`);
  }
  return { uprn, lat, lon };
}

async function flush(batch: PropertyRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const rows = batch.splice(0, batch.length);
  return withRetry(`upsert_properties x${rows.length}`, () =>
    rpc<number>("upsert_properties", { p_rows: rows }),
  );
}

async function main(): Promise<void> {
  createIngestClient();
  const csvPath = await findUprnCsv();
  console.log(`Streaming ${csvPath}`);
  console.log(
    `Bristol bbox lon ${BRISTOL_BBOX.minLon}..${BRISTOL_BBOX.maxLon}, lat ${BRISTOL_BBOX.minLat}..${BRISTOL_BBOX.maxLat}`,
  );

  const rl = readline.createInterface({
    input: createReadStream(csvPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let header: { uprn: number; lat: number; lon: number } | undefined;
  let scanned = 0;
  let matched = 0;
  let skipped = 0;
  const batch: PropertyRow[] = [];

  for await (const line of rl) {
    if (!header) {
      header = parseHeader(line);
      continue;
    }
    if (!line) continue;
    scanned += 1;

    const cols = line.split(",");
    const uprn = Number(cols[header.uprn]);
    const lat = Number(cols[header.lat]);
    const lon = Number(cols[header.lon]);
    if (!Number.isFinite(uprn) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      skipped += 1;
      continue;
    }
    if (
      lon < BRISTOL_BBOX.minLon ||
      lon > BRISTOL_BBOX.maxLon ||
      lat < BRISTOL_BBOX.minLat ||
      lat > BRISTOL_BBOX.maxLat
    ) {
      continue;
    }

    matched += 1;
    batch.push({ uprn, lon, lat });
    if (batch.length >= BATCH_SIZE) {
      await flush(batch);
    }

    if (scanned % 1_000_000 === 0) {
      console.log(`scanned ${scanned.toLocaleString("en-GB")}, matched ${matched.toLocaleString("en-GB")}`);
    }
  }

  await flush(batch);

  const flagged = await rpc<number>("apply_nccz_flags", {});
  const supabase = createIngestClient();
  const { count, error } = await supabase
    .from("properties")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`count properties: ${error.message}`);

  console.log(`scanned ${scanned.toLocaleString("en-GB")} CSV rows`);
  console.log(`skipped ${skipped.toLocaleString("en-GB")} unparseable rows`);
  console.log(`Bristol UPRN matches this pass: ${matched.toLocaleString("en-GB")}`);
  console.log(`properties row count: ${count?.toLocaleString("en-GB") ?? "?"}`);
  console.log(`is_nccz = true: ${flagged.toLocaleString("en-GB")}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
