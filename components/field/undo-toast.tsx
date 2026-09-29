"use client";

import { useEffect, useState } from "react";

import { pulse } from "@/lib/field/feedback";
import { takeUndo, useUndoTarget } from "@/lib/field/undo";

/**
 * UndoToast — Figma node 12:173.
 *
 * "Appears OVER the note bar after every log for the undo window (existing
 * lib/field/undo) — never over the outcome buttons. Countdown is text, not
 * a bar (glare)."
 *
 * One undo target, sitting above the tab bar and over the NoteBar,
 * counting down from 60. Undoing deletes the `held_undo` outbox row, so
 * nothing has reached Postgres and nothing needs to be deleted there —
 * which is the only workable design, because a canvasser holds no DELETE
 * grant on `knock_events`.
 *
 * A single 44px-plus target. The countdown is text, not a shrinking bar:
 * a bar is unreadable in glare and says nothing about how long is left.
 *
 * The countdown line uses `paper/75` (9.20:1 on ink, computed for this
 * session), not `ink-faint` (which is too low here) — see the Session B1
 * contrast report. The title line uses `surface` (white, 16.08:1), the
 * exact figure this session's contrast table gives for "white on ink
 * (toast)"; the raw Figma export referenced the existing `paper` token
 * (15.41:1) instead, which is close but not the figure this session was
 * given, so `surface` is used here.
 */
export function UndoToast() {
  const target = useUndoTarget();
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((target.expiresAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [target]);

  if (!target) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3 pb-2"
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
    >
      <div
        className="pointer-events-auto flex h-[60px] items-center gap-3 rounded-field-md bg-ink pr-2 pl-4 shadow-field-toast"
        data-testid="undo-toast-card"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
          <span className="truncate text-field-body-strong text-surface">{target.description}</span>
          <span className="text-field-button-label text-paper/75">Logged · {remaining}s to undo</span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void takeUndo()
              .then((undone) => {
                if (undone) pulse(25);
              })
              .finally(() => setBusy(false));
          }}
          className="h-11 w-20 shrink-0 rounded-field-sm bg-surface text-field-body-strong text-ink disabled:opacity-60"
          data-testid="undo-button"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
