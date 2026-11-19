"use client";

import type { ReactNode } from "react";

import { NoteButton } from "@/components/field/ui/note-button";
import { LogToast } from "@/components/field/ui/log-toast";
import { StatsRail } from "@/components/field/ui/stats-rail";
import { useUndoTarget } from "@/lib/field/undo";

/**
 * DIAL-1: the Logger body in the dial layout (Figma "Logger V2.1 / Rest"
 * 331:935, Dragging 331:1074, Logged 331:1214). Three zones under the shared
 * FieldHeader, each with one job:
 *
 * - Glance: the mini map card (flexes to the room left, min 64) and one
 *   status line under it (the Logger's one banner slot, 40px, reserved so
 *   the door never jumps when a banner comes and goes).
 * - Focus: the door scroll, with the NoteButton on the right margin, centred
 *   on the number. "Already logged" or "Add number" sits in a 16px line over
 *   the empty top of the number's stage, so it takes no height of its own.
 * - Dock: a `surface` sheet with a 24px top radius and a hairline. Today's
 *   numbers (40px), then the dial with 16 above and 12 below. The tab bar
 *   continues the same surface underneath (globals.css drops its top line
 *   while a dock is mounted).
 *
 * The dock never scrolls and sits in the thumb zone. If a small phone or a
 * long team strip leaves too little room, the map gives way first (to 64px,
 * or 48px on a short screen), then the glance and focus zones scroll. Under
 * 720px of screen height (iPhone SE, 375 x 667) the dial draws at 184
 * instead of 224 (`--dial-scale`) and the dock's padding tightens by 4px a
 * step, so nothing scrolls there with a solo header.
 *
 * While the dial is in use (`active`) the glance zone recedes behind a light
 * scrim (the door stays crisp), and the numbers and the toast fade out, so
 * the readout above the ring has the space. On release the dial plays its
 * logged frame (about 1.1 s, `settling`), then the toast slides in over the
 * numbers for the rest of the undo window.
 */
export function LoggerDialBody({
  map,
  banner,
  doorLine,
  door,
  note,
  counts,
  dial,
  active,
  settling = false,
}: {
  map: ReactNode;
  banner: ReactNode;
  doorLine: ReactNode;
  door: ReactNode;
  note: { label: string; hasDraft: boolean; onPress: () => void };
  counts: { doors: number | null; contacts: number | null; leads: number | null; confirmed: number | null };
  dial: ReactNode;
  active: boolean;
  /** The dial's logged frame is playing: the toast waits for it. */
  settling?: boolean;
}) {
  const undo = useUndoTarget();

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="logger-body" data-layout="dial">
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain">
        <div className="relative flex flex-1 flex-col" data-testid="logger-glance">
          <div
            className="logger-map-band relative mx-4 mt-3 min-h-16 flex-1 overflow-hidden rounded-field-lg border border-line [@media(max-height:720px)]:min-h-12"
            data-testid="logger-map-band"
          >
            {map}
          </div>
          <div className="flex h-10 shrink-0 items-center px-4" data-testid="logger-status-line">
            <div className="min-w-0 flex-1">{banner}</div>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[5] bg-scrim-focus"
            style={{ opacity: active ? 1 : 0, transition: "opacity 160ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
            data-testid="logger-glance-scrim"
          />
        </div>

        <div className="relative shrink-0 px-4" data-testid="logger-focus">
          <div className="mx-auto max-w-[calc(100%-112px)]">{door}</div>
          <div
            className="absolute inset-x-[72px] top-0 flex h-4 items-center justify-center gap-3"
            data-testid="door-line"
          >
            {doorLine}
          </div>
          <div className="absolute top-[26px] right-4" data-testid="note-slot">
            <NoteButton label={note.label} hasDraft={note.hasDraft} onPress={note.onPress} />
          </div>
        </div>
      </div>

      <div
        className="relative shrink-0 rounded-t-field-xl border-t border-line bg-surface pt-4 [--dial-scale:1] [@media(max-height:720px)]:pt-3 [@media(max-height:720px)]:[--dial-scale:0.82]"
        data-dial-dock
        data-testid="logger-dock"
      >
        <StatsRail counts={counts} hidden={active || settling || undo !== null} />
        <div className="absolute inset-x-4 top-2 z-10">
          <LogToast hidden={active || settling} />
        </div>
        <div className="flex justify-center pt-4 pb-3 [@media(max-height:720px)]:pt-3 [@media(max-height:720px)]:pb-2">{dial}</div>
      </div>
    </div>
  );
}
