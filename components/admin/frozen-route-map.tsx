"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { loadAssignmentRouteModel } from "@/lib/map/route-load";
import {
  emptyRouteModel,
  fitRouteBounds,
  paintRouteLayers,
  variantLabel,
  type RoutePaintModel,
} from "@/lib/map/route-layers";
import { createClient } from "@/lib/supabase/client";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const BRISTOL: [number, number] = [-2.5879, 51.4545];

/**
 * Read-only map of one frozen assignment. No generate, save or allocate
 * control — the route is `route_steps`, already copied onto the assignment.
 */
export function FrozenRouteMap({
  assignmentId,
  title,
  variantKey,
  onClose,
}: {
  assignmentId: string;
  title: string;
  variantKey: string;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const modelRef = useRef<RoutePaintModel>(emptyRouteModel());
  const variantRef = useRef(variantKey);
  const [steps, setSteps] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  variantRef.current = variantKey;

  const paint = (instance: MapLibreMap, model: RoutePaintModel) => {
    const key = variantRef.current;
    paintRouteLayers(instance, model, key);
    fitRouteBounds(instance, model, key, { maxZoom: 17 });
  };

  useEffect(() => {
    if (!container.current || map.current) return;
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    const instance = new MapLibreMap({
      container: container.current,
      style: `https://api.maptiler.com/maps/dataviz-light/style.json?key=${key}`,
      center: BRISTOL,
      zoom: 12.4,
      attributionControl: { compact: false },
    });
    map.current = instance;
    instance.addControl(new NavigationControl({ showCompass: false }), "bottom-left");
    instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    const onStyle = () => {
      paint(instance, modelRef.current);
    };
    instance.on("load", onStyle);
    instance.on("style.load", onStyle);

    return () => {
      instance.off("load", onStyle);
      instance.off("style.load", onStyle);
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSteps(null);
    const supabase = createClient();
    void loadAssignmentRouteModel(supabase, assignmentId, variantKey).then((loaded) => {
      if (cancelled) return;
      if (!loaded.ok) {
        setError(loaded.message);
        return;
      }
      modelRef.current = loaded.model;
      setSteps(loaded.steps);
      const instance = map.current;
      if (!instance?.getStyle()) return;
      paint(instance, loaded.model);
    });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, variantKey]);

  return (
    <div className="flex h-full min-h-[54dvh] flex-col" data-testid="frozen-route">
      <div className="flex items-start justify-between gap-3 border-b border-ink/15 px-4 py-3">
        <div>
          <p className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">Read only</p>
          <h2 className="mt-1 font-display text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">
            {title}
          </h2>
          <p className="mt-2 font-data text-[11px] uppercase tracking-[0.12em] text-ink-soft">
            {variantLabel(variantKey)}
            {steps !== null ? ` · ${steps.toLocaleString("en-GB")} steps` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 border border-ink/25 px-3 font-data text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
        >
          Close
        </button>
      </div>
      <div ref={container} className="min-h-[280px] w-full flex-1 bg-worksheet-deep" />
      {error ? (
        <p className="px-4 py-2 text-[13px] text-oxide" role="alert">
          {error}
        </p>
      ) : null}
      {steps === 0 ? (
        <p className="px-4 py-2 text-[13px] text-ink-soft">This route has no pavement line to draw.</p>
      ) : null}
      <p className="px-4 py-2 font-data text-[9px] leading-relaxed text-ink-soft">
        Contains OS data © Crown copyright and database right 2026. Map data © OpenStreetMap
        contributors.
      </p>
    </div>
  );
}
