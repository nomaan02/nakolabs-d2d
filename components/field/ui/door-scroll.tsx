"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CachedAddress } from "@/lib/field/db";
import {
  PLATE_PX,
  SETTLE_DEBOUNCE_MS,
  SETTLE_PULSE_MS,
  atEnd,
  atStart,
  distanceFromCentre,
  indexAt,
  plateSize,
  scrollBehaviourFor,
  scrollLeftFor,
  scrollPlate,
  settle,
  stepIndex,
  trackMetrics,
  windowIndices,
} from "@/lib/field/door-window";
import { pulse } from "@/lib/field/feedback";
import { doorPlate } from "@/lib/field/labels";

/**
 * DoorScroll (Figma 7:18, plan P13): native CSS scroll-snap over a
 * virtualised track. The track is N slots wide, but only the ±8 doors
 * around the live scroll centre exist in the DOM, so node count is flat
 * for any prop size. All the maths is in `lib/field/door-window.ts`.
 *
 * The scroll moves the cursor only when a person moves the scroll: a
 * settle calls `onSettle` only if the resting door differs from `index`,
 * and an external `index` change scrolls to exactly that door. Nothing here
 * advances on a timer.
 */

export type DoorScrollItem = {
  uprn: number;
  label: CachedAddress | undefined;
  /** Route position, 0-based. The placeholder plate shows position + 1. */
  position: number;
  /** A teammate's name when live knock sharing says they knocked this door. */
  knockedBy: string | null;
};

const SUPPORTS_SCROLLEND = typeof window !== "undefined" && "onscrollend" in window;
const FADE_TO = 0.35;
const STAGE_PX = 96;

