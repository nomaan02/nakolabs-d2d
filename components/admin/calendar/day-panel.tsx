"use client";

import { useState, type ReactNode } from "react";

import { OutcomeBar } from "@/components/admin/today/visit-card";
import { DesktopPanel } from "@/components/admin/today/visit-panel";
import { useIsDesktop } from "@/components/admin/map/use-is-desktop";
import { Button, ButtonLink } from "@/components/admin/ui/button";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { Sheet } from "@/components/admin/ui/sheet";
import { ChevronRightIcon, InfoIcon, WarningIcon } from "@/components/field/icons";
import {
  allocatedNote,
  dayTitle,
  daySummary,
  entryMeta,
  leadResultRows,
  leadResultsLine,
  notWorkedCopy,
  openOnMapHref,
  outcomesLine,
  peopleLine,
  OUTCOME_ROWS,
  type DayEntry,
  type OutcomeCounts,
} from "@/lib/admin/calendar";
import { endVisitConfirm, NO_FIGURES } from "@/lib/admin/today";
import { closeVisitAction } from "@/lib/props/visits";

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

const DOT: Record<keyof OutcomeCounts, string> = {
  contacts: "bg-outcome-contact",
  leads: "bg-outcome-lead",
  rented: "bg-outcome-rented-edge",
  notIn: "bg-outcome-notin",
  refused: "bg-ink-soft",
  doNotCall: "bg-oxide",
  callback: "bg-ink-faint",
  cantReach: "bg-ink-faint",
};

