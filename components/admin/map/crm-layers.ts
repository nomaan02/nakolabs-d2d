import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import { PROPS_FILL } from "@/components/admin/props/prop-layers";
import { crmDoorFeatures, heatFeatures, type CrmDoor, type CrmDoorGroup, type HeatCell } from "@/lib/admin/crm-map";
import { mapColours, type MapMode } from "@/lib/map/map-palette";

/**
 * CRM-2 D (owner 2026-10-10, P4a; Figma CRM-2 C4–C6, D2 approved). CRM
 * layers for the admin maps (never /field): 250 m heat squares under the
 * props, and CRM doors as rounded-square outlines on top. Squares, not
 * rings, so they never read as the round lead pins; hollow, so the knock dot
 * still shows inside. Coloured by the door's latest CRM outcome; the sheet's
 * key names each colour in words. The three outcome hues were run through
 * the dataviz validator in both themes (CVD ΔE ≥ 18, contrast ≥ 3:1); UTC
 * and Other are two clearly different greys.
 */

export const CRM_HEAT_SOURCE = "admin-crm-heat";
export const CRM_DOORS_SOURCE = "admin-crm-doors";
export const CRM_HEAT_FILL = "admin-crm-heat-fill";
const CRM_HEAT_LINE = "admin-crm-heat-line";
export const CRM_DOORS_LAYER = "admin-crm-doors";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export const CRM_RING: Record<MapMode, Record<CrmDoorGroup, string>> = {
  light: { sale: "#2f8f57", pm: "#3f74d0", blowout: "#c0505a", utc: "#6b7079", other: "#b4b9c0" },
  dark: { sale: "#3f9e69", pm: "#5b8ff0", blowout: "#e06a72", utc: "#aab2bd", other: "#4f5863" },
};

const GROUPS: CrmDoorGroup[] = ["sale", "pm", "blowout", "utc", "other"];
const markName = (mode: MapMode, group: CrmDoorGroup) => `admin-crm-mark-${mode}-${group}`;

/** A 16 px rounded-square outline (drawn at 2×), one per outcome colour. */
function addMarkImages(map: MapLibreMap, mode: MapMode): void {
  if (typeof document === "undefined") return;
  for (const group of GROUPS) {
    const name = markName(mode, group);
    if (map.hasImage(name)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = CRM_RING[mode][group];
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(4.5, 4.5, 23, 23, 7);
    ctx.stroke();
    map.addImage(name, ctx.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
  }
}

/** One hue, light → dark (sequential). Index -1 = too few pitched to say. */
export const HEAT_RAMP: Record<MapMode, { steps: [string, string, string, string]; few: string }> = {
  light: { steps: ["#dbe5f6", "#a9c0ea", "#6f93d8", "#2f5fb8"], few: "#d8d5ce" },
  dark: { steps: ["#26344d", "#33507f", "#4a74bd", "#7aa3f2"], few: "#3a404a" },
};

export function ensureCrmLayers(map: MapLibreMap, mode: MapMode): void {
  if (map.getSource(CRM_HEAT_SOURCE)) return;
  const c = mapColours(mode);
  const ramp = HEAT_RAMP[mode];
  const below = map.getLayer(PROPS_FILL) ? PROPS_FILL : undefined;

  map.addSource(CRM_HEAT_SOURCE, { type: "geojson", data: EMPTY, promoteId: "i" });
  map.addLayer(
    {
      id: CRM_HEAT_FILL,
      type: "fill",
      source: CRM_HEAT_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "fill-color": ["match", ["get", "step"], 0, ramp.steps[0], 1, ramp.steps[1], 2, ramp.steps[2], 3, ramp.steps[3], ramp.few],
        "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.85, 0.62],
      },
    },
    below,
  );
  map.addLayer(
    {
      id: CRM_HEAT_LINE,
      type: "line",
      source: CRM_HEAT_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "selected"], false], c.focus.line, c.palette.ground],
        "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 1],
      },
    },
    below,
  );

  addMarkImages(map, mode);
  map.addSource(CRM_DOORS_SOURCE, { type: "geojson", data: EMPTY, promoteId: "uprn" });
  map.addLayer({
    id: CRM_DOORS_LAYER,
    type: "symbol",
    source: CRM_DOORS_SOURCE,
    layout: {
      visibility: "none",
      "icon-image": ["concat", `admin-crm-mark-${mode}-`, ["get", "group"]],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 14, 0.6, 16, 0.8, 18, 1.15],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

function setData(map: MapLibreMap, source: string, data: GeoJSON.FeatureCollection): void {
  (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

export function setCrmDoors(map: MapLibreMap, doors: CrmDoor[]): void {
  setData(map, CRM_DOORS_SOURCE, crmDoorFeatures(doors));
}

export function setCrmHeat(map: MapLibreMap, cells: HeatCell[], metric: "rate" | "leads", minLeads = 5): void {
  setData(map, CRM_HEAT_SOURCE, heatFeatures(cells, metric, minLeads));
}

export function setSelectedHeatCell(map: MapLibreMap, index: number | null): void {
  if (!map.getSource(CRM_HEAT_SOURCE)) return;
  map.removeFeatureState({ source: CRM_HEAT_SOURCE });
  if (index !== null) map.setFeatureState({ source: CRM_HEAT_SOURCE, id: index }, { selected: true });
}

export function setCrmVisibility(map: MapLibreMap, show: { heat: boolean; doors: boolean }): void {
  const set = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  set(CRM_HEAT_FILL, show.heat);
  set(CRM_HEAT_LINE, show.heat);
  set(CRM_DOORS_LAYER, show.doors);
}
