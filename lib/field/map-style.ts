import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";

/**
 * Shared basemap setup for the field's two maps — the Map tab and the
 * Logger's 120px confirmation strip.
 *
 * MapTiler tiles, never a public OSM tile server. The attribution is a
 * licence condition on all four Track A sources and is not removable to tidy
 * the UI: OS Open UPRN under OGL, the EPC extract under OGL as Crown
 * copyright held by MHCLG, and OpenStreetMap under ODbL through the basemap.
 */

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export const ATTRIBUTION =
  "Contains OS data © Crown copyright and database right 2026. " +
  "Contains public sector information licensed under the Open Government Licence v3.0. " +
  "Contains Energy Performance Certificate data © Crown copyright, Ministry of Housing, " +
  "Communities and Local Government. Map data © OpenStreetMap contributors.";

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
