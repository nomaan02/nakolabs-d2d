"use client";

import { OtherButton } from "@/components/field/ui/other-button";
import { OutcomePill } from "@/components/field/ui/outcome-pill";
import { PRIMARY_OUTCOMES, type OtherOutcome, type PrimaryOutcome } from "@/lib/field/outcomes";

/**
 * OutcomeColumn — Figma frame 8:44 (UI item 1, Session C).
 *
 * Built from the Session B2 primitives only (`OutcomePill`, `OtherButton`);
 * neither is rebuilt here. Order, top to bottom, confirmed against the
 * Figma Default screenshot (8:2): Lead, Contact, Rented/Council, Not In,
 * then Other last — smallest, at the bottom, not first. That is NOT the old
 * Stage 8 frequency ladder (owner decision 1 supersedes it outright): every
 * pill is `size-outcome`, and Other's position here is simply where Figma
 * draws it, not a re-derived ergonomics call.
 *
 * 2026-09-30 owner E3/E5 (UI item 1c, Session H1): the composer reserves
 * the pill's real width (`w-[140px] shrink-0`). The tail no longer spills
 * left into the door column. Other's slot is `top-2` (8px), centred on
 * the 76px circle: (76 - 60) / 2.
 *
 * 2026-09-29 owner D3: Other inline left of Not In.
 */
export function OutcomeColumn({
  onPrimary,
  onOther,
  confirmKeys,
  disabled,
  otherOpen,
  onOtherOpenChange,
}: {
  onPrimary: (outcome: PrimaryOutcome) => void;
  onOther: (outcome: OtherOutcome) => void;
  /**
   * One confirm key PER outcome. `OutcomePill.confirmKey` compares against
   * its own first-seen value, so bumping every pill's key on every log (a
   * single shared counter) would slide all four pills at once. The caller
   * must only bump the key for the outcome actually logged.
   */
  confirmKeys: Record<PrimaryOutcome, number>;
  disabled?: boolean;
  /**
   * "While the menu is open, the pills and the scroller are inert" (the
   * plan's Other gesture section). `OtherButton` itself must stay fully
   * interactive while its own gesture is live, so only the four pills —
   * not the whole column — go inert here. The caller is responsible for
   * making the door scroll inert too (via `OtherButton.onOpenChange`,
   * unrelated to this component).
   */
  otherOpen?: boolean;
  onOtherOpenChange?: (open: boolean) => void;
}) {
  const leading = PRIMARY_OUTCOMES.filter((spec) => spec.key !== "no_answer");
  const notIn = PRIMARY_OUTCOMES.find((spec) => spec.key === "no_answer");

  return (
    <div className="flex flex-col items-end gap-2" data-testid="outcome-column" data-theme-island="light">
      <div className="contents" inert={otherOpen || undefined}>
        {leading.map((spec) => (
          <OutcomePill
            key={spec.key}
            outcome={spec.key}
            onPress={onPrimary}
            confirmKey={confirmKeys[spec.key]}
            disabled={disabled}
          />
        ))}
      </div>
      {notIn ? (
        <div className="relative" data-testid="outcome-notin-row">
          <div inert={otherOpen || undefined}>
            <OutcomePill
              outcome={notIn.key}
              onPress={onPrimary}
              confirmKey={confirmKeys[notIn.key]}
              disabled={disabled}
            />
          </div>
          <div className="absolute right-full top-2 mr-2" data-testid="outcome-other-slot">
            <OtherButton onPick={onOther} disabled={disabled} onOpenChange={onOtherOpenChange} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
