import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import proj4 from "proj4";
import { createIngestClient, rpc } from "./lib/supabase";

const RAW_DIR = path.resolve(process.cwd(), "data", "raw");
const SOURCE = "bristol-nccz";

proj4.defs(
  "EPSG:27700",
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs",
);

type Position = [number, number];
type LinearRing = Position[];
type PolygonCoords = LinearRing[];

type GeoJson =
  | { type: "FeatureCollection"; features: GeoJsonFeature[]; crs?: { properties?: { name?: string } } }
  | GeoJsonFeature
  | GeoJsonGeometry;

type GeoJsonFeature = {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry: GeoJsonGeometry | null;
  crs?: { properties?: { name?: string } };
};

type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: PolygonCoords }
  | { type: "MultiPolygon"; coordinates: PolygonCoords[] };

async function findNcczFile(): Promise<string | null> {
  const names = await readdir(RAW_DIR);
  const geojson = names.find((name) => /^bristol-nccz\.(geojson|json)$/i.test(name));
  if (geojson) return path.join(RAW_DIR, geojson);

  const unsupported = names.find((name) =>
    /^bristol-nccz\.(shp|gpkg|zip)$/i.test(name),
  );
  if (unsupported) {
    throw new Error(
      `Found ${unsupported} but this ingest path reads GeoJSON only. Convert to data/raw/bristol-nccz.geojson (EPSG:27700 or 4326) and re-run.`,
    );
  }
  return null;
}

function looksLike27700(coords: unknown): boolean {
  const first = firstPosition(coords);
  if (!first) return false;
  const [x, y] = first;
  return Math.abs(x) > 180 || Math.abs(y) > 90;
}

function firstPosition(coords: unknown): Position | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    return [coords[0], coords[1]];
  }
  return firstPosition(coords[0]);
}

function detectCrs(doc: GeoJson, coords: unknown): "EPSG:27700" | "EPSG:4326" {
  const named =
    "crs" in doc && doc.crs?.properties?.name
      ? doc.crs.properties.name.toUpperCase()
      : "";
  if (named.includes("27700") || named.includes("OSGB")) return "EPSG:27700";
  if (named.includes("4326") || named.includes("WGS84") || named.includes("CRS84")) {
    return "EPSG:4326";
  }
  return looksLike27700(coords) ? "EPSG:27700" : "EPSG:4326";
}

function reprojectPosition(
  position: Position,
  source: "EPSG:27700" | "EPSG:4326",
): Position {
  if (source === "EPSG:4326") return [position[0], position[1]];
  const [lon, lat] = proj4(source, "EPSG:4326", [position[0], position[1]]);
  return [lon, lat];
}

function reprojectRing(
  ring: LinearRing,
  source: "EPSG:27700" | "EPSG:4326",
): LinearRing {
  return ring.map((position) => reprojectPosition(position, source));
}

function polygonsFromGeometry(
  geometry: GeoJsonGeometry,
  source: "EPSG:27700" | "EPSG:4326",
): PolygonCoords[] {
  switch (geometry.type) {
    case "Polygon":
      return [geometry.coordinates.map((ring) => reprojectRing(ring, source))];
    case "MultiPolygon":
      return geometry.coordinates.map((polygon) =>
        polygon.map((ring) => reprojectRing(ring, source)),
      );
  }
}

function featureName(feature: GeoJsonFeature, index: number): string {
  const props = feature.properties ?? {};
  for (const key of ["name", "Name", "NAME", "zone", "ZONE_NAME", "nccz_name"]) {
    const value = props[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `NCCZ ${index + 1}`;
}

function assertPolygonGeometry(value: { type: string }): GeoJsonGeometry {
  if (value.type === "Polygon" || value.type === "MultiPolygon") {
    return value as GeoJsonGeometry;
  }
  throw new Error(`Unsupported NCCZ geometry type: ${value.type}`);
}

function featuresOf(doc: GeoJson): GeoJsonFeature[] {
  if (doc.type === "FeatureCollection") return doc.features;
  if (doc.type === "Feature") return [doc];
  return [{ type: "Feature", properties: { name: "NCCZ 1" }, geometry: doc }];
}

async function main(): Promise<void> {
  createIngestClient();
  const file = await findNcczFile();
  if (!file) {
    console.log(
      `No data/raw/bristol-nccz.geojson (council extract not yet available). Leaving nccz_zones unchanged.`,
    );
    const flagged = await rpc<number>("apply_nccz_flags", {});
    console.log(`is_nccz = true: ${flagged.toLocaleString("en-GB")}`);
    return;
  }

  const doc = JSON.parse(await readFile(file, "utf8")) as GeoJson;
  const features = featuresOf(doc);
  const polygons: { name: string; coordinates: PolygonCoords }[] = [];

  features.forEach((feature, index) => {
    if (!feature.geometry) return;
    const geometry = assertPolygonGeometry(feature.geometry);
    const source = detectCrs(doc, geometry.coordinates);
    if (source === "EPSG:27700") {
      console.log(`Reprojecting feature ${index} from EPSG:27700 to EPSG:4326`);
    }
    for (const coordinates of polygonsFromGeometry(geometry, source)) {
      polygons.push({ name: featureName(feature, index), coordinates });
    }
  });

  const supabase = createIngestClient();
  const { error: delError } = await supabase
    .from("nccz_zones")
    .delete()
    .eq("source", SOURCE);
  if (delError) throw new Error(`clear nccz_zones: ${delError.message}`);

  for (const polygon of polygons) {
    await rpc<string>("insert_nccz_zone", {
      p_name: polygon.name,
      p_geojson: { type: "Polygon", coordinates: polygon.coordinates },
      p_source: SOURCE,
    });
  }

  const flagged = await rpc<number>("apply_nccz_flags", {});
  const { count, error } = await supabase
    .from("nccz_zones")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`count nccz_zones: ${error.message}`);

  console.log(`Loaded ${polygons.length} polygon(s) from ${path.basename(file)}`);
  console.log(`nccz_zones row count: ${count ?? "?"}`);
  console.log(`is_nccz = true: ${flagged.toLocaleString("en-GB")}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
