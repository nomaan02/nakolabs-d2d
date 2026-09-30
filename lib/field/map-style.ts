import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";

/**
 * Shared basemap setup for the field Map tab and the Logger's compact mini
 * map (`components/field/mini-map.tsx`, `components/field/field-map.tsx`'s
 * `variant="compact"`).
 *
 * MapTiler tiles, never a public OSM tile server. Four licences are in play
 * and every one requires attribution: OS Open UPRN (Crown / OGL), the OGL
 * line itself, the EPC extract (Crown copyright held by MHCLG), and
 * OpenStreetMap (ODbL) through the basemap. Compact ⓘ on the Map tab (and on
 * the mini map); permanent full text on the Profile tab. Do not drop a line
 * to tidy the UI.
 *
 * Dated note, 2026-09-29 (UI item 1, Session C, owner decision 7). This
 * comment used to read "there is one MapLibre instance in the field app —
 * the Logger does not mount a second map." That is no longer true: the
 * Logger now mounts its OWN compact `FieldMap` (the mini map). What still
 * holds, and is the actual invariant (amendment 6): there is only ever ONE
 * MapLibre instance MOUNTED AT A TIME, because the Map tab and the Logger
 * are separate routes under the same layout, never rendered together, and
 * `FieldMap` calls `map.remove()` on unmount either way. Verified by
 * counting `.maplibregl-map` in the DOM while switching
 * Map → Logger → Map → Logger (see the Session C BUILD-LOG entry).
 * 2026-09-30: the Logger's compact map is interactive (pan/pinch); still one instance per route.
 */

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export const ATTRIBUTION_LINES = [
  "Contains OS data © Crown copyright and database right 2026.",
  "Contains public sector information licensed under the Open Government Licence v3.0.",
  "Contains Energy Performance Certificate data © Crown copyright, Ministry of Housing, Communities and Local Government.",
  "Map data © OpenStreetMap contributors.",
] as const;

export const ATTRIBUTION = ATTRIBUTION_LINES.join(" ");

/** Offline, or no key: a flat background. Dots and labels still render. */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: "field-offline",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#e4e6de" } }],
};

export async function fieldMapStyle(): Promise<string | StyleSpecification> {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (!key) return FALLBACK_STYLE;
  const url = `https://api.maptiler.com/maps/dataviz-light/style.json?key=${key}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return FALLBACK_STYLE;
    return url;
  } catch {
    return FALLBACK_STYLE;
  }
}
