"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { agoLabel, fetchLivePositions, LIVE_FADE_MS, liveStateLine, type LiveRow } from "@/lib/admin/live";
import { accuracyPxAtZoom22 } from "@/lib/field/geo";
import { ATTRIBUTION_LINES, fieldMapStyle } from "@/lib/field/map-style";
import { MAP_UI } from "@/lib/map/map-palette";
import { createClient } from "@/lib/supabase/client";

/**
 * UI-7 C3c (owner H5, U7-3, U7-5, 2026-10-04). "Live now" on the admin
 * dashboard until UI-10's Today screen. One dot per canvasser at their
 * CURRENT position (first name initial), with an accuracy ring. Rows older
 * than 10 minutes fade and read "Last seen". No trail is drawn, because none
 * is stored (invariant 7 as amended).
 */

const BRISTOL: [number, number] = [-2.5879, 51.4545];
const SOURCE = "live-positions";
const ACCURACY = "live-accuracy";
const DOTS = "live-dots";
const INITIALS = "live-initials";
const POLL_MS = 30_000;
const UI = MAP_UI.light;

function toCollection(rows: LiveRow[], now: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      properties: {
        initial: row.firstName.charAt(0).toUpperCase(),
        faded: now - Date.parse(row.reportedAt) > LIVE_FADE_MS,
        acc_px22: row.accuracyM === null ? 0 : accuracyPxAtZoom22(row.lat, row.accuracyM),
      },
      geometry: { type: "Point", coordinates: [row.lon, row.lat] },
    })),
  };
}

function fitRows(instance: MapLibreMap, rows: LiveRow[]) {
  if (rows.length === 0) return;
  const lons = rows.map((row) => row.lon);
  const lats = rows.map((row) => row.lat);
  instance.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: 60, maxZoom: 17, duration: 0 },
  );
}

export function LivePanel() {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rowsRef = useRef(rows);
  const nowRef = useRef(now);
  const fitted = useRef(false);
  rowsRef.current = rows;
  nowRef.current = now;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await fetchLivePositions(createClient());
      if (cancelled) return;
      setNow(Date.now());
      if (result.ok) {
        setRows(result.rows);
        setError(null);
      } else {
        setError(result.message);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;
    void (async () => {
      const style = await fieldMapStyle("light");
      if (cancelled || !container.current) return;
      const instance = new MapLibreMap({
        container: container.current,
        style,
        center: BRISTOL,
        zoom: 11.5,
        attributionControl: { compact: true, customAttribution: [...ATTRIBUTION_LINES] },
      });
      map.current = instance;
      instance.on("load", () => {
        instance.addSource(SOURCE, { type: "geojson", data: toCollection(rowsRef.current, nowRef.current) });
        instance.addLayer({
          id: ACCURACY,
          type: "circle",
          source: SOURCE,
          paint: {
            "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 0, 0, 22, ["get", "acc_px22"]],
            "circle-color": UI.you,
            "circle-opacity": ["case", ["boolean", ["get", "faded"], false], 0, 0.12],
            "circle-stroke-color": UI.you,
            "circle-stroke-width": ["case", ["boolean", ["get", "faded"], false], 0, 1],
            "circle-stroke-opacity": 0.4,
          },
        });
        instance.addLayer({
          id: DOTS,
          type: "circle",
          source: SOURCE,
          paint: {
            "circle-radius": 12,
            "circle-color": ["case", ["boolean", ["get", "faded"], false], UI.youWeak, UI.you],
            "circle-opacity": ["case", ["boolean", ["get", "faded"], false], 0.55, 1],
            "circle-stroke-width": 2,
            "circle-stroke-color": UI.youRing,
          },
        });
        instance.addLayer({
          id: INITIALS,
          type: "symbol",
          source: SOURCE,
          layout: {
            "text-field": ["get", "initial"],
            "text-size": 12,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: { "text-color": "#ffffff" },
        });
        if (!fitted.current && rowsRef.current.length > 0) {
          fitRows(instance, rowsRef.current);
          fitted.current = true;
        }
      });
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Gate on the source, never isStyleLoaded() (2026-10-02 G1).
  useEffect(() => {
    const instance = map.current;
    const source = instance?.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!instance || !source) return;
    source.setData(toCollection(rows, now));
    if (!fitted.current && rows.length > 0) {
      fitRows(instance, rows);
      fitted.current = true;
    }
  }, [rows, now]);

  const focus = (row: LiveRow) => {
    map.current?.easeTo({ center: [row.lon, row.lat], zoom: 17, duration: 400 });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="live-panel">
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Current position only. Overwritten every 30 seconds, never kept as a trail, cleared when the visit closes.
      </p>
      <div className="relative h-[300px] overflow-hidden border border-ink/15">
        <div ref={container} className="h-full w-full" data-testid="live-map" />
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-oxide">
          {error}
        </p>
      ) : null}
      {!error && rows.length === 0 ? (
        <p className="text-[13px] text-ink-soft">Nobody is sharing a position right now.</p>
      ) : null}
      <ul className="divide-y divide-ink/10" data-testid="live-rows">
        {rows.map((row) => {
          const faded = now - Date.parse(row.reportedAt) > LIVE_FADE_MS;
          return (
            <li key={row.canvasserId}>
              <button
                type="button"
                onClick={() => focus(row)}
                className="flex min-h-11 w-full items-center gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
              >
                <span
                  aria-hidden
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-paper ${faded ? "bg-ink-soft/50" : "bg-you"}`}
                >
                  {row.firstName.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[14px] ${faded ? "text-ink-soft" : "text-ink"}`}>
                    {row.firstName} · {row.territoryName}
                  </span>
                  <span className="block text-[12px] text-ink-soft">{liveStateLine(row, now)}</span>
                </span>
                <span className="shrink-0 font-data text-[12px] tabular-nums text-ink-soft">
                  {agoLabel(row.reportedAt, now)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
