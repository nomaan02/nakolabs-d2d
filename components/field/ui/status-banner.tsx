"use client";

import type { ReactNode } from "react";

/**
 * StatusBanner — Figma node 12:172.
 *
 * "One-line status under the header/map. Glyph + words, never colour
 * alone. Instruction = turn/spur/transfer card from route-display (high
 * contrast ink). Offline and Error come from lib/sync status. Info =
 * teammate/door notices."
 *
 * `glyph` is caller-supplied (Figma's own default variants render a plain
 * character — "i", "!", "◌", "↰" — not an icon asset, so this stays a
 * `ReactNode` rather than a fixed icon per kind). One banner slot, one
 * component: the composer (Session C) decides which kind is showing.
 *
 * 2026-09-29 owner D2: slim row under the map, instruction is plain text.
 */
export type StatusBannerKind = "instruction" | "offline" | "error" | "info";

const KIND_CLASS: Record<StatusBannerKind, { row: string; text: string; message: string }> = {
  instruction: { row: "px-0", text: "text-ink-soft", message: "text-field-body" },
  offline: { row: "bg-warn-bg px-3", text: "text-outcome-rented-ink", message: "text-field-body-strong" },
  error: { row: "bg-error-bg px-3", text: "text-oxide", message: "text-field-body-strong" },
  info: { row: "border border-line bg-surface px-3", text: "text-ink", message: "text-field-body-strong" },
};

export function StatusBanner({
  kind,
  glyph,
  message,
  action,
}: {
  kind: StatusBannerKind;
  glyph: ReactNode;
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  const style = KIND_CLASS[kind];

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex h-8 items-center gap-2 rounded-field-sm ${style.row}`}
      data-testid="status-banner"
      data-kind={kind}
    >
      <span aria-hidden className={`shrink-0 ${style.text}`} data-testid="status-banner-glyph">
        {glyph}
      </span>
      <p className={`min-w-0 flex-1 truncate ${style.message} ${style.text}`} data-testid="status-banner-message">
        {message}
      </p>
      {action ? (
        <button
          type="button"
          onClick={action.onPress}
          className={`-my-1.5 flex h-11 shrink-0 items-center px-2 text-field-button-label underline underline-offset-2 ${style.text}`}
          data-testid="status-banner-action"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
