"use client";

import { useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { DoorCollection } from "@/lib/geo/todays-assignment";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const BRISTOL: [number, number] = [-2.5879, 51.4545];
const DOORS_SOURCE = "field-doors";
const DOORS_LAYER = "field-doors";

const OS_ATTRIBUTION =
  "Contains OS data © Crown copyright and database right 2026. Contains public sector information licensed under the Open Government Licence v3.0.";

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: "field-offline",
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#e4e6de" },
    },
  ],
};

function token(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

async function mapStyle(): Promise<string | StyleSpecification> {
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

function fitDoors(map: MapLibreMap, doors: DoorCollection) {
  if (doors.features.length === 0) return;
  const lngs = doors.features.map((f) => f.geometry.coordinates[0]);
  const lats = doors.features.map((f) => f.geometry.coordinates[1]);
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 48, maxZoom: 19, duration: 0 },
  );
}

export function FieldMap({
  doors,
  selectedUprn,
  onSelectUprn,
  active,
}: {
  doors: DoorCollection;
  selectedUprn: number | null;
  onSelectUprn: (uprn: number) => void;
  active: boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const onSelect = useRef(onSelectUprn);
  const doorsRef = useRef(doors);
  onSelect.current = onSelectUprn;
  doorsRef.current = doors;

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;

    void (async () => {
      const style = await mapStyle();
      if (cancelled || !container.current) return;

      const instance = new MapLibreMap({
        container: container.current,
        style,
        center: BRISTOL,
        zoom: 12.4,
        attributionControl: { compact: false, customAttribution: OS_ATTRIBUTION },
      });
      map.current = instance;

      instance.addControl(new NavigationControl({ showCompass: false }), "bottom-left");
      instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

      instance.on("load", () => {
        const current = doorsRef.current;
        instance.addSource(DOORS_SOURCE, { type: "geojson", data: current });
        instance.addLayer({
          id: DOORS_LAYER,
          type: "circle",
          source: DOORS_SOURCE,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              14,
              5,
              17,
              10,
              19,
              16,
              20,
              20,
            ],
            "circle-color": token("--color-ink", "#1c2226"),
            "circle-stroke-width": 1.5,
            "circle-stroke-color": token("--color-paper", "#fbfaf8"),
          },
        });
        fitDoors(instance, current);

        instance.on("click", DOORS_LAYER, (event) => {
          const feature = event.features?.[0];
          const uprn = feature?.properties?.uprn;
          if (typeof uprn === "number") onSelect.current(uprn);
          else if (typeof uprn === "string" && uprn !== "") onSelect.current(Number(uprn));
        });
        instance.on("mouseenter", DOORS_LAYER, () => {
          instance.getCanvas().style.cursor = "pointer";
        });
        instance.on("mouseleave", DOORS_LAYER, () => {
          instance.getCanvas().style.cursor = "";
        });
      });
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded()) return;
    const source = instance.getSource(DOORS_SOURCE) as GeoJSONSource | undefined;
    source?.setData(doors);
    fitDoors(instance, doors);
  }, [doors]);

  useEffect(() => {
    if (active) map.current?.resize();
  }, [active]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || selectedUprn === null) return;
    const feature = doors.features.find((f) => f.properties.uprn === selectedUprn);
    if (!feature) return;
    instance.easeTo({
      center: feature.geometry.coordinates as [number, number],
      zoom: Math.max(instance.getZoom(), 18),
      duration: 300,
    });
  }, [selectedUprn, doors]);

  return <div ref={container} className="h-full w-full" data-testid="field-map" />;
}
