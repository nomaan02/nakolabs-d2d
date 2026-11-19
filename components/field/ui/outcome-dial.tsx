"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  CheckLineIcon,
  DoorLineIcon,
  KeyLineIcon,
  MessageLineIcon,
  StarLineIcon,
} from "@/components/field/icons";
import { prefersReducedMotion } from "@/components/field/ui/outcome-pill";
import {
  DIAL_BOX,
  DIAL_CENTRE,
  DIAL_DIRECTIONS,
  DIAL_IDLE,
  DIAL_OUTCOME,
  dialGesture,
  dialPhase,
  hitAt,
  type DialDirection,
  type DialEffect,
  type DialEvent,
  type DialState,
} from "@/lib/field/dial-gesture";
import { pulse, useInputLock } from "@/lib/field/feedback";
import { OTHER_OUTCOMES, type OtherOutcome, type PrimaryOutcome } from "@/lib/field/outcomes";

/**
 * OutcomeDial: Figma "OutcomeDial 2.1" (325:796), Logger V2.1. Built 1:1
 * from the component set's own numbers, in its own 224 frame units:
 *
 * - Face: 184 circle, `field-bg`. Wedge dividers on the diagonals, r 44-90,
 *   1px `ink-faint`, opacity 0.4 at rest, 0.6 pressed, 0 while choosing.
 * - Arcs: outer radius 98, each 74° (16° gaps), `outcome/*` colours. Width 6
 *   at rest, 10 pressed, 14 for the target while choosing; the others drop
 *   to 40%.
 * - Labels: icon 20 + 4 + label (11/14 semibold), centred at (112,48),
 *   (176,112), (112,176), (48,112), each a 44 x 44 minimum target. While
 *   choosing, the target's label hides (the readout names it) and the
 *   others turn `ink-muted` at full opacity: neutral, never faint, so they
 *   still read in sunlight.
 * - Puck: 72 `puck` (#303337), inner ring inset 8, three 4px dots (tap =
 *   Other). Pressed: 68, an 88 halo at 8% ink, the lighter shadow. Choosing:
 *   moves 16 towards the target over a 30% trail in the target's colour.
 * - Readout: a 28 pill above the ring, "Release · Lead", in the target's
 *   dark colour, where the thumb cannot cover it.
 * - Logged: the ring fills in the outcome's colour, the puck turns that
 *   colour with a check, the readout says "Logged · Lead", then it rests.
 *
 * The gesture rules live in `lib/field/dial-gesture.ts`; this component
 * only feeds it pointer events and draws `dialPhase`. Motion uses the
 * transform, opacity and stroke-width of a few layers, never layout.
 * Under prefers-reduced-motion nothing travels or sweeps: states swap and
 * the logged frame fades.
 *
 * The dial is a light island in dark mode, like the outcome pills
 * (owner H1-H4), so it looks the same on a dark dock.
 */

export type DialLoggedTone = DialDirection | "other";

/** Bump `key` after a log is queued to play the logged frame. */
export type DialLogged = { key: number; tone: DialLoggedTone; label: string };

type DirSpec = {
  label: string;
  /** The line under the label (Rented only). */
  sub?: string;
  /** The readout's words. */
  name: string;
  Icon: ComponentType<{ className?: string; stroke?: number }>;
  /** Label and icon colour at rest (7:1 on the face). */
  ink: string;
  /** Readout and logged-puck fill. */
  fill: string;
  /** Arc colour (a CSS colour). */
  arc: string;
  /** Arc start angle, degrees, 0 = right, clockwise. Every arc is 74°. */
  start: number;
  centre: readonly [number, number];
  /** Unit vector towards the target, for the puck's 16 px travel. */
  unit: readonly [number, number];
  /** Trail rotation: the trail is drawn pointing up. */
  turn: number;
};

