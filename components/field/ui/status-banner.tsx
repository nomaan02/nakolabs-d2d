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
 */
export type StatusBannerKind = "instruction" | "offline" | "error" | "info";

const KIND_CLASS: Record<StatusBannerKind, { surface: string; text: string; border: string }> = {
  info: { surface: "border border-line bg-surface", text: "text-ink", border: "border-ink" },
  offline: { surface: "bg-warn-bg", text: "text-outcome-rented-ink", border: "border-outcome-rented-ink" },
  error: { surface: "bg-error-bg", text: "text-oxide", border: "border-oxide" },
  instruction: { surface: "bg-ink", text: "text-paper", border: "border-paper" },
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
      className={`flex h-12 items-center gap-2.5 rounded-field-md pr-2.5 pl-3.5 ${style.surface}`}
      data-testid="status-banner"
      data-kind={kind}
    >
      <span aria-hidden className={`shrink-0 text-field-body-strong ${style.text}`} data-testid="status-banner-glyph">
        {glyph}
      </span>
      <p className={`min-w-0 flex-1 truncate text-field-body-strong ${style.text}`} data-testid="status-banner-message">
        {message}
      </p>
      {action ? (
        <button
          type="button"
          onClick={action.onPress}
          style={{ minHeight: 36 }}
          className={`shrink-0 rounded-field-sm border-[1.5px] px-3 text-field-button-label ${style.text} ${style.border}`}
          data-testid="status-banner-action"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
