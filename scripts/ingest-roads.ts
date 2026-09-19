/**
 * OSM road-network ingest. Server-side, service role key.
 *
 * This script lives in scripts/ and must never be imported from app/ or lib/.
 * The service role key is for operator ingest only.
 *
 * This does NOT go through lib/sync/queue.ts — that rule governs field
 * writes only. This is an operator ingest, the same class as ingest-uprn.ts.
 *
 * An OSM way is not a segment. A way is a polyline through many nodes.
 * A junction is any node that appears in two or more ways, plus the first
 * and last node of every way. Every run of nodes between two consecutive
 * junctions becomes one road_segments row whose geom is the FULL polyline
 * of that run, not a straight line between the endpoints.
 *
 * Oneway tags are ignored: canvassers walk. Vehicle restrictions must not
 * constrain the route.
 *
 * Re-running upserts nodes and replaces segments for ways in this file,
 * so a later extract that discovers new junctions cannot leave a coarser
 * stale split. The JSON is streamed; it is never JSON.parse'd as a whole.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { createIngestClient, rpc, withRetry } from "./lib/supabase";

const NODE_BATCH = 500;
const SEGMENT_BATCH = 100;
const DELETE_CHUNK = 200;
const OSM_JSON = path.resolve(process.cwd(), "data", "raw", "bristol-roads.osm.json");
const QUERY_FILE = "scripts/queries/bristol-roads.overpassql";

const FETCH_COMMAND = [
  "curl.exe -A nakolabs-d2d/stage-1b -H \"Accept: application/json\"",
  "-H \"Content-Type: application/x-www-form-urlencoded\"",
  "-X POST https://overpass-api.de/api/interpreter",
  `--data-urlencode "data@${QUERY_FILE}"`,
  "-o data/raw/bristol-roads.osm.json",
].join(" ");

type NodeCoord = { lon: number; lat: number };

type OverpassWay = {
  type: "way";
  id: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string | undefined>;
};

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string | undefined>;
  remark?: string;
};

type NodeRow = { id: number; lon: number; lat: number };

type SegmentRow = {
  osm_way_id: number;
  from_node: number;
  to_node: number;
  name: string | null;
  highway: string;
  coords: [number, number][];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOverpassElement(value: unknown): OverpassElement | null {
  if (!isRecord(value)) return null;
  return value as OverpassElement;
}

/**
 * Stream complete objects from an Overpass JSON `elements` array without
 * parsing the document as a whole. Tracks brace depth and string state so
 * street names containing quotes or braces cannot split an object early.
 */
async function* streamOverpassElements(
  filePath: string,
): AsyncGenerator<OverpassElement> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  let buf = "";
  let parsePos = 0;
  let inArray = false;
  let objStart = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  const compact = (): void => {
    const keepFrom = objStart >= 0 ? objStart : parsePos;
    if (keepFrom <= 0) return;
    buf = buf.slice(keepFrom);
    parsePos -= keepFrom;
    if (objStart >= 0) objStart -= keepFrom;
  };

  const drain = function* (): Generator<OverpassElement> {
    if (!inArray) {
      const key = buf.indexOf('"elements"');
      if (key < 0) {
        if (buf.length > 1_000_000) {
          throw new Error(
            `No "elements" array in ${filePath}. The Overpass response is not OSM JSON.`,
          );
        }
        return;
      }
      const bracket = buf.indexOf("[", key);
      if (bracket < 0) return;
      inArray = true;
      parsePos = bracket + 1;
    }

    while (parsePos < buf.length) {
      const ch = buf[parsePos];

      if (objStart < 0) {
        if (ch === "]") return;
        if (ch === "{") {
          objStart = parsePos;
          depth = 1;
          inString = false;
          escape = false;
        }
        parsePos += 1;
        continue;
      }

      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        parsePos += 1;
        continue;
      }

      if (ch === '"') {
        inString = true;
        parsePos += 1;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const raw = buf.slice(objStart, parsePos + 1);
          const parsed: unknown = JSON.parse(raw);
          const element = asOverpassElement(parsed);
          if (element) yield element;
          parsePos += 1;
          objStart = -1;
          compact();
          continue;
        }
      }
      parsePos += 1;
    }
  };

  for await (const chunk of stream) {
    buf += chunk;
    yield* drain();
    compact();
  }

  yield* drain();
  if (!inArray) {
    throw new Error(
      `No "elements" array in ${filePath}. Fetch it once with:\n  ${FETCH_COMMAND}`,
    );
  }
}