const DIR: Record<DialDirection, DirSpec> = {
  up: {
    label: "Contact",
    name: "Contact",
    Icon: MessageLineIcon,
    ink: "text-prop",
    fill: "bg-prop",
    arc: "var(--color-outcome-contact)",
    start: -127,
    centre: [112, 48],
    unit: [0, -1],
    turn: 0,
  },
  right: {
    label: "Lead",
    name: "Lead",
    Icon: StarLineIcon,
    ink: "text-outcome-lead-ink",
    fill: "bg-outcome-lead-ink",
    arc: "var(--color-outcome-lead)",
    start: -37,
    centre: [176, 112],
    unit: [1, 0],
    turn: 90,
  },
  down: {
    label: "Not in",
    name: "Not in",
    Icon: DoorLineIcon,
    ink: "text-ink-soft",
    fill: "bg-ink-soft",
    arc: "var(--color-outcome-notin)",
    start: 53,
    centre: [112, 176],
    unit: [0, 1],
    turn: 180,
  },
  left: {
    label: "Rented",
    sub: "/ council",
    name: "Rented / council",
    Icon: KeyLineIcon,
    ink: "text-outcome-rented-ink",
    fill: "bg-outcome-rented-ink",
    arc: "var(--color-outcome-rented-edge)",
    start: 143,
    centre: [48, 112],
    unit: [-1, 0],
    turn: 270,
  },
};

const ARC_R = 98;
const ARC_SPAN = 74;
const ARC_REST = 6;
const ARC_PRESSED = 10;
const ARC_TARGET = 14;
const RING_LOGGED = 10;
const PUCK = 72;
const PUCK_PRESSED = 68;
const PUCK_TRAVEL = 16;
const HALO = 88;

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const FAST_MS = 120;
const BASE_MS = 160;
const PUCK_MS = 140;
const SWEEP_MS = 320;
const LOGGED_HOLD_MS = 900;
const LOGGED_FADE_MS = 200;

const T_FAST = `opacity ${FAST_MS}ms ${EASE}, color ${FAST_MS}ms ${EASE}`;

const LOGGED_FILL: Record<DialLoggedTone, string> = {
  up: "bg-prop",
  right: "bg-outcome-lead-ink",
  down: "bg-ink-soft",
  left: "bg-outcome-rented-ink",
  other: "bg-ink-soft",
};

const LOGGED_RING: Record<DialLoggedTone, string> = {
  up: "var(--color-outcome-contact)",
  right: "var(--color-outcome-lead)",
  down: "var(--color-outcome-notin)",
  left: "var(--color-outcome-rented-edge)",
  other: "var(--color-outcome-notin)",
};

/** Where the logged ring's sweep starts: the middle of the wedge, or the top for Other. */
const SWEEP_FROM: Record<DialLoggedTone, number> = { up: -90, right: 0, down: 90, left: 180, other: -90 };

const OTHER_LABEL: Record<OtherOutcome, string> = Object.fromEntries(
  OTHER_OUTCOMES.map((spec) => [spec.key, spec.label]),
) as Record<OtherOutcome, string>;

function toDial(e: { clientX: number; clientY: number }, box: HTMLElement): { x: number; y: number } {
  const rect = box.getBoundingClientRect();
  const k = rect.width / DIAL_BOX || 1;
  return { x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k };
}

