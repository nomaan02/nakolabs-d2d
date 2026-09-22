/**
 * Stage 5b (R1) — GeoJSON preview of one variant for geojson.io: walklines
 * coloured by kind, start and end markers. Display only; nothing here is
 * stored or read by the app.
 */

import type { WalkVariant } from "@/lib/geo/walk/types";

const COLOUR: Record<WalkVariant["steps"][number]["kind"], string> = {
  work: "#1a9850",
  cross: "#f46d43",
  walk: "#4575b4",
};

type Feature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] } | { type: "Point"; coordinates: number[] };
  properties: Record<string, unknown>;
};

export function variantToGeoJson(name: string, v: WalkVariant): { type: "FeatureCollection"; features: Feature[]; properties: Record<string, unknown> } {
  const features: Feature[] = v.steps.map((s, i) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: s.walkline.map((c) => [c[0], c[1]]) },
    properties: {
      seq: i,
      kind: s.kind,
      side: s.side,
      street: s.street_name,
      segment_id: s.segment_id,
      instruction: s.instruction,
      doors: s.first_seq === null || s.last_seq === null ? 0 : s.last_seq - s.first_seq + 1,
      is_dead_end: s.is_dead_end,
      stroke: COLOUR[s.kind],
      "stroke-width": s.kind === "work" ? 4 : 2,
      "stroke-opacity": s.kind === "walk" ? 0.7 : 1,
    },
  }));
  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [v.start.lon, v.start.lat] },
    properties: { role: "start", title: `Start (${v.hand} hand)`, "marker-color": "#1a9850", "marker-symbol": "s" },
  });
  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [v.end.lon, v.end.lat] },
    properties: { role: "end", title: "End", "marker-color": "#d73027", "marker-symbol": "e" },
  });
  return {
    type: "FeatureCollection",
    properties: {
      prop: name,
      variant: v.key,
      hand: v.hand,
      total_m: v.total_m,
      working_m: v.working_m,
      non_working_m: v.non_working_m,
      stranded: v.stranded_count,
      steps: v.steps.length,
    },
    features,
  };
}
