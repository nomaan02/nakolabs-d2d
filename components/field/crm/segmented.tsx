"use client";

import type { ReactNode } from "react";

/**
 * CRM-5 C. iOS-style segmented control (Figma F1 / F4). A radiogroup: one
 * choice, every option visible, 44px tall in the large size.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = "lg",
  testId,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  size?: "lg" | "sm";
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className={`flex gap-1 rounded-field-md bg-line p-1 ${size === "lg" ? "w-full" : "w-fit"}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-field-sm font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
              size === "lg" ? "min-h-tap-min flex-1 text-sm" : "min-h-tap-min px-3 text-field-body-strong"
            } ${selected ? "bg-surface text-ink shadow-sm" : "text-ink-muted"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
