"use client";

import { useEffect, useState, type RefObject } from "react";
import { AttributionControl, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { ATTRIBUTION_LINES, fieldMapStyle } from "@/lib/field/map-style";
import type { MapMode } from "@/lib/map/map-palette";

const BRISTOL: [number, number] = [-2.5879, 51.4545];
const BRISTOL_ZOOM = 12.4;

type View = { lng: number; lat: number; zoom: number };

function readView(key: string): View | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const view = JSON.parse(raw) as Partial<View>;
    if (typeof view.lng !== "number" || typeof view.lat !== "number" || typeof view.zoom !== "number") return null;
    return { lng: view.lng, lat: view.lat, zoom: view.zoom };
  } catch {
    return null;
  }
}

/**
 * UI-10 F2b. One full-bleed admin map (owner A22, M2): the field basemap
 * (Map style v1, light or dark), no MapLibre buttons (the page floats its
 * own), and the licence lines in the compact ⓘ, which `.admin-map` in
 * app/globals.css moves under the page's top-right button.
 *
 * Returns the instance once its style has loaded, so layer code can add
 * sources straight away. A new `mode` builds a new map; callers re-add
 * their layers because the instance changes. The view is remembered for
 * the tab in session storage (never the URL: MapLibre's hash option
 * rewrites the location on every pan, which the App Router treats as a
 * navigation).
 */
export function useAdminMap(
  container: RefObject<HTMLDivElement | null>,
  mode: MapMode,
  viewKey: string,
  /** UI-10 F3c: a still preview (the visit sheet's map) takes no gestures. */
  options: { interactive?: boolean } = {},
): { map: MapLibreMap | null; error: string | null } {
  const interactive = options.interactive ?? true;
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let instance: MapLibreMap | null = null;

    void (async () => {
      const style = await fieldMapStyle(mode);
      if (cancelled || !container.current) return;
      const view = readView(viewKey);
      instance = new MapLibreMap({
        container: container.current,
        style,
        center: view ? [view.lng, view.lat] : BRISTOL,
        zoom: view ? view.zoom : BRISTOL_ZOOM,
        attributionControl: false,
        interactive,
        dragRotate: false,
        pitchWithRotate: false,
      });
      instance.touchZoomRotate.disableRotation();
      instance.keyboard.disable();
      instance.addControl(
        new AttributionControl({ compact: true, customAttribution: [...ATTRIBUTION_LINES] }),
        "top-right",
      );
      instance.on("error", (event) => {
        setError(event.error?.message ?? "The map could not be loaded.");
      });
      instance.on("moveend", () => {
        if (!instance) return;
        const centre = instance.getCenter();
        try {
          sessionStorage.setItem(viewKey, JSON.stringify({ lng: centre.lng, lat: centre.lat, zoom: instance.getZoom() }));
        } catch {
          // A full or blocked session store is not worth interrupting the map for.
        }
      });
      instance.once("load", () => {
        if (cancelled || !instance) return;
        const attrib = instance.getContainer().querySelector(".maplibregl-ctrl-attrib");
        attrib?.classList.remove("maplibregl-compact-show");
        setError(null);
        setMap(instance);
      });
    })();

    return () => {
      cancelled = true;
      setMap(null);
      instance?.remove();
    };
  }, [container, mode, viewKey, interactive]);

  return { map, error };
}
