"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CallbacksPane } from "@/components/field/crm/callbacks-pane";
import { PendingPane } from "@/components/field/crm/pending-pane";
import { Segmented } from "@/components/field/crm/segmented";
import { WeekPane } from "@/components/field/crm/week-pane";
import { useFieldData } from "@/components/field/field-data-provider";
import { FieldHeader, FieldPage } from "@/components/field/shell/field-header";
import { useCrmMe } from "@/lib/field/crm-data";
import { doorPlate, mapLabel } from "@/lib/field/labels";
import { leadsFromOutcomes } from "@/lib/field/local-outcomes";
import { isSameLondonDay } from "@/lib/field/london-date";
import { LEADS_VIEW_KEY, onLeadsViewRequest, parseLeadsView, type LeadsView } from "@/lib/field/nav";
import { todaySubtitle } from "@/lib/field/pending";

/**
 * Leads tab. Three views (CRM-5 C, Figma F1; This week added by CRM-7):
 *
 * - Today: read-only, this canvasser, today, in the order they were taken.
 *   Never aggregated by street or by prop (a per-street count is a quality
 *   signal — invariant 2). Nothing here writes: settlement is the office's.
 *   PP-2 (owner 2026-10-21): above them, "Pending a result" — this
 *   canvasser's OWN CRM leads still waiting for the sit
 *   (components/field/crm/pending-pane.tsx).
 * - Call-backs (AGENTS.md P4b exception, owner 2026-10-11): this
 *   canvasser's OWN CRM leads to ring back, with the result logged through
 *   the offline queue. See components/field/crm/callbacks-pane.tsx.
 * - This week (CRM-7, owner 2026-10-15): this canvasser's OWN CRM leads for
 *   the London week, logged in the app or not, with the CRM status as a
 *   coloured word and a Refresh from CRM button.
 *   See components/field/crm/week-pane.tsx.
 */

type View = LeadsView;

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
  const { phase, outcomes, labelFor, canvasserId } = useFieldData();
  return <LeadsScreen phase={phase} leads={leadsFromOutcomes(outcomes)} labelFor={labelFor} canvasserId={canvasserId} />;
}

type FieldData = ReturnType<typeof useFieldData>;

/** The tab without the field context, so it can be rendered on its own. */
export function LeadsScreen({
  phase,
  leads,
  labelFor,
  canvasserId,
}: {
  phase: FieldData["phase"];
  leads: ReturnType<typeof leadsFromOutcomes>;
  labelFor: FieldData["labelFor"];
  canvasserId: string | null;
}) {
  const me = useCrmMe(canvasserId);
  const [view, setView] = useState<View>("today");
  const [toCall, setToCall] = useState<number | null>(null);
  const [weekCount, setWeekCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    try {
      setView(parseLeadsView(window.localStorage.getItem(LEADS_VIEW_KEY)));
    } catch {
      // Private mode: start on Today.
    }
    // FUI-1b: the drawer's Leads and Call-backs items switch an open tab.
    return onLeadsViewRequest(setView);
  }, []);

  const choose = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(LEADS_VIEW_KEY, next);
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  };

  const onCount = useCallback((n: number | null) => setToCall(n), []);
  const onWeekCount = useCallback((n: number | null) => setWeekCount(n), []);
  const onPendingCount = useCallback((n: number | null) => setPendingCount(n), []);
  const linked = me.kind === "ready" && me.data.name !== null;
  const loggedCount = phase.kind === "ready" ? leads.length : null;
  const todayCount = loggedCount === null && pendingCount === null ? null : (loggedCount ?? 0) + (pendingCount ?? 0);
  // FUI-3 (owner 2026-10-15, Figma L1/L3): the header says what the view holds.
  const subtitle =
    view === "callbacks"
      ? toCall === null
        ? undefined
        : `${toCall} to call back`
      : view === "week"
        ? weekCount === null
          ? undefined
          : weekCount === 0
            ? "This week · no leads yet"
            : `This week · ${weekCount === 1 ? "1 lead" : `${weekCount} leads`}`
      : todaySubtitle(pendingCount, loggedCount);

  // FUI-1b (owner 2026-10-14, O3): the title and the view switch sit in the
  // fixed header; only the list scrolls.
  return (
    <FieldPage
      testId="leads-tab"
      header={
        <FieldHeader title="Leads" subtitle={subtitle}>
          <div className="mx-auto max-w-2xl px-4 pb-3">
            <Segmented<View>
              label="Leads view"
              value={view}
              onChange={choose}
              testId="leads-view"
              options={[
                { value: "today", label: <Count label="Today" n={todayCount} /> },
                { value: "week", label: <Count label="This week" n={weekCount} /> },
                { value: "callbacks", label: <Count label="Call-backs" n={toCall} accent /> },
              ]}
            />
          </div>
        </FieldHeader>
      }
    >

      {view === "week" ? (
        me.kind === "ready" && canvasserId ? (
          <WeekPane linked={linked} onCount={onWeekCount} />
        ) : (
          <p className="px-4 pt-6 text-field-body text-ink-muted">
            {me.kind === "offline" ? "No signal. Your week loads when you’re back online." : me.kind === "error" ? "Your week didn’t load. Reopen the tab to try again." : "Loading your week…"}
          </p>
        )
      ) : view === "callbacks" ? (
        me.kind === "ready" && canvasserId ? (
          <CallbacksPane canvasserId={canvasserId} linked={linked} onCount={onCount} />
        ) : (
          <p className="px-4 pt-6 text-field-body text-ink-muted">
            {me.kind === "offline" ? "No signal. Your call-backs load when you’re back online." : me.kind === "error" ? "Your call-backs didn’t load. Reopen the tab to try again." : "Loading your call-backs…"}
          </p>
        )
      ) : (
        <>
          {linked && canvasserId ? <PendingPane canvasserId={canvasserId} onCount={onPendingCount} /> : null}
          <TodayPane phase={phase} leads={leads} labelFor={labelFor} />
        </>
      )}
    </FieldPage>
  );
}

