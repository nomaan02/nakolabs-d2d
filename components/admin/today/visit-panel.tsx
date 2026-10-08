"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { VisitMiniMap } from "@/components/admin/today/visit-mini-map";
import { OutcomeBar } from "@/components/admin/today/visit-card";
import { useIsDesktop } from "@/components/admin/map/use-is-desktop";
import { Button, ButtonLink } from "@/components/admin/ui/button";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { IconButton } from "@/components/admin/ui/icon-button";
import { Sheet } from "@/components/admin/ui/sheet";
import { CloseIcon, PlusIcon, WarningIcon } from "@/components/field/icons";
import {
  activeTeam,
  addableCanvassers,
  ago,
  endVisitConfirm,
  mustEnd,
  routeLine,
  sheetMeta,
  MAX_TEAM,
  type TeamOption,
  type TodayVisit,
  type VisitFigures,
} from "@/lib/admin/today";
import type { TodayProp } from "@/lib/admin/today-data";
import type { MapMode } from "@/lib/map/map-palette";
import { addMemberAction, previewAssignmentRemoval, removeAssignmentAction, removeMemberAction } from "@/lib/props/reallocation";
import { closeVisitAction } from "@/lib/props/visits";
import { isOverlayOpen } from "@/components/admin/ui/use-overlay-focus";

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

export type VisitChange =
  | { kind: "removed-member"; visitId: string; member: { id: string; name: string } }
  | { kind: "added-member"; name: string }
  | { kind: "ended"; text: string };

/**
 * UI-10 F3c (owner A26; frames 14, 33, D1). One visit: its map and route,
 * the numbers, the team (add a person, remove one with Undo), and End visit.
 * Delete is offered only for a visit that never started and has no knocks;
 * a started visit is always ended (`assignment_close_early`), because its
 * phones may still hold knocks that have not synced. Phone: a sheet over
 * Today. Desktop: the right-hand panel. `notice` (the undo toast) sits above
 * the footer so it never covers End visit and stays inside the sheet.
 */
