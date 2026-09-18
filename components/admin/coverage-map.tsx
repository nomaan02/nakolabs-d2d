"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { CoverageDoorCollection, CoverageOutcome, CoverageProp } from "@/lib/admin/coverage";
import { outcomeSpec } from "@/lib/field/outcomes";
import { ATTRIBUTION_LINES, fieldMapStyle } from "@/lib/field/map-style";
import { KNOCK_OUTCOMES, type KnockOutcome } from "@/lib/sync/ops";

const BRISTOL: [number, number] = [-2.5879, 51.4545];
const DOORS_SOURCE = "coverage-doors";
const DOORS_LAYER = "coverage-doors";
const LABELS_LAYER = "coverage-door-labels";
const PROPS_SOURCE = "coverage-props";
const PROPS_FILL = "coverage-props-fill";
const PROPS_LINE = "coverage-props-line";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const UNWORKED = "#4a5259";
const OUTCOME_STATE: ExpressionSpecification = [
  "coalesce",
  ["feature-state", "outcome"],
  "none",
];

const FILL_BY_STATE: ExpressionSpecification = [
  "match",
  OUTCOME_STATE,
  "no_answer",
  "#d2d6c9",
  "inaccessible",
  "#d2d6c9",
  "answered",
  "#1b4aa6",
  "lead",
  "#1e6b3a",
  "no_opportunity",
  "#7a2b33",
  "refused",
  "#9c6212",
  "do_not_call",
  "#7a2b33",
  "callback",
  "#1b4aa6",
  UNWORKED,
];

const OPACITY_BY_STATE: ExpressionSpecification = [
  "case",
  ["==", OUTCOME_STATE, "none"],
  0.22,
  0.95,
];

/**
 * MapLibre only allows `["zoom"]` as the input of a *top-level* interpolate
 * or step. Nesting that interpolate inside `*` or `case` throws at runtime
 * and the doors layer never paints. Found in Stage 8b.
 */
function radiusAt(unworked: number, worked: number): ExpressionSpecification {
  return ["case", ["==", OUTCOME_STATE, "none"], unworked, worked];
}

const CIRCLE_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  radiusAt(1.6, 2.4),
  15,
  radiusAt(2.8, 4.2),
  17,
  radiusAt(4.2, 6.5),
  19,
  radiusAt(6.5, 10),
];

function strokeAt(unworked: number, worked: number): ExpressionSpecification {
  return ["case", ["==", OUTCOME_STATE, "none"], unworked, worked];
}

const CIRCLE_STROKE: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  12,
  strokeAt(0.4, 0.8),
  17,
  strokeAt(0.6, 1.4),
  19,
  strokeAt(0.8, 2),
];

function isKnockOutcome(value: string): value is KnockOutcome {
  return (KNOCK_OUTCOMES as readonly string[]).includes(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyOutcomeState(instance: MapLibreMap, outcomes: CoverageOutcome[]) {
  if (!instance.getSource(DOORS_SOURCE)) return;
  instance.removeFeatureState({ source: DOORS_SOURCE });
  for (const row of outcomes) {
    instance.setFeatureState({ source: DOORS_SOURCE, id: row.uprn }, { outcome: row.outcome });
  }
}

function doorsForProp(doors: CoverageDoorCollection, propId: string | null): CoverageDoorCollection {
  if (!propId) return doors;
  return {
    type: "FeatureCollection",
    features: doors.features.filter((feature) => feature.properties.territory_id === propId),
  };
}

function propsCollection(props: CoverageProp[], propId: string | null): GeoJSON.FeatureCollection {
  const rows = propId ? props.filter((row) => row.id === propId) : props;
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature" as const,
      id: row.id,
      geometry: row.geometry,
      properties: { id: row.id, name: row.name },
    })),
  };
}

function fitDoors(map: MapLibreMap, doors: CoverageDoorCollection) {
  if (doors.features.length === 0) {
    map.jumpTo({ center: BRISTOL, zoom: 12.4 });
    return;
  }
  const lngs = doors.features.map((f) => f.geometry.coordinates[0]);
  const lats = doors.features.map((f) => f.geometry.coordinates[1]);
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 48, maxZoom: 17, duration: 0 },
  );
}

/**
 * Pad a collection to `count` dots for the Stage 14 performance check.
 * Extra points are unworked (no feature-state) and carry no label. They
 * are not written anywhere — display only.
 */
export function padDoors(doors: CoverageDoorCollection, count: number): CoverageDoorCollection {
  if (doors.features.length >= count || doors.features.length === 0) return doors;
  const extras: CoverageDoorCollection["features"] = [];
  const origin = doors.features[0]!;
  for (let i = doors.features.length; i < count; i += 1) {
    const col = Math.floor((i - doors.features.length) / 45);
    const row = (i - doors.features.length) % 45;
    extras.push({
      type: "Feature",
      id: 9_000_000_000_000 + i,
      geometry: {
        type: "Point",
        coordinates: [
          origin.geometry.coordinates[0] + col * 0.00012,
          origin.geometry.coordinates[1] + row * 0.00008,
        ],
      },
      properties: {
        uprn: 9_000_000_000_000 + i,
        territory_id: origin.properties.territory_id,
        territory_name: origin.properties.territory_name,
      },
    });
  }
  return { type: "FeatureCollection", features: [...doors.features, ...extras] };
}

