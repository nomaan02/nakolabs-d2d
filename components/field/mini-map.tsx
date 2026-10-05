"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FieldMap } from "@/components/field/field-map";
import { useGeo } from "@/components/field/geo-provider";
import { LocateIcon, MapIcon } from "@/components/field/icons";
import { LocationOffNotice } from "@/components/field/location-off-notice";
import { mapPositionOf } from "@/lib/field/geo";
import { toggleMapView, useMapView } from "@/lib/field/map-view";
import type { DoorLabels } from "@/lib/field/labels";
import type { LocalOutcomes } from "@/lib/field/local-outcomes";
import type { DoorCollection } from "@/lib/geo/todays-assignment";
import type { MapMode } from "@/lib/map/map-palette";
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
 * 2026-10-04 UI-6 B1 (owner P2.2): two-finger rotate; a recentre button (bottom-right) appears after a manual move and returns north-up to the current door.
 * 2026-10-04 UI-7 C1b (owners H3, U7-4): the canvasser's own marker (violet, from GeoProvider, memory only).
 * Recentre goes to the canvasser heading-up when the fix is 30 m or better, else to the door north-up.
 * The tap also asks iOS for the compass. `overlay` is the top-left slot (UI-7 C2 near-you chip);
 * with no overlay, "Location off" shows there when location is denied or unavailable.
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
  mode,
  overlay,
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
  mode: MapMode;
  /** UI-7 C2: top-left slot (the near-you chip). */
  overlay?: ReactNode;
}) {
  const mapView = useMapView();
  const geo = useGeo();
  const [moved, setMoved] = useState(false);
  const [recenterNonce, setRecenterNonce] = useState(0);
  const [recenterTarget, setRecenterTarget] = useState<"door" | "position">("door");
  const position = useMemo(
    () => mapPositionOf(geo.fix, geo.heading, geo.weak),
    [geo.fix, geo.heading, geo.weak],
  );
  const goodFix = position !== null && !position.weak;
  const locationOff = geo.status === "denied" || geo.status === "unavailable";
  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="mini-map">
      <FieldMap
        key={mode}
        mode={mode}
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
        onUserMove={setMoved}
        recenterNonce={recenterNonce}
        recenterTarget={recenterTarget}
        position={position}
      />
      {overlay ?? (locationOff ? <LocationOffNotice className="left-2 top-2" /> : null)}
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
      {moved ? (
        <button
          type="button"
          onClick={() => {
            geo.requestCompass();
            setRecenterTarget(goodFix ? "position" : "door");
            setRecenterNonce((n) => n + 1);
          }}
          aria-label={goodFix ? "Recentre on you" : "Recentre on this door"}
          className="absolute right-2 bottom-2 z-[2] flex size-11 items-center justify-center rounded-full border border-line bg-surface text-prop shadow-field-knob"
          data-testid="mini-map-recentre"
        >
          <LocateIcon className="size-5" />
        </button>
      ) : null}
    </div>
  );
}
