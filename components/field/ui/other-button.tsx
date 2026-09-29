"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { slideConfirm } from "@/components/field/ui/outcome-pill";
import { pulse, useInputLock } from "@/lib/field/feedback";
import {
  OTHER_IDLE,
  OTHER_MENU_OPTIONS,
  isMenuOpen,
  otherGesture,
  type OtherGestureEffect,
  type OtherGestureEvent,
  type OtherGestureState,
} from "@/lib/field/other-gesture";
import { OTHER_OUTCOMES, type OtherOutcome } from "@/lib/field/outcomes";

/**
 * OtherButton (Figma 7:8) and OtherMenu (7:9). Every rule lives in
 * `lib/field/other-gesture.ts`; this component only turns DOM events into
 * gesture events and runs the effects it gets back.
 *
 * The button captures the pointer, so every move goes to it rather than to
 * the door scroll or a pill, and `touch-action: none` stops a pan starting.
 * While the menu is open the caller should make the pills and the scroller
 * `inert` (`onOpenChange`).
 */

const LABEL: Record<OtherOutcome, string> = Object.fromEntries(
  OTHER_OUTCOMES.map((o) => [o.key, o.label]),
) as Record<OtherOutcome, string>;

function optionAt(x: number, y: number): OtherOutcome | null {
  const el = document.elementFromPoint(x, y)?.closest("[data-other-option]");
  return (el?.getAttribute("data-other-option") as OtherOutcome | null) ?? null;
}

export function OtherButton({
  onPick,
  disabled,
  onOpenChange,
}: {
  onPick: (outcome: OtherOutcome) => void;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [state, setState] = useState<OtherGestureState>(OTHER_IDLE);
  const stateRef = useRef<OtherGestureState>(OTHER_IDLE);
  const timer = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lock = useInputLock();
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const dispatchRef = useRef<(event: OtherGestureEvent) => void>(() => {});

  const run = useCallback(
    (effect: OtherGestureEffect) => {
      switch (effect.kind) {
        case "capture":
          try {
            buttonRef.current?.setPointerCapture(effect.pointerId);
          } catch {
            // The pointer is already gone; the pointercancel that follows closes the gesture.
          }
          return;
        case "startTimer":
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            timer.current = null;
            dispatchRef.current({ type: "timer", t: performance.now() });
          }, effect.ms);
          return;
        case "clearTimer":
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = null;
          return;
        case "pulse":
          pulse(effect.ms);
          return;
        case "focusRow":
          requestAnimationFrame(() => rowRefs.current[effect.index]?.focus());
          return;
        case "commit": {
          const outcome = effect.outcome;
          if (lock(() => onPickRef.current(outcome))) slideConfirm(buttonRef.current);
          return;
        }
      }
    },
    [lock],
  );

  const dispatch = useCallback(
    (event: OtherGestureEvent) => {
      const step = otherGesture(stateRef.current, event);
      stateRef.current = step.state;
      setState(step.state);
      for (const effect of step.effects) run(effect);
    },
    [run],
  );
  dispatchRef.current = dispatch;

  const open = isMenuOpen(state);
  const active = state.mode !== "idle";

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (disabled && stateRef.current.mode !== "idle") dispatch({ type: "cancel", reason: "disabled" });
  }, [disabled, dispatch]);

  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") dispatch({ type: "cancel", reason: "hidden" });
    };
    const onBlur = () => dispatch({ type: "cancel", reason: "blur" });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "cancel", reason: "escape" });
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
    };
  }, [active, dispatch]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const pointerOption = (e: ReactPointerEvent) =>
    stateRef.current.mode === "hold" ? optionAt(e.clientX, e.clientY) : null;

  const highlighted = state.mode === "hold" ? state.highlighted : null;

  return (
    <div className="relative" data-testid="other">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => {
          if (disabled) return;
          dispatch({
            type: "down",
            pointerId: e.pointerId,
            primary: e.isPrimary && e.button === 0,
            x: e.clientX,
            y: e.clientY,
            t: performance.now(),
          });
        }}
        onPointerMove={(e) =>
          dispatch({ type: "move", pointerId: e.pointerId, x: e.clientX, y: e.clientY, option: pointerOption(e) })
        }
        onPointerUp={(e) =>
          dispatch({ type: "up", pointerId: e.pointerId, t: performance.now(), option: pointerOption(e) })
        }
        onPointerCancel={(e) => dispatch({ type: "cancel", reason: "pointercancel", pointerId: e.pointerId })}
        onLostPointerCapture={(e) =>
          dispatch({ type: "cancel", reason: "lostpointercapture", pointerId: e.pointerId })
        }
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          dispatch({ type: "key", key: e.key });
        }}
        className={`flex size-[60px] touch-none select-none flex-col items-center justify-center rounded-full border border-line text-field-button-label drop-shadow-field-pill [-webkit-touch-callout:none] disabled:opacity-50 ${
          active ? "bg-ink text-surface" : "bg-surface text-ink-soft"
        }`}
        data-testid="outcome-other"
        data-gesture={state.mode}
      >
        <span aria-hidden>•••</span>
        <span>Other</span>
      </button>

      {state.mode === "tap" && (
        <div
          aria-hidden
          className="fixed inset-0 z-20"
          onClick={() => dispatch({ type: "cancel", reason: "outside" })}
          data-testid="other-scrim"
        />
      )}

      {open && (
        <div
          role="menu"
          aria-label="Other outcomes"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              dispatch({ type: "key", key: e.key });
            }
          }}
          className="absolute right-full top-0 z-30 mr-2 flex w-[220px] flex-col gap-1 rounded-field-md border border-line bg-surface p-2 shadow-field-menu"
          data-testid="other-menu"
        >
          {OTHER_MENU_OPTIONS.map((key, i) => {
            const on = highlighted === key;
            return (
              <button
                key={key}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={state.mode === "tap" && state.focused === i ? 0 : -1}
                data-other-option={key}
                onClick={() => {
                  if (stateRef.current.mode === "tap") dispatch({ type: "pick", option: key });
                }}
                className={`flex h-12 w-full items-center overflow-clip rounded-field-md px-3 text-left text-field-body-strong outline-none focus-visible:bg-ink focus-visible:text-surface ${
                  on ? "bg-ink text-surface" : "text-ink"
                }`}
              >
                {LABEL[key]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
