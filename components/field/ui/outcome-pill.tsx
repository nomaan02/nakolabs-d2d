"use client";

import { useEffect, useRef, type ComponentType } from "react";

import { ChevronIcon, HouseIcon, HouseOutlineIcon, SpeechIcon, StarIcon } from "@/components/field/icons";
import { useInputLock } from "@/lib/field/feedback";
import { PRIMARY_OUTCOMES, type PrimaryOutcome } from "@/lib/field/outcomes";

/**
 * OutcomeButton (Figma 6:58): a 140px pill with the 84px white circle at
 * its left, meant to be clipped by the screen edge. One tap logs; there is
 * no confirm step.
 *
 * 2026-09-29 owner D7: slide-to-confirm (circle off-screen, tick, return, 780 ms, compositor-only, restartable).
 *
 * The confirm runs when `confirmKey` changes, i.e. after the parent has
 * actually queued the write, not on press. Under `prefers-reduced-motion`
 * the circle does not travel; the tick still fades in and out. The 40ms
 * haptic is the Logger's existing `pulse(40)` after the write; this
 * component adds no second one.
 *
 * Labels use `outcome-lead-ink` rather than Figma's `lead` for Lead: `lead`
 * on white is 6.5:1, below the 7:1 field floor.
 */

export const CONFIRM = { outMs: 260, holdMs: 280, backMs: 240, travelPx: 124 } as const;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_BACK = "cubic-bezier(0.34, 1.25, 0.64, 1)";

type PillStyle = {
  Icon: ComponentType<{ className?: string }>;
  pill: string;
  circle: string;
  ink: string;
  chevron: string;
};

const STYLE: Record<PrimaryOutcome, PillStyle> = {
  lead: {
    Icon: StarIcon,
    pill: "bg-outcome-lead",
    circle: "border-[1.5px] border-lead",
    ink: "text-outcome-lead-ink",
    chevron: "text-outcome-on-pill",
  },
  answered: {
    Icon: SpeechIcon,
    pill: "bg-outcome-contact",
    circle: "border border-line",
    ink: "text-prop",
    chevron: "text-outcome-on-pill",
  },
  no_opportunity: {
    Icon: HouseIcon,
    pill: "border border-outcome-rented-edge bg-outcome-rented",
    circle: "border border-outcome-rented-edge",
    ink: "text-outcome-rented-ink",
    chevron: "text-outcome-rented-edge",
  },
  no_answer: {
    Icon: HouseOutlineIcon,
    pill: "bg-outcome-notin",
    circle: "border border-line",
    ink: "text-ink-soft",
    chevron: "text-outcome-on-pill",
  },
};

type ConfirmNode = HTMLElement | SVGElement | null;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Soft pop for Other. Outcome pills use `playLogConfirm`. Skipped under reduced motion. */
export function slideConfirm(el: HTMLElement | null): void {
  if (!el || prefersReducedMotion() || typeof el.animate !== "function") return;
  el.animate([{ scale: "1" }, { scale: "0.9", offset: 0.35 }, { scale: "1" }], {
    duration: 240,
    easing: EASE_OUT,
  });
}

