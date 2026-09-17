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
 * It is deliberately MANUAL. Advancing to "the next unlogged door" is not a
 * convenience this stage can add: without Stage 10's claim mechanism every
 * member of a duo or trio would be sent to the same doorstep at the same
 * moment. Stage 10 wraps claims around this hook and only then does
 * next-unlogged become safe.
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