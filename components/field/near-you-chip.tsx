"use client";

import { useEffect, useState } from "react";

import { useGeo } from "@/components/field/geo-provider";
import { CHIP_START, nearestDoorIndex, stepChip, type ChipState } from "@/lib/field/geo";

/**
 * UI-7 C2 (owner H3, 2026-10-04). The sequence index of the door nearest the
 * canvasser along the route, after hysteresis (2 agreeing fixes). Null when
 * there is no good fix, the canvasser is more than 100 m off the route, or
 * the prop is unrouted. It only ever suggests: the cursor never moves on its
 * own.
 */
export function useNearYouIndex(): number | null {
  const { routePlace, doorAlongsM } = useGeo();
  const [chip, setChip] = useState<ChipState>(CHIP_START);
  const placeAt = routePlace?.at ?? null;

  useEffect(() => {
    if (routePlace === null) {
      setChip(CHIP_START);
      return;
    }
    const next =
      routePlace.alongM === null || doorAlongsM.length === 0
        ? null
        : nearestDoorIndex(doorAlongsM, routePlace.alongM);
    setChip((current) => stepChip(current, next === -1 ? null : next));
    // One step per fix: `placeAt` changes once per snapped fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeAt]);

  return chip.shown;
}

/** "Near you · 42 Coronation Road  Jump ›" on the mini map, top-left. */
export function NearYouChip({ label, onJump }: { label: string; onJump: () => void }) {
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`Jump to ${label}, the door nearest you`}
      className="absolute left-0.5 top-0.5 z-[2] flex h-11 max-w-[calc(100%-3.75rem)] items-center px-1.5"
      data-testid="near-you-chip"
    >
      <span className="flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface pl-2.5 pr-3 shadow-field-knob">
        <span className="min-w-0 truncate text-field-button-label text-ink">Near you · {label}</span>
        <span aria-hidden className="shrink-0 text-field-button-label text-prop">
          Jump ›
        </span>
      </span>
    </button>
  );
}
