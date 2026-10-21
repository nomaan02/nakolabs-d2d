"use client";

import { useCallback, useEffect, useMemo } from "react";

import { StatusWord } from "@/components/field/crm/week-pane";
import { callbackAddress, dayAndTime, type WeekLead } from "@/lib/field/crm";
import { useLoad } from "@/lib/field/crm-data";
import { pendingLeads, pendingWhenLine } from "@/lib/field/pending";
import { fetchPendingWindow, useMinuteClock, useSeenBlowouts } from "@/lib/field/pending-data";

/**
 * PP-2 (owner 2026-10-21, Figma-equivalent mockup "PP-2 · Field Leads").
 * "Pending a result" at the top of the Leads tab's Today view: the
 * canvasser's OWN CRM leads from the last 14 days still waiting for the sit
 * (rules in `lib/field/pending.ts`). Read-only, except "Seen it" on a
 * blowout, which is remembered on this phone only and moves it to Call-backs.
 * Address and status only here; names, numbers and notes stay in This week
 * and Call-backs.
 */
export function PendingPane({ canvasserId, onCount }: { canvasserId: string; onCount: (n: number | null) => void }) {
  const load = useLoad(`pending:${canvasserId}`, () => fetchPendingWindow());
  const { reload } = load;
  // Back in the app: re-read the CRM rows (a lead may have been sat or rebooked meanwhile).
  const wake = useCallback(() => reload(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const now = useMinuteClock(wake);
  const { seen, markSeen } = useSeenBlowouts(canvasserId);
  const ready = load.kind === "ready" ? load.data : null;
  const leads = useMemo(() => (ready ? pendingLeads(ready, seen, now) : null), [ready, seen, now]);

  const count = leads ? leads.length : null;
  useEffect(() => onCount(count), [count, onCount]);

  if (load.kind === "offline" || load.kind === "error") {
    return (
      <p className="mx-auto mt-4 max-w-2xl px-4 text-field-body text-ink-muted" data-testid="pending-unavailable">
        {load.kind === "offline" ? "No signal. Pending leads from the CRM load when you’re back online." : "Pending leads from the CRM didn’t load."}
      </p>
    );
  }
  if (!leads || leads.length === 0) return null;

  return (
    <section className="mx-auto max-w-2xl px-4" aria-label="Pending a result" data-testid="pending-pane">
      <h2 className="mb-2 mt-4 text-admin-section text-ink-muted">Pending a result · from the CRM</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-field-lg border border-line bg-surface">
        {leads.map((lead) => (
          <PendingRow key={lead.crm_id} lead={lead} now={now} onSeen={() => markSeen(lead.crm_id)} />
        ))}
      </ul>
    </section>
  );
}

function PendingRow({ lead, now, onSeen }: { lead: WeekLead; now: Date; onSeen: () => void }) {
  const blowout = lead.status === "blowout";
  return (
    <li className="flex flex-col gap-1 px-4 py-3" data-testid="pending-row">
      <p className="break-words text-admin-headline text-ink">{callbackAddress(lead)}</p>
      <p className="flex flex-wrap items-center gap-2 text-field-body">
        <StatusWord status={lead.status} />
        <span className="text-ink-muted tabular-nums">{pendingWhenLine(lead, dayAndTime, now)}</span>
      </p>
      {blowout ? (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSeen}
            className="inline-flex min-h-tap-min items-center rounded-field-md border border-prop px-5 text-admin-button text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
            data-testid="pending-seen"
          >
            Seen it
          </button>
          <span className="text-field-body text-ink-muted">Moves it to Call-backs</span>
        </div>
      ) : null}
    </li>
  );
}
