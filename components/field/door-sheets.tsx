"use client";

import { useState } from "react";

import { Sheet } from "@/components/field/sheet";
import { useInputLock } from "@/lib/field/feedback";
import { OTHER_OUTCOMES, type OtherOutcome } from "@/lib/field/outcomes";
import { HOUSE_NUMBER_MAX, NOTES_MAX } from "@/lib/sync/ops";

/**
 * The three secondary sheets: Other, notes, and the house number.
 *
 * None of them is a free-text escape hatch for something that has an enum.
 * `do_not_call` in particular is a real outcome value under Other and is
 * never typed — it is the one outcome with a compliance consequence and it
 * has to stay queryable.
 */

export function OtherOutcomeSheet({
  onPick,
  onDismiss,
}: {
  onPick: (outcome: OtherOutcome) => void;
  onDismiss: () => void;
}) {
  const lock = useInputLock();

  return (
    <Sheet title="Other outcome" onDismiss={onDismiss}>
      <div className="flex flex-col gap-2">
        {OTHER_OUTCOMES.map((spec) => (
          <button
            key={spec.key}
            type="button"
            onClick={() => lock(() => onPick(spec.key))}
            className="flex min-h-[60px] w-full items-center gap-3 rounded-md border-2 border-ink bg-paper px-4 text-left text-base font-semibold text-ink"
            data-testid={`other-${spec.key}`}
          >
            <span aria-hidden className="text-xl leading-none">
              {spec.glyph}
            </span>
            {spec.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * Notes about the door. Chips first, because they are faster to tap and
 * structurally cannot hold a name or a phone number — which is the whole
 * point. Section 9's argument rests on this database holding essentially no
 * personal data.
 */
const NOTE_CHIPS = ["Dog", "Side entrance", "Scaffolding", "Empty"] as const;

export function NotesSheet({
  initial,
  onSave,
  onDismiss,
  saveLabel,
}: {
  initial: string;
  onSave: (notes: string) => void;
  onDismiss: () => void;
  saveLabel: string;
}) {
  const [text, setText] = useState(initial);
  const remaining = NOTES_MAX - text.length;

  const appendChip = (chip: string) => {
    setText((current) => {
      const trimmed = current.trim();
      if (trimmed.split(" · ").includes(chip)) return current;
      const next = trimmed ? `${trimmed} · ${chip}` : chip;
      return next.slice(0, NOTES_MAX);
    });
  };

  return (
    <Sheet
      title="Notes about door"
      onDismiss={onDismiss}
      footer={
        <button
          type="button"
          onClick={() => onSave(text.trim())}
          className="min-h-[56px] w-full rounded-md bg-ink text-base font-semibold text-paper"
          data-testid="notes-save"
        >
          {saveLabel}
        </button>
      }
    >
      <div className="flex flex-wrap gap-2">
        {NOTE_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => appendChip(chip)}
            className="min-h-11 rounded-md border-2 border-ink bg-paper px-4 text-sm font-semibold"
            data-testid={`note-chip-${chip.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {chip}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        maxLength={NOTES_MAX}
        onChange={(event) => setText(event.target.value)}
        placeholder="e.g. side gate, dog, back extension"
        rows={4}
        className="mt-3 w-full rounded-md border-2 border-ink/30 bg-worksheet px-3 py-2 text-base"
        data-testid="notes-input"
      />

      <p className="mt-2 text-sm font-semibold text-oxide" data-testid="notes-privacy">
        Do not record names or contact details.
      </p>
      <p className="mt-1 font-data text-xs text-ink-soft">{remaining} characters left</p>
    </Sheet>
  );
}

/**
 * The ✎ affordance. A numeric-first field against a UPRN the canvasser has
 * ALREADY selected — by the cursor, or by tapping its dot. It describes that
 * door; it cannot find one. There is no address search, no autocomplete and
 * no street or postcode entry anywhere in this app.
 *
 * `inputMode="numeric"` rather than `type="number"`: Bristol has 14A and 2B.
 */
export function HouseNumberSheet({
  currentLabel,
  street,
  onSave,
  onDismiss,
}: {
  currentLabel: string;
  street: string | null;
  onSave: (houseNumber: string) => void;
  onDismiss: () => void;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= HOUSE_NUMBER_MAX;

  return (
    <Sheet
      title="House number"
      onDismiss={onDismiss}
      footer={
        <button
          type="button"
          disabled={!valid}
          onClick={() => onSave(trimmed)}
          className="min-h-[56px] w-full rounded-md bg-ink text-base font-semibold text-paper disabled:opacity-40"
          data-testid="house-number-save"
        >
          Save number
        </button>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        The number on this door, as you can read it. It replaces{" "}
        <span className="font-data">{currentLabel}</span>
        {street ? ` on ${street}` : ""} for everyone on the team.
      </p>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={HOUSE_NUMBER_MAX}
        placeholder="38"
        aria-label="House number"
        className="mt-3 min-h-[56px] w-full rounded-md border-2 border-ink bg-worksheet px-3 text-center font-data text-3xl"
        data-testid="house-number-input"
      />
      <p className="mt-2 text-xs text-ink-soft">
        Numbers and letters, up to {HOUSE_NUMBER_MAX} characters — 14A is fine.
      </p>
    </Sheet>
  );
}