export function CoverageMap({
  doors,
  outcomes,
  props,
  selectedPropId,
}: {
  doors: CoverageDoorCollection;
  outcomes: CoverageOutcome[];
  props: CoverageProp[];
  selectedPropId: string | null;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const popup = useRef<Popup | null>(null);
  const doorsRef = useRef(doors);
  const outcomesRef = useRef(outcomes);
  const propsRef = useRef(props);
  const selectedRef = useRef(selectedPropId);
  doorsRef.current = doors;
  outcomesRef.current = outcomes;
  propsRef.current = props;
  selectedRef.current = selectedPropId;

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const paint = useCallback((instance: MapLibreMap) => {
    const selected = selectedRef.current;
    const currentDoors = doorsForProp(doorsRef.current, selected);
    const currentProps = propsCollection(propsRef.current, selected);

    const doorsSource = instance.getSource(DOORS_SOURCE) as GeoJSONSource | undefined;
    const propsSource = instance.getSource(PROPS_SOURCE) as GeoJSONSource | undefined;
    if (doorsSource) doorsSource.setData(currentDoors);
    if (propsSource) propsSource.setData(currentProps);
    applyOutcomeState(instance, outcomesRef.current);
    fitDoors(instance, currentDoors);
  }, []);

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;

    void (async () => {
      const style = await fieldMapStyle();
      if (cancelled || !container.current) return;

      const instance = new MapLibreMap({
        container: container.current,
        style,
        center: BRISTOL,
        zoom: 12.4,
        attributionControl: { compact: false, customAttribution: [...ATTRIBUTION_LINES] },
      });
      map.current = instance;

      instance.addControl(new NavigationControl({ showCompass: false }), "bottom-left");
      instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
      instance.on("error", (event) => {
        setMapError(event.error?.message ?? "The map could not be loaded.");
      });

      const onStyleReady = () => {
        if (!instance.getSource(PROPS_SOURCE)) {
          instance.addSource(PROPS_SOURCE, { type: "geojson", data: EMPTY });
          instance.addLayer({
            id: PROPS_FILL,
            type: "fill",
            source: PROPS_SOURCE,
            paint: { "fill-color": "#1b4aa6", "fill-opacity": 0.06 },
          });
          instance.addLayer({
            id: PROPS_LINE,
            type: "line",
            source: PROPS_SOURCE,
            paint: { "line-color": "#1b4aa6", "line-width": 1.6, "line-opacity": 0.7 },
          });
        }

        if (!instance.getSource(DOORS_SOURCE)) {
          instance.addSource(DOORS_SOURCE, {
            type: "geojson",
            data: EMPTY,
            promoteId: "uprn",
          });
          instance.addLayer({
            id: DOORS_LAYER,
            type: "circle",
            source: DOORS_SOURCE,
            paint: {
              "circle-radius": CIRCLE_RADIUS,
              "circle-color": FILL_BY_STATE,
              "circle-opacity": OPACITY_BY_STATE,
              "circle-stroke-width": CIRCLE_STROKE,
              "circle-stroke-color": "#fbfaf8",
            },
          });
          instance.addLayer({
            id: LABELS_LAYER,
            type: "symbol",
            source: DOORS_SOURCE,
            minzoom: 18,
            filter: ["all", ["has", "label"], ["!=", ["get", "label"], ""]],
            layout: {
              "text-field": ["get", "label"],
              "text-size": 12,
              "text-offset": [0, 1.4],
              "text-anchor": "top",
              "text-allow-overlap": false,
              "text-optional": true,
            },
            paint: {
              "text-color": "#1c2226",
              "text-halo-color": "#fbfaf8",
              "text-halo-width": 1.6,
            },
          });

          instance.on("click", DOORS_LAYER, (event) => {
            const feature = event.features?.[0];
            if (!feature || feature.geometry.type !== "Point") return;
            const uprnRaw = feature.properties?.uprn;
            const uprn =
              typeof uprnRaw === "number"
                ? uprnRaw
                : typeof uprnRaw === "string" && uprnRaw !== ""
                  ? Number(uprnRaw)
                  : null;
            if (uprn === null || Number.isNaN(uprn)) return;
            const label =
              typeof feature.properties?.label === "string" && feature.properties.label !== ""
                ? feature.properties.label
                : `UPRN ${uprn}`;
            const state = instance.getFeatureState({ source: DOORS_SOURCE, id: uprn });
            const outcome = typeof state.outcome === "string" ? state.outcome : null;
            const logged = outcome && isKnockOutcome(outcome) ? outcomeSpec(outcome).logged : "Not yet worked";
            const coords = feature.geometry.coordinates as [number, number];
            popup.current?.remove();
            popup.current = new Popup({ closeButton: true, maxWidth: "16rem" })
              .setLngLat(coords)
              .setHTML(
                `<p style="margin:0;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#4a5259">${escapeHtml(logged)}</p><p style="margin:6px 0 0;font-size:14px;color:#1c2226">${escapeHtml(label)}</p>`,
              )
              .addTo(instance);
          });
          instance.on("mouseenter", DOORS_LAYER, () => {
            instance.getCanvas().style.cursor = "pointer";
          });
          instance.on("mouseleave", DOORS_LAYER, () => {
            instance.getCanvas().style.cursor = "";
          });
        }

        // Feature-state on style load as well as in the React effect.
        // An effect that returns early when the style is not ready leaves
        // every door looking unworked after a remount. Found in Stage 8b.
        paint(instance);
        setReady(true);
      };

      instance.on("load", onStyleReady);
      instance.on("style.load", onStyleReady);
    })();

    return () => {
      cancelled = true;
      popup.current?.remove();
      popup.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, [paint]);

  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded()) return;
    paint(instance);
  }, [doors, outcomes, props, selectedPropId, paint]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="h-full w-full bg-worksheet-deep"
        data-testid="coverage-map"
        data-door-count={doors.features.length}
      />
      {!ready ? (
        <p className="absolute inset-x-6 top-1/2 text-center font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
          {mapError ?? "Loading the map…"}
        </p>
      ) : null}
    </div>
  );
}
