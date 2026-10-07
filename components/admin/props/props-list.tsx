"use client";

import type { RefObject } from "react";

import { Button } from "@/components/admin/ui/button";
import { Chip } from "@/components/admin/ui/chip";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { ChevronRightIcon, SearchIcon } from "@/components/field/icons";
import { countsLine, propSubtitle, statePill, type PropFilter, type PropRow, type PropState } from "@/lib/admin/props";

export type ListItem = { row: PropRow; state: PropState; doors: number | null };

/** Sheet header (frame 03 peek, D2 panel): title, counts, Draw prop, search on desktop, filter chips. */
export function PropsListHeader({
  counts,
  filter,
  onFilter,
  onDraw,
  query,
  onQuery,
  searchRef,
}: {
  counts: { live: number; due: number; today: number; archived: number };
  filter: PropFilter;
  onFilter: (next: PropFilter) => void;
  /** Absent until Draw lands (F2d): no button. */
  onDraw?: () => void;
  query: string;
  onQuery: (next: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const chips: { key: PropFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "due", label: counts.due > 0 ? `Due ${counts.due}` : "Due" },
    { key: "today", label: counts.today > 0 ? `Out today ${counts.today}` : "Out today" },
    { key: "archived", label: "Archived" },
  ];
  return (
    <div className="px-4 pb-1 lg:pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-admin-title lg:text-admin-headline">Props</h1>
          <p className="text-admin-subhead text-ink-muted tabular-nums">{countsLine(counts)}</p>
        </div>
        {onDraw ? (
          <Button kind="secondary" size="compact" onClick={onDraw}>
            Draw prop
          </Button>
        ) : null}
      </div>
      <label className="mt-3 hidden h-10 items-center gap-2 rounded-field-md bg-field-bg px-3 text-ink-muted focus-within:outline-2 focus-within:outline-prop lg:flex">
        <SearchIcon className="size-4 shrink-0" />
        <span className="sr-only">Search props</span>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search props"
          className="min-w-0 flex-1 bg-transparent text-admin-subhead text-ink outline-none placeholder:text-ink-muted"
        />
        <kbd aria-hidden className="rounded-field-sm border border-line px-1.5 text-admin-caption">
          /
        </kbd>
      </label>
      <div role="group" aria-label="Filter props" className="mt-1 flex gap-2 overflow-x-auto">
        {chips.map((chip) => (
          <Chip key={chip.key} on={filter === chip.key} onClick={() => onFilter(chip.key)}>
            {chip.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** Frame 04 / D2: one row per prop. The pill is visit state only (Live, Due, Done, Not started). */
export function PropsList({
  items,
  selectedId,
  onSelect,
  emptyText,
}: {
  items: ListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="px-4 py-6 text-admin-body text-ink-muted">{emptyText}</p>;
  }
  return (
    <ul className="px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {items.map(({ row, state, doors }) => {
        const pill = statePill(state);
        const selected = row.id === selectedId;
        return (
          <li key={row.id} className="border-b border-line last:border-b-0 lg:border-b-0">
            <button
              type="button"
              onClick={() => onSelect(row.id)}
              aria-current={selected ? "true" : undefined}
              className={`flex min-h-16 w-full items-center gap-3 rounded-field-md px-2 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop ${
                selected ? "bg-prop-soft" : "hover:bg-field-bg"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-admin-body-strong ${selected ? "text-prop" : ""}`}>{row.name}</span>
                <span className="block truncate text-admin-subhead text-ink-muted tabular-nums">
                  {propSubtitle(state, doors, row.archivedAt)}
                </span>
              </span>
              {pill ? <StatusPill status={pill} /> : null}
              <ChevronRightIcon className="size-5 shrink-0 text-ink-faint lg:hidden" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
