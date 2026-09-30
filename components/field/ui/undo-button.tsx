"use client";

import { useEffect, useState } from "react";

import { UndoIcon } from "@/components/field/icons";
import { pulse } from "@/lib/field/feedback";
import { takeUndo, useUndoTarget } from "@/lib/field/undo";
import { UNDO_WINDOW_MS } from "@/lib/sync/queue";

const C = 2 * Math.PI * 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 44px undo ring. The countdown is the stroke, not a bar: a bar washes out
 * in glare. One target, from `useUndoTarget`. Undoing deletes the held
 * outbox row, so nothing has reached Postgres.
 */
export function UndoButton({ className }: { className?: string }) {
  const target = useUndoTarget();
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    const tick = () => setRemaining(Math.max(0, (target.expiresAt - Date.now()) / 1000));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [target]);

  if (!target) return null;

  const frac = clamp(remaining / (UNDO_WINDOW_MS / 1000), 0, 1);
  // `relative` and a caller's `absolute` both set `position`. This Tailwind
  // build keeps the `relative` rule, so the base position is omitted when
  // the caller places the button.
  const placed = className && /\b(?:absolute|fixed|sticky)\b/.test(className);
  const buttonClass = [
    placed ? "" : "relative",
    "flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink disabled:opacity-60",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      data-testid="undo-button"
      disabled={busy}
      aria-label={`Undo ${target.description}. ${Math.ceil(remaining)} seconds left.`}
      onClick={() => {
        setBusy(true);
        void takeUndo()
          .then((undone) => {
            if (undone) pulse(25);
          })
          .finally(() => setBusy(false));
      }}
      className={buttonClass}
    >
      <svg aria-hidden viewBox="0 0 44 44" className="absolute inset-0 size-full -rotate-90">
        <circle cx={22} cy={22} r={20} fill="none" className="stroke-line" strokeWidth={2.5} />
        <circle
          cx={22}
          cy={22}
          r={20}
          fill="none"
          className="stroke-prop"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <UndoIcon className="size-5" />
    </button>
  );
}
