"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { IconButton } from "@/components/admin/ui/icon-button";
import { StatusPill } from "@/components/admin/ui/status-pill";
import {
  ClockIcon,
  CloseIcon,
  CoverageIcon,
  DrawIcon,
  MoreIcon,
  NoteIcon,
  RouteIcon,
  WarningIcon,
} from "@/components/field/icons";
import {
  historyFigures,
  joinNames,
  nextVisitLine,
  outcomeSegments,
  shortDate,
  slotLabel,
  statePill,
  visitTitle,
  FOLDER_NAME_MAX,
  type OutcomeSegment,
  type PropFolder,
  type PropRow,
  type PropState,
  type PropVisit,
  type VisitStats,
} from "@/lib/admin/props";

const SEGMENT_CLASS: Record<OutcomeSegment["key"], string> = {
  contacts: "bg-outcome-contact",
  leads: "bg-outcome-lead",
  rented: "bg-outcome-rented-edge",
  notIn: "bg-outcome-notin",
  other: "bg-ink-faint",
};

const SEGMENT_LABEL: Record<OutcomeSegment["key"], string> = {
  contacts: "contacts",
  leads: "leads",
  rented: "rented or council",
  notIn: "not in",
  other: "other",
};

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

/**
 * UI-10 F2b (owner A22, A25, A47; frames 05-06, D2). One prop: its doors, the
 * visit that is on today or planned, when the next one is due, and every
 * earlier visit. No Allocate here (A25: visits start from a date on Today).
 * Rename is inline on the title. Archive goes through a named confirm.
 */
