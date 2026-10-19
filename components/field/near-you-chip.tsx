"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useGeo } from "@/components/field/geo-provider";
import { CHIP_START, nearDoorIndexes, stepChip, type ChipState } from "@/lib/field/geo";

const NONE: number[] = [];

/**
 * UI-7 C2 (owner H3, 2026-10-04), amended GL-C (owner C2, C4; 2026-10-18).
 * The sequence indexes of the doors near the canvasser, in walk order: the
 * nearest door on each pass of the route within GPS accuracy, so a street
 * walked twice offers one door per pavement (GPS cannot tell the side).
 * Forward only from the furthest real log; knocked doors are left out. Steps
 * through hysteresis (2 agreeing fixes). Empty with no good fix, more than
 * 100 m off the route, or an unrouted prop. It only ever suggests: the
 * cursor never moves on its own.
 */
export function useNearYouDoors(anchorIndex: number, isOpen: (index: number) => boolean): number[] {
  const { routePlace, doorAlongsM } = useGeo();
  const [chip, setChip] = useState<ChipState<string>>(CHIP_START);
  const latest = useRef({ anchorIndex, isOpen, doorAlongsM });
  latest.current = { anchorIndex, isOpen, doorAlongsM };
  const placeAt = routePlace?.at ?? null;

  useEffect(() => {
    if (routePlace === null) {
      setChip(CHIP_START);
      return;
    }
    const { anchorIndex: anchor, isOpen: open, doorAlongsM: alongs } = latest.current;
    const doors =
      routePlace.alongM === null || alongs.length === 0
        ? []
        : nearDoorIndexes({ passesM: routePlace.passesM, doorAlongsM: alongs, anchorIndex: anchor, isOpen: open });
    setChip((current) => stepChip(current, doors.length === 0 ? null : doors.join(",")));
    // One step per fix: `placeAt` changes once per snapped fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeAt]);

  const shown = chip.shown;
  // Drop a door that has since been knocked or passed (a log between fixes).
  return useMemo(() => {
    if (shown === null) return NONE;
    const doors = shown.split(",").map(Number).filter((index) => index > anchorIndex && isOpen(index));
    return doors.length === 0 ? NONE : doors;
  }, [shown, anchorIndex, isOpen]);
}

/** GL-2: the top-left slot on the mini map, and its 40 px pill. */
const SLOT = "absolute left-0.5 top-0.5 z-[2] flex h-11 max-w-[calc(100%-6.75rem)] items-center px-1.5";
const PILL = "flex h-10 min-w-0 items-center gap-2 rounded-full border pl-3 shadow-field-knob";

/**
 * "Near you · 42 Coronation Road  Jump ›" on the mini map, top-left. FUI-2a:
 * kept clear of the two top-right buttons (Recentre, Open Map). GL-2
 * (Figma "GPS-LOCK (2026-10-18)"): the pill is 40 px, inside the 44 px target.
 */
export function NearYouChip({ label, onJump }: { label: string; onJump: () => void }) {
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`Jump to ${label}, the door nearest you`}
      className={SLOT}
      data-testid="near-you-chip"
    >
      <span className={`${PILL} border-line bg-surface pr-3.5`}>
        <span className="min-w-0 truncate text-field-body-strong text-ink">Near you · {label}</span>
        <span aria-hidden className="shrink-0 text-field-body-strong text-prop">
          Jump ›
        </span>
      </span>
    </button>
  );
}

/**
 * GL-C (owner C2; Figma "GPS-LOCK C · side correction" 231:1924). Where the
 * route passes the canvasser twice (usually both pavements), "Near you | 48 | 49":
 * one button per door, in walk order. Each door is a 44 px target inside the
 * 40 px pill. Tapping a door moves the Logger there.
 */
export function NearYouSidesChip({
  doors,
  onPick,
}: {
  doors: ReadonlyArray<{ index: number; plate: string; address: string }>;
  onPick: (index: number) => void;
}) {
  return (
    <div className={SLOT} role="group" aria-label="Doors near you" data-testid="near-you-sides">
      <span className={`${PILL} border-line bg-surface pr-1`}>
        <span className="shrink-0 text-field-body-strong text-ink">Near you</span>
        {doors.map((door) => (
          <span key={door.index} className="flex shrink-0 items-center gap-1">
            <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
            <button
              type="button"
              onClick={() => onPick(door.index)}
              aria-label={`Jump to ${door.address}, near you`}
              className="-my-0.5 flex h-11 min-w-11 max-w-24 items-center justify-center rounded-full px-2.5 text-field-body-strong text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
              data-testid="near-you-door"
            >
              <span className="truncate">{door.plate}</span>
            </button>
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * GL-2: the same slot while a reopen waits for a good fix. Informational, so
 * it takes no taps; `JumpAnnouncer` reads it out.
 */
export function FindingYouChip() {
  return (
    <div className={`${SLOT} pointer-events-none`} aria-hidden data-testid="finding-you-chip">
      <span className={`${PILL} border-line bg-surface pr-3.5`}>
        <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-prop motion-reduce:animate-none" />
        <span className="min-w-0 truncate text-field-body-strong text-ink-soft">Finding you…</span>
      </span>
    </div>
  );
}

/** GL-2 (owner G6): after the automatic jump. Undo puts the Logger back on the door it left. */
export function MovedChip({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div className={SLOT} data-testid="moved-chip">
      <span className={`${PILL} border-prop bg-prop-soft pr-1`}>
        <span className="min-w-0 truncate text-field-body-strong text-ink">
          Moved to {label}
        </span>
        <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
        <button
          type="button"
          onClick={onUndo}
          aria-label={`Undo: go back to the door you were on`}
          className="-my-0.5 flex h-11 shrink-0 items-center rounded-full px-3 text-field-body-strong text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
          data-testid="moved-undo"
        >
          Undo
        </button>
      </span>
    </div>
  );
}


/**
 * GL-2: one live region that stays mounted, so screen readers announce
 * "Finding you…" and "Moved to …" (a region inserted with its text is often
 * not read out).
 */
export function JumpAnnouncer({ text }: { text: string }) {
  return (
    <span role="status" className="sr-only" data-testid="jump-announcer">
      {text}
    </span>
  );
}
