"use client";

import { useCallback, useMemo, useState } from "react";

import type { SequenceDoor } from "@/lib/field/sequence";

/**
 * SEAM (Stage 10). Which door the Logger is pointed at.
 *
 * Stage 8 owns this state outright: one index into the sequence, moved only
 * by something the canvasser did — a log, Back, Skip, a free scroll, or a tap
 * on the map.
 *
 * It stays manual. Stage 10 does not move this index on its own. After a log
 * the Logger asks `nextOpenIndex` for the next open door, forward from where
 * it is now.
 *
 * Amended 2026-09-28 (agent proposal, owner ACCEPTED — A1). Claims are
 * removed. `nextOpenIndex` now wraps: the first open door AFTER the given
 * index, or the lowest open door if none is open ahead, or -1 if every door
 * is knocked. A teammate's knock never moves this index by itself — only
 * this canvasser's own log, or an explicit action, calls `goTo`.
 */

export type Cursor = {
  /** Index into the sequence, clamped to it. -1 only when the prop is empty. */
  index: number;
  door: SequenceDoor | undefined;
  total: number;
  atStart: boolean;
  atEnd: boolean;
  /** Human position, 1-based: "Door 24 of 214". */
  humanPosition: number;
  goTo: (index: number) => void;
  goToUprn: (uprn: number) => void;
  next: () => void;
  previous: () => void;
};

/**
 * The first open (not in `blocked`) door strictly after `fromIndex`, wrapping
 * around to the lowest open door if none is found ahead. -1 only when every
 * door in `sequence` is blocked. `fromIndex` defaults to -1, so calling this
 * with no starting point is the same as asking for the lowest open door.
 */
export function nextOpenIndex(
  sequence: SequenceDoor[],
  blocked: ReadonlySet<number>,
  fromIndex: number = -1,
): number {
  const total = sequence.length;
  if (total === 0) return -1;
  for (let step = 1; step <= total; step += 1) {
    const index = (((fromIndex + step) % total) + total) % total;
    if (!blocked.has(sequence[index]!.uprn)) return index;
  }
  return -1;
}

export function useCursor(sequence: SequenceDoor[]): Cursor {
  const [index, setIndex] = useState(0);

  const total = sequence.length;
  const clamped = total === 0 ? -1 : Math.min(index, total - 1);

  const goTo = useCallback((target: number) => {
    setIndex(target < 0 ? 0 : target);
  }, []);

  const goToUprn = useCallback(
    (uprn: number) => {
      const found = sequence.findIndex((door) => door.uprn === uprn);
      if (found >= 0) setIndex(found);
    },
    [sequence],
  );

  const next = useCallback(() => {
    setIndex((current) => (total === 0 ? 0 : Math.min(current + 1, total - 1)));
  }, [total]);

  const previous = useCallback(() => {
    setIndex((current) => Math.max(current - 1, 0));
  }, []);

  return useMemo(
    () => ({
      index: clamped,
      door: clamped >= 0 ? sequence[clamped] : undefined,
      total,
      atStart: clamped <= 0,
      atEnd: total === 0 || clamped >= total - 1,
      humanPosition: clamped + 1,
      goTo,
      goToUprn,
      next,
      previous,
    }),
    [clamped, sequence, total, goTo, goToUprn, next, previous],
  );
}