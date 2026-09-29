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
 * pill is the same 84px (`size-outcome`), and Other's position here is
 * simply where Figma draws it, not a re-derived ergonomics call.
 *
 * Each pill is 140px wide but only its 84px circle is "real" width for
 * layout: the tail (the chevron end) is meant to overflow the SCREEN edge
 * ("a 140px pill clipped at the screen edge, with the 84px circle"), not
 * this component's own box. The composer (`logger-tab.tsx`) is responsible
 * for giving this component a narrow (circle-width) slot to sit in — NOT
 * the full 140px — so the door scroll beside it gets the rest of the
 * width. Found in Session C assembly: reserving the full 140px here starved
 * `DoorScroll` down to ~211px at 390px, which clipped the current door's
 * own digits. This component therefore does NOT clip or size itself to fit
 * its widest child; the composer's wrapper is a fixed, narrower box, and
 * the pills overflow it on purpose. The `<main>` root (or the composer's
 * own scroll container) clips that overflow at the actual screen edge.
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
  return (
    <div className="flex flex-col items-end gap-2" data-testid="outcome-column">
      <div className="contents" inert={otherOpen || undefined}>
        {PRIMARY_OUTCOMES.map((spec) => (
          <OutcomePill
            key={spec.key}
            outcome={spec.key}
            onPress={onPrimary}
            confirmKey={confirmKeys[spec.key]}
            disabled={disabled}
          />
        ))}
      </div>
      <OtherButton onPick={onOther} disabled={disabled} onOpenChange={onOtherOpenChange} />
    </div>
  );
}
