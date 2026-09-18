import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";

/**
 * Shared basemap setup for the field Map tab. There is one MapLibre instance
 * in the field app — the Logger does not mount a second map.
 *
 * MapTiler tiles, never a public OSM tile server. Four licences are in play
 * and every one requires attribution: OS Open UPRN (Crown / OGL), the OGL
 * line itself, the EPC extract (Crown copyright held by MHCLG), and
 * OpenStreetMap (ODbL) through the basemap. Compact ⓘ on the Map tab;
 * permanent full text on the Profile tab. Do not drop a line to tidy the UI.
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
