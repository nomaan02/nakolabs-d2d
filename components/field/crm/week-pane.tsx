"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { ChevronDownIcon } from "@/components/field/icons";
import {
  callbackAddress,
  callbackBookedLine,
  callbackDetails,
  contactName,
  freshnessLine,
  statusLabel,
  weekAppointmentLine,
  weekGroups,
  weekSaleLine,
  weekSpan,
  weekStatusKey,
  WEEK_STATUS_CHIP,
  type WeekLead,
} from "@/lib/field/crm";
import { fetchFreshness, fetchWeek, refreshFromCrm, useLoad, type RefreshReply } from "@/lib/field/crm-data";

/**
 * CRM-7 (owner 2026-10-15, Wayne OK'd the details). "This week": the
 * canvasser's OWN CRM leads for the London week, whether or not they were
 * logged in the app, newest day first. The status is the CRM word on a
 * coloured chip (UTC yellow, Re-App purple, Blowout red, Booked blue). Each
 * row opens to the same details as a call-back. "Refresh from CRM" asks the
 * server to re-read this canvasser's leads right now.
 */
export function WeekPane({ linked, onCount }: { linked: boolean; onCount: (n: number | null) => void }) {
  const span = useMemo(() => weekSpan(new Date()), []);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const week = useLoad(linked ? `week:${span.from}` : null, () => fetchWeek(span.from, span.to));
  const fresh = useLoad(linked ? "week-fresh" : null, fetchFreshness);
  const groups = useMemo(() => (week.kind === "ready" ? weekGroups(week.data, new Date()) : null), [week]);

  const count = week.kind === "ready" ? week.data.length : null;
  useEffect(() => onCount(count), [count, onCount]);

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    const reply = await refreshFromCrm();
    setBusy(false);
    setMessage(refreshMessage(reply));
    if (reply.ok) {
      week.reload();
      fresh.reload();
    }
  };

  if (!linked) {
    return (
      <p className="px-4 pt-6 text-field-body text-ink-muted" data-testid="week-not-linked">
        Your account isn&apos;t linked to the CRM yet. Ask your admin to add your CRM name.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8" data-testid="week-pane">
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-field-body text-ink-muted" data-testid="week-fresh">
          {freshnessLine(fresh.kind === "ready" ? fresh.data : null, new Date())}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          aria-busy={busy}
          className="min-h-tap-min shrink-0 rounded-field-md border border-prop px-4 text-admin-button text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop disabled:opacity-60"
          data-testid="week-refresh"
        >
          {busy ? "Refreshing…" : "Refresh from CRM"}
        </button>
      </div>
      <p role="status" aria-live="polite" className={message ? "mt-2 text-field-body text-ink" : "sr-only"} data-testid="week-message">
        {message ?? ""}
      </p>

      {week.kind === "loading" ? <p className="mt-6 text-field-body text-ink-muted">Loading your week…</p> : null}
      {week.kind === "offline" ? (
        <p className="mt-6 text-field-body text-ink-muted">No signal. Your week loads when you&apos;re back online.</p>
      ) : null}
      {week.kind === "error" ? (
        <div className="mt-6">
          <p className="text-field-body text-ink-muted">Your week didn&apos;t load.</p>
          <button type="button" onClick={week.reload} className="mt-2 min-h-tap-min text-sm font-semibold text-prop">
            Try again
          </button>
        </div>
      ) : null}

      {groups && groups.length === 0 ? (
        <div className="mt-4 rounded-field-lg border border-line bg-surface p-5" data-testid="week-empty">
          <h2 className="text-admin-headline text-ink">No CRM leads this week yet</h2>
          <p className="mt-2 text-admin-body text-ink-muted">
            Leads booked in the CRM under your name show here, even if you didn&apos;t log them in the app. Tap Refresh from CRM to check now.
          </p>
        </div>
      ) : null}

      {groups?.map((group) => (
        <section key={group.day} className="mt-5" aria-label={group.label}>
          <h2 className="mb-2 text-admin-section text-ink-muted">
            {group.label} · {group.leads.length === 1 ? "1 lead" : `${group.leads.length} leads`}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-field-lg border border-line bg-surface">
            {group.leads.map((lead) => (
              <WeekItem
                key={lead.crm_id}
                lead={lead}
                open={expanded === lead.crm_id}
                onToggle={() => setExpanded((cur) => (cur === lead.crm_id ? null : lead.crm_id))}
              />
            ))}
          </ul>
        </section>
      ))}

      {groups ? (
        <p className="mt-6 text-field-body text-ink-muted">
          Statuses come from the CRM and update about every half hour. Names, numbers and notes are deleted 90 days after the lead.
        </p>
      ) : null}
    </div>
  );
}

