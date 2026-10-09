import Link from "next/link";
import type { ReactNode } from "react";

import { LeadMarkDot, MARK_TEXT } from "@/components/admin/leads/lead-mark";
import { PeriodChips } from "@/components/admin/team/period-chips";
import { Avatar } from "@/components/admin/ui/avatar";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/field/icons";
import { calendarHref, OUTCOME_ROWS, type OutcomeCounts } from "@/lib/admin/calendar";
import { outcomeGroup, outcomeWords } from "@/lib/admin/coverage-filters";
import { doorTitle, leadMark, leadStatusLabel, whenLine } from "@/lib/admin/leads";
import { initialOf } from "@/lib/admin/nav";
import { dayDate } from "@/lib/admin/props";
import {
  TEAM_PERIODS,
  contactToLead,
  dayLine,
  doorsCount,
  funnel,
  percentText,
  profileHref,
  profileLine,
  teamHref,
  type DayRow,
  type FunnelStep,
  type PersonStats,
  type TeamPerson,
  type TeamPeriod,
} from "@/lib/admin/team";

export type ProfileDoor = { key: string; uprn: number; door: string | null; prop: string; outcome: string; occurredAt: string };
export type ProfileLead = { id: string; uprn: number; door: string | null; prop: string; occurredAt: string; status: string };

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

const STEP_FILL: Record<FunnelStep["key"], string> = {
  contact: "bg-outcome-contact",
  lead: "bg-outcome-lead",
  sale: "bg-lead",
};

const SEGMENT_FILL: Partial<Record<keyof OutcomeCounts, string>> = {
  contacts: "bg-outcome-contact",
  leads: "bg-outcome-lead",
  rented: "bg-outcome-rented-edge",
  notIn: "bg-outcome-notin",
};

const DOT_FILL: Record<string, string> = {
  contact: "bg-outcome-contact",
  lead: "bg-outcome-lead",
  rented: "bg-outcome-rented-edge",
  notin: "bg-outcome-notin",
  other: "bg-ink-faint",
};

/**
 * UI-10 F5c (owner A9; owner 2026-10-09: "a full profile on the
 * canvasser"). One canvasser: the period's numbers, conversions against
 * all time, the outcome breakdown, and their recent leads, days and doors.
 * Read-only; admin only (invariant 2). Doors are address labels or UPRNs,
 * never residents; lead statuses are the office's.
 */