function asWay(element: OverpassElement): OverpassWay | null {
  if (element.type !== "way" || typeof element.id !== "number") return null;
  return element as OverpassWay;
}

function recordWayNodes(
  way: OverpassWay,
  nodeCoords: Map<number, NodeCoord>,
  wayCount: Map<number, number>,
  endpoints: Set<number>,
): void {
  const nodeIds = way.nodes ?? [];
  const geom = way.geometry ?? [];
  const seen = new Set<number>();

  for (let i = 0; i < nodeIds.length; i += 1) {
    const id = nodeIds[i];
    if (!Number.isFinite(id)) continue;
    const pt = geom[i];
    if (pt && Number.isFinite(pt.lon) && Number.isFinite(pt.lat)) {
      nodeCoords.set(id, { lon: pt.lon, lat: pt.lat });
    }
    if (!seen.has(id)) {
      seen.add(id);
      wayCount.set(id, (wayCount.get(id) ?? 0) + 1);
    }
  }

  if (nodeIds.length > 0) {
    endpoints.add(nodeIds[0]);
    endpoints.add(nodeIds[nodeIds.length - 1]);
  }
}

function splitWay(
  way: OverpassWay,
  nodeCoords: Map<number, NodeCoord>,
  isJunction: (id: number) => boolean,
): SegmentRow[] {
  const highway = way.tags?.highway;
  if (!highway) return [];

  const nodeIds = way.nodes ?? [];
  if (nodeIds.length < 2) return [];

  const name = way.tags?.name?.trim() || null;
  const out: SegmentRow[] = [];
  let start = 0;

  const emit = (fromIdx: number, toIdx: number): void => {
    if (toIdx <= fromIdx) return;
    const fromNode = nodeIds[fromIdx];
    const toNode = nodeIds[toIdx];
    if (fromNode === toNode && toIdx === fromIdx + 1) return;

    const coords: [number, number][] = [];
    let lastLon = Number.NaN;
    let lastLat = Number.NaN;
    for (let i = fromIdx; i <= toIdx; i += 1) {
      const pt = nodeCoords.get(nodeIds[i]);
      if (!pt) return;
      if (pt.lon === lastLon && pt.lat === lastLat) continue;
      coords.push([pt.lon, pt.lat]);
      lastLon = pt.lon;
      lastLat = pt.lat;
    }
    if (coords.length < 2) return;

    out.push({
      osm_way_id: way.id,
      from_node: fromNode,
      to_node: toNode,
      name,
      highway,
      coords,
    });
  };

  for (let i = 1; i < nodeIds.length; i += 1) {
    if (!isJunction(nodeIds[i])) continue;
    emit(start, i);
    start = i;
  }

  return out;
}

async function deleteSegmentsForWays(wayIds: number[]): Promise<number> {
  const supabase = createIngestClient();
  let deleted = 0;
  for (let i = 0; i < wayIds.length; i += DELETE_CHUNK) {
    const chunk = wayIds.slice(i, i + DELETE_CHUNK);
    const { count } = await withRetry(
      `delete road_segments ways ${i}..${i + chunk.length}`,
      async () => {
        const result = await supabase
          .from("road_segments")
          .delete({ count: "exact" })
          .in("osm_way_id", chunk);
        if (result.error) throw new Error(result.error.message);
        return result;
      },
    );
    deleted += count ?? 0;
  }
  return deleted;
}

async function flushNodes(batch: NodeRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const rows = batch.splice(0, batch.length);
  return withRetry(`upsert_road_nodes x${rows.length}`, () =>
    rpc<number>("upsert_road_nodes", { p_rows: rows }),
  );
}

async function flushSegments(batch: SegmentRow[]): Promise<number> {
  if (batch.length === 0) return 0;
  const raw = batch.splice(0, batch.length);
  const unique = new Map<string, SegmentRow>();
  for (const row of raw) {
    unique.set(`${row.osm_way_id}:${row.from_node}:${row.to_node}`, row);
  }
  const rows = [...unique.values()];
  return withRetry(`upsert_road_segments x${rows.length}`, () =>
    rpc<number>("upsert_road_segments", { p_rows: rows }),
  );
}

