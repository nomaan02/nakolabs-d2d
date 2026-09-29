"use client";

import { CaretIcon, NoteIcon } from "@/components/field/icons";

/**
 * NoteBar — Figma node 7:33.
 *
 * "Opens the existing notes sheet for the current door (notes-input,
 * privacy line, save)."
 *
 * A single 56px full-width row, ink-muted (the door it refers to is
 * repeated elsewhere on screen, so this is a secondary label, not a
 * must-read one). The caret rotates to point down when the sheet it opens
 * is showing; `open` is caller-controlled state, not owned here.
 */
export function NoteBar({
  label,
  open = false,
  onPress,
}: {
  label: string;
  open?: boolean;
  onPress?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-expanded={open}
      className="flex h-14 w-full items-center gap-3 border-t border-line bg-surface px-4"
      data-testid="note-bar"
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-line text-ink-muted"
      >
        <NoteIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-field-body-strong text-ink-muted">{label}</span>
      <CaretIcon
        className={`size-4 shrink-0 text-ink-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}
