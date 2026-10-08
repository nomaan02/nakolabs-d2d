"use client";

import { useEffect, useRef } from "react";

import { useAdminMap } from "@/components/admin/map/use-admin-map";
import { ensurePropLayers, setProps, setSelectedProp } from "@/components/admin/props/prop-layers";
import { boxOf } from "@/lib/admin/map-fit";
import type { TodayProp } from "@/lib/admin/today-data";
import type { MapMode } from "@/lib/map/map-palette";
import { loadAssignmentRouteModel } from "@/lib/map/route-load";
import { paintRouteLayers } from "@/lib/map/route-layers";
import { createClient } from "@/lib/supabase/client";

/**
 * UI-10 F3c (frame 14). A still map of the visit's prop with the route
 * frozen onto this visit (the copy the team walks). No gestures: the sheet
 * scrolls over it, and Open prop is the way into the full map.
 */
export function VisitMiniMap({
  prop,
  visitId,
  variantKey,
  mode,
}: {
  prop: TodayProp | null;
  visitId: string;
  variantKey: string | null;
  mode: MapMode;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const { map, error } = useAdminMap(container, mode, "d2d.admin.visit-map", { interactive: false });
  // A refresh of Today hands over a new `prop` object for the same prop:
  // read it through a ref so the map only redraws when the prop or visit changes.
  const propRef = useRef(prop);
  propRef.current = prop;
  const propId = prop?.id ?? null;

  useEffect(() => {
    const prop = propRef.current;
    if (!map || !prop?.geometry) return;
    ensurePropLayers(map, mode);
    setProps(map, [{ id: prop.id, name: prop.name, archived: false, geometry: prop.geometry }]);
    setSelectedProp(map, prop.id);
    const box = boxOf([prop.geometry]);
    if (box) map.fitBounds(box, { padding: 16, maxZoom: 17, duration: 0 });
    if (!variantKey) return;
    let live = true;
    void loadAssignmentRouteModel(createClient(), visitId, variantKey).then((result) => {
      if (live && result.ok && result.steps > 0) paintRouteLayers(map, result.model, variantKey, undefined, null, mode);
    });
    return () => {
      live = false;
    };
  }, [map, propId, visitId, variantKey, mode]);

  return (
    <div className="relative h-40 overflow-hidden rounded-field-lg bg-field-bg">
      <div ref={container} className="h-full w-full" aria-label={`Map of ${prop?.name ?? "the prop"}`} role="img" />
      {!map ? (
        <p className="absolute inset-0 flex items-center justify-center text-admin-caption text-ink-muted">
          {error ?? "Loading the map…"}
        </p>
      ) : null}
    </div>
  );
}
