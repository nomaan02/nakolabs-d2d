"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Map as MapLibreMap } from "maplibre-gl";

import { ensureDrawLayers, setDrawShape, type DragState } from "@/components/admin/props/draw-layers";
import type { DrawShape } from "@/lib/admin/draw-history";
import { fieldMapStyle } from "@/lib/field/map-style";
import type { MapMode } from "@/lib/map/map-palette";

const SIZE = 120;
/** How far above the finger the lens sits, so the finger never covers it. */
const LIFT = 96;
const ZOOM_IN = 2;

function subscribeCoarse(onChange: () => void): () => void {
  const media = window.matchMedia("(pointer: coarse)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

/**
 * UI-10 F2e (owner A19; frame 10). While a corner is dragged on a touch
 * screen, a round lens above the finger shows the corner two zoom levels
 * closer, with a crosshair, so it can be placed on the right side of a
 * garden wall. A second, non-interactive map that only carries the shape.
 * Built when drawing starts (so it is ready on the first drag), removed when
 * drawing ends. Not shown with a mouse: the pointer never hides the corner.
 */
export function DrawMagnifier({
  map,
  mode,
  shape,
  drag,
}: {
  map: MapLibreMap | null;
  mode: MapMode;
  shape: DrawShape;
  drag: DragState | null;
}) {
  const coarse = useCoarsePointer();
  const container = useRef<HTMLDivElement | null>(null);
  const lens = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!coarse || !container.current) return;
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    void (async () => {
      const style = await fieldMapStyle(mode);
      if (cancelled || !container.current) return;
      instance = new MapLibreMap({
        container: container.current,
        style,
        interactive: false,
        attributionControl: false,
        center: [-2.5879, 51.4545],
        zoom: 16,
      });
      instance.once("load", () => {
        if (cancelled || !instance) return;
        ensureDrawLayers(instance, mode);
        lens.current = instance;
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      lens.current = null;
      setReady(false);
      instance?.remove();
    };
  }, [coarse, mode]);

  useEffect(() => {
    const instance = lens.current;
    if (!ready || !instance || !map || !drag) return;
    instance.jumpTo({ center: drag.point, zoom: map.getZoom() + ZOOM_IN });
    setDrawShape(instance, shape, drag, false);
  }, [ready, map, shape, drag]);

  if (!coarse) return null;
  let left = -9999;
  let top = -9999;
  if (map && drag) {
    const at = map.project(drag.point);
    const canvas = map.getCanvas();
    left = Math.min(Math.max(at.x - SIZE / 2, 8), canvas.clientWidth - SIZE - 8);
    top = at.y - LIFT - SIZE / 2;
    // Too close to the top: put the lens beside the finger instead.
    if (top < 60) {
      top = Math.max(60, at.y - SIZE / 2);
      left = at.x + SIZE / 2 + 24 > canvas.clientWidth ? at.x - SIZE - 32 : at.x + 32;
    }
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-30 overflow-hidden rounded-full border-2 border-surface shadow-admin-float"
      style={{ width: SIZE, height: SIZE, left, top, visibility: drag && ready ? "visible" : "hidden" }}
    >
      <div ref={container} className="h-full w-full" />
      <span className="absolute top-1/2 left-1/2 h-px w-7 -translate-x-1/2 bg-ink" />
      <span className="absolute top-1/2 left-1/2 h-7 w-px -translate-y-1/2 bg-ink" />
    </div>
  );
}