function refreshMessage(reply: RefreshReply): string {
  if (reply.ok) return reply.changed === 0 ? "Checked the CRM. Nothing has changed." : reply.changed === 1 ? "Updated 1 lead from the CRM." : `Updated ${reply.changed} leads from the CRM.`;
  switch (reply.error) {
    case "too_soon":
      return `Just refreshed. Try again in ${reply.retryAfterSec ?? 30} seconds.`;
    case "busy":
      return `The CRM is busy with another refresh. Try again in ${reply.retryAfterSec ?? 10} seconds.`;
    case "offline":
      return "No signal. Try again when you're back online.";
    case "not_linked":
      return "Your account isn't linked to the CRM yet. Ask your admin to add your CRM name.";
    case "not_signed_in":
      return "You've been signed out. Sign in again, then refresh.";
    default:
      return "Couldn't reach the CRM. Showing what you had; try again in a moment.";
  }
}

/** The status word on its CRM colour. The word is always there. */
export function StatusWord({ status }: { status: string | null }) {
  return (
    <span
      className={`inline-flex items-center rounded-field-sm px-2 py-0.5 text-admin-pill ${WEEK_STATUS_CHIP[weekStatusKey(status)]}`}
      data-testid="week-status"
    >
      {statusLabel(status)}
    </span>
  );
}

function WeekItem({ lead, open, onToggle }: { lead: WeekLead; open: boolean; onToggle: () => void }) {
  const panelId = useId();
  const lineId = useId();
  const name = contactName(lead);
  const address = callbackAddress(lead);
  const who = name ?? address;
  const sale = weekSaleLine(lead);
  return (
    <li data-testid="week-row">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${who}, details`}
        aria-describedby={lineId}
        className="flex w-full min-w-0 flex-col gap-1 py-3 pl-4 pr-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
        data-testid="week-toggle"
      >
        <span className="flex items-start gap-1">
          <span className={`text-base font-semibold text-ink ${name ? "truncate" : "break-words"}`}>{who}</span>
          <ChevronDownIcon
            className={`mt-0.5 size-5 shrink-0 text-ink-muted transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </span>
        {name ? <span className="block break-words text-field-body text-ink-muted">{address}</span> : null}
        <span id={lineId} className="flex flex-wrap items-center gap-2 text-field-body text-ink">
          <StatusWord status={lead.status} />
          <span className="text-ink-muted">{sale ?? weekAppointmentLine(lead)}</span>
        </span>
      </button>
      {open ? <WeekDetails id={panelId} lead={lead} /> : null}
    </li>
  );
}

function WeekDetails({ id, lead }: { id: string; lead: WeekLead }) {
  const details = callbackDetails(lead);
  const now = useMemo(() => new Date(), []);
  const call = useCallback((phone: string) => `tel:${phone}`, []);
  const sale = weekSaleLine(lead);
  return (
    <div id={id} className="border-t border-line bg-field-bg px-4 pb-4 pt-3" data-testid="week-details">
      <p className="flex items-center gap-2 text-field-body-strong text-ink">
        <StatusWord status={lead.status} />
      </p>
      <p className="mt-1 text-field-body text-ink-muted">{callbackBookedLine(lead, now)}</p>
      {sale ? <p className="text-field-body text-ink">{sale}</p> : null}
      <dl className="mt-3 space-y-3">
        {lead.phone ? (
          <div>
            <dt className="text-field-body-strong text-ink-muted">Phone</dt>
            <dd className="text-base text-ink">
              <a href={call(lead.phone)} className="inline-flex min-h-tap-min items-center font-semibold text-prop underline">
                {lead.phone}
              </a>
            </dd>
          </div>
        ) : null}
        {lead.alt_phone ? (
          <div>
            <dt className="text-field-body-strong text-ink-muted">Other phone</dt>
            <dd className="text-base text-ink">
              <a href={call(lead.alt_phone)} className="inline-flex min-h-tap-min items-center font-semibold text-prop underline">
                {lead.alt_phone}
              </a>
            </dd>
          </div>
        ) : null}
        {details.map((d) => (
          <div key={d.label}>
            <dt className="text-field-body-strong text-ink-muted">{d.label}</dt>
            <dd className="whitespace-pre-line break-words text-base text-ink">{d.value}</dd>
          </div>
        ))}
      </dl>
      {details.length === 0 && !lead.phone && !lead.alt_phone ? (
        <p className="mt-3 text-field-body text-ink-muted">No notes in the CRM for this lead yet. Tap Refresh from CRM to check.</p>
      ) : null}
      <p className="mt-3 text-field-body text-ink-muted">Copied from the CRM. Deleted 90 days after the lead date.</p>
    </div>
  );
}
