import type { KnockOutcome } from "@/lib/sync/ops";

/**
 * The canonical button-to-enum mapping. One table, read by the Logger, the
 * map tab, the Leads tab and the undo toast, so a button can never mean two
 * things in two places.
 *
 * | Button          | outcome          | also writes                          |
 * |-----------------|------------------|--------------------------------------|
 * | Lead            | lead             | `leads` row                          |
 * | Contact         | answered         | —                                    |
 * | No Answer       | no_answer        | —                                    |
 * | Rented/Council  | no_opportunity   | `property_observations`, tenure       |
 * | Other →         | refused · do_not_call · inaccessible · callback |        |
 *
 * `do_not_call` is a real enum value under Other and is NEVER free text. It
 * is the one outcome with a compliance consequence and has to stay
 * queryable.
 *
 * `not_interested` exists in the CHECK constraint but has no button: Stage 8
 * routes that conversation to `refused`. Kept out of the UI rather than out
 * of the enum, because older rows may carry it.
 */

export type PrimaryOutcome = "no_answer" | "answered" | "no_opportunity" | "lead";
export type OtherOutcome = "refused" | "do_not_call" | "inaccessible" | "callback";

export type OutcomeSpec = {
  outcome: KnockOutcome;
  /** British English, as it appears on the button. */
  label: string;
  /** Paired with every colour use. Colour is never the only carrier. */
  glyph: string;
  /** Sequence list, undo toast and already-logged line. Same words as `label` unless a shorter form is clearer. */
  logged: string;
};

/**
 * Bottom-to-top. Frequency-driven, and it is not a style choice: No Answer is
 * roughly six taps in ten and sits lowest and largest where a one-handed
 * thumb rests. Lead is buffered from Contact by Rented/Council because a lead
 * is the one outcome a canvasser cannot undo once flushed — only the office
 * can cancel one — so its harder reach is a deliberate guard against a
 * mis-tap.
 *
 * Heights come straight from the brief's Stage 8b diagram and are not to be
 * re-derived: 96, 80, 72, 72, then Other at 56.
 */
export const PRIMARY_OUTCOMES: (OutcomeSpec & {
  key: PrimaryOutcome;
  heightPx: number;
})[] = [
  { key: "no_answer", outcome: "no_answer", label: "No Answer", glyph: "○", logged: "No answer", heightPx: 96 },
  { key: "answered", outcome: "answered", label: "Contact", glyph: "☺", logged: "Contact", heightPx: 80 },
  {
    key: "no_opportunity",
    outcome: "no_opportunity",
    label: "Rented/Council",
    glyph: "⌂",
    logged: "Rented/Council",
    heightPx: 72,
  },
  { key: "lead", outcome: "lead", label: "Lead", glyph: "★", logged: "Lead", heightPx: 72 },
];

export const OTHER_OUTCOMES: (OutcomeSpec & { key: OtherOutcome })[] = [
  { key: "refused", outcome: "refused", label: "Refused", glyph: "✕", logged: "Refused" },
  {
    key: "do_not_call",
    outcome: "do_not_call",
    label: "Do not call again",
    glyph: "⊘",
    logged: "Do not call",
  },
  {
    key: "inaccessible",
    outcome: "inaccessible",
    label: "Cannot reach the door",
    glyph: "⛔",
    logged: "Inaccessible",
  },
  { key: "callback", outcome: "callback", label: "Call back later", glyph: "↻", logged: "Call back" },
];

const BY_OUTCOME = new Map<KnockOutcome, OutcomeSpec>(
  [...PRIMARY_OUTCOMES, ...OTHER_OUTCOMES].map((spec) => [spec.outcome, spec]),
);

export function outcomeSpec(outcome: KnockOutcome): OutcomeSpec {
  return (
    BY_OUTCOME.get(outcome) ?? {
      outcome,
      label: outcome,
      glyph: "•",
      logged: outcome,
    }
  );
}

/** Rented/Council is the one button that also records a tenure. */
export function tenureFor(outcome: KnockOutcome): "no_opportunity" | null {
  return outcome === "no_opportunity" ? "no_opportunity" : null;
}
