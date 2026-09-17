"use client";

import { useFieldData } from "@/components/field/field-data-provider";
import { doorPlate, mapLabel } from "@/lib/field/labels";
import { leadsFromOutcomes } from "@/lib/field/local-outcomes";

/**
 * Read-only. This canvasser, today, in the order they were taken.
 *
 * Never aggregated by street or by prop. A per-street lead count is a quality
 * signal, and a quality signal in the field view is cherry-picking fuel —
 * invariant 2. There is nothing to total here and nothing to sort by.
 *
 * Nothing on this screen writes. Field code never updates `leads`: a
 * canvasser has no UPDATE policy, so the write would match zero rows and
 * return no error, the queue would mark it synced, and nothing would have
 * happened. Settlement is the office's job.
 */

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

const WHEN = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

export function LeadsTab() {
  const { phase, outcomes, labelFor } = useFieldData();
  const leads = leadsFromOutcomes(outcomes);

  if (phase.kind !== "ready") {
    return (
      <p className="px-4 pt-8 text-sm text-ink-soft">
        {phase.kind === "loading" ? "Loading today's prop…" : "No prop today, so no leads."}
      </p>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-worksheet" data-testid="leads-tab">
      <header className="border-b border-ink/15 bg-paper px-4 py-3">
        <h1 className="font-display text-lg tracking-tight">Leads taken today</h1>
        <p className="font-data text-xs text-ink-soft">
          {leads.length === 1 ? "1 lead" : `${leads.length} leads`} · this prop
        </p>
      </header>

      {leads.length === 0 ? (
        <p className="px-4 pt-6 text-sm leading-relaxed text-ink-soft">
          No leads yet today. They appear here the moment you log one, before they sync.
        </p>
      ) : (
        <ol className="divide-y divide-ink/10 bg-paper">
          {leads.map((lead) => {
            const label = labelFor(lead.uprn);
            return (
              <li key={lead.clientEventId} className="px-4 py-3">
                <p className="font-display text-base tracking-tight">
                  ★ {mapLabel(label) ?? doorPlate(label)}
                </p>
                <p className="mt-0.5 font-data text-xs text-ink-soft">
                  Logged {TIME.format(new Date(lead.occurredAt))}
                  {lead.undoable ? " · still undoable" : ""}
                </p>
                <p className="mt-1 text-sm">
                  {lead.bookedFor
                    ? `Appointment ${WHEN.format(new Date(lead.bookedFor))}`
                    : "No appointment time booked"}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
