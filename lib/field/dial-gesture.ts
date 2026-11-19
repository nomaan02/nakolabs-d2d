import type { PrimaryOutcome } from "@/lib/field/outcomes";

/**
 * DIAL-1 (Logger V2.1, Figma "OutcomeDial 2.1" 325:796). The radial dial's
 * press-drag-release gesture as a pure state machine, in the same shape as
 * `other-gesture.ts`: `OutcomeDial` only turns DOM pointer events into
 * `DialEvent`s and runs the effects it gets back, so every rule below is
 * checked without a browser (`npm run verify:dial`).
 *
 * It is a marking menu (Kurtenbach & Buxton): press the puck and drag.
 * Up = Contact, Right = Lead, Down = Not in, Left = Rented / council. Each
 * direction owns a 90° wedge. Release outside the dead zone logs that
 * direction; drag back into the dead zone and release, and nothing is logged.
 *
 * - Tap the puck (released inside TAP_SLOP_PX within PUCK_TAP_MAX_MS, never
 *   having left the dead zone): opens Other.
 * - Press a wedge (a label, or anywhere in its quarter of the ring): the
 *   label shows pressed; releasing within TAP_SLOP_PX logs it. Moving further
 *   disarms it, so a slip never logs.
 * - pointercancel, lostpointercapture, a hidden page, window blur and Escape
 *   end the gesture with no write.
 *
 * Geometry is in the Figma frame's own units (a 224 box). The component
 * scales pointer positions into this box, so a smaller dial hit-tests the
 * same.
 */

export type DialDirection = "up" | "right" | "down" | "left";

export const DIAL_DIRECTIONS: readonly DialDirection[] = ["up", "right", "down", "left"];

/** Owner (Figma V2 brief): the direction-to-outcome mapping. Tested and fixed. */
export const DIAL_OUTCOME: Record<DialDirection, PrimaryOutcome> = {
  up: "answered",
  right: "lead",
  down: "no_answer",
  left: "no_opportunity",
};

/** Figma frame units. */
export const DIAL_BOX = 224;
export const DIAL_CENTRE = 112;
export const PUCK_HIT_R = 36;
export const DIAL_HIT_R = 112;

/** Distance (px, from the press point) before a direction is chosen. */
export const DEAD_ZONE_PX = 24;
/** Movement allowed for a tap on the puck or a label. */
export const TAP_SLOP_PX = 12;
/** A puck tap longer than this is a hold, not a tap: it opens nothing. */
export const PUCK_TAP_MAX_MS = 350;
/** Degrees past a wedge edge before the target switches (stops flicker on a boundary). */
export const HYSTERESIS_DEG = 10;

export const PRESS_PULSE_MS = 15;
export const TARGET_PULSE_MS = 8;

export type DialHit = { kind: "puck" } | { kind: "wedge"; dir: DialDirection } | { kind: "none" };

export type DialState =
  | { mode: "idle" }
  | {
      mode: "puck";
      pointerId: number;
      x0: number;
      y0: number;
      t0: number;
      target: DialDirection | null;
      /** True once the finger has left the dead zone: from then on a release there is a cancel. */
      left: boolean;
      /** Furthest distance from the press point so far. */
      travel: number;
    }
  | { mode: "wedge"; pointerId: number; x0: number; y0: number; dir: DialDirection; armed: boolean };

export type DialCancelReason = "pointercancel" | "lostpointercapture" | "hidden" | "blur" | "escape" | "disabled";

export type DialEvent =
  | { type: "down"; pointerId: number; primary: boolean; x: number; y: number; t: number; hit: DialHit }
  | { type: "move"; pointerId: number; x: number; y: number }
  | { type: "up"; pointerId: number; x: number; y: number; t: number }
  | { type: "cancel"; reason: DialCancelReason; pointerId?: number };

export type DialEffect =
  | { kind: "capture"; pointerId: number }
  | { kind: "pulse"; ms: number }
  | { kind: "commit"; dir: DialDirection }
  | { kind: "openOther" };

export type DialStep = { state: DialState; effects: DialEffect[] };

export const DIAL_IDLE: DialState = { mode: "idle" };

/** What the dial draws. Figma variants: Rest, Pressed, Contact/Lead/NotIn/Rented, Tap*. */
export type DialPhase =
  | { phase: "rest" }
  | { phase: "pressed" }
  | { phase: "choosing"; dir: DialDirection }
  | { phase: "tap"; dir: DialDirection };

export function dialPhase(state: DialState): DialPhase {
  if (state.mode === "puck") return state.target ? { phase: "choosing", dir: state.target } : { phase: "pressed" };
  if (state.mode === "wedge" && state.armed) return { phase: "tap", dir: state.dir };
  return { phase: "rest" };
}