export function OutcomeDial({
  onPick,
  onOther,
  logged,
  disabled,
  onActiveChange,
  onLoggedChange,
}: {
  onPick: (outcome: PrimaryOutcome) => void;
  onOther: (outcome: OtherOutcome) => void;
  logged: DialLogged | null;
  disabled?: boolean;
  /** True from touch-down until release: the Logger dims the glance zone and fades the numbers. */
  onActiveChange?: (active: boolean) => void;
  /** True while the logged frame plays (about 1.1 s): the Logger holds the toast back until it ends. */
  onLoggedChange?: (playing: boolean) => void;
}) {
  const [state, setState] = useState<DialState>(DIAL_IDLE);
  const stateRef = useRef<DialState>(DIAL_IDLE);
  const boxRef = useRef<HTMLDivElement>(null);
  const puckRef = useRef<HTMLButtonElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const checkRef = useRef<SVGSVGElement>(null);
  const lock = useInputLock();
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [menuOpen, setMenuOpen] = useState(false);
  const [shownLog, setShownLog] = useState<DialLogged | null>(null);
  const [logFading, setLogFading] = useState(false);
  const firstLogKey = useRef(logged?.key ?? 0);
  const clipId = `dial-arc-clip-${useId().replace(/:/g, "")}`;

  const run = useCallback(
    (effect: DialEffect) => {
      switch (effect.kind) {
        case "capture":
          try {
            boxRef.current?.setPointerCapture(effect.pointerId);
          } catch {
            // The pointer is already gone; the pointercancel that follows ends the gesture.
          }
          return;
        case "pulse":
          pulse(effect.ms);
          return;
        case "commit": {
          const outcome = DIAL_OUTCOME[effect.dir];
          lock(() => onPickRef.current(outcome));
          return;
        }
        case "openOther":
          setMenuOpen(true);
          return;
      }
    },
    [lock],
  );

  const dispatch = useCallback(
    (event: DialEvent) => {
      const step = dialGesture(stateRef.current, event);
      stateRef.current = step.state;
      setState(step.state);
      for (const effect of step.effects) run(effect);
    },
    [run],
  );

  const view = dialPhase(state);
  const active = view.phase !== "rest";

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  const playing = shownLog !== null;
  useEffect(() => {
    onLoggedChange?.(playing);
  }, [playing, onLoggedChange]);

  useEffect(() => {
    if (disabled && stateRef.current.mode !== "idle") dispatch({ type: "cancel", reason: "disabled" });
  }, [disabled, dispatch]);

  useEffect(() => {
    if (state.mode === "idle") return;
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
  }, [state.mode, dispatch]);

  // The logged frame: plays when the caller bumps `logged.key` (after the write is queued).
  useEffect(() => {
    if (!logged || logged.key === firstLogKey.current) return;
    firstLogKey.current = logged.key;
    const reduced = prefersReducedMotion();
    setShownLog(logged);
    setLogFading(false);
    const hold = reduced ? 700 : LOGGED_HOLD_MS;
    const fade = window.setTimeout(() => setLogFading(true), hold);
    const done = window.setTimeout(() => {
      setShownLog(null);
      setLogFading(false);
    }, hold + LOGGED_FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [logged]);

  // Sweep the ring and draw the check once the logged layer is in the DOM.
  useLayoutEffect(() => {
    const ring = ringRef.current;
    // A finished ring has no dash, so no hairline where the sweep began.
    const close = () => {
      if (ring) ring.style.strokeDasharray = "none";
    };
    if (!shownLog) return;
    if (prefersReducedMotion() || !ring || typeof ring.animate !== "function") {
      close();
      return;
    }
    const check = checkRef.current?.querySelector("path");
    const sweep = ring.animate([{ strokeDashoffset: 360 }, { strokeDashoffset: 0 }], {
      duration: SWEEP_MS,
      easing: EASE,
    });
    sweep.onfinish = close;
    if (check && typeof check.animate === "function") {
      check.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 1, offset: 0.3 }, { strokeDashoffset: 0 }], {
        duration: 260,
        easing: EASE,
      });
    }
    return () => {
      sweep.onfinish = null;
    };
  }, [shownLog]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || menuOpen || !boxRef.current) return;
    if (shownLog) {
      setShownLog(null);
      setLogFading(false);
    }
    const p = toDial(e, boxRef.current);
    dispatch({
      type: "down",
      pointerId: e.pointerId,
      primary: e.isPrimary && e.button === 0,
      x: p.x,
      y: p.y,
      t: performance.now(),
      hit: hitAt(p.x, p.y),
    });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stateRef.current.mode === "idle" || !boxRef.current) return;
    const p = toDial(e, boxRef.current);
    dispatch({ type: "move", pointerId: e.pointerId, x: p.x, y: p.y });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (stateRef.current.mode === "idle" || !boxRef.current) return;
    const p = toDial(e, boxRef.current);
    dispatch({ type: "up", pointerId: e.pointerId, x: p.x, y: p.y, t: performance.now() });
  };

  const logging = shownLog !== null;
  const phase = logging ? "logged" : view.phase;
  const target = view.phase === "choosing" || view.phase === "tap" ? view.dir : null;

  const dividerOpacity = phase === "rest" ? 0.4 : phase === "pressed" ? 0.6 : 0;
  const puckSize = phase === "pressed" ? PUCK_PRESSED : PUCK;
  const travel = view.phase === "choosing" ? DIR[view.dir].unit : ([0, 0] as const);
  const showDots = phase === "rest" || phase === "pressed" || phase === "tap";

  return (
    <div className="relative" data-theme-island="light" data-testid="outcome-dial" data-phase={phase}>
      <div
        className="relative"
        style={{ width: `calc(${DIAL_BOX}px * var(--dial-scale, 1))`, height: `calc(${DIAL_BOX}px * var(--dial-scale, 1))` }}
      >
        <div
          ref={boxRef}
          role="group"
          aria-label="Log this door"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => dispatch({ type: "cancel", reason: "pointercancel", pointerId: e.pointerId })}
          onLostPointerCapture={(e) => dispatch({ type: "cancel", reason: "lostpointercapture", pointerId: e.pointerId })}
          onContextMenu={(e) => e.preventDefault()}
          className="absolute top-0 left-0 size-[224px] origin-top-left touch-none select-none [-webkit-touch-callout:none]"
          style={{ transform: "scale(var(--dial-scale, 1))" }}
          aria-disabled={disabled || undefined}
        >
          <svg aria-hidden width={DIAL_BOX} height={DIAL_BOX} viewBox="0 0 224 224" className="absolute inset-0 overflow-visible">
            <defs>
              <clipPath id={clipId}>
                <circle cx={DIAL_CENTRE} cy={DIAL_CENTRE} r={ARC_R} />
              </clipPath>
            </defs>
            <circle cx={DIAL_CENTRE} cy={DIAL_CENTRE} r={92} fill="var(--color-field-bg)" />
            <g
              stroke="var(--color-ink-faint)"
              strokeWidth={1}
              strokeLinecap="round"
              style={{ opacity: dividerOpacity, transition: `opacity ${BASE_MS}ms ${EASE}` }}
            >
              {[45, 135, 225, 315].map((deg) => {
                const a = (deg * Math.PI) / 180;
                return (
                  <line
                    key={deg}
                    x1={DIAL_CENTRE + 44 * Math.cos(a)}
                    y1={DIAL_CENTRE + 44 * Math.sin(a)}
                    x2={DIAL_CENTRE + 90 * Math.cos(a)}
                    y2={DIAL_CENTRE + 90 * Math.sin(a)}
                  />
                );
              })}
            </g>
            <g clipPath={`url(#${clipId})`}>
              {DIAL_DIRECTIONS.map((dir) => {
                const spec = DIR[dir];
                const width =
                  phase === "pressed"
                    ? ARC_PRESSED
                    : target === dir
                      ? view.phase === "tap"
                        ? ARC_PRESSED
                        : ARC_TARGET
                      : ARC_REST;
                const opacity = phase === "logged" ? 0 : target !== null && target !== dir ? 0.4 : 1;
                return (
                  <circle
                    key={dir}
                    data-arc={dir}
                    cx={DIAL_CENTRE}
                    cy={DIAL_CENTRE}
                    r={ARC_R}
                    fill="none"
                    stroke={spec.arc}
                    pathLength={360}
                    strokeDasharray={`${ARC_SPAN} ${360 - ARC_SPAN}`}
                    strokeDashoffset={-((spec.start + 360) % 360)}
                    style={{
                      strokeWidth: width * 2,
                      opacity,
                      transition: `stroke-width ${BASE_MS}ms ${EASE}, opacity ${BASE_MS}ms ${EASE}`,
                    }}
                  />
                );
              })}
              {shownLog ? (
                <circle
                  ref={ringRef}
                  cx={DIAL_CENTRE}
                  cy={DIAL_CENTRE}
                  r={ARC_R}
                  fill="none"
                  stroke={LOGGED_RING[shownLog.tone]}
                  pathLength={360}
                  strokeDasharray="360 360"
                  strokeDashoffset={0}
                  transform={`rotate(${SWEEP_FROM[shownLog.tone]} ${DIAL_CENTRE} ${DIAL_CENTRE})`}
                  style={{
                    strokeWidth: RING_LOGGED * 2,
                    opacity: logFading ? 0 : 1,
                    transition: `opacity ${LOGGED_FADE_MS}ms ${EASE}`,
                  }}
                  data-testid="dial-logged-ring"
                />
              ) : null}
            </g>
          </svg>

          {/* Press wash: a label pressed directly (Figma Tap* variants). */}
          {view.phase === "tap" ? (
            <span
              aria-hidden
              className="pointer-events-none absolute size-14 rounded-full opacity-20"
              style={{
                left: DIR[view.dir].centre[0] - 28,
                top: DIR[view.dir].centre[1] - 28,
                background: `radial-gradient(circle, ${DIR[view.dir].arc} 0%, ${DIR[view.dir].arc} 45%, transparent 72%)`,
              }}
            />
          ) : null}

          {DIAL_DIRECTIONS.map((dir) => {
            const spec = DIR[dir];
            const hidden = phase === "logged" || (view.phase === "choosing" && view.dir === dir);
            const neutral = target !== null && target !== dir;
            const ink = neutral ? "text-ink-muted" : spec.ink;
            return (
              <button
                key={dir}
                type="button"
                tabIndex={hidden ? -1 : 0}
                aria-label={`Log ${spec.name}`}
                disabled={disabled}
                onClick={(e) => {
                  // Pointer presses are handled by the gesture; this is the keyboard path.
                  if (e.detail !== 0) return;
                  lock(() => onPickRef.current(DIAL_OUTCOME[dir]));
                }}
                className={`absolute flex min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-field-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${ink}`}
                style={{ left: spec.centre[0], top: spec.centre[1], opacity: hidden ? 0 : 1, transition: T_FAST }}
                data-testid={`dial-${dir}`}
                data-outcome={DIAL_OUTCOME[dir]}
              >
                <spec.Icon className="size-5 shrink-0" stroke={1.75} />
                <span className="flex flex-col items-center">
                  <span className="whitespace-nowrap text-field-tab-label">{spec.label}</span>
                  {spec.sub ? (
                    <span className={`whitespace-nowrap text-field-caption-xs ${neutral ? "text-ink-muted" : "text-ink-soft"}`}>
                      {spec.sub}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}

          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full bg-ink"
            style={{
              left: DIAL_CENTRE - HALO / 2,
              top: DIAL_CENTRE - HALO / 2,
              width: HALO,
              height: HALO,
              opacity: phase === "pressed" ? 0.08 : 0,
              transition: `opacity ${BASE_MS}ms ${EASE}`,
            }}
          />

          {/* Drag trail, drawn pointing up and turned to the target (Figma "Drag trail"). */}
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-full"
            style={{
              left: DIAL_CENTRE - PUCK / 2,
              top: DIAL_CENTRE - PUCK / 2 - PUCK_TRAVEL,
              width: PUCK,
              height: PUCK + PUCK_TRAVEL,
              transformOrigin: `${PUCK / 2}px ${PUCK / 2 + PUCK_TRAVEL}px`,
              background: view.phase === "choosing" ? DIR[view.dir].arc : "transparent",
              opacity: view.phase === "choosing" ? 0.3 : 0,
              transform: `rotate(${view.phase === "choosing" ? DIR[view.dir].turn : 0}deg)`,
              transition: `opacity ${FAST_MS}ms ${EASE}`,
            }}
            data-testid="dial-trail"
          />

          <button
            ref={puckRef}
            type="button"
            aria-label="Other outcomes"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={disabled}
            onClick={(e) => {
              if (e.detail !== 0) return;
              setMenuOpen(true);
            }}
            className={`absolute flex items-center justify-center overflow-hidden rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
              shownLog ? LOGGED_FILL[shownLog.tone] : "bg-puck"
            }`}
            style={
              {
                left: DIAL_CENTRE - PUCK / 2,
                top: DIAL_CENTRE - PUCK / 2,
                width: PUCK,
                height: PUCK,
                transform: `translate(${travel[0] * PUCK_TRAVEL}px, ${travel[1] * PUCK_TRAVEL}px) scale(${puckSize / PUCK})`,
                boxShadow: phase === "pressed" ? "var(--shadow-field-puck-pressed)" : "var(--shadow-field-puck)",
                transition: `transform ${PUCK_MS}ms ${EASE}, box-shadow ${BASE_MS}ms ${EASE}, background-color ${BASE_MS}ms ${EASE}`,
              } as CSSProperties
            }
            data-testid="dial-puck"
          >
            <span aria-hidden className="pointer-events-none absolute inset-2 rounded-full border border-on-ink-wash" />
            <span
              aria-hidden
              className="flex gap-1"
              style={{ opacity: showDots && !shownLog ? 1 : 0, transition: T_FAST }}
            >
              <span className="size-1 rounded-full bg-on-ink-muted" />
              <span className="size-1 rounded-full bg-on-ink-muted" />
              <span className="size-1 rounded-full bg-on-ink-muted" />
            </span>
            {shownLog ? (
              <svg
                ref={checkRef}
                aria-hidden
                viewBox="0 0 24 24"
                className="absolute size-6 text-outcome-on-pill"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ opacity: logFading ? 0 : 1, transition: `opacity ${LOGGED_FADE_MS}ms ${EASE}` }}
              >
                <path d="M20 6L9 17L4 12" pathLength={1} strokeDasharray={1} strokeDashoffset={0} />
              </svg>
            ) : null}
          </button>

          <Readout view={view} logged={shownLog} fading={logFading} />
        </div>
      </div>

      {menuOpen ? (
        <DialOtherMenu
          anchor={puckRef.current}
          onPick={(outcome) => {
            setMenuOpen(false);
            lock(() => onOther(outcome));
          }}
          onClose={() => {
            setMenuOpen(false);
            puckRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** The 28 px pill above the ring: "Release · Lead", then "Logged · Lead". */
function Readout({
  view,
  logged,
  fading,
}: {
  view: ReturnType<typeof dialPhase>;
  logged: DialLogged | null;
  fading: boolean;
}) {
  let content: { fill: string; Icon: DirSpec["Icon"]; text: string } | null = null;
  if (logged) {
    content = { fill: LOGGED_FILL[logged.tone], Icon: CheckLineIcon, text: `Logged · ${logged.label}` };
  } else if (view.phase === "choosing" || view.phase === "tap") {
    const spec = DIR[view.dir];
    content = { fill: spec.fill, Icon: spec.Icon, text: `Release · ${spec.name}` };
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -top-7 left-0 flex w-[224px] justify-center"
      style={{
        opacity: content && !fading ? 1 : 0,
        transform: content ? "translateY(0)" : "translateY(4px)",
        transition: `opacity ${FAST_MS}ms ${EASE}, transform ${FAST_MS}ms ${EASE}`,
      }}
      data-testid="dial-readout"
    >
      {content ? (
        <span
          className={`flex h-7 items-center gap-1 rounded-full pr-3 pl-2 text-field-button-label whitespace-nowrap text-outcome-on-pill shadow-field-float ${content.fill}`}
        >
          <content.Icon className="size-4 shrink-0" stroke={logged ? 2 : 1.5} />
          {content.text}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Other, from a tap on the puck. Same rows as the V1 Other menu (Figma 7:9),
 * opened above the dial. Tap a row to log it; tap outside or Escape closes.
 */
function DialOtherMenu({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  onPick: (outcome: OtherOutcome) => void;
  onClose: () => void;
}) {
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    const width = 220;
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 16);
    setPos({ left, bottom: window.innerHeight - rect.top + 12, maxHeight: rect.top - 12 - 16 });
  }, [anchor]);

  useEffect(() => {
    requestAnimationFrame(() => rows.current[0]?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-20" onClick={onClose} data-testid="dial-other-scrim" />
      <div
        role="menu"
        aria-label="Other outcomes"
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          const i = rows.current.findIndex((el) => el === document.activeElement);
          const next = e.key === "ArrowDown" ? Math.min(rows.current.length - 1, i + 1) : Math.max(0, i - 1);
          rows.current[next]?.focus();
        }}
        className="fixed z-30 flex w-[220px] flex-col gap-1 overflow-y-auto rounded-field-md border border-line bg-surface p-2 shadow-field-menu"
        style={pos ? { left: pos.left, bottom: pos.bottom, maxHeight: pos.maxHeight } : { visibility: "hidden" }}
        data-testid="dial-other-menu"
      >
        {OTHER_OUTCOMES.map((spec, i) => (
          <button
            key={spec.key}
            ref={(el) => {
              rows.current[i] = el;
            }}
            type="button"
            role="menuitem"
            onClick={() => onPick(spec.key)}
            className="flex h-12 w-full items-center rounded-field-md px-3 text-left text-field-body-strong text-ink outline-none focus-visible:bg-ink focus-visible:text-surface active:bg-ink active:text-surface"
            data-testid={`dial-other-${spec.key}`}
          >
            {OTHER_LABEL[spec.key]}
          </button>
        ))}
      </div>
    </>
  );
}
