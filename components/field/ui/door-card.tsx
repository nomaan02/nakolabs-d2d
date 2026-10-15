"use client";

import type { ReactNode } from "react";

import { NoteIcon, PlusIcon } from "@/components/field/icons";
import { UndoButton } from "@/components/field/ui/undo-button";

const ACTION =
  "flex h-11 min-w-0 items-center gap-1.5 rounded-field-sm px-2 text-admin-section text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop";

/**
 * FUI-2b (owner 2026-10-14, Q1; Figma Field/DoorCard 208:369). The current
 * door as one card:
 *
 * - Status row: "Current door", or the outcome logged on this visit and its
 *   time, with the undo ring on the right while there is something to undo.
 * - The door scroll (`children`): the existing horizontal scroll with its
 *   ‹ › and street line. No claim, no Take (owner 2026-09-28).
 * - Actions: Add note (replaces the full-width NoteBar; the notes sheet is
 *   unchanged), and Add number only when the plate is a placeholder. The
 *   number is typed against this already-selected UPRN (AGENTS.md).
 *
 * At the end of the prop the Logger passes the "This prop is done" block as
 * `children`, so the undo ring and Add note stay for the last door logged.
 */
export function DoorCard({
  logged,
  noteLabel,
  onNote,
  onHouseNumber,
  children,
}: {
  /** e.g. "Contact · 10:42" when this door is logged on this visit. */
  logged: string | null;
  noteLabel: string;
  onNote: () => void;
  /** Present only when the plate is a placeholder. */
  onHouseNumber?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-field-lg border border-line bg-surface" aria-label="Current door" data-testid="door-card">
      <div className="flex h-11 items-center justify-between gap-2 pr-0.5 pl-3">
        {logged ? (
          <p className="min-w-0 truncate text-admin-section text-ink" data-testid="already-logged">
            {"✓"} {logged}
          </p>
        ) : (
          <p className="text-admin-caption text-ink-muted">Current door</p>
        )}
        <UndoButton />
      </div>
      {children}
      <div aria-hidden className="mx-3 h-px bg-line" />
      <div className="flex items-center gap-1 px-1" data-testid="door-actions">
        <button type="button" onClick={onNote} className={ACTION} data-testid="add-note">
          <NoteIcon className="size-4 shrink-0" />
          <span className="truncate">{noteLabel}</span>
        </button>
        {onHouseNumber ? (
          <button
            type="button"
            onClick={onHouseNumber}
            className={`${ACTION} shrink-0`}
            data-testid="add-house-number"
          >
            <PlusIcon className="size-4 shrink-0" />
            Add number
          </button>
        ) : null}
      </div>
    </section>
  );
}
