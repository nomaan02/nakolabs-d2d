import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

import { MAP_PALETTE } from "@/lib/map/map-palette";

/**
 * 2026-10-01 (UI-2 Session M1). Pure restyle of a MapTiler style JSON.
 * First matching rule wins. Paint keys are overridden one at a time.
 * Layout is touched only to set visibility. Fill-extrusion is hidden
 * here; M4 adds our own buildings.
 */

const HIDDEN_SOURCE_LAYERS = new Set([
  "poi",
  "housenumber",
  "aerodrome_label",
  "mountain_peak",
  "boundary",
]);

const PARK_LANDCOVER = /grass|wood|park|garden|scrub|meadow|forest/;
const RAIL = /rail|transit/;
const PATH = /path|footway|track|pedestrian|cycle|steps/;
const CASING = /casing|outline/;
const MAJOR = /motorway|trunk|primary|secondary|major/;

export type RestyleReportRow = {
  id: string;
  type: string;
  sourceLayer: string | undefined;
  rule: string;
};

function sourceLayerOf(layer: LayerSpecification): string | undefined {
  return "source-layer" in layer ? layer["source-layer"] : undefined;
}

function ruleFor(layer: LayerSpecification): string {
  const sl = sourceLayerOf(layer);
  const id = layer.id.toLowerCase();

  if (layer.type === "background") return "background";
  if (sl !== undefined && (HIDDEN_SOURCE_LAYERS.has(sl) || sl === "boundary")) return "hide";
  if (layer.type === "fill-extrusion") return "hide-extrusion";

  if (layer.type === "fill") {
    if (sl === "water") return "fill-water";
    if (sl === "park" || (sl === "landcover" && PARK_LANDCOVER.test(id))) return "fill-park";
    if (sl === "building") return "fill-building";
    if (sl === "landuse" || sl === "landcover") return "fill-landuse";
  }

  if (layer.type === "line") {
    if (sl === "water" || sl === "waterway") return "line-water";
    if (sl === "transportation" && RAIL.test(id)) return "line-rail";
    if (sl === "transportation" && PATH.test(id)) return "line-path";
    if (sl === "transportation" && CASING.test(id)) {
      return MAJOR.test(id) ? "line-casing-major" : "line-casing-minor";
    }
    if (sl === "transportation") return "line-road";
    if (sl === "building") return "line-building";
  }

  if (layer.type === "symbol") {
    if (sl === "transportation_name") return "symbol-name";
    return "symbol-muted";
  }

  return "unchanged";
}

function hide(layer: LayerSpecification): LayerSpecification {
  switch (layer.type) {
    case "background":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    case "fill":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    case "line":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    case "symbol":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    case "circle":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    case "heatmap":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    case "fill-extrusion":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    case "raster":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    case "hillshade":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    case "color-relief":
      return { ...layer, layout: { ...layer.layout, visibility: "none" } };
    default: {
      const unreachable: never = layer;
      return unreachable;
    }
  }
}

function restyleLayer(layer: LayerSpecification): LayerSpecification {
  const rule = ruleFor(layer);

  if (rule === "background" && layer.type === "background") {
    return {
      ...layer,
      paint: { ...layer.paint, "background-color": MAP_PALETTE.ground },
    };
  }

  if (rule === "hide" || rule === "hide-extrusion") return hide(layer);

  if (layer.type === "fill") {
    if (rule === "fill-water") {
      return { ...layer, paint: { ...layer.paint, "fill-color": MAP_PALETTE.water } };
    }
    if (rule === "fill-park") {
      return { ...layer, paint: { ...layer.paint, "fill-color": MAP_PALETTE.park } };
    }
    if (rule === "fill-landuse") {
      return { ...layer, paint: { ...layer.paint, "fill-color": MAP_PALETTE.landuse } };
    }
    if (rule === "fill-building") {
      return {
        ...layer,
        paint: {
          ...layer.paint,
          "fill-color": MAP_PALETTE.building,
          "fill-outline-color": MAP_PALETTE.buildingEdge,
        },
      };
    }
  }

  if (layer.type === "line") {
    const lineColor =
      rule === "line-water"
        ? MAP_PALETTE.water
        : rule === "line-rail" || rule === "line-building"
          ? MAP_PALETTE.buildingEdge
          : rule === "line-path" || rule === "line-casing-minor"
            ? MAP_PALETTE.roadMinorCase
            : rule === "line-casing-major"
              ? MAP_PALETTE.roadMajorCase
              : rule === "line-road"
                ? MAP_PALETTE.road
                : undefined;
    if (lineColor !== undefined) {
      return { ...layer, paint: { ...layer.paint, "line-color": lineColor } };
    }
  }

  if (layer.type === "symbol" && (rule === "symbol-name" || rule === "symbol-muted")) {
    return {
      ...layer,
      paint: {
        ...layer.paint,
        "text-color": rule === "symbol-name" ? MAP_PALETTE.label : MAP_PALETTE.labelMuted,
        "text-halo-color": MAP_PALETTE.ground,
        "text-halo-width": rule === "symbol-name" ? 1.5 : 1.2,
      },
    };
  }

  return layer;
}

export function restyleBasemap(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => restyleLayer(layer)),
  };
}

export function restyleReport(style: StyleSpecification): RestyleReportRow[] {
  return style.layers.map((layer) => ({
    id: layer.id,
    type: layer.type,
    sourceLayer: sourceLayerOf(layer),
    rule: ruleFor(layer),
  }));
}
