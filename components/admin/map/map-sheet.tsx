"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useIsDesktop } from "@/components/admin/map/use-is-desktop";
import {
  clampHeight,
  detentHeights,
  nextDetent,
  settleDetent,
  type Detent,
} from "@/lib/admin/sheet-detents";

/** Movement before a press on the header becomes a drag (taps on its buttons still work). */
const DRAG_SLOP = 6;

/**
 * UI-10 F2b (owner A22; frames 03-05, D2). The sheet over a full-screen map.
 * Phone: pinned to the bottom with three heights (peek / half / full); drag
 * the header, flick it, or tap the handle. Desktop: a floating panel down
 * the left of the map, full height, no dragging.
 *
 * Only the header drags, so lists scroll normally. `available` is the height
 * of the map area; `onHeight` reports the sheet's settled height so the page
 * can keep map padding and floating buttons clear of it.
 */
export function MapSheet({
  label,
  detent,
  onDetent,
  available,
  onHeight,
  header,
  children,
}: {
  label: string;
  detent: Detent;
  onDetent: (next: Detent) => void;
  available: number;
  onHeight?: (height: number) => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const desktop = useIsDesktop();
  const heights = detentHeights(available);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const suppressClick = useRef(false);
  const height = dragHeight ?? heights[detent];
  const settled = heights[detent];

  useEffect(() => {
    onHeight?.(desktop ? 0 : settled);
  }, [desktop, settled, onHeight]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (desktop || (event.pointerType === "mouse" && event.button !== 0)) return;
    const startY = event.clientY;
    const startHeight = heights[detent];
    let dragging = false;
    let lastY = startY;
    let lastT = event.timeStamp;
    let velocity = 0;

    const move = (moveEvent: PointerEvent) => {
      const dy = startY - moveEvent.clientY;
      if (!dragging && Math.abs(dy) < DRAG_SLOP) return;
      dragging = true;
      const dt = Math.max(1, moveEvent.timeStamp - lastT);
      velocity = (lastY - moveEvent.clientY) / dt;
      lastY = moveEvent.clientY;
      lastT = moveEvent.timeStamp;
      setDragHeight(clampHeight(startHeight + dy, heights));
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragging) return;
      // Swallow the click this drag may produce, but never a later, real tap.
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      // A pause before letting go is a placement, not a flick.
      const flick = upEvent.timeStamp - lastT > 100 ? 0 : velocity;
      const finalHeight = clampHeight(startHeight + (startY - upEvent.clientY), heights);
      setDragHeight(null);
      onDetent(settleDetent(finalHeight, flick, heights, detent));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <section
      aria-label={label}
      style={desktop ? undefined : { height }}
      className={[
        "absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-admin-sheet bg-surface text-ink shadow-admin-sheet",
        "lg:inset-x-auto lg:top-3 lg:bottom-3 lg:left-3 lg:w-[360px] lg:rounded-admin-sheet lg:border lg:border-line lg:shadow-admin-float",
        dragHeight === null ? "transition-[height] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none" : "",
      ].join(" ")}
    >
      <div
        onPointerDown={onPointerDown}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        className="shrink-0 touch-none lg:touch-auto"
      >
        <div className="flex justify-center lg:hidden">
          <button
            type="button"
            aria-label={`Resize the ${label.toLowerCase()} sheet`}
            onClick={() => onDetent(nextDetent(detent))}
            className="flex h-6 w-16 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
          >
            <span aria-hidden className="h-1.5 w-9 rounded-full bg-ink-faint" />
          </button>
        </div>
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </section>
  );
}
