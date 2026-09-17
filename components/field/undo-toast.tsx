"use client";

import { useEffect, useState } from "react";

import { pulse } from "@/lib/field/feedback";
import { takeUndo, useUndoTarget } from "@/lib/field/undo";

/**
 * One undo target, sitting above the tab bar, counting down from 60.
 *
 * Undoing deletes the `held_undo` outbox row, so nothing has reached Postgres
 * and nothing needs to be deleted there — which is the only workable design,
 * because a canvasser holds no DELETE grant on `knock_events`.
 *
 * A single 44px-plus target. The countdown is text, not a shrinking bar: a
 * bar is unreadable in glare and says nothing about how long is left.
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
      <div className="pointer-events-auto flex items-center gap-3 rounded-md border-2 border-ink bg-ink px-3 py-2 text-paper shadow-lg">
        <p className="min-w-0 flex-1 text-sm leading-snug">
          <span className="block truncate font-medium">{target.description}</span>
          <span className="font-data text-xs text-paper/75">Logged · {remaining}s to undo</span>
        </p>
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
          className="min-h-11 shrink-0 rounded-md bg-paper px-5 text-base font-semibold text-ink disabled:opacity-60"
          data-testid="undo-button"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
