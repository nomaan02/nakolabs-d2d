/**
 * OSM building outlines and per-door slices. Service role only.
 *
 * This script lives in scripts/ and must never be imported from app/ or lib/.
 * The service role key is for operator ingest only. It does not go through
 * lib/sync/queue.ts — that rule governs field writes only.
 *
 * Multipolygon relations are NOT loaded. Houses are almost always simple
 * ways, so this is a known limit: a building drawn only as a relation
 * (some flats, some courtyards) is missing. A door more than 3 m from any
 * loaded outline gets no slice. That rule lives in rebuild_door_footprints.
 *
 * Re-running upserts the same osm_ids and rebuilds the slices. When the
 * Overpass extract is unchanged, the table row counts stay the same.
 *
 * OpenStreetMap attribution is already in ATTRIBUTION_LINES. This script
 * does not change it.
 *
 *   npx tsx scripts/ingest-buildings.ts --territory="REF - Speedwell"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createIngestClient, rpc, withRetry } from "./lib/supabase";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "nakolabs-d2d/ui-2";
const BBOX_PAD = 0.0008;
const BATCH = 200;

type LonLat = [number, number];

type PolygonGeom = {
  type: "Polygon";
  coordinates: LonLat[][];
};

type FootprintRow = {
  osm_id: number;
  geom: PolygonGeom;
  height_m: number;
  building: string | null;
};

type TerritoryGeom = {
  type: string;
  coordinates: unknown;
};

type OverpassElement = {
  type?: string;
  id?: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string | undefined>;
};

const USAGE = [
  "Usage: npx tsx scripts/ingest-buildings.ts --territory=<name> [--territory=<name> ...]",
  "Names one or more territories. Does not fetch every territory.",
].join("\n");

function territoryNames(): string[] {
  const names = process.argv
    .filter((arg) => arg.startsWith("--territory="))
    .map((arg) => arg.slice("--territory=".length).trim())
    .filter((name) => name.length > 0);
  return names;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseMetres(raw: string): number | null {
  const match = raw.trim().match(/^([0-9]*\.?[0-9]+)\s*(m|metres|meters)?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function heightMetres(tags: Record<string, string | undefined> | undefined): number {
  const height = tags?.height;
  if (height) {
    const parsed = parseMetres(height);
    if (parsed !== null) return parsed;
  }
  const levels = tags?.["building:levels"];
  if (levels) {
    const n = Number(levels.trim());
    if (Number.isFinite(n) && n > 0) return n * 3 + 1;
  }
  const kind = (tags?.building ?? "").toLowerCase();
  if (kind === "apartments" || kind === "flats") return 10;
  if (kind === "garage" || kind === "garages" || kind === "shed") return 3;
  return 7;
}

function walkCoords(node: unknown, visit: (lon: number, lat: number) => void): void {
  if (!Array.isArray(node) || node.length === 0) return;
  if (typeof node[0] === "number" && typeof node[1] === "number") {
    visit(node[0], node[1]);
    return;
  }
  for (const child of node) walkCoords(child, visit);
}

function extent(geom: TerritoryGeom): { west: number; south: number; east: number; north: number } {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  walkCoords(geom.coordinates, (lon, lat) => {
    if (lon < west) west = lon;
    if (lat < south) south = lat;
    if (lon > east) east = lon;
    if (lat > north) north = lat;
  });
  if (!Number.isFinite(west)) throw new Error("territory geometry has no coordinates");
  return {
    west: west - BBOX_PAD,
    south: south - BBOX_PAD,
    east: east + BBOX_PAD,
    north: north + BBOX_PAD,
  };
}

function overpassQuery(box: { west: number; south: number; east: number; north: number }): string {
  return [
    "[out:json][timeout:60];",
    `way["building"](${box.south},${box.west},${box.north},${box.east});`,
    "out geom tags;",
  ].join("\n");
}

async function postOverpass(query: string): Promise<string> {
  let last = "no response";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(OVERPASS, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await response.text();
    if (response.ok) return text;
    last = `${response.status} ${text.slice(0, 240)}`;
    const retry = response.status === 429 || response.status === 502 || response.status === 504;
    if (!retry || attempt === 4) break;
    const delay = 5_000 * attempt;
    console.warn(`Overpass ${response.status}; retrying in ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`Overpass failed: ${last}`);
}

function polygonsFromOverpass(raw: string): FootprintRow[] {
  const parsed = JSON.parse(raw) as { elements?: OverpassElement[]; remark?: string };
  if (!Array.isArray(parsed.elements)) {
    throw new Error(parsed.remark ?? "Overpass response has no elements array");
  }
  const byId = new Map<number, FootprintRow>();
  for (const element of parsed.elements) {
    if (element.type !== "way" || typeof element.id !== "number") continue;
    const ring = element.geometry;
    if (!ring || ring.length < 4) continue;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last || first.lat !== last.lat || first.lon !== last.lon) continue;
    const coordinates: LonLat[] = ring.map((point) => [point.lon, point.lat]);
    byId.set(element.id, {
      osm_id: element.id,
      geom: { type: "Polygon", coordinates: [coordinates] },
      height_m: heightMetres(element.tags),
      building: element.tags?.building ?? null,
    });
  }
  return [...byId.values()];
}

async function flush(batch: FootprintRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const rows = batch.splice(0, batch.length);
  return withRetry(`upsert_building_footprints x${rows.length}`, () =>
    rpc<number>("upsert_building_footprints", { p_rows: rows }),
  );
}

async function countTable(table: "building_footprints" | "door_footprints"): Promise<number> {
  const supabase = createIngestClient();
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function ingestTerritory(name: string): Promise<void> {
  const supabase = createIngestClient();
  const { data, error } = await supabase
    .from("territories")
    .select("id, geom")
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(`${name}: ${error.message}`);
  if (!data) throw new Error(`No territory named ${name}`);

  const geom = data.geom as TerritoryGeom;
  const box = extent(geom);
  console.log(
    `${name}  ${data.id}  bbox ${box.south.toFixed(7)},${box.west.toFixed(7)},${box.north.toFixed(7)},${box.east.toFixed(7)}`,
  );

  const raw = await postOverpass(overpassQuery(box));
  const file = path.resolve(process.cwd(), "data", "raw", `buildings-${slug(name)}.osm.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, raw);
  console.log(`saved ${path.relative(process.cwd(), file)} (${raw.length} bytes)`);

  const polygons = polygonsFromOverpass(raw);
  let sent = 0;
  let written = 0;
  const batch: FootprintRow[] = [];
  for (const row of polygons) {
    batch.push(row);
    if (batch.length >= BATCH) {
      sent += BATCH;
      written += await flush(batch);
    }
  }
  sent += batch.length;
  written += await flush(batch);
  console.log(`upsert_building_footprints sent ${sent}, written ${written}`);

  const slices = await withRetry(`rebuild_door_footprints ${name}`, () =>
    rpc<number>("rebuild_door_footprints", { p_territory: data.id }),
  );
  console.log(`rebuild_door_footprints ${slices}`);
}

async function main(): Promise<void> {
  const names = territoryNames();
  if (names.length === 0) {
    console.error(USAGE);
    process.exit(1);
  }

  createIngestClient();
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (!name) continue;
    await ingestTerritory(name);
    if (i < names.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }

  const buildings = await countTable("building_footprints");
  const doors = await countTable("door_footprints");
  console.log(`building_footprints ${buildings}`);
  console.log(`door_footprints ${doors}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
