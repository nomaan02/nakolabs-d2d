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
 * The confirm slide (circle +24px and back, 180ms) runs when `confirmKey`
 * changes, i.e. after the parent has actually queued the write, not on
 * press. It is skipped under `prefers-reduced-motion`. The 40ms haptic is
 * the Logger's existing `pulse(40)` after the write; this component adds
 * no second one.
 *
 * Labels use `outcome-lead-ink` rather than Figma's `lead` for Lead: `lead`
 * on white is 6.5:1, below the 7:1 field floor.
 */

export const SLIDE_PX = 24;
export const SLIDE_MS = 180;

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

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** The shared confirm slide, also used by `OtherButton`. */
export function slideConfirm(el: HTMLElement | null): void {
  if (!el || prefersReducedMotion() || typeof el.animate !== "function") return;
  el.animate(
    [{ transform: "translateX(0)" }, { transform: `translateX(${SLIDE_PX}px)` }, { transform: "translateX(0)" }],
    { duration: SLIDE_MS, easing: "ease-out" },
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
  /** Change this after a successful log of this outcome to play the slide. */
  confirmKey: number;
  disabled?: boolean;
}) {
  const lock = useInputLock();
  const circleRef = useRef<HTMLSpanElement>(null);
  const firstKey = useRef(confirmKey);
  const spec = PRIMARY_OUTCOMES.find((s) => s.key === outcome)!;
  const style = STYLE[outcome];

  useEffect(() => {
    if (confirmKey === firstKey.current) return;
    slideConfirm(circleRef.current);
  }, [confirmKey]);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={spec.label}
      onClick={() => lock(() => onPress(outcome))}
      className={`flex h-outcome w-[140px] shrink-0 items-center gap-3 rounded-full pr-4 drop-shadow-field-pill disabled:opacity-50 ${style.pill}`}
      data-testid={`outcome-${outcome}`}
      data-outcome={outcome}
    >
      <span
        ref={circleRef}
        className={`flex size-outcome shrink-0 flex-col items-center justify-center gap-1 overflow-clip rounded-full bg-surface shadow-field-knob ${style.circle} ${style.ink}`}
      >
        <style.Icon />
        <span aria-hidden className="w-[70px] text-center text-field-button-label">
          {spec.label.replace("/", "/\u200b")}
        </span>
      </span>
      <ChevronIcon className={`shrink-0 rotate-180 ${style.chevron}`} />
    </button>
  );
}