function Count({ label, n, accent = false }: { label: string; n: number | null; accent?: boolean }) {
  return (
    <>
      {label}
      {n !== null ? <span className={`ml-1.5 tabular-nums ${accent && n > 0 ? "text-prop" : "text-ink-muted"}`}>{n}</span> : null}
    </>
  );
}

function TodayPane({
  phase,
  leads,
  labelFor,
}: {
  phase: FieldData["phase"];
  leads: ReturnType<typeof leadsFromOutcomes>;
  labelFor: FieldData["labelFor"];
}) {
  if (phase.kind !== "ready") {
    return (
      <p className="px-4 pt-6 text-field-body text-ink-muted">
        {phase.kind === "loading" ? "Loading today's prop…" : "No prop today, so no leads."}
      </p>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <div className="flex flex-col gap-2 rounded-field-lg border border-line bg-surface p-5" data-testid="leads-empty">
          <h2 className="text-admin-headline text-ink">No leads yet today</h2>
          <p className="text-admin-body text-ink-muted">They appear here the moment you log one, before they sync.</p>
          <Link
            href="/field/logger"
            className="mt-2 inline-flex min-h-tap-min w-fit items-center rounded-field-md border border-prop px-5 text-admin-button text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
          >
            Go to Logger
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8">
      <h2 className="mb-2 mt-4 text-admin-section text-ink-muted">This prop · in the order you took them</h2>
      <ol className="divide-y divide-line overflow-hidden rounded-field-lg border border-line bg-surface">
        {leads.map((lead) => {
          const label = labelFor(lead.uprn);
          const immediate =
            lead.bookedFor !== null && isSameLondonDay(new Date(lead.bookedFor), new Date(lead.occurredAt));
          return (
            <li key={lead.clientEventId} className="flex flex-col gap-0.5 px-4 py-3">
              <p className="text-admin-headline text-ink">{mapLabel(label) ?? doorPlate(label)}</p>
              <p className="text-admin-subhead text-ink-muted tabular-nums">
                Logged {TIME.format(new Date(lead.occurredAt))}
                {lead.undoable ? " · still undoable" : ""}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-admin-subhead text-ink">
                <span>
                  {lead.bookedFor ? `Appointment ${WHEN.format(new Date(lead.bookedFor))}` : "No appointment time booked"}
                </span>
                {immediate ? (
                  <span
                    className="inline-flex items-center rounded-field-sm bg-lead px-2 py-0.5 text-xs font-semibold text-paper"
                    data-testid="lead-immediate-badge"
                  >
                    Immediate
                  </span>
                ) : null}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