export function CanvasserProfile({
  person,
  period,
  periodText,
  today,
  stats,
  allTime,
  days,
  doors,
  leads,
}: {
  person: TeamPerson;
  period: TeamPeriod;
  periodText: string;
  today: string;
  stats: PersonStats;
  allTime: PersonStats;
  days: DayRow[];
  doors: ProfileDoor[];
  leads: ProfileLead[];
}) {
  const periodName = TEAM_PERIODS.find((option) => option.value === period)?.label ?? "";
  const steps = funnel(stats);
  const allSteps = funnel(allTime);
  const empty = stats.doors === 0;
  const conversion = contactToLead(stats);

  return (
    <main className="mx-auto max-w-2xl px-4 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] lg:max-w-5xl lg:px-10 lg:pt-8">
      <Link
        href={teamHref(period)}
        className="-ml-2 inline-flex min-h-11 items-center gap-0.5 pr-2 text-admin-body text-prop focus-visible:outline-2 focus-visible:outline-prop"
      >
        <ChevronLeftIcon className="size-6" />
        Team
      </Link>

      <header className="mt-1 flex items-center gap-3">
        <Avatar initial={initialOf(person.name)} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-admin-large-title">{person.name}</h1>
          <p className="text-admin-subhead text-ink-muted">{profileLine(person, stats, period)}</p>
        </div>
      </header>

      <div className="mt-3">
        <PeriodChips links={TEAM_PERIODS.map((option) => ({ label: option.label, href: profileHref(person.id, option.value), on: option.value === period }))} />
        <p className="mt-1 text-admin-caption text-ink-muted">{periodText}</p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <section aria-label="Numbers" className="rounded-field-lg bg-surface p-4 lg:border lg:border-line">
            <dl className="grid grid-cols-3 gap-3">
              {[
                { label: "Doors", value: n(stats.doors) },
                { label: "Contacts", value: n(stats.contacts) },
                { label: "Leads", value: n(stats.leads) },
              ].map((figure) => (
                <div key={figure.label} className="flex flex-col-reverse">
                  <dt className="text-admin-subhead text-ink-muted">{figure.label}</dt>
                  <dd className="text-admin-figure tabular-nums">{figure.value}</dd>
                </div>
              ))}
            </dl>
            <dl className="mt-3 border-t border-line pt-1">
              <div className="flex min-h-9 items-center justify-between">
                <dt className="text-admin-subhead text-ink-muted">Contact → lead</dt>
                <dd className={`text-admin-body-strong tabular-nums ${conversion === null ? "text-ink-muted" : "text-lead"}`}>{percentText(conversion)}</dd>
              </div>
              <div className="flex min-h-9 items-center justify-between">
                <dt className="text-admin-subhead text-ink-muted">Doors answered</dt>
                <dd className="text-admin-subhead text-ink-muted tabular-nums">{n(stats.answered)}</dd>
              </div>
            </dl>
          </section>

          <Section title="Conversions">
            <div className="rounded-field-lg bg-surface lg:border lg:border-line">
              {steps.map((step, index) => (
                <div key={step.key} className={`px-4 py-3.5 ${index > 0 ? "border-t border-line" : ""}`}>
                  <p className="text-admin-body-strong">{step.label}</p>
                  <div className="mt-2 flex flex-col gap-2.5">
                    <RateLine name={periodName} step={step} />
                    {period !== "all" ? <RateLine name="All time" step={allSteps[index]!} quiet /> : null}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-1.5 px-1 text-admin-caption text-ink-muted">Here a lead also counts as a contact: it was one before it was booked. Sales are out of the leads the office has settled.</p>
          </Section>

          <Section title="Outcomes">
            <div className="rounded-field-lg bg-surface p-4 lg:border lg:border-line">
              {empty ? (
                <p className="text-admin-body text-ink-muted">No doors {periodPhraseOf(period)}.</p>
              ) : (
                <>
                  <OutcomeBar outcomes={stats.outcomes} total={stats.doors} />
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5">
                    {OUTCOME_ROWS.filter((row) => stats.outcomes[row.key] > 0).map((row) => (
                      <div key={row.key} className="flex items-center gap-2">
                        <span aria-hidden className={`size-2 shrink-0 rounded-full ${SEGMENT_FILL[row.key] ?? "bg-ink-faint"}`} />
                        <dt className="min-w-0 flex-1 truncate text-admin-subhead text-ink-soft">{row.label}</dt>
                        <dd className="text-admin-subhead tabular-nums">{n(stats.outcomes[row.key])}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </div>
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Section title="Recent leads">
            <List empty={leads.length === 0 ? `No leads ${periodPhraseOf(period)}.` : null}>
              {leads.map((lead) => (
                <Row key={lead.id} title={doorTitle(lead)} meta={`${lead.prop} · ${whenLine(lead.occurredAt, today)}`}>
                  <span className={`flex items-center gap-1.5 text-admin-pill ${MARK_TEXT[leadMark(lead.status)]}`}>
                    <LeadMarkDot status={lead.status} />
                    {leadStatusLabel(lead.status)}
                  </span>
                </Row>
              ))}
            </List>
          </Section>

          <Section title="Recent days">
            <List empty={days.length === 0 ? `No days ${periodPhraseOf(period)}.` : null}>
              {days.map((day) => (
                <li key={day.date} className="border-t border-line first:border-t-0">
                  <Link
                    href={calendarHref(day.date.slice(0, 7), day.date)}
                    className="flex min-h-14 items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-admin-body-strong">{dayDate(day.date)}</span>
                      <span className="block truncate text-admin-subhead text-ink-muted">{dayLine(day)}</span>
                    </span>
                    <span className="shrink-0 text-admin-subhead text-ink-soft tabular-nums">{doorsCount(day.doors)}</span>
                    <ChevronRightIcon className="size-5 shrink-0 text-ink-faint" />
                  </Link>
                </li>
              ))}
            </List>
          </Section>

          <Section title="Recent doors">
            <List empty={doors.length === 0 ? `No doors ${periodPhraseOf(period)}.` : null}>
              {doors.map((door) => (
                <Row key={door.key} title={doorTitle(door)} meta={`${door.prop} · ${whenLine(door.occurredAt, today)}`}>
                  <span className="flex items-center gap-1.5 text-admin-subhead text-ink-soft">
                    <span aria-hidden className={`size-2 rounded-full ${DOT_FILL[outcomeGroup(door.outcome)] ?? "bg-ink-faint"}`} />
                    {outcomeWords(door.outcome)}
                  </span>
                </Row>
              ))}
            </List>
          </Section>
        </div>
      </div>
    </main>
  );
}

function periodPhraseOf(period: TeamPeriod): string {
  if (period === "week") return "this week";
  if (period === "4w") return "in the last 4 weeks";
  return "yet";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1.5 px-1 text-admin-section text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}

function List({ empty, children }: { empty: string | null; children: ReactNode }) {
  return (
    <ul className="rounded-field-lg bg-surface lg:border lg:border-line">
      {empty ? <li className="px-4 py-4 text-admin-body text-ink-muted">{empty}</li> : children}
    </ul>
  );
}

function Row({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return (
    <li className="flex min-h-14 items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-admin-body-strong">{title}</span>
        <span className="block truncate text-admin-subhead text-ink-muted">{meta}</span>
      </span>
      <span className="shrink-0">{children}</span>
    </li>
  );
}

/** One conversion for one period: the share as a figure and a bar, and what it is out of. */
function RateLine({ name, step, quiet = false }: { name: string; step: FunnelStep; quiet?: boolean }) {
  const width = step.rate === null ? 0 : Math.round(step.rate * 100);
  return (
    <div className="grid grid-cols-[5.5rem_3rem_1fr] items-center gap-x-2">
      <span className="text-admin-caption text-ink-muted">{name}</span>
      <span className={`text-right tabular-nums ${quiet ? "text-admin-body text-ink-soft" : "text-admin-headline"}`}>{percentText(step.rate)}</span>
      <span aria-hidden className="h-2 overflow-hidden rounded-full bg-field-bg">
        <span className={`block h-full rounded-full ${STEP_FILL[step.key]} ${quiet ? "opacity-50" : ""}`} style={{ width: `${width}%` }} />
      </span>
      <span className="col-start-3 text-admin-caption text-ink-muted">{step.detail}</span>
    </div>
  );
}

function OutcomeBar({ outcomes, total }: { outcomes: OutcomeCounts; total: number }) {
  const other = total - outcomes.contacts - outcomes.leads - outcomes.rented - outcomes.notIn;
  const segments = [
    { key: "contacts", value: outcomes.contacts, fill: "bg-outcome-contact" },
    { key: "leads", value: outcomes.leads, fill: "bg-outcome-lead" },
    { key: "rented", value: outcomes.rented, fill: "bg-outcome-rented-edge" },
    { key: "notIn", value: outcomes.notIn, fill: "bg-outcome-notin" },
    { key: "other", value: other, fill: "bg-ink-faint" },
  ].filter((segment) => segment.value > 0);
  return (
    <div aria-hidden className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-field-bg">
      {segments.map((segment) => (
        <span key={segment.key} className={`h-full ${segment.fill}`} style={{ flexGrow: segment.value, flexBasis: 0 }} />
      ))}
    </div>
  );
}