export function playLogConfirm(parts: {
  circle: ConfirmNode;
  chevron: ConfirmNode;
  tick: ConfirmNode;
  tickPath: ConfirmNode;
}): void {
  const nodes = [parts.circle, parts.chevron, parts.tick, parts.tickPath];
  if (nodes.some((el) => el != null && typeof el.animate !== "function")) return;

  // 2026-09-30: travel = distance to the viewport edge + 8, measured per run (124 left 32px on screen)
  const circleEl = parts.circle;
  let travel: number = CONFIRM.travelPx;
  if (circleEl) {
    const rect = circleEl.getBoundingClientRect();
    const transform = getComputedStyle(circleEl).transform;
    const currentTranslateX = transform !== "none" ? new DOMMatrixReadOnly(transform).m41 : 0;
    const restLeft = rect.left - currentTranslateX;
    travel = Math.max(CONFIRM.travelPx, Math.ceil(window.innerWidth - restLeft + 8));
  }

  for (const el of nodes) el?.getAnimations().forEach((animation) => animation.cancel());

  const total = CONFIRM.outMs + CONFIRM.holdMs + CONFIRM.backMs;
  const o = CONFIRM.outMs / total;
  const h = (CONFIRM.outMs + CONFIRM.holdMs) / total;
  const { circle, chevron, tick, tickPath } = parts;

  if (prefersReducedMotion()) {
    // The circle covers the tick and must not travel. Fade it, opacity only, so the tick can show.
    circle?.animate(
      [
        { opacity: 1 },
        { opacity: 0, offset: 0.1 },
        { opacity: 0, offset: 0.8 },
        { opacity: 1 },
      ],
      { duration: 700 },
    );
    tick?.animate(
      [
        { opacity: 0 },
        { opacity: 1, offset: 0.1 },
        { opacity: 1, offset: 0.8 },
        { opacity: 0 },
      ],
      { duration: 700 },
    );
    chevron?.animate(
      [
        { opacity: 1 },
        { opacity: 0, offset: 0.1 },
        { opacity: 0, offset: 0.8 },
        { opacity: 1 },
      ],
      { duration: 700 },
    );
    // The path rests fully offset. A static tick (no stroke-draw) has to sit at 0 while the fade runs.
    tickPath?.animate(
      [
        { strokeDashoffset: 0 },
        { strokeDashoffset: 0, offset: 0.8 },
        { strokeDashoffset: 1 },
      ],
      { duration: 700 },
    );
    return;
  }

  circle?.animate(
    [
      { transform: "translateX(0)", easing: EASE_OUT },
      { transform: `translateX(${travel}px)`, offset: o },
      { transform: `translateX(${travel}px)`, offset: h, easing: EASE_BACK },
      { transform: "translateX(0)" },
    ],
    { duration: total },
  );
  chevron?.animate(
    [
      { opacity: 1, offset: 0 },
      { opacity: 0, offset: 40 / total },
      { opacity: 0, offset: 660 / total },
      { opacity: 1, offset: 1 },
    ],
    { duration: total },
  );
  tick?.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: 60 / total },
      { opacity: 1, offset: h },
      { opacity: 0, offset: 620 / total },
      { opacity: 0, offset: 1 },
    ],
    { duration: total },
  );
  tickPath?.animate(
    [
      { strokeDashoffset: 1, easing: EASE_OUT },
      { strokeDashoffset: 1, offset: 60 / total, easing: EASE_OUT },
      { strokeDashoffset: 0, offset: 240 / total },
      { strokeDashoffset: 0 },
    ],
    { duration: total },
  );
}

export function OutcomePill({
  outcome,
  onPress,
  confirmKey,
  disabled,
}: {
  outcome: PrimaryOutcome;
  onPress: (outcome: PrimaryOutcome) => void;
  /** Change this after a successful log of this outcome to play the confirm. */
  confirmKey: number;
  disabled?: boolean;
}) {
  const lock = useInputLock();
  const circleRef = useRef<HTMLSpanElement>(null);
  const chevronRef = useRef<HTMLSpanElement>(null);
  const tickRef = useRef<SVGSVGElement>(null);
  const tickPathRef = useRef<SVGPathElement>(null);
  const firstKey = useRef(confirmKey);
  const spec = PRIMARY_OUTCOMES.find((s) => s.key === outcome)!;
  const style = STYLE[outcome];

  useEffect(() => {
    if (confirmKey === firstKey.current) return;
    playLogConfirm({
      circle: circleRef.current,
      chevron: chevronRef.current,
      tick: tickRef.current,
      tickPath: tickPathRef.current,
    });
  }, [confirmKey]);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={spec.label}
      onClick={() => lock(() => onPress(outcome))}
      className={`relative flex h-outcome w-[140px] shrink-0 items-center gap-3 rounded-full pr-4 drop-shadow-field-pill disabled:opacity-50 ${style.pill}`}
      data-testid={`outcome-${outcome}`}
      data-outcome={outcome}
    >
      <svg
        ref={tickRef}
        aria-hidden
        viewBox="0 0 24 24"
        className={`pointer-events-none absolute left-[24px] top-1/2 size-7 -translate-y-1/2 opacity-0 ${style.chevron}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path ref={tickPathRef} d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} strokeDasharray={1} strokeDashoffset={1} />
      </svg>
      <span
        ref={circleRef}
        className={`relative z-10 flex size-outcome shrink-0 flex-col items-center justify-center gap-1 overflow-clip rounded-full bg-surface shadow-field-knob transition-[scale] duration-100 active:scale-[0.96] ${style.circle} ${style.ink}`}
      >
        <style.Icon />
        <span aria-hidden className="w-[70px] text-center text-field-button-label">
          {spec.label.replace("/", "/\u200b")}
        </span>
      </span>
      <span ref={chevronRef} className="flex shrink-0">
        <ChevronIcon className={`shrink-0 rotate-180 ${style.chevron}`} />
      </span>
    </button>
  );
}
