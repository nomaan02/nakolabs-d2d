"use client";

import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { Sheet } from "@/components/admin/ui/sheet";
import { CheckIcon } from "@/components/field/icons";
import { periodLabel, periodOf, type CoverageFilters, type PeriodPreset } from "@/lib/admin/coverage-filters";

export type PickerOption = { key: string; label: string; selected: boolean; apply: (filters: CoverageFilters) => CoverageFilters };

/** One choice in a filter sheet: a radio row with a tick. */
function OptionRow({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onPick}
        className="flex min-h-12 w-full items-center gap-3 text-left text-admin-body focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
      >
        <span className="flex-1">{label}</span>
        {selected ? <CheckIcon className="size-5 text-prop" /> : null}
      </button>
    </li>
  );
}

/** A filter chip's sheet: pick one option; the page navigates to the new filters. */
export function FilterPicker({
  title,
  options,
  filters,
  onClose,
  onApply,
}: {
  title: string;
  options: PickerOption[];
  filters: CoverageFilters;
  onClose: () => void;
  onApply: (next: CoverageFilters) => void;
}) {
  return (
    <Sheet open title={title} onClose={onClose}>
      <ul role="radiogroup" aria-label={title}>
        {options.map((option) => (
          <OptionRow key={option.key} label={option.label} selected={option.selected} onPick={() => onApply(option.apply(filters))} />
        ))}
      </ul>
    </Sheet>
  );
}

const PRESETS: ReadonlyArray<{ preset: PeriodPreset; label: string }> = [
  { preset: "all", label: "All time" },
  { preset: "today", label: "Today" },
  { preset: "7", label: "Last 7 days" },
  { preset: "30", label: "Last 30 days" },
];

/** The period chip's sheet: a preset, or two dates (A32 date range). */
export function PeriodPicker({
  filters,
  today,
  onClose,
  onApply,
}: {
  filters: CoverageFilters;
  today: string;
  onClose: () => void;
  onApply: (next: CoverageFilters) => void;
}) {
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const current = periodLabel(filters, today);
  const presetMatch = PRESETS.some((option) => option.label === current);
  const valid = from !== "" && to !== "" && from <= to && to <= today;
  return (
    <Sheet
      open
      title="Days"
      onClose={onClose}
      footer={
        <Button className="w-full" disabled={!valid} onClick={() => onApply({ ...filters, from, to })}>
          {valid ? "Show these days" : "Pick a start and end day"}
        </Button>
      }
    >
      <ul role="radiogroup" aria-label="Days">
        {PRESETS.map((option) => (
          <OptionRow
            key={option.preset}
            label={option.label}
            selected={option.label === current}
            onPick={() => onApply({ ...filters, ...periodOf(option.preset, today) })}
          />
        ))}
        {presetMatch ? null : <OptionRow label={current} selected onPick={onClose} />}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-admin-subhead text-ink-muted">
          From
          <input
            type="date"
            value={from}
            max={to || today}
            onChange={(event) => setFrom(event.target.value)}
            className="h-11 rounded-field-md border border-line bg-surface px-3 text-admin-body text-ink focus-visible:outline-2 focus-visible:outline-prop"
          />
        </label>
        <label className="flex flex-col gap-1 text-admin-subhead text-ink-muted">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            max={today}
            onChange={(event) => setTo(event.target.value)}
            className="h-11 rounded-field-md border border-line bg-surface px-3 text-admin-body text-ink focus-visible:outline-2 focus-visible:outline-prop"
          />
        </label>
      </div>
    </Sheet>
  );
}
