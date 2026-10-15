"use client";

import { SpeechIcon } from "@/components/field/icons";
import { useInputLock } from "@/lib/field/feedback";
import { PRIMARY_OUTCOMES, type PrimaryOutcome } from "@/lib/field/outcomes";

/**
 * The Map's door sheet controls (FUI-3, Figma M2): four solid 56px tiles in
 * a 2x2 grid, Lead and Contact above Rented/Council and Not In (owner
 * decision 1, 2026-09-28 order), and a small Other button that sits beside
 * Close in the sheet header.
 *
 * Every fill is solid and every colour is paired with a glyph or an icon. In
 * direct sun an outline vanishes and hue discrimination degrades before shape
 * recognition does, so neither may carry a state on its own. No emoji: the
 * Contact tile uses the speech-bubble icon, the others keep their text glyph.
 */

const FILL: Record<PrimaryOutcome, string> = {
  lead: "bg-lead text-paper",
  answered: "bg-prop text-paper",
  no_opportunity: "bg-oxide text-paper",
  no_answer: "border border-line bg-ink text-paper",
};

export function OutcomeButtons({
  onPrimary,
  disabled,
}: {
  onPrimary: (outcome: PrimaryOutcome) => void;
  disabled?: boolean;
}) {
  const lock = useInputLock();

  return (
    <div
      className="grid grid-cols-2 gap-2 px-4 pb-4"
      data-testid="outcome-buttons"
      data-theme-island="light"
    >
      {PRIMARY_OUTCOMES.map((spec) => (
        <button
          key={spec.key}
          type="button"
          disabled={disabled}
          onClick={() => lock(() => onPrimary(spec.key))}
          className={`flex min-h-14 items-center justify-center gap-2 rounded-field-md px-2 text-admin-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop disabled:opacity-50 ${FILL[spec.key]}`}
          data-testid={`outcome-${spec.key}`}
        >
          {spec.key === "answered" ? (
            <SpeechIcon className="size-5 shrink-0" />
          ) : (
            <span aria-hidden className="text-lg leading-none">
              {spec.glyph}
            </span>
          )}
          {spec.label}
        </button>
      ))}
    </div>
  );
}

/** Opens the rarer outcomes. Sits beside Close in the door sheet header. */
export function OtherOutcomeButton({ onOther, disabled }: { onOther: () => void; disabled?: boolean }) {
  const lock = useInputLock();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => lock(onOther)}
      className="min-h-tap-min shrink-0 rounded-field-md border border-line bg-surface px-4 text-admin-pill text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop disabled:opacity-50"
      data-testid="outcome-other"
    >
      Other
    </button>
  );
}
