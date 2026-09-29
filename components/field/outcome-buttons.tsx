"use client";

import { useInputLock } from "@/lib/field/feedback";
import { PRIMARY_OUTCOMES, type PrimaryOutcome } from "@/lib/field/outcomes";

/**
 * The four outcome controls, bottom-anchored, top to bottom: Lead, Contact,
 * Rented/Council, Not In (owner decision 1, 2026-09-28), each a flat 72px
 * (P9). This is an interim component: Session B/C's Figma rebuild replaces
 * it with `OutcomePill`/`OutcomeColumn` and the height ladder that comes
 * with the new visual system. Until then this keeps the app working with
 * the new order and label.
 *
 * Every fill is solid and every colour is paired with a glyph. In direct sun
 * an outline vanishes and hue discrimination degrades before shape
 * recognition does, so neither may carry a state on its own.
 */

const FILL: Record<PrimaryOutcome, string> = {
  lead: "bg-lead text-paper",
  answered: "bg-prop text-paper",
  no_opportunity: "bg-oxide text-paper",
  no_answer: "bg-ink text-paper",
};

export function OutcomeButtons({
  onPrimary,
  onOther,
  disabled,
}: {
  onPrimary: (outcome: PrimaryOutcome) => void;
  onOther: () => void;
  disabled?: boolean;
}) {
  const lock = useInputLock();

  return (
    <div className="flex flex-col gap-2 px-3 pb-4" data-testid="outcome-buttons">
      <button
        type="button"
        disabled={disabled}
        onClick={() => lock(onOther)}
        style={{ minHeight: 56 }}
        className="flex w-full items-center justify-center gap-3 rounded-md border-2 border-ink bg-paper text-base font-semibold text-ink disabled:opacity-50"
        data-testid="outcome-other"
      >
        <span aria-hidden className="text-lg leading-none">
          ⋯
        </span>
        Other
      </button>

      {PRIMARY_OUTCOMES.map((spec) => (
        <button
          key={spec.key}
          type="button"
          disabled={disabled}
          onClick={() => lock(() => onPrimary(spec.key))}
          style={{ minHeight: spec.heightPx }}
          className={`flex w-full items-center justify-center gap-3 rounded-md text-xl font-semibold disabled:opacity-50 ${FILL[spec.key]}`}
          data-testid={`outcome-${spec.key}`}
        >
          <span aria-hidden className="text-2xl leading-none">
            {spec.glyph}
          </span>
          {spec.label}
        </button>
      ))}
    </div>
  );
}
