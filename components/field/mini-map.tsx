"use client";

import { FieldMap } from "@/components/field/field-map";
import { MapIcon } from "@/components/field/icons";
import { toggleMapView, useMapView } from "@/lib/field/map-view";
import type { DoorLabels } from "@/lib/field/labels";
import type { LocalOutcomes } from "@/lib/field/local-outcomes";
import type { DoorCollection } from "@/lib/geo/todays-assignment";
import type { RoutePaintModel } from "@/lib/map/route-layers";
import type { RouteTiers } from "@/lib/map/route-progress";

/**
 * MiniMap — Figma node 8:14 (UI item 1, Session C, owner decision 7).
 *
 * "Mini map dot = the CURRENT DOOR. Never GPS (invariant 7). The real map is
 * the existing MapLibre field map, compact. Tapping it opens the Map tab
 * centred on the current door."
 *
 * This wraps the SAME `FieldMap` the Map tab uses (`variant="compact"`), not
 * a second renderer — one route layer, one style, one set of outcome/route
 * paint rules. The one-MapLibre-instance-at-a-time invariant holds because
 * the Map tab and the Logger are separate routes (see the dated note in
 * `lib/field/map-style.ts`).
 *
 * 2026-09-30 owner E6: the map itself pans and pinches. A 44px round
 * button at the bottom-left opens the full map, centred on this door.
 * Attribution stays tappable.
 */
export function MiniMap({
  doors,
  labels,
  outcomes,
  routeModel,
  routeTiers,
  footprints = null,
  currentUprn,
  onOpenMap,
}: {
  doors: DoorCollection;
  labels: DoorLabels;
  outcomes: LocalOutcomes;
  routeModel: RoutePaintModel;
  routeTiers: RouteTiers | null;
  footprints?: GeoJSON.FeatureCollection | null;
  /** The door the Logger cursor is on now. Never a GPS position. */
  currentUprn: number | null;
  onOpenMap: () => void;
}) {
  const mapView = useMapView();
  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="mini-map">
      <FieldMap
        doors={doors}
        labels={labels}
        outcomes={outcomes}
        routeModel={routeModel}
        routeTiers={routeTiers}
        footprints={footprints}
        selectedUprn={currentUprn}
        cameraNonce={0}
        onSelectUprn={() => {}}
        active
        variant="compact"
      />
      <button
        type="button"
        aria-pressed={mapView === "3d"}
        onClick={() => toggleMapView()}
        className="absolute right-2 top-2 z-[2] flex size-11 items-center justify-center rounded-full border border-line bg-surface text-field-button-label"
        data-testid="map-view-toggle"
      >
        {mapView === "3d" ? "2D" : "3D"}
      </button>
      <button
        type="button"
        onClick={onOpenMap}
        aria-label="Open the full map, centred on this door"
        className="absolute left-2 bottom-2 z-[2] flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-field-knob"
        data-testid="mini-map-open"
      >
        <MapIcon className="size-5" />
      </button>
    </div>
  );
}