export function PropDetail({
  row,
  state,
  today,
  doorsText,
  stats,
  statsError,
  visitHref,
  coverageHref,
  onClose,
  onRename,
  onEditShape,
  onRoutes,
  onArchive,
  onRestore,
  folders = [],
  onMove,
  onMoveToNew,
}: {
  row: PropRow;
  state: PropState;
  today: string;
  doorsText: string | null;
  stats: Map<string, VisitStats> | null;
  statsError: string | null;
  visitHref: string;
  coverageHref: string;
  onClose: () => void;
  onRename: (name: string) => Promise<string | null>;
  /** Absent until Edit shape lands (F2d): no menu item. */
  onEditShape?: () => void;
  /** RT-3: the prop's Routes panel (automatic routes, or draw your own). */
  onRoutes?: () => void;
  onArchive: () => void;
  onRestore: () => void;
  /** PP-1 (owner 2026-10-21): the folders a prop can move to. */
  folders?: PropFolder[];
  /** Resolves to an error message, or null once moved. Absent: no Folder row. */
  onMove?: (folderId: string | null) => Promise<string | null>;
  onMoveToNew?: (name: string) => Promise<string | null>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const current = state.kind === "today" || state.kind === "planned" ? state.visit : null;
  const history = row.visits
    .filter((visit) => visit.id !== current?.id && visit.workDate < today)
    .sort((a, b) => b.workDate.localeCompare(a.workDate) || b.visitNumber - a.visitNumber);
  const next = nextVisitLine(row, state);

  return (
    <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 pt-1">
          {renaming ? (
            <RenameField
              initial={row.name}
              onCancel={() => setRenaming(false)}
              onSave={async (name) => {
                const error = await onRename(name);
                if (!error) setRenaming(false);
                return error;
              }}
            />
          ) : (
            <h2 className="text-admin-title text-balance">
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
                aria-label={`${row.name}. Rename`}
              >
                {row.name}
              </button>
            </h2>
          )}
          <p className="mt-0.5 text-admin-subhead text-ink-muted tabular-nums">{doorsText ?? "Counting doors…"}</p>
        </div>
        <div className="relative">
          <IconButton label="More" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} data-prop-menu-button>
            <MoreIcon className="size-6" />
          </IconButton>
          <PropMenu
            open={menuOpen}
            archived={state.kind === "archived"}
            coverageHref={coverageHref}
            onClose={() => setMenuOpen(false)}
            onRename={() => setRenaming(true)}
            onEditShape={onEditShape}
            onRoutes={onRoutes}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        </div>
        <IconButton label="Close" onClick={onClose}>
          <CloseIcon className="size-6" />
        </IconButton>
      </div>

      {onMove && onMoveToNew ? (
        <FolderRow folderId={row.folderId ?? null} folders={folders} onMove={onMove} onMoveToNew={onMoveToNew} />
      ) : null}

      {state.kind === "archived" ? (
        <div className="mt-4 rounded-field-lg bg-field-bg p-4">
          <p className="text-admin-body">
            Archived{row.archivedAt ? ` ${shortDate(row.archivedAt)}` : ""}. It is off the map and cannot be allocated.
          </p>
          <Button kind="secondary" size="compact" className="mt-3" onClick={onRestore}>
            Restore prop
          </Button>
        </div>
      ) : null}

      {current ? <VisitCard visit={current} state={state} today={today} stats={stats?.get(current.id) ?? null} visitHref={visitHref} /> : null}

      {next ? (
        <div className="mt-4 flex gap-3 px-1">
          <ClockIcon className="mt-0.5 size-5 shrink-0 text-ink-muted" />
          <div>
            <p className="text-admin-body">{next}</p>
            <p className="text-admin-subhead text-ink-muted">Plan it from Today</p>
          </div>
        </div>
      ) : null}

      {statsError ? (
        <p role="alert" className="mt-4 flex gap-2 text-admin-subhead text-oxide">
          <WarningIcon className="size-5 shrink-0" />
          {statsError}
        </p>
      ) : null}

      {history.length > 0 ? (
        <section className="mt-5">
          <h3 className="px-1 text-admin-section text-ink-muted">History</h3>
          <ul className="mt-1">
            {history.map((visit) => (
              <li key={visit.id} className="flex items-center gap-3 border-b border-line px-1 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-admin-body-strong">{visitTitle(visit, today)}</p>
                  <p className="truncate text-admin-subhead text-ink-muted">{joinNames(visit.team)}</p>
                </div>
                <p className="shrink-0 text-admin-subhead text-ink-soft tabular-nums">
                  {stats?.get(visit.id) ? historyFigures(stats.get(visit.id)!) : "…"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : state.kind !== "archived" && !current ? (
        <p className="mt-5 px-1 text-admin-subhead text-ink-muted">No visits yet.</p>
      ) : null}
    </div>
  );
}

function VisitCard({
  visit,
  state,
  today,
  stats,
  visitHref,
}: {
  visit: PropVisit;
  state: PropState;
  today: string;
  stats: VisitStats | null;
  visitHref: string;
}) {
  const pill = statePill(state);
  const slot = slotLabel(visit.slot);
  const worked = state.kind === "today";
  const bar = stats ? outcomeSegments(stats) : null;
  return (
    <section aria-label={visitTitle(visit, today)} className="mt-4 rounded-field-lg bg-field-bg p-4 pb-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-admin-headline">{visitTitle(visit, today)}</h3>
          <p className="truncate text-admin-subhead text-ink-muted">
            {joinNames(visit.team)}
            {slot ? ` · ${slot}` : ""}
          </p>
        </div>
        {pill ? <StatusPill status={pill} /> : null}
      </div>
      {worked ? (
        <>
          <div
            role="img"
            aria-label={
              bar && bar.segments.length > 0
                ? bar.segments.map((segment) => `${n(segment.value)} ${SEGMENT_LABEL[segment.key]}`).join(", ")
                : "No doors worked yet"
            }
            className="mt-3 flex h-2 overflow-hidden rounded-full bg-line"
          >
            {bar && bar.total > 0
              ? bar.segments.map((segment) => (
                  <span
                    key={segment.key}
                    className={SEGMENT_CLASS[segment.key]}
                    style={{ width: `${(segment.value / bar.total) * 100}%` }}
                  />
                ))
              : null}
          </div>
          <dl className="mt-3 grid grid-cols-4 gap-2">
            {[
              { label: "Worked", value: stats?.worked },
              { label: "Contacts", value: stats?.contacts },
              { label: "Leads", value: stats?.leads },
              { label: "Left", value: stats?.remaining },
            ].map((figure) => (
              <div key={figure.label} className="flex min-w-0 flex-col-reverse">
                <dt className="text-admin-caption text-ink-muted">{figure.label}</dt>
                <dd className="text-admin-headline tabular-nums">{figure.value === undefined ? "…" : n(figure.value)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <Link
        href={visitHref}
        className="mt-1 -ml-1 inline-flex min-h-11 items-center px-1 text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
      >
        Open visit
      </Link>
    </section>
  );
}

function RenameField({
  initial,
  onSave,
  onCancel,
}: {
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
    if (value.trim() === initial.trim()) {
      onCancel();
      return;
    }
    setBusy(true);
    setError(await onSave(value));
    setBusy(false);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="sr-only" htmlFor="prop-rename">
        Prop name
      </label>
      <input
        id="prop-rename"
        ref={input}
        value={value}
        maxLength={80}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => void save()}
        className="h-11 w-full rounded-field-md border border-prop bg-surface px-3 text-admin-headline text-ink outline-none"
      />
      {error ? (
        <p role="alert" className="mt-1 text-admin-caption text-oxide">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-admin-caption text-ink-muted">Enter to save · Esc to cancel</p>
      )}
    </form>
  );
}

function PropMenu({
  open,
  archived,
  coverageHref,
  onClose,
  onRename,
  onEditShape,
  onRoutes,
  onArchive,
  onRestore,
}: {
  open: boolean;
  archived: boolean;
  coverageHref: string;
  onClose: () => void;
  onRename: () => void;
  onEditShape?: () => void;
  onRoutes?: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  // Held in a ref so figures arriving in the background never re-run the effect (and move focus).
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onClose = () => close.current();
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    items()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(at + step + list.length) % list.length]?.focus();
    };
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && panel.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-prop-menu-button]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  if (!open) return null;
  const item =
    "flex min-h-11 w-full items-center gap-3 px-4 text-left text-admin-body focus-visible:bg-field-bg focus-visible:outline-none hover:bg-field-bg";
  const pick = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <div
      ref={panel}
      role="menu"
      aria-label="Prop actions"
      className="absolute top-11 right-0 z-30 w-56 overflow-hidden rounded-field-lg border border-line bg-surface py-1 text-ink shadow-admin-float motion-safe:animate-admin-fade-in"
    >
      <button type="button" role="menuitem" className={item} onClick={pick(onRename)}>
        <NoteIcon className="size-5 text-ink-soft" />
        Rename
      </button>
      {!archived && onEditShape ? (
        <button type="button" role="menuitem" className={item} onClick={pick(onEditShape)}>
          <DrawIcon className="size-5 text-ink-soft" />
          Edit shape
        </button>
      ) : null}
      {!archived && onRoutes ? (
        <button type="button" role="menuitem" className={item} onClick={pick(onRoutes)}>
          <RouteIcon className="size-5 text-ink-soft" />
          Routes
        </button>
      ) : null}
      <Link href={coverageHref} role="menuitem" className={item} onClick={onClose}>
        <CoverageIcon className="size-5 text-ink-soft" />
        Show on Coverage
      </Link>
      <div aria-hidden className="my-1 border-t border-line" />
      {archived ? (
        <button type="button" role="menuitem" className={item} onClick={pick(onRestore)}>
          Restore prop
        </button>
      ) : (
        <button type="button" role="menuitem" className={`${item} text-oxide`} onClick={pick(onArchive)}>
          <CloseIcon className="size-5" />
          Archive prop
        </button>
      )}
    </div>
  );
}

const NEW_FOLDER = "__new__";
const NO_FOLDER = "";

/**
 * PP-1 (owner 2026-10-21). Which folder the prop is in, and Move: picking a
 * folder saves straight away; "New folder…" asks for a name, makes the
 * folder and moves the prop into it.
 */
function FolderRow({
  folderId,
  folders,
  onMove,
  onMoveToNew,
}: {
  folderId: string | null;
  folders: PropFolder[];
  onMove: (folderId: string | null) => Promise<string | null>;
  onMoveToNew: (name: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const saved = folderId !== null && folders.some((folder) => folder.id === folderId) ? folderId : NO_FOLDER;
  // Shown straight away after a pick; the saved value takes over once the page has refreshed.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [saved]);
  const known = picked ?? saved;
  const sorted = folders.slice().sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));

  const pick = async (value: string) => {
    setError(null);
    if (value === NEW_FOLDER) {
      setNaming(true);
      return;
    }
    if (value === known) return;
    setBusy(true);
    setPicked(value);
    try {
      const failed = await onMove(value === NO_FOLDER ? null : value);
      if (failed) {
        setPicked(null);
        setError(failed);
      }
    } catch {
      setPicked(null);
      setError("The prop could not be moved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const make = async () => {
    if (busy) return;
    if (!name.trim()) {
      setNaming(false);
      return;
    }
    setBusy(true);
    try {
      const failed = await onMoveToNew(name);
      setError(failed);
      // A failed move after the folder was made: back to the select, where the new folder now is.
      if (!failed || failed.startsWith("The prop could not be moved")) {
        setNaming(false);
        setName("");
      }
    } catch {
      // The folder may already exist: back to the select, where it shows once the page refreshes.
      setNaming(false);
      setError("That didn't save. Check your connection, then pick the folder again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-field-lg bg-field-bg px-4 py-3" data-testid="prop-folder">
      <label htmlFor="prop-folder" className="block text-admin-caption text-ink-muted">
        Folder
      </label>
      {naming ? (
        <form
          className="mt-1 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void make();
          }}
        >
          <input
            id="prop-folder"
            autoFocus
            value={name}
            maxLength={FOLDER_NAME_MAX}
            disabled={busy}
            placeholder="e.g. Fishponds"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setNaming(false);
              }
            }}
            className="h-11 min-w-0 flex-1 rounded-field-md border border-prop bg-surface px-3 text-admin-body text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
          />
          <Button kind="secondary" size="compact" type="submit" disabled={busy}>
            Make and move
          </Button>
        </form>
      ) : (
        <select
          id="prop-folder"
          value={known}
          disabled={busy}
          onChange={(event) => void pick(event.target.value)}
          className="mt-1 h-11 w-full rounded-field-md border border-line bg-surface px-3 text-admin-body-strong text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
        >
          {sorted.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
          <option value={NO_FOLDER}>No folder</option>
          <option value={NEW_FOLDER}>New folder…</option>
        </select>
      )}
      {error ? (
        <p role="alert" className="mt-1 text-admin-caption text-oxide">
          {error}
        </p>
      ) : null}
    </div>
  );
}
