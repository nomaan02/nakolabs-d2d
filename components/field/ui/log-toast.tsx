"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { CheckLineIcon, QueuedLineIcon, UndoLineIcon } from "@/components/field/icons";
import { prefersReducedMotion } from "@/components/field/ui/outcome-pill";
import { pulse } from "@/lib/field/feedback";
import { takeUndo, useUndoTarget, type UndoTarget } from "@/lib/field/undo";
import { UNDO_WINDOW_MS } from "@/lib/sync/queue";

/**
 * LogToast: Figma "LogToast 2.1" (327:961), Logger V2.1 dial layout. Shows
 * for the undo window (60 s) after a log, over the stats rail. Undo sits next
 * to the confirmation of what was logged; it replaces the floating undo ring.
 *
 * - 350 x 56 (fills the dock less 16 each side), `ink`, radius 16, padding 4
 *   right and 12 left, `field/float` shadow. A light island in dark mode.
 * - Badge 32: a green check when sent, a neutral clock when the phone is
 *   offline and the log is queued (glyph and words change, not colour alone).
 * - Title 13/18 semibold `paper`; detail 12/16 `on-ink-muted`.
 * - Undo: 48 tall, radius 12 (16 less the 4 inset), `on-ink-wash`, pressed
 *   `on-ink-wash-strong`.
 * - Countdown: a 2 px bar along the bottom, shrinking to nothing over the
 *   time left (transform only).
 *
 * One target, from `useUndoTarget` (lib/field/undo.ts), exactly as the undo
 * ring: undoing deletes the held outbox row, so nothing has reached Postgres.
 * `hidden` keeps it out of sight without dismissing it: while the dial is in
 * use, and while the dial's logged frame plays, so the readout above the
 * ring is never covered. It slides in (8px, 220 ms) when it may show.
 */

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const ENTER_MS = 220;
const EXIT_MS = 160;

export function LogToast({ hidden = false }: { hidden?: boolean }) {
  const target = useUndoTarget();
  const [shown, setShown] = useState<UndoTarget | null>(target);
  const [leaving, setLeaving] = useState(false);
  const [entered, setEntered] = useState(false);
  const [busy, setBusy] = useState(false);
  const barRef = useRef<HTMLSpanElement>(null);

  // Presence: keep the last target on screen while it fades out.
  useEffect(() => {
    if (target) {
      setShown(target);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const id = window.setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, EXIT_MS);
    return () => window.clearTimeout(id);
    // `shown` is read, not tracked: only a change of target starts an exit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // A new target starts below and transparent, then slides in once it may show.
  useEffect(() => {
    setEntered(false);
  }, [target]);
  useEffect(() => {
    if (!target || hidden || entered) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [target, hidden, entered]);

  // The countdown runs from the log, whether or not the toast is showing yet.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!target || !bar || typeof bar.animate !== "function") return;
    const left = Math.max(0, target.expiresAt - Date.now());
    const animation = bar.animate(
      [{ transform: `scaleX(${Math.min(1, left / UNDO_WINDOW_MS)})` }, { transform: "scaleX(0)" }],
      { duration: left, easing: "linear", fill: "forwards" },
    );
    return () => animation.cancel();
  }, [target]);

  if (!shown) return null;

  const queued = shown.tone === "queued";
  const title = shown.title ?? shown.description;
  const secondsLeft = Math.max(0, Math.ceil((shown.expiresAt - Date.now()) / 1000));
  const visible = entered && !hidden && !leaving;
  const still = prefersReducedMotion();

  return (
    <div
      role="status"
      data-theme-island="light"
      className="relative flex h-14 items-center gap-3 overflow-hidden rounded-field-lg bg-ink py-1 pr-1 pl-3 shadow-field-float"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible || still ? "translateY(0)" : leaving ? "translateY(4px)" : "translateY(8px)",
        pointerEvents: visible ? undefined : "none",
        transition: leaving
          ? `opacity ${EXIT_MS}ms ${EASE}, transform ${EXIT_MS}ms ${EASE}`
          : `opacity ${ENTER_MS}ms ${EASE}, transform ${ENTER_MS}ms ${EASE}`,
      }}
      aria-hidden={visible ? undefined : true}
      data-testid="log-toast"
      data-tone={queued ? "queued" : "sent"}
      data-visible={visible ? "true" : "false"}
    >
      <span
        aria-hidden
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          queued ? "bg-on-ink-wash-strong text-paper" : "bg-outcome-lead text-outcome-on-pill"
        }`}
      >
        {queued ? <QueuedLineIcon className="size-4" stroke={2} /> : <CheckLineIcon className="size-4" stroke={2} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-field-body-strong text-paper" data-testid="log-toast-title">
          {title}
        </p>
        {shown.detail ? (
          <p className="truncate text-field-detail text-on-ink-muted" data-testid="log-toast-detail">
            {shown.detail}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={busy || !visible}
        aria-label={`Undo ${shown.description}. ${secondsLeft} seconds left.`}
        onClick={() => {
          setBusy(true);
          void takeUndo()
            .then((undone) => {
              if (undone) pulse(25);
            })
            .finally(() => setBusy(false));
        }}
        className="flex h-12 shrink-0 items-center gap-2 rounded-field-md bg-on-ink-wash px-3 text-field-body-strong text-paper transition-colors duration-100 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper active:bg-on-ink-wash-strong disabled:opacity-60"
        data-testid="log-toast-undo"
      >
        <UndoLineIcon className="size-4" stroke={1.5} />
        Undo
      </button>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-on-ink-wash" />
      <span
        ref={barRef}
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-0.5 origin-left ${queued ? "bg-on-ink-muted" : "bg-outcome-lead"}`}
        data-testid="log-toast-countdown"
      />
    </div>
  );
}
