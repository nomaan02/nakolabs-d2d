/**
 * UI-10 F2a. Geometry helpers for the admin maps: the outer ring of a saved
 * prop (to edit it) and the box that frames a set of props.
 *
 * Pure: no map instance, no network. Checked by `npm run verify:ui10`.
 */
import type { Position, Ring } from "@/lib/geo/prop-polygon";

export type LngLatBox = [[number, number], [number, number]];

type PropGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/**
 * A `territories.geom` value as PostgREST returns it: a GeoJSON object (or
 * the same as a JSON string). Anything else is null, never a guess.
 */
export function parsePropGeometry(value: unknown): PropGeometry | null {
  if (typeof value === "string") {
    try {
      return parsePropGeometry(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if ((geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") || !Array.isArray(geometry.coordinates)) return null;
  return geometry as PropGeometry;
}

/** The outer ring of a Polygon, or of the first part of a MultiPolygon. Not repeated at the end. */
export function outerRing(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined): Ring | null {
  if (!geometry) return null;
  const raw = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  if (!raw || raw.length < 3) return null;
  const ring: Ring = raw.map((position) => [Number(position[0]), Number(position[1])] as Position);
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
  return ring.length >= 3 ? ring : null;
}

function extend(box: { minLon: number; minLat: number; maxLon: number; maxLat: number }, lon: number, lat: number) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  box.minLon = Math.min(box.minLon, lon);
  box.minLat = Math.min(box.minLat, lat);
  box.maxLon = Math.max(box.maxLon, lon);
  box.maxLat = Math.max(box.maxLat, lat);
}

/** The box around every corner of every geometry, or null when there is nothing to frame. */
export function boxOf(geometries: (GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined)[]): LngLatBox | null {
  const box = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const geometry of geometries) {
    if (!geometry) continue;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      for (const position of polygon[0] ?? []) extend(box, Number(position[0]), Number(position[1]));
    }
  }
  if (box.minLon === Infinity) return null;
  return [
    [box.minLon, box.minLat],
    [box.maxLon, box.maxLat],
  ];
}

/** The box around a ring of corners (a shape being drawn). */
export function boxOfRing(ring: Position[]): LngLatBox | null {
  if (ring.length === 0) return null;
  return boxOf([{ type: "Polygon", coordinates: [[...ring, ring[0]!]] }]);
}

/** A closed GeoJSON polygon from an open ring. */
export function polygonOfRing(ring: Position[]): GeoJSON.Polygon {
  return { type: "Polygon", coordinates: [[...ring, ring[0]!]] };
}
