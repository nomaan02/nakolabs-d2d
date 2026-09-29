"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button — Figma node 12:151.
 *
 * "Sheet buttons. Primary 56px, Lead 64px (lead submit), Secondary 56px
 * outline, Chip 44px (note chips, time presets). Min target 44px."
 *
 * `lead` fills with `outcome-lead-ink`, not the existing `lead` token
 * (P14, plan amendment 2): paper on `lead` is only 6.25:1, paper on
 * `outcome-lead-ink` is 7.91:1 (computed once, see the Session B1 report).
 * `min-h-11` (44px) is kept on every kind as a floor even though `kind`
 * already sets a taller height, so a future kind can never fall under the
 * tap-target minimum by omission.
 */
export type ButtonKind = "primary" | "lead" | "secondary" | "chip";

const KIND_CLASS: Record<ButtonKind, string> = {
  primary: "h-14 bg-ink text-paper",
  lead: "h-16 bg-outcome-lead-ink text-paper",
  secondary: "h-14 border-2 border-ink bg-surface text-ink",
  chip: "h-11 border border-line bg-surface text-ink",
};

export function Button({
  kind = "primary",
  className,
  children,
  ...props
}: {
  kind?: ButtonKind;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  return (
    <button
      type="button"
      data-testid="field-button"
      data-kind={kind}
      className={`flex min-h-11 items-center justify-center rounded-field-md px-5 text-field-body-strong whitespace-nowrap disabled:opacity-50 ${KIND_CLASS[kind]} ${className ?? ""}`}
      {...props}
    >
      {children}
    </button>
  );
}
