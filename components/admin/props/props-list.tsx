"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";

import { Button, buttonClass } from "@/components/admin/ui/button";
import { Chip } from "@/components/admin/ui/chip";
import { IconButton } from "@/components/admin/ui/icon-button";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { ChevronDownIcon, ChevronRightIcon, DrawIcon, SearchIcon } from "@/components/field/icons";
import { coverageFolderHref } from "@/lib/admin/nav";
import {
  countsLine,
  FOLDER_NAME_MAX,
  folderLine,
  propSubtitle,
  statePill,
  type FolderGroup,
  type PropFilter,
  type PropRow,
  type PropState,
} from "@/lib/admin/props";

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
  onNewFolder,
}: {
  counts: { live: number; due: number; today: number; archived: number };
  filter: PropFilter;
  onFilter: (next: PropFilter) => void;
  /** Absent until Draw lands (F2d): no button. */
  onDraw?: () => void;
  query: string;
  onQuery: (next: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** PP-1 (owner 2026-10-21): make a folder. Resolves to an error message, or null when it was made. */
  onNewFolder?: (name: string) => Promise<string | null>;
}) {
  const [naming, setNaming] = useState(false);
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
        <div className="flex shrink-0 gap-2">
          {onNewFolder ? (
            <Button kind="secondary" size="compact" onClick={() => setNaming(true)} disabled={naming}>
              New folder
            </Button>
          ) : null}
          {onDraw ? (
            <Button kind="secondary" size="compact" onClick={onDraw}>
              Draw prop
            </Button>
          ) : null}
        </div>
      </div>
      {naming && onNewFolder ? (
        <div className="mt-3">
          <FolderNameField
            id="folder-new"
            label="New folder name"
            initial=""
            onCancel={() => setNaming(false)}
            onSave={async (name) => {
              const error = await onNewFolder(name);
              if (!error) setNaming(false);
              return error;
            }}
          />
        </div>
      ) : null}
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
      {items.map((item) => (
        <PropListRow key={item.row.id} item={item} selected={item.row.id === selectedId} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function PropListRow({ item, selected, onSelect }: { item: ListItem; selected: boolean; onSelect: (id: string) => void }) {
  const { row, state, doors } = item;
  const pill = statePill(state);
  return (
    <li className="border-b border-line last:border-b-0 lg:border-b-0">
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
}

/**
 * PP-1 (owner 2026-10-21). The list in folders: each folder opens and closes,
 * shows its counts (counts only, no quality signals), opens Coverage limited
 * to its props, and can be renamed. No delete (parked). A search or filter
 * opens every folder that has a match.
 */
export function FolderedPropsList({
  groups,
  selectedId,
  onSelect,
  emptyText,
  narrowed,
  onRenameFolder,
}: {
  groups: FolderGroup<ListItem>[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyText: string;
  /** A search or filter is on: every folder shown is open. */
  narrowed: boolean;
  onRenameFolder: (id: string, name: string) => Promise<string | null>;
}) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);

  if (groups.every((group) => group.items.length === 0) && narrowed) {
    return <p className="px-4 py-6 text-admin-body text-ink-muted">{emptyText}</p>;
  }

  const toggle = (key: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="props-folders">
      {groups.map((group) => {
        const key = group.folder?.id ?? "none";
        const name = group.folder?.name ?? "No folder";
        const open = narrowed || !closed.has(key);
        const listId = `folder-list-${key}`;
        return (
          <section key={key} className="border-t border-line first:border-t-0" data-testid="props-folder">
            <div className="flex items-center gap-1 bg-field-bg py-1.5 pr-2 pl-2">
              {renaming === key && group.folder ? (
                <div className="min-w-0 flex-1 py-1 pl-1">
                  <FolderNameField
                    id={`folder-rename-${key}`}
                    label="Folder name"
                    initial={group.folder.name}
                    onCancel={() => setRenaming(null)}
                    onSave={async (next) => {
                      const error = await onRenameFolder(group.folder!.id, next);
                      if (!error) setRenaming(null);
                      return error;
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  disabled={narrowed}
                  aria-expanded={open}
                  aria-controls={listId}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-field-md px-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop disabled:cursor-default"
                >
                  {open ? (
                    <ChevronDownIcon className="size-5 shrink-0 text-ink-muted" />
                  ) : (
                    <ChevronRightIcon className="size-5 shrink-0 text-ink-muted" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-admin-body-strong">{name}</span>
                    <span className="block truncate text-admin-subhead text-ink-muted tabular-nums">{folderLine(group.counts)}</span>
                  </span>
                </button>
              )}
              {group.folder && renaming !== key ? (
                <>
                  <Link
                    href={coverageFolderHref(group.folder.id)}
                    className={buttonClass("secondary", "compact", "shrink-0 text-prop")}
                    aria-label={`Open on map: ${name}`}
                  >
                    Open on map
                  </Link>
                  <IconButton label={`Rename ${name}`} onClick={() => setRenaming(key)}>
                    <DrawIcon className="size-5" />
                  </IconButton>
                </>
              ) : null}
            </div>
            {open ? (
              group.items.length > 0 ? (
                <ul id={listId} className="px-2 pl-6">
                  {group.items.map((item) => (
                    <PropListRow key={item.row.id} item={item} selected={item.row.id === selectedId} onSelect={onSelect} />
                  ))}
                </ul>
              ) : (
                <p id={listId} className="px-4 py-3 pl-10 text-admin-subhead text-ink-muted">
                  No props here yet. Open a prop and use Move to put it in this folder.
                </p>
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** Inline name field for a new or renamed folder. Enter or leaving the field saves; Escape cancels. */
function FolderNameField({
  id,
  label,
  initial,
  onSave,
  onCancel,
}: {
  id: string;
  label: string;
  initial: string;
  onSave: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const save = async () => {
    if (busy) return;
    if (value.trim() === "" || value.trim() === initial.trim()) {
      onCancel();
      return;
    }
    setBusy(true);
    try {
      setError(await onSave(value));
    } catch {
      setError("That didn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={input}
        value={value}
        maxLength={FOLDER_NAME_MAX}
        disabled={busy}
        placeholder={initial ? undefined : "e.g. Fishponds"}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => void save()}
        className="h-11 w-full rounded-field-md border border-prop bg-surface px-3 text-admin-body-strong text-ink outline-none"
      />
      {error ? (
        <p role="alert" className="mt-1 text-admin-caption text-oxide">
          {error}
        </p>
      ) : null}
    </form>
  );
}
