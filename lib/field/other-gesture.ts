import { OTHER_OUTCOMES, type OtherOutcome } from "@/lib/field/outcomes";

/**
 * The Other button's hold-slide-tap gesture as a pure state machine
 * (UI item 1, Session B2). `OtherButton` only translates DOM pointer,
 * key and window events into `OtherGestureEvent`s and runs the returned
 * effects, so every rule below is testable without a browser
 * (`scripts/verify-ui-1-logger.ts`).
 *
 * - Hold (>= HOLD_MS, moved <= MOVE_CANCEL_PX): the menu opens under the
 *   thumb. Releasing on an option commits it; releasing anywhere else
 *   commits nothing.
 * - Tap (released before HOLD_MS): the menu opens as ordinary buttons.
 * - pointercancel, lostpointercapture, hidden page, window blur and Esc
 *   close the menu with no write.
 *
 * The option list is flat. "Do not call again" is a compliance outcome and
 * is always one slide away, never behind a sub-menu.
 */

export const HOLD_MS = 350;
export const MOVE_CANCEL_PX = 12;
export const HOLD_OPEN_PULSE_MS = 15;
export const HIGHLIGHT_PULSE_MS = 8;

export const OTHER_MENU_OPTIONS: readonly OtherOutcome[] = OTHER_OUTCOMES.map((o) => o.key);

export type OtherGestureState =
  | { mode: "idle" }
  | { mode: "pressing"; pointerId: number; x: number; y: number; t: number }
  | { mode: "hold"; pointerId: number; highlighted: OtherOutcome | null }
  | { mode: "tap"; focused: number };

export type OtherCancelReason =
  | "pointercancel"
  | "lostpointercapture"
  | "hidden"
  | "blur"
  | "escape"
  | "outside"
  | "disabled";

export type OtherGestureEvent =
  | { type: "down"; pointerId: number; primary: boolean; x: number; y: number; t: number }
  | { type: "move"; pointerId: number; x: number; y: number; option: OtherOutcome | null }
  | { type: "timer"; t: number }
  | { type: "up"; pointerId: number; t: number; option: OtherOutcome | null }
  | { type: "cancel"; reason: OtherCancelReason; pointerId?: number }
  | { type: "key"; key: string }
  | { type: "pick"; option: OtherOutcome };

export type OtherGestureEffect =
  | { kind: "capture"; pointerId: number }
  | { kind: "startTimer"; ms: number }
  | { kind: "clearTimer" }
  | { kind: "pulse"; ms: number }
  | { kind: "focusRow"; index: number }
  | { kind: "commit"; outcome: OtherOutcome };

export type OtherGestureStep = { state: OtherGestureState; effects: OtherGestureEffect[] };

export const OTHER_IDLE: OtherGestureState = { mode: "idle" };

export function isMenuOpen(state: OtherGestureState): boolean {
  return state.mode === "hold" || state.mode === "tap";
}

const POINTER_REASONS: ReadonlySet<OtherCancelReason> = new Set(["pointercancel", "lostpointercapture"]);

function idle(effects: OtherGestureEffect[] = []): OtherGestureStep {
  return { state: OTHER_IDLE, effects };
}

function stay(state: OtherGestureState): OtherGestureStep {
  return { state, effects: [] };
}

function openTap(): OtherGestureStep {
  return { state: { mode: "tap", focused: 0 }, effects: [{ kind: "focusRow", index: 0 }] };
}

export function otherGesture(state: OtherGestureState, event: OtherGestureEvent): OtherGestureStep {
  switch (state.mode) {
    case "idle": {
      if (event.type === "down") {
        if (!event.primary) return stay(state);
        return {
          state: { mode: "pressing", pointerId: event.pointerId, x: event.x, y: event.y, t: event.t },
          effects: [
            { kind: "capture", pointerId: event.pointerId },
            { kind: "startTimer", ms: HOLD_MS },
          ],
        };
      }
      if (event.type === "key" && (event.key === "Enter" || event.key === " ")) return openTap();
      return stay(state);
    }

    case "pressing": {
      if (event.type === "cancel") {
        if (POINTER_REASONS.has(event.reason) && event.pointerId !== undefined && event.pointerId !== state.pointerId) {
          return stay(state);
        }
        return idle([{ kind: "clearTimer" }]);
      }
      if (event.type === "move") {
        if (event.pointerId !== state.pointerId) return stay(state);
        if (Math.hypot(event.x - state.x, event.y - state.y) > MOVE_CANCEL_PX) {
          return idle([{ kind: "clearTimer" }]);
        }
        return stay(state);
      }
      if (event.type === "timer") {
        if (event.t - state.t < HOLD_MS) return stay(state);
        return {
          state: { mode: "hold", pointerId: state.pointerId, highlighted: null },
          effects: [{ kind: "pulse", ms: HOLD_OPEN_PULSE_MS }],
        };
      }
      if (event.type === "up") {
        if (event.pointerId !== state.pointerId) return stay(state);
        // A late timer: held long enough but the menu never opened, so the
        // finger cannot be on an option. That is a release off the menu.
        if (event.t - state.t >= HOLD_MS) return idle([{ kind: "clearTimer" }]);
        const step = openTap();
        return { state: step.state, effects: [{ kind: "clearTimer" }, ...step.effects] };
      }
      return stay(state);
    }

    case "hold": {
      if (event.type === "cancel") {
        if (POINTER_REASONS.has(event.reason) && event.pointerId !== undefined && event.pointerId !== state.pointerId) {
          return stay(state);
        }
        return idle();
      }
      if (event.type === "key" && event.key === "Escape") return idle();
      if (event.type === "move") {
        if (event.pointerId !== state.pointerId || event.option === state.highlighted) return stay(state);
        return {
          state: { ...state, highlighted: event.option },
          effects: event.option ? [{ kind: "pulse", ms: HIGHLIGHT_PULSE_MS }] : [],
        };
      }
      if (event.type === "up") {
        if (event.pointerId !== state.pointerId) return stay(state);
        return event.option ? idle([{ kind: "commit", outcome: event.option }]) : idle();
      }
      return stay(state);
    }

    case "tap": {
      if (event.type === "cancel") {
        // No pointer is captured in tap mode; the lostpointercapture that
        // follows the opening tap's pointerup must not close the menu.
        if (POINTER_REASONS.has(event.reason)) return stay(state);
        return idle();
      }
      if (event.type === "pick") return idle([{ kind: "commit", outcome: event.option }]);
      if (event.type === "key") {
        const last = OTHER_MENU_OPTIONS.length - 1;
        if (event.key === "Escape") return idle();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const focused =
            event.key === "ArrowDown" ? Math.min(last, state.focused + 1) : Math.max(0, state.focused - 1);
          return { state: { mode: "tap", focused }, effects: [{ kind: "focusRow", index: focused }] };
        }
        if (event.key === "Enter" || event.key === " ") {
          return idle([{ kind: "commit", outcome: OTHER_MENU_OPTIONS[state.focused] }]);
        }
      }
      return stay(state);
    }
  }
}