/** Screen angle in degrees: 0 = right, 90 = down (y grows downwards), range (-180, 180]. */
export function angleOf(dx: number, dy: number): number {
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

const CENTRE_DEG: Record<DialDirection, number> = { right: 0, down: 90, left: 180, up: -90 };

function angularGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The wedge an angle falls in. With `current`, the current wedge is kept until the angle is HYSTERESIS_DEG past its edge. */
export function directionAt(angle: number, current: DialDirection | null = null): DialDirection {
  if (current && angularGap(angle, CENTRE_DEG[current]) <= 45 + HYSTERESIS_DEG) return current;
  if (angle > -45 && angle <= 45) return "right";
  if (angle > 45 && angle <= 135) return "down";
  if (angle > -135 && angle <= -45) return "up";
  return "left";
}

/** Hit-test a point in dial units (0..224 each way). */
export function hitAt(x: number, y: number): DialHit {
  const dx = x - DIAL_CENTRE;
  const dy = y - DIAL_CENTRE;
  const r = Math.hypot(dx, dy);
  if (r <= PUCK_HIT_R) return { kind: "puck" };
  if (r <= DIAL_HIT_R) return { kind: "wedge", dir: directionAt(angleOf(dx, dy)) };
  return { kind: "none" };
}

const POINTER_REASONS: ReadonlySet<DialCancelReason> = new Set(["pointercancel", "lostpointercapture"]);

function stay(state: DialState): DialStep {
  return { state, effects: [] };
}

function idle(effects: DialEffect[] = []): DialStep {
  return { state: DIAL_IDLE, effects };
}

function cancelFor(state: Exclude<DialState, { mode: "idle" }>, event: Extract<DialEvent, { type: "cancel" }>): DialStep {
  // A pointer reason for another pointer (a second finger) leaves this gesture alone.
  if (POINTER_REASONS.has(event.reason) && event.pointerId !== undefined && event.pointerId !== state.pointerId) {
    return stay(state);
  }
  return idle();
}

export function dialGesture(state: DialState, event: DialEvent): DialStep {
  switch (state.mode) {
    case "idle": {
      if (event.type !== "down" || !event.primary || event.hit.kind === "none") return stay(state);
      const capture: DialEffect = { kind: "capture", pointerId: event.pointerId };
      if (event.hit.kind === "puck") {
        return {
          state: { mode: "puck", pointerId: event.pointerId, x0: event.x, y0: event.y, t0: event.t, target: null, left: false, travel: 0 },
          effects: [capture, { kind: "pulse", ms: PRESS_PULSE_MS }],
        };
      }
      return {
        state: { mode: "wedge", pointerId: event.pointerId, x0: event.x, y0: event.y, dir: event.hit.dir, armed: true },
        effects: [capture, { kind: "pulse", ms: TARGET_PULSE_MS }],
      };
    }

    case "puck": {
      if (event.type === "cancel") return cancelFor(state, event);
      if (event.type === "down") return stay(state);
      if (event.pointerId !== state.pointerId) return stay(state);
      const dx = event.x - state.x0;
      const dy = event.y - state.y0;
      const d = Math.hypot(dx, dy);
      if (event.type === "move") {
        const travel = Math.max(state.travel, d);
        if (d < DEAD_ZONE_PX) {
          if (state.target === null && travel === state.travel) return stay(state);
          return { state: { ...state, target: null, travel }, effects: [] };
        }
        const target = directionAt(angleOf(dx, dy), state.target);
        const next: DialState = { ...state, target, left: true, travel };
        return { state: next, effects: target !== state.target ? [{ kind: "pulse", ms: TARGET_PULSE_MS }] : [] };
      }
      // up
      if (d >= DEAD_ZONE_PX) {
        return idle([{ kind: "commit", dir: state.target ?? directionAt(angleOf(dx, dy)) }]);
      }
      const tapped = !state.left && Math.max(state.travel, d) <= TAP_SLOP_PX && event.t - state.t0 <= PUCK_TAP_MAX_MS;
      return idle(tapped ? [{ kind: "openOther" }] : []);
    }

    case "wedge": {
      if (event.type === "cancel") return cancelFor(state, event);
      if (event.type === "down") return stay(state);
      if (event.pointerId !== state.pointerId) return stay(state);
      const moved = Math.hypot(event.x - state.x0, event.y - state.y0) > TAP_SLOP_PX;
      if (event.type === "move") {
        if (!state.armed || !moved) return stay(state);
        return { state: { ...state, armed: false }, effects: [] };
      }
      return idle(state.armed && !moved ? [{ kind: "commit", dir: state.dir }] : []);
    }
  }
}