export function VisitPanel({
  visit,
  figures,
  prop,
  today,
  now,
  mode,
  options,
  onClose,
  onChanged,
  notice,
}: {
  visit: TodayVisit;
  figures: VisitFigures | null;
  prop: TodayProp | null;
  today: string;
  now: number;
  mode: MapMode;
  /** Every active canvasser for this visit's date, busy ones marked. */
  options: TeamOption[];
  onClose: () => void;
  onChanged: (change: VisitChange) => void;
  notice?: ReactNode;
}) {
  const desktop = useIsDesktop();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; confirm: string } | null>(null);

  const team = activeTeam(visit);
  const open = visit.closedAt === null;
  const addable = addableCanvassers(options, visit);
  const canAdd = open && team.length < MAX_TEAM && addable.length > 0;

  const run = async (key: string, work: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const failed = await work();
      if (failed) setError(failed);
    } catch {
      setError("That didn't go through. Check your signal, then try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = (member: { id: string; name: string }) =>
    run(`remove:${member.id}`, async () => {
      const result = await removeMemberAction(visit.id, member.id);
      if (!result.ok) return result.message;
      onChanged({ kind: "removed-member", visitId: visit.id, member });
      return null;
    });

  const add = (option: TeamOption) =>
    run(`add:${option.id}`, async () => {
      const result = await addMemberAction(visit.id, option.id);
      if (!result.ok) return result.message;
      setPicking(false);
      onChanged({ kind: "added-member", name: option.name });
      return null;
    });

  const ending = mustEnd(visit, figures);

  const askEnd = () =>
    run("preview", async () => {
      if (visit.startedAt && (figures?.knocks ?? 0) === 0) {
        // Started, nothing synced yet: always an end, never a delete.
        setConfirm(endVisitConfirm(visit, { kind: "close", worked: 0, total: figures ? figures.worked + figures.remaining : 0, countsForRotation: false }));
        return null;
      }
      const result = await previewAssignmentRemoval(visit.id);
      if (!result.ok) return result.message;
      const preview = result.preview;
      setConfirm(
        endVisitConfirm(
          visit,
          preview.kind === "delete"
            ? { kind: "delete" }
            : {
                kind: "close",
                worked: preview.worked,
                total: preview.total,
                countsForRotation: preview.countsForRotation,
              },
        ),
      );
      return null;
    });

  const end = () =>
    run("end", async () => {
      let what: "deleted" | "ended" = "ended";
      if (visit.startedAt) {
        const result = await closeVisitAction(visit.id);
        setConfirm(null);
        if (!result.ok) return result.message;
      } else {
        const result = await removeAssignmentAction(visit.id);
        setConfirm(null);
        if (!result.ok) return result.message;
        if (result.removal.action === "deleted") what = "deleted";
      }
      onChanged({ kind: "ended", text: `Visit ${visit.visitNumber} of ${visit.propName} ${what}.` });
      onClose();
      return null;
    });


  const body = (
    <div className="flex flex-col gap-4">
      <VisitMiniMap prop={prop} visitId={visit.id} variantKey={visit.routeVariantKey} mode={mode} />
      {figures ? (
        <section aria-label="Numbers">
          <OutcomeBar figures={figures} />
          <dl className="mt-3 grid grid-cols-4 gap-2">
            {[
              { label: "Worked", value: figures.worked },
              { label: "Left", value: figures.remaining },
              { label: "Contacts", value: figures.contacts },
              { label: "Leads", value: figures.leads },
            ].map((figure) => (
              <div key={figure.label} className="flex min-w-0 flex-col-reverse">
                <dt className="text-admin-caption text-ink-muted">{figure.label}</dt>
                <dd className="text-admin-headline tabular-nums">{n(figure.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 flex justify-between gap-3 text-admin-subhead text-ink-muted tabular-nums">
            <span>
              Doors answered{figures.lastKnockAt ? ` · last knock ${ago(figures.lastKnockAt, now)}` : ""}
            </span>
            <span>{n(figures.answered)}</span>
          </p>
        </section>
      ) : (
        <p className="text-admin-subhead text-ink-muted">Nothing is worked until the day.</p>
      )}

      <section aria-label="Team">
        <h3 className="text-admin-section text-ink-muted">Team</h3>
        <ul className="mt-1">
          {team.map((member) => (
            <li key={member.id} className="flex min-h-12 items-center gap-3">
              <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-field-bg text-admin-caption text-ink-soft">
                {member.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 text-admin-body">{member.name}</span>
              {open && team.length > 1 ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void remove(member)}
                  className="min-h-11 px-3 text-admin-body-strong text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop disabled:opacity-40"
                >
                  {busy === `remove:${member.id}` ? "Removing…" : "Remove"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {canAdd && !picking ? (
          <Button kind="quiet" size="compact" className="-ml-3.5" onClick={() => setPicking(true)}>
            <PlusIcon className="size-5" />
            Add person
          </Button>
        ) : null}
        {picking ? (
          <ul aria-label="Add a person" className="mt-1 rounded-field-md border border-line">
            {addable.map((option) => (
              <li key={option.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void add(option)}
                  className="flex min-h-11 w-full items-center justify-between px-3 text-left text-admin-body focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop disabled:opacity-40"
                >
                  {option.name}
                  <span className="text-admin-subhead text-prop">{busy === `add:${option.id}` ? "Adding…" : "Add"}</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setPicking(false)}
                className="flex min-h-11 w-full items-center px-3 text-admin-subhead text-ink-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
              >
                Cancel
              </button>
            </li>
          </ul>
        ) : null}
        {open && team.length === 1 ? (
          <p className="mt-1 text-admin-caption text-ink-muted">To take the last person off, end the visit.</p>
        ) : null}
      </section>

      <p className="flex justify-between border-t border-line pt-3 text-admin-subhead text-ink-soft tabular-nums">
        <span>Route</span>
        <span>{routeLine(visit)}</span>
      </p>

      {error ? (
        <p role="alert" className="flex gap-2 text-admin-subhead text-oxide">
          <WarningIcon className="size-5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );

  const footer = (
    <div>
      {notice}
      <div className="flex gap-2">
      <ButtonLink href={`/admin/props?prop=${encodeURIComponent(visit.propId)}`} kind="secondary" size="compact" className="flex-1">
        Open prop
      </ButtonLink>
      {open ? (
        <Button kind="destructive" size="compact" className="flex-1" disabled={busy !== null} onClick={() => void askEnd()}>
          {busy === "preview" ? "Checking…" : ending ? "End visit" : "Delete visit"}
        </Button>
      ) : null}
      </div>
    </div>
  );

  const dialog = (
    <ConfirmDialog
      open={confirm !== null}
      title={confirm?.title ?? ""}
      body={confirm?.body ?? ""}
      confirmLabel={busy === "end" ? "Working…" : (confirm?.confirm ?? "")}
      busy={busy === "end"}
      onConfirm={() => void end()}
      onCancel={() => setConfirm(null)}
    />
  );

  if (desktop) {
    return (
      <>
        <DesktopPanel title={visit.propName} subtitle={sheetMeta(visit, today)} onClose={onClose} footer={footer}>
          {body}
        </DesktopPanel>
        {dialog}
      </>
    );
  }
  return (
    <>
      <Sheet open title={visit.propName} subtitle={sheetMeta(visit, today)} onClose={onClose} footer={footer}>
        {body}
      </Sheet>
      {dialog}
    </>
  );
}

/** D1: the visit fills the right-hand column; Today stays visible beside it. */
function DesktopPanel({
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Not modal (Today stays usable beside it), so no focus trap: focus moves
  // in when a visit opens, and Escape closes it unless a dialog is up.
  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A dialog or the live map is on top: Escape is theirs.
      if (isOverlayOpen()) return;
      close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [title]);
  return (
    <aside
      ref={panel}
      aria-label={title}
      tabIndex={-1}
      className="flex h-full w-[400px] shrink-0 flex-col border-l border-line bg-surface outline-none"
    >
      <header className="flex items-start gap-2 pt-5 pr-3 pb-3 pl-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-admin-title text-balance">{title}</h2>
          <p className="mt-0.5 text-admin-subhead text-ink-muted">{subtitle}</p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <CloseIcon className="size-6" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
      <div className="border-t border-line px-6 py-4">{footer}</div>
    </aside>
  );
}
