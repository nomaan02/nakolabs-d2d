"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource } from "maplibre-gl";

import { useAdminMap } from "@/components/admin/map/use-admin-map";
import { ensurePropLayers, setProps, setSelectedProp } from "@/components/admin/props/prop-layers";
import { IconButton } from "@/components/admin/ui/icon-button";
import { useOverlayFocus } from "@/components/admin/ui/use-overlay-focus";
import { ChevronLeftIcon } from "@/components/field/icons";
import { loadLastKnocks, type LastKnock } from "@/lib/admin/last-knocks";
import { LIVE_FADE_MS, type LiveRow } from "@/lib/admin/live";
import { boxOf } from "@/lib/admin/map-fit";
import { activeTeam, ago, type TodayVisit } from "@/lib/admin/today";
import type { TodayProp } from "@/lib/admin/today-data";
import { MAP_UI, type MapMode } from "@/lib/map/map-palette";
import { createClient } from "@/lib/supabase/client";

const SOURCE = "admin-live";
const DOTS = "admin-live-dots";
const INITIALS = "admin-live-initials";

/**
 * UI-10 F3c (owner A36, H5; frame 15). One visit's team on a map: each
 * person's CURRENT position only (no trail exists to draw), their last knock
 * and its door. Positions come from the 30-second poll Today already runs;
 * nothing here stores or sends a location.
 */
export function LiveMap({
  visit,
  prop,
  rows,
  updatedAt,
  now,
  mode,
  onClose,
}: {
  visit: TodayVisit;
  prop: TodayProp | null;
  /** This visit's rows from `admin_live_positions`. */
  rows: LiveRow[];
  updatedAt: number;
  now: number;
  mode: MapMode;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const { map } = useAdminMap(container, mode, "d2d.admin.live-map");
  const [knocks, setKnocks] = useState<Map<string, LastKnock>>(new Map());
  const team = activeTeam(visit);
  const ui = MAP_UI[mode];
  useOverlayFocus(panel, true, onClose);

  const teamKey = team.map((member) => member.id).join(",");
  useEffect(() => {
    let live = true;
    void loadLastKnocks(createClient(), visit.id, teamKey ? teamKey.split(",") : []).then((result) => {
      if (live) setKnocks(result);
    });
    return () => {
      live = false;
    };
  }, [visit.id, teamKey, updatedAt]);

  // Fit once per map: a refresh of Today must not undo the admin's own pan and zoom.
  const propRef = useRef(prop);
  propRef.current = prop;
  const propId = prop?.id ?? null;
  useEffect(() => {
    const prop = propRef.current;
    if (!map) return;
    ensurePropLayers(map, mode);
    if (prop?.geometry) {
      setProps(map, [{ id: prop.id, name: prop.name, archived: false, geometry: prop.geometry }]);
      setSelectedProp(map, prop.id);
      const box = boxOf([prop.geometry]);
      if (box) map.fitBounds(box, { padding: { top: 40, right: 32, bottom: 200, left: 32 }, maxZoom: 17, duration: 0 });
    }
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: DOTS,
        type: "circle",
        source: SOURCE,
        paint: {
          "circle-radius": 13,
          "circle-color": ["case", ["boolean", ["get", "faded"], false], ui.youWeak, ui.halo],
          "circle-stroke-color": ui.core,
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: INITIALS,
        type: "symbol",
        source: SOURCE,
        layout: { "text-field": ["get", "initial"], "text-size": 12, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": ui.core },
      });
    }
  }, [map, mode, propId, ui]);

  useEffect(() => {
    const source = map?.getSource(SOURCE) as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: rows.map((row) => ({
        type: "Feature",
        properties: { initial: row.firstName.charAt(0).toUpperCase(), faded: now - Date.parse(row.reportedAt) > LIVE_FADE_MS },
        geometry: { type: "Point", coordinates: [row.lon, row.lat] },
      })),
    });
  }, [map, rows, now]);

  const positions = new Map(rows.map((row) => [row.canvasserId, row] as const));

  return (
    <div ref={panel} role="dialog" aria-modal="true" aria-label={`Live: ${visit.propName}`} tabIndex={-1} className="fixed inset-0 z-50 flex flex-col bg-field-bg outline-none">
      <header className="flex items-center gap-1 border-b border-line bg-surface px-1 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]">
        <IconButton label="Back to Today" onClick={onClose}>
          <ChevronLeftIcon className="size-6" />
        </IconButton>
        <div className="min-w-0">
          <h2 className="truncate text-admin-headline">Live · {visit.propName}</h2>
          <p className="text-admin-caption text-ink-muted">Current positions only · updated {ago(new Date(updatedAt).toISOString(), now)}</p>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={container} className="admin-map h-full w-full" />
        <ul className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] rounded-field-lg border border-line bg-surface px-4 py-1 shadow-admin-float lg:inset-x-auto lg:left-3 lg:w-96">
          {team.map((member) => {
            const knock = knocks.get(member.id);
            const position = positions.get(member.id);
            const sharing = position !== undefined && now - Date.parse(position.reportedAt) <= LIVE_FADE_MS;
            const line = knock ? `Last knock ${ago(knock.at, now)}${knock.door ? ` · ${knock.door}` : ""}` : "No knocks yet";
            return (
              <li key={member.id} className="flex min-h-14 items-center gap-3 border-b border-line py-2 last:border-b-0">
                <span
                  aria-hidden
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-admin-caption ${sharing ? "bg-ink text-paper" : "bg-field-bg text-ink-soft"}`}
                >
                  {member.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block text-admin-body-strong">{member.name}</span>
                  <span className="block truncate text-admin-subhead text-ink-muted">
                    {line}
                    {sharing ? "" : " · not sharing a position"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