export function DoorScroll({
  doors,
  index,
  street,
  onSettle,
}: {
  doors: DoorScrollItem[];
  index: number;
  street: string | null;
  onSettle: (index: number) => void;
}) {
  const total = doors.length;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLDivElement>());
  const [viewport, setViewport] = useState(0);
  const [centre, setCentre] = useState(index);
  const centreRef = useRef(index);
  const indexRef = useRef(index);
  const paintIndexRef = useRef(index);
  paintIndexRef.current = index;
  const settledByScroll = useRef<number | null>(null);
  const pendingJump = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const debounce = useRef<number | null>(null);
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  const { slot, pad, trackWidth } = useMemo(() => trackMetrics(viewport, total), [viewport, total]);

  const paint = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft;
    for (const [i, node] of itemRefs.current) {
      if (i !== paintIndexRef.current) {
        node.style.opacity = "0";
        continue;
      }
      const d = distanceFromCentre(i, left, slot);
      const px = PLATE_PX[plateSize(node.dataset.plate ?? "")];
      const scale = 1 - (1 - px.neighbour / px.current) * d;
      const plate = node.firstElementChild as HTMLElement | null;
      if (plate) plate.style.transform = `scale(${scale})`;
      node.style.opacity = String(1 - (1 - FADE_TO) * d);
    }
  }, [slot]);

  const doSettle = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || total === 0) return;
    const result = settle(el.scrollLeft, slot, total, indexRef.current);
    if (!result.changed) return;
    indexRef.current = result.index;
    settledByScroll.current = result.index;
    pulse(SETTLE_PULSE_MS);
    onSettleRef.current(result.index);
  }, [slot, total]);

  const runJump = useCallback(() => {
    const el = scrollerRef.current;
    const target = pendingJump.current;
    pendingJump.current = null;
    if (!el || target === null) return;
    el.scrollTo({ left: scrollLeftFor(target, slot), behavior: "instant" });
    requestAnimationFrame(() => {
      el.style.scrollSnapType = "";
    });
  }, [slot]);

  const step = useCallback(
    (direction: -1 | 1) => {
      const next = stepIndex(indexRef.current, direction, total);
      if (next === indexRef.current) return;
      pulse(SETTLE_PULSE_MS);
      onSettleRef.current(next);
    },
    [total],
  );

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientWidth));
    ro.observe(el);
    setViewport(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // A new slot width (first measure, rotation): put the current door back in the centre.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || viewport === 0) return;
    el.scrollTo({ left: scrollLeftFor(indexRef.current, slot), behavior: "instant" });
    paint();
  }, [viewport, slot, paint]);

  // External index change: scroll to it, unless this is our own settle coming back.
  useEffect(() => {
    const el = scrollerRef.current;
    if (settledByScroll.current === index) {
      settledByScroll.current = null;
      indexRef.current = index;
      return;
    }
    settledByScroll.current = null;
    const from = indexRef.current;
    indexRef.current = index;
    if (!el || viewport === 0) return;
    const target = scrollLeftFor(index, slot);
    if (Math.abs(el.scrollLeft - target) < 1) return;
    const behavior = scrollBehaviourFor(from, index);
    if (behavior === "smooth") {
      el.scrollTo({ left: target, behavior });
      return;
    }
    // Snap can only land on a rendered door, so an instant jump turns snap
    // off, renders the target window, scrolls, then turns snap back on.
    el.style.scrollSnapType = "none";
    pendingJump.current = index;
    if (centreRef.current === index) {
      runJump();
    } else {
      centreRef.current = index;
      setCentre(index);
    }
  }, [index, slot, viewport, runJump]);

  useLayoutEffect(() => {
    if (pendingJump.current !== null) runJump();
    paint();
  }, [centre, doors, index, paint, runJump]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (debounce.current !== null) window.clearTimeout(debounce.current);
    },
    [],
  );

  const onScroll = () => {
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const el = scrollerRef.current;
        if (!el) return;
        const live = indexAt(el.scrollLeft, slot, total);
        if (live !== centreRef.current) {
          centreRef.current = live;
          setCentre(live);
        }
        paint();
      });
    }
    if (!SUPPORTS_SCROLLEND) {
      if (debounce.current !== null) window.clearTimeout(debounce.current);
      debounce.current = window.setTimeout(doSettle, SETTLE_DEBOUNCE_MS);
    }
  };

  const current = doors[index];
  const currentPlate = current ? scrollPlate(doorPlate(current.label), current.position) : null;
  const announce = current
    ? `Door ${currentPlate!.text}${street ? `, ${street}` : ""}, ${index + 1} of ${total}${
        current.knockedBy ? `, knocked by ${current.knockedBy}` : ""
      }`
    : "";

  return (
    <div className="flex min-w-0 flex-col items-center gap-0 overflow-hidden" data-testid="door-scroll">
      <div
        ref={scrollerRef}
        tabIndex={0}
        role="group"
        aria-label="Doors"
        onScroll={onScroll}
        onScrollEnd={doSettle}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            step(e.key === "ArrowLeft" ? -1 : 1);
          }
        }}
        className="w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-index={index}
        data-centre={centre}
        data-slot={slot}
      >
        <div className="relative h-[110px]" style={{ width: trackWidth }}>
          {viewport > 0 &&
            windowIndices(centre, total).map((i) => {
              const door = doors[i];
              const plate = scrollPlate(doorPlate(door.label), door.position);
              const size = PLATE_PX[plateSize(plate.text)];
              const isCurrent = i === index;
              const ink = door.knockedBy ? "text-ink-soft" : isCurrent ? "text-ink" : "text-ink-faint";
              return (
                <div
                  key={door.uprn}
                  ref={(el) => {
                    if (el) itemRefs.current.set(i, el);
                    else itemRefs.current.delete(i);
                  }}
                  aria-hidden
                  data-door-item={i}
                  data-plate={plate.text}
                  className={`absolute top-0 flex snap-center flex-col items-center [scroll-snap-stop:normal]${
                    isCurrent ? "" : " opacity-0"
                  }`}
                  style={{ left: pad + i * slot, width: slot }}
                >
                  <span
                    className={`flex items-center justify-center text-field-door-current ${
                      isCurrent ? "whitespace-nowrap" : "max-w-full"
                    } ${ink}`}
                    style={{ height: STAGE_PX, fontSize: size.current, lineHeight: `${STAGE_PX}px` }}
                  >
                    {/*
                      Found in Session C assembly, at real screen width, with
                      Sora actually applying (see the dated globals.css
                      note): the current door's own item box is only `slot`
                      wide — narrower than a 2-digit plate at 112px Sora
                      (measured ~157px). `truncate` there ellipsised the
                      digits, an unreadable regression the isolated Session
                      B2 check page never hit (full-width test, plus a
                      then-undetected Sora bug that happened to render a
                      narrower font). The current item renders at its
                      natural width instead, uncapped and unclipped by this
                      span; nothing in its ancestor chain sets
                      `overflow-hidden` before the scroller itself, whose
                      viewport is always wider than one plate, so it is
                      never actually cut off. Neighbours keep the original
                      max-w-full + truncate safety net — they are small
                      enough (40px or less) to need it only for a long
                      house number.
                    */}
                    {isCurrent ? plate.text : <span className="truncate">{plate.text}</span>}
                  </span>
                  {door.knockedBy && (
                    <span className="text-field-button-label text-ink-soft">✓ {door.knockedBy}</span>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      <div className="flex items-center gap-2 text-field-body text-ink-soft">
        <button
          type="button"
          aria-label="Previous door"
          aria-disabled={atStart(index)}
          onClick={() => step(-1)}
          className="flex size-tap-min items-center justify-center aria-disabled:text-ink-faint"
          data-testid="door-prev"
        >
          ‹
        </button>
        <span className="truncate">{street ?? ""}</span>
        <button
          type="button"
          aria-label="Next door"
          aria-disabled={atEnd(index, total)}
          onClick={() => step(1)}
          className="flex size-tap-min items-center justify-center aria-disabled:text-ink-faint"
          data-testid="door-next"
        >
          ›
        </button>
      </div>

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