async function countTable(table: "road_nodes" | "road_segments"): Promise<number> {
  const supabase = createIngestClient();
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  createIngestClient();

  if (!existsSync(OSM_JSON)) {
    throw new Error(
      `Missing ${OSM_JSON}. Fetch it once (do not loop Overpass):\n  ${FETCH_COMMAND}`,
    );
  }

  const bytes = statSync(OSM_JSON).size;
  console.log(`Streaming ${OSM_JSON} (${(bytes / 1_048_576).toFixed(1)} MiB)`);
  console.log("Pass 1: node coordinates and junction membership");

  const nodeCoords = new Map<number, NodeCoord>();
  const wayCount = new Map<number, number>();
  const endpoints = new Set<number>();
  const wayIds = new Set<number>();
  let wayTotal = 0;
  let skippedWays = 0;

  for await (const element of streamOverpassElements(OSM_JSON)) {
    if (typeof element.remark === "string" && element.remark.length > 0) {
      throw new Error(`Overpass remark: ${element.remark}`);
    }
    const way = asWay(element);
    if (!way) continue;
    wayTotal += 1;
    if (!way.tags?.highway || !way.nodes || way.nodes.length < 2) {
      skippedWays += 1;
      continue;
    }
    wayIds.add(way.id);
    recordWayNodes(way, nodeCoords, wayCount, endpoints);
  }

  const junctions = new Set<number>();
  for (const id of endpoints) junctions.add(id);
  for (const [id, count] of wayCount) {
    if (count >= 2) junctions.add(id);
  }

  const isJunction = (id: number): boolean => junctions.has(id);

  console.log(`ways in file: ${wayTotal.toLocaleString("en-GB")}`);
  console.log(`ways skipped: ${skippedWays.toLocaleString("en-GB")}`);
  console.log(`distinct OSM nodes: ${nodeCoords.size.toLocaleString("en-GB")}`);
  console.log(`junction nodes: ${junctions.size.toLocaleString("en-GB")}`);

  const nodeBatch: NodeRow[] = [];
  let nodesWritten = 0;
  for (const id of junctions) {
    const pt = nodeCoords.get(id);
    if (!pt) continue;
    nodeBatch.push({ id, lon: pt.lon, lat: pt.lat });
    if (nodeBatch.length >= NODE_BATCH) {
      nodesWritten += await flushNodes(nodeBatch);
    }
  }
  nodesWritten += await flushNodes(nodeBatch);
  console.log(`road_nodes upserted this pass: ${nodesWritten.toLocaleString("en-GB")}`);

  const deleted = await deleteSegmentsForWays([...wayIds]);
  console.log(
    `cleared ${deleted.toLocaleString("en-GB")} existing segments for ${wayIds.size.toLocaleString("en-GB")} ways`,
  );

  console.log("Pass 2: split ways at junctions");
  const segmentBatch: SegmentRow[] = [];
  let segmentsBuilt = 0;
  let segmentsWritten = 0;
  let waysSeen = 0;

  for await (const element of streamOverpassElements(OSM_JSON)) {
    const way = asWay(element);
    if (!way) continue;
    waysSeen += 1;
    const pieces = splitWay(way, nodeCoords, isJunction);
    for (const row of pieces) {
      segmentsBuilt += 1;
      segmentBatch.push(row);
      if (segmentBatch.length >= SEGMENT_BATCH) {
        segmentsWritten += await flushSegments(segmentBatch);
      }
    }
    if (waysSeen % 1000 === 0) {
      console.log(
        `split ${waysSeen.toLocaleString("en-GB")} ways, ${segmentsBuilt.toLocaleString("en-GB")} segments`,
      );
    }
  }
  segmentsWritten += await flushSegments(segmentBatch);

  const nodeRows = await countTable("road_nodes");
  const segmentRows = await countTable("road_segments");

  console.log(`segments built: ${segmentsBuilt.toLocaleString("en-GB")}`);
  console.log(`road_segments upserted this pass: ${segmentsWritten.toLocaleString("en-GB")}`);
  console.log(`road_nodes row count: ${nodeRows.toLocaleString("en-GB")}`);
  console.log(`road_segments row count: ${segmentRows.toLocaleString("en-GB")}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
