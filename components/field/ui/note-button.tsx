"use client";

import { PencilLineIcon } from "@/components/field/icons";

/**
 * NoteButton: Figma "NoteButton 2.1" (327:900), Logger V2.1 dial layout.
 * Opens the note sheet for the current door. 44 x 44 (`size/tap-min`) on the
 * right margin, centred on the door number. Flat: `surface`, a 1px `line`,
 * no shadow. Pressed: the fill steps to `line`.
 *
 * A note drafted for the next log shows as a small `prop` dot (the V1 note
 * row used to show the draft's first words; the dial layout has no room for
 * them, and the sheet still shows the whole draft).
 */
export function NoteButton({ label, hasDraft, onPress }: { label: string; hasDraft: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className="relative flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink transition-colors duration-100 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop active:bg-line"
      data-testid="note-button"
      data-draft={hasDraft ? "true" : "false"}
    >
      <PencilLineIcon className="size-5" stroke={1.75} />
      {hasDraft ? (
        <span aria-hidden className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-prop ring-2 ring-surface" />
      ) : null}
    </button>
  );
}
