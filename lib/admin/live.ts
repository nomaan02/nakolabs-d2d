import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * UI-7 C3c (owner H5, U7-3, U7-5, 2026-10-04). The admin "Live now" panel's
 * data: today's open visits, one current position per canvasser, from
 * `admin_live_positions()` (admin only, RLS + role check). Current position
 * only — there is no history to read, by design.
 */

export type LiveRow = {
  canvasserId: string;
  firstName: string;
  territoryName: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  headingDeg: number | null;
  reportedAt: string;
  /** Partner scalar, server metres. Null = off the route. */
  routeM: number | null;
  routeLengthM: number | null;
};

/** Older than this, a row fades and reads "Last seen". */
export const LIVE_FADE_MS = 10 * 60_000;

export type LiveResult = { ok: true; rows: LiveRow[] } | { ok: false; message: string };

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchLivePositions(supabase: SupabaseClient<Database>): Promise<LiveResult> {
  const { data, error } = await supabase.rpc("admin_live_positions");
  if (error) return { ok: false, message: "Live positions could not be loaded. They refresh every 30 seconds." };
  const rows: LiveRow[] = [];
  for (const row of data ?? []) {
    const lat = finite(row.lat);
    const lon = finite(row.lon);
    if (lat === null || lon === null || !row.reported_at) continue;
    rows.push({
      canvasserId: row.canvasser_id,
      firstName: row.first_name || "Canvasser",
      territoryName: row.territory_name,
      lat,
      lon,
      accuracyM: finite(row.accuracy_m),
      headingDeg: finite(row.heading_deg),
      reportedAt: row.reported_at,
      routeM: finite(row.route_position_m),
      routeLengthM: finite(row.route_length_m),
    });
  }
  return { ok: true, rows };
}

function distance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** "On route · 1.2 km of 1.9 km" / "Off route" / "Last seen". */
export function liveStateLine(row: LiveRow, now: number): string {
  if (now - Date.parse(row.reportedAt) > LIVE_FADE_MS) return "Last seen";
  if (row.routeM === null) return "Off route";
  if (row.routeLengthM === null) return "On route";
  return `On route · ${distance(row.routeM)} of ${distance(row.routeLengthM)}`;
}

/** "30 s ago" / "4 min ago" / "2 h ago". */
export function agoLabel(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${Math.max(10, Math.round(seconds / 10) * 10)} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}