/** A row that opens and closes its list (Outcomes, Lead results). */
function Disclosure({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-14 w-full items-center gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-admin-body-strong">{title}</span>
          {open ? null : <span className="block truncate text-admin-subhead text-ink-muted">{summary}</span>}
        </span>
        <ChevronRightIcon className={`size-5 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? <div className="pb-3">{children}</div> : null}
    </div>
  );
}

function WorkedCard({ entry, alone }: { entry: DayEntry; alone: boolean }) {
  const [outcomesOpen, setOutcomesOpen] = useState(alone);
  const [leadsOpen, setLeadsOpen] = useState(alone);
  const note = allocatedNote(entry);
  const figures = {
    ...NO_FIGURES,
    worked: entry.worked,
    remaining: entry.visit.remaining ?? 0,
    contacts: entry.outcomes.contacts,
    leads: entry.outcomes.leads,
    rented: entry.outcomes.rented,
    notIn: entry.outcomes.notIn,
  };
  const leadRows = leadResultRows(entry.leadResults);
  return (
    <article aria-label={entry.visit.propName} className="rounded-field-lg bg-field-bg p-4">
      <h3 className="text-admin-headline text-balance">{entry.visit.propName}</h3>
      <p className="text-admin-subhead text-ink-muted">{entryMeta(entry.visit)}</p>
      <div className="mt-3">
        <OutcomeBar figures={figures} />
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-2">
        {[
          { label: "Worked", value: entry.worked },
          { label: "Left", value: entry.visit.remaining },
          { label: "Contacts", value: entry.outcomes.contacts },
          { label: "Leads", value: entry.outcomes.leads },
        ].map((figure) => (
          <div key={figure.label} className="flex min-w-0 flex-col-reverse">
            <dt className="text-admin-caption text-ink-muted">{figure.label}</dt>
            <dd className="text-admin-headline tabular-nums">{figure.value === null ? "–" : n(figure.value)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex min-h-11 items-center gap-3">
        <span aria-hidden className="flex -space-x-1.5">
          {entry.people.slice(0, 3).map((name, index) => (
            <span key={`${index}:${name}`} className="flex size-7 items-center justify-center rounded-full border border-line bg-surface text-admin-caption text-ink-soft">
              {name.charAt(0).toUpperCase()}
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 text-admin-subhead text-ink-soft tabular-nums">{peopleLine(entry, alone)}</span>
      </div>
      {note ? (
        <p className="mb-2 flex items-center gap-1.5 text-admin-caption text-ink-muted">
          <InfoIcon className="size-4 shrink-0" />
          {note}
        </p>
      ) : null}
      <Disclosure title="Outcomes" summary={outcomesLine(entry.outcomes)} open={outcomesOpen} onToggle={() => setOutcomesOpen((open) => !open)}>
        <ul>
          {OUTCOME_ROWS.filter((row) => entry.outcomes[row.key] > 0).map((row) => (
            <li key={row.key} className="flex min-h-8 items-center gap-2.5 text-admin-body">
              <span aria-hidden className={`size-2 rounded-full ${DOT[row.key]}`} />
              <span className="flex-1">{row.label}</span>
              <span className="tabular-nums">{n(entry.outcomes[row.key])}</span>
            </li>
          ))}
        </ul>
      </Disclosure>
      <Disclosure title="Lead results" summary={leadResultsLine(entry.leadResults)} open={leadsOpen} onToggle={() => setLeadsOpen((open) => !open)}>
        {leadRows.length === 0 ? (
          <p className="text-admin-subhead text-ink-muted">No leads on this visit that day.</p>
        ) : (
          <ul>
            {leadRows.map((row) => (
              <li key={row.status} className="flex min-h-8 items-center justify-between text-admin-body">
                <span>{row.label}</span>
                <span className="tabular-nums">{n(row.value)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-admin-caption text-ink-muted">Set by the office.</p>
      </Disclosure>
      {alone ? null : (
        <ButtonLink href={openOnMapHref(entry)} kind="secondary" size="compact" className="mt-2 w-full">
          Open on map
        </ButtonLink>
      )}
    </article>
  );
}

const PILL: Record<"not-worked" | "planned" | "ended", string> = {
  "not-worked": "Not worked",
  planned: "Planned",
  ended: "Ended",
};

function UnworkedCard({ entry, busy, onEnd }: { entry: DayEntry; busy: boolean; onEnd: () => void }) {
  const copy = notWorkedCopy(entry);
  const kind = entry.kind === "worked" ? "planned" : entry.kind;
  return (
    <article aria-label={entry.visit.propName} className="rounded-field-lg bg-field-bg p-4">
      <div className="flex items-start gap-3">
        <h3 className="min-w-0 flex-1 text-admin-headline text-balance">{entry.visit.propName}</h3>
        <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-dashed border-ink-faint px-2.5 text-admin-pill text-ink-soft">
          {PILL[kind]}
        </span>
      </div>
      <p className="text-admin-subhead text-ink-muted">{entryMeta(entry.visit)}</p>
      <p className="mt-2 text-admin-body text-ink-soft">{copy.line}</p>
      {copy.canEnd ? (
        <Button kind="secondary" size="compact" className="mt-3 w-full" disabled={busy} onClick={onEnd}>
          End visit
        </Button>
      ) : null}
    </article>
  );
}

/**
 * UI-10 F4c (owner A42-A46; frames 35-37). Every visit on one day, as a
 * sheet (phone) or the right-hand panel (desktop). Worked visits show the
 * day's numbers, who knocked and when, Outcomes and Lead results (read-only,
 * set by the office) and Open on map. A past visit nobody worked offers End
 * only (owner 2026-10-08: once its day has come a visit is never deleted).
 * A one-visit day opens fully expanded with Open on map pinned.
 */
export function DayPanel({
  date,
  entries,
  onClose,
  onChanged,
}: {
  date: string;
  entries: DayEntry[];
  onClose: () => void;
  onChanged: (text: string) => void;
}) {
  const desktop = useIsDesktop();
  const [confirm, setConfirm] = useState<DayEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alone = entries.length === 1 && entries[0]!.kind === "worked";

  const copy = confirm
    ? endVisitConfirm(confirm.visit, { kind: "close", worked: 0, total: confirm.visit.remaining ?? 0, countsForRotation: false })
    : null;

  const run = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    const entry = confirm;
    try {
      const result = await closeVisitAction(entry.visit.id);
      // Close the dialog either way, so a failure is read in the panel, not under the scrim.
      setConfirm(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged(`Visit ${entry.visit.visitNumber} of ${entry.visit.propName} ended.`);
    } catch {
      setConfirm(null);
      setError("That didn't go through. Check your signal, then try again.");
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? <p className="text-admin-body text-ink-muted">Nothing was worked or planned on this day.</p> : null}
      {entries.map((entry) =>
        entry.kind === "worked" ? (
          <WorkedCard key={`${entry.visit.id}:${entry.date}`} entry={entry} alone={alone} />
        ) : (
          <UnworkedCard key={`${entry.visit.id}:${entry.date}`} entry={entry} busy={busy} onEnd={() => setConfirm(entry)} />
        ),
      )}
      {error ? (
        <p role="alert" className="flex gap-2 text-admin-subhead text-oxide">
          <WarningIcon className="size-5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );

  const footer = alone ? (
    <ButtonLink href={openOnMapHref(entries[0]!)} className="w-full">
      Open on map
    </ButtonLink>
  ) : undefined;

  const dialog = (
    <ConfirmDialog
      open={copy !== null}
      title={copy?.title ?? ""}
      body={copy?.body ?? ""}
      confirmLabel={busy ? "Working…" : (copy?.confirm ?? "")}
      busy={busy}
      onConfirm={() => void run()}
      onCancel={() => {
        setConfirm(null);
        setError(null);
      }}
    />
  );

  if (desktop) {
    return (
      <>
        <DesktopPanel title={dayTitle(date)} subtitle={daySummary(entries)} onClose={onClose} footer={footer}>
          {body}
        </DesktopPanel>
        {dialog}
      </>
    );
  }
  return (
    <>
      <Sheet open title={dayTitle(date)} subtitle={daySummary(entries)} onClose={onClose} footer={footer}>
        {body}
      </Sheet>
      {dialog}
    </>
  );
}
