"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { ATTRIBUTION, fieldMapStyle } from "@/lib/field/map-style";
import type { SequenceDoor } from "@/lib/field/sequence";

/**
 * A 120px confirmation strip: am I at the right house?
 *
 * It is not a navigation surface and has no controls. Only the doors around
 * the cursor are fed to it — a window of the sequence, not all 2,000 — so a
 * second GL context on a mid-range phone stays cheap, and the instance is
 * destroyed the moment the strip is collapsed.
 *
 * There is no `navigator.geolocation` here and there will not be one before
 * Stage 16. The map centres on the CURRENT DOOR, which is the thing the
 * canvasser is trying to confirm anyway.
 */

const SOURCE = "mini-doors";
const NEIGHBOURS = 12;

export function MiniMap({
  sequence,
  index,
}: {
  sequence: SequenceDoor[];
  index: number;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);

  const current = sequence[index];

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;

    void (async () => {
      const style = await fieldMapStyle();
      if (cancelled || !container.current) return;

      const instance = new MapLibreMap({
        container: container.current,
        style,
        center: current ? current.lngLat : [-2.5879, 51.4545],
        zoom: 18,
        interactive: false,
        attributionControl: { compact: true, customAttribution: ATTRIBUTION },
      });
      map.current = instance;

      instance.on("load", () => {
        instance.addSource(SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          promoteId: "uprn",
        });
        instance.addLayer({
          id: "mini-doors",
          type: "circle",
          source: SOURCE,
          paint: {
            "circle-radius": ["case", ["get", "current"], 11, 5],
            "circle-color": ["case", ["get", "current"], "#1b4aa6", "#4a5259"],
            "circle-stroke-width": ["case", ["get", "current"], 3, 1],
            "circle-stroke-color": "#fbfaf8",
          },
        });
      });
    })();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [current]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !current) return;

    const from = Math.max(0, index - NEIGHBOURS);
    const window = sequence.slice(from, index + NEIGHBOURS + 1);
    const data: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features: window.map((door) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: door.lngLat },
        properties: { uprn: door.uprn, current: door.uprn === current.uprn },
      })),
    };

    const apply = () => {
      const source = instance.getSource(SOURCE) as GeoJSONSource | undefined;
      source?.setData(data);
      instance.jumpTo({ center: current.lngLat, zoom: 18 });
    };

    if (instance.isStyleLoaded()) apply();
    else instance.once("load", apply);
  }, [sequence, index, current]);

  return <div ref={container} className="h-full w-full" data-testid="field-mini-map" />;
}
