"use client";

import { useEffect, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import { setDrawDoors } from "@/components/admin/props/prop-layers";
import { ringKey } from "@/lib/admin/draw-history";
import { countKnockable, type KnockableCount } from "@/lib/geo/count-knockable";
import type { Ring } from "@/lib/geo/prop-polygon";
import { DOT_CAP, propertiesInPolygon } from "@/lib/geo/properties-in-polygon";
import { createClient } from "@/lib/supabase/client";

export type ShapeCount =
  | { status: "idle" }
  | { status: "counting"; previous: KnockableCount | null }
  | { status: "counted"; key: string; count: KnockableCount }
  | { status: "failed"; message: string };

/** Long enough that dragging a corner around does not fire a count per frame. */
const SETTLE_MS = 350;

/**
 * UI-10 F2c (owner A20, A21). Counts the doors in a closed shape (in
 * Postgres: `count_door_eligibility`, never client-side) and then draws
 * them: knockable solid, No Cold Calling zone and flats hollow. Never the
 * other way round. A newer shape always wins over a slower older count.
 */
export function useShapeCount(map: MapLibreMap | null, ring: Ring | null): ShapeCount {
  const [state, setState] = useState<ShapeCount>({ status: "idle" });
  const key = ringKey(ring);

  useEffect(() => {
    if (!ring) {
      setState({ status: "idle" });
      if (map) setDrawDoors(map, null);
      return;
    }
    let stale = false;
    setState((current) => ({
      status: "counting",
      previous: current.status === "counted" ? current.count : current.status === "counting" ? current.previous : null,
    }));
    const timer = setTimeout(() => {
      void (async () => {
        const supabase = createClient();
        const counted = await countKnockable(supabase, ring);
        if (stale) return;
        if (!counted.ok) {
          setState({ status: "failed", message: counted.message });
          if (map) setDrawDoors(map, null);
          return;
        }
        setState({ status: "counted", key, count: counted.count });
        const doors = await propertiesInPolygon(supabase, ring, DOT_CAP);
        if (stale || !map) return;
        setDrawDoors(map, doors.ok ? doors.doors : null);
      })();
    }, SETTLE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `ring` is read through `key`: a new array with the same corners is the same shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  return state;
}
