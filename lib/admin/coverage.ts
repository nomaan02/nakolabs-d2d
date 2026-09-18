import type { SupabaseClient } from "@supabase/supabase-js";

import { mapLabel } from "@/lib/field/labels";
import type { Database, Json } from "@/lib/supabase/types";

export type CoverageDoorProperties = {
  uprn: number;
  territory_id: string;
  territory_name: string;
  label?: string;
};

export type CoverageDoorCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  CoverageDoorProperties
>;

export type CoverageOutcome = { uprn: number; outcome: string };

export type CoverageProp = {
  id: string;
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  knockable: number;
  worked: number;
  answered: number;
  remaining: number;
};

export type CoveragePayload = {
  doors: CoverageDoorCollection;
  outcomes: CoverageOutcome[];
  props: CoverageProp[];
};

export type CoverageResult =
  | { ok: true; payload: CoveragePayload }
  | { ok: false; message: string; detail?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function isPoint(geometry: unknown): geometry is GeoJSON.Point {
  if (!geometry || typeof geometry !== "object") return false;
  const g = geometry as GeoJSON.Geometry;
  return (
    g.type === "Point" &&
    Array.isArray(g.coordinates) &&
    g.coordinates.length >= 2 &&
    typeof g.coordinates[0] === "number" &&
    typeof g.coordinates[1] === "number"
  );
}

function isPolygonGeom(
  geometry: unknown,
): geometry is GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (!geometry || typeof geometry !== "object") return false;
  const g = geometry as GeoJSON.Geometry;
  return g.type === "Polygon" || g.type === "MultiPolygon";
}

function parseDoorFeature(
  value: unknown,
): GeoJSON.Feature<GeoJSON.Point, CoverageDoorProperties> | null {
  const feature = asRecord(value);
  if (!feature || feature.type !== "Feature") return null;
  if (!isPoint(feature.geometry)) return null;
  const props = asRecord(feature.properties);
  if (!props) return null;
  const uprn = asNumber(props.uprn);
  const territoryId = asString(props.territory_id);
  const territoryName = asString(props.territory_name);
  if (uprn === null || !territoryId || !territoryName) return null;

  const label = mapLabel({
    uprn,
    house_number: asString(props.house_number),
    building_name: asString(props.building_name),
    street_name: asString(props.street_name),
  });

  return {
    type: "Feature",
    id: uprn,
    geometry: feature.geometry,
    properties: {
      uprn,
      territory_id: territoryId,
      territory_name: territoryName,
      ...(label ? { label } : {}),
    },
  };
}

function parseOutcome(value: unknown): CoverageOutcome | null {
  const row = asRecord(value);
  if (!row) return null;
  const uprn = asNumber(row.uprn);
  const outcome = asString(row.outcome);
  if (uprn === null || !outcome) return null;
  return { uprn, outcome };
}

function parseProp(value: unknown): CoverageProp | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  const knockable = asNumber(row.knockable);
  const worked = asNumber(row.worked);
  const answered = asNumber(row.answered);
  if (!id || !name || knockable === null || worked === null || answered === null) {
    return null;
  }
  if (!isPolygonGeom(row.geometry)) return null;
  return {
    id,
    name,
    geometry: row.geometry,
    knockable,
    worked,
    answered,
    remaining: Math.max(0, knockable - worked),
  };
}

export function parseCoveragePayload(data: Json | null): CoveragePayload {
  const root = asRecord(data);
  if (!root) throw new Error("coverage_map_payload did not return an object");

  const doorsRoot = asRecord(root.doors);
  if (!doorsRoot || doorsRoot.type !== "FeatureCollection" || !Array.isArray(doorsRoot.features)) {
    throw new Error("coverage_map_payload missing doors FeatureCollection");
  }
  const features = doorsRoot.features.map(parseDoorFeature);
  if (features.some((f) => f === null)) {
    throw new Error("coverage_map_payload doors contains a malformed feature");
  }

  if (!Array.isArray(root.outcomes)) {
    throw new Error("coverage_map_payload missing outcomes");
  }
  const outcomes = root.outcomes.map(parseOutcome);
  if (outcomes.some((row) => row === null)) {
    throw new Error("coverage_map_payload outcomes contains a malformed row");
  }

  if (!Array.isArray(root.props)) {
    throw new Error("coverage_map_payload missing props");
  }
  const props = root.props.map(parseProp);
  if (props.some((row) => row === null)) {
    throw new Error("coverage_map_payload props contains a malformed row");
  }

  return {
    doors: {
      type: "FeatureCollection",
      features: features as GeoJSON.Feature<GeoJSON.Point, CoverageDoorProperties>[],
    },
    outcomes: outcomes as CoverageOutcome[],
    props: props as CoverageProp[],
  };
}

/**
 * Reads the coverage map payload with the signed-in admin session.
 * Outcome is not baked into the GeoJSON — the map applies feature-state.
 */
export async function fetchCoverageMap(
  supabase: SupabaseClient<Database>,
): Promise<CoverageResult> {
  const { data, error } = await supabase.rpc("coverage_map_payload");
  if (error) {
    return {
      ok: false,
      message: "Coverage could not be loaded. Check your connection and try again.",
      detail: [error.code, error.hint, error.message].filter(Boolean).join(" | "),
    };
  }
  try {
    return { ok: true, payload: parseCoveragePayload(data) };
  } catch (caught) {
    return {
      ok: false,
      message: "Coverage could not be read. Try again.",
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

export function totalsOf(props: CoverageProp[]): {
  knockable: number;
  worked: number;
  answered: number;
  remaining: number;
} {
  const knockable = props.reduce((sum, row) => sum + row.knockable, 0);
  const worked = props.reduce((sum, row) => sum + row.worked, 0);
  const answered = props.reduce((sum, row) => sum + row.answered, 0);
  return {
    knockable,
    worked,
    answered,
    remaining: Math.max(0, knockable - worked),
  };
}
