"use client";

import { ChevronDownIcon } from "@/components/field/icons";
import { RESULT_PERIODS, type ResultPeriod } from "@/lib/field/crm";

/** CRM-5 C. The dark "This month ⌄" pill (Figma F3 / F4). A native select, so it works one-handed and with VoiceOver. */
export function PeriodSelect({ value, onChange, testId }: { value: ResultPeriod; onChange: (p: ResultPeriod) => void; testId?: string }) {
  return (
    <label className="relative inline-flex shrink-0 items-center">
      <span className="sr-only">Period</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ResultPeriod)}
        data-testid={testId}
        className="min-h-tap-min appearance-none rounded-full bg-ink pl-4 pr-9 text-sm font-semibold text-field-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
      >
        {RESULT_PERIODS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 size-4 text-field-bg" />
    </label>
  );
}

const PERIOD_KEY = "d2d.crm.period";

export function readPeriod(fallback: ResultPeriod): ResultPeriod {
  try {
    const saved = window.localStorage.getItem(PERIOD_KEY);
    return RESULT_PERIODS.some((p) => p.value === saved) ? (saved as ResultPeriod) : fallback;
  } catch {
    return fallback;
  }
}

export function savePeriod(period: ResultPeriod): void {
  try {
    window.localStorage.setItem(PERIOD_KEY, period);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
}
