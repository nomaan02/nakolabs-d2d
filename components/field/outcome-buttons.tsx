"use client";

import { useInputLock } from "@/lib/field/feedback";
import { PRIMARY_OUTCOMES, type PrimaryOutcome } from "@/lib/field/outcomes";

/**
 * The five outcome controls, bottom-anchored, in the brief's exact order and
 * at its exact heights.
 *
 * Reading UP from the bottom: No Answer 96px, Contact 80px, Rented/Council
 * 72px, Lead 72px, Other 56px. The order is tap frequency, inverted from the
 * usual primary-at-the-top convention because that convention assumes two
 * hands and a seated user. No Answer is roughly six taps in ten and sits
 * where a one-handed thumb already rests. Lead is buffered from Contact by
 * Rented/Council and takes a deliberate reach: it is the one outcome a
 * canvasser cannot undo once flushed, since only the office can cancel a
 * lead.
 *
 * Every fill is solid and every colour is paired with a glyph. In direct sun
 * an outline vanishes and hue discrimination degrades before shape
 * recognition does, so neither may carry a state on its own.
 */

const FILL: Record<PrimaryOutcome, string> = {
  no_answer: "bg-ink text-paper",
  answered: "bg-prop text-paper",
  no_opportunity: "bg-oxide text-paper",
  lead: "bg-lead text-paper",
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

      {/* Reversed so the array reads bottom-up (No Answer first) while the
          DOM and the screen read top-down. The array order is the frequency
          order and is the thing to preserve. */}
      {[...PRIMARY_OUTCOMES].reverse().map((spec) => (
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
