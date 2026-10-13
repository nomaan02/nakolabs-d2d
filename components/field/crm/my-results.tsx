"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PeriodSelect, readPeriod, savePeriod } from "@/components/field/crm/period-select";
import { ChevronLeftIcon, ChevronRightIcon, TrophyIcon } from "@/components/field/icons";
import {
  boardSummary,
  clock,
  dayAndTime,
  doorLine,
  myTotals,
  PERIOD_WORDS,
  periodSpan,
  pounds,
  poundsShort,
  rankBoard,
  rate,
  shiftWeek,
  statusLabel,
  statusTone,
  TONE_FILL,
  TONE_LABEL,
  TONE_ORDER,
  TONE_SQUARE,
  weekDays,
  weekStart,
  weekTitle,
  londonMidnight,
  type CrmStatus,
  type MyCrmLead,
  type ResultPeriod,
} from "@/lib/field/crm";
import { fetchLeaderboard, fetchMyLeads, useLoad, type CrmMe } from "@/lib/field/crm-data";
import { londonDate } from "@/lib/field/london-date";

/**
 * CRM-5 C, Figma F3 (185:497). The You tab's own-CRM block: my results for
 * a period, a link to the leaderboard with my place, and my week. Own leads
 * only (AGENTS.md P4b exception).
 */
export function MyResults({ me }: { me: CrmMe }) {
  const [period, setPeriod] = useState<ResultPeriod>("month");
  useEffect(() => setPeriod(readPeriod("month")), []);
  const span = periodSpan(period, new Date());

  const leads = useLoad(`mine:${span.from}`, () => fetchMyLeads(span.from, span.to));
  const board = useLoad(`board:${span.from}`, () => fetchLeaderboard(span.from, span.to));
  const totals = leads.kind === "ready" ? myTotals(leads.data) : null;
  const summary = useMemo(() => {
    if (board.kind !== "ready") return null;
    return boardSummary(rankBoard(board.data, "pitched", me), board.data.length, PERIOD_WORDS[period]);
  }, [board, me, period]);

  const choose = (p: ResultPeriod) => {
    setPeriod(p);
    savePeriod(p);
  };

  return (
    <div className="mx-auto max-w-2xl px-4" data-testid="my-results">
      <div className="mt-4 flex items-center gap-3">
        <PeriodSelect value={period} onChange={choose} testId="my-results-period" />
        <span className="text-field-body text-ink-muted">
          {span.line}
          {totals ? ` · ${totals.leads === 1 ? "1 lead" : `${totals.leads} leads`}` : ""}, by date booked
        </span>
      </div>

      <section className="mt-4 rounded-field-lg border border-line bg-surface p-4" aria-label="My results">
        {totals === null ? (
          <p className="text-field-body text-ink-muted">
            {leads.kind === "offline" ? "No signal. Your results load when you’re back online." : leads.kind === "error" ? "Your results didn’t load." : "Loading your results…"}
          </p>
        ) : (
          <Totals totals={totals} />
        )}
      </section>

      <Link
        href="/field/profile/leaderboard"
        className="mt-4 flex min-h-16 items-center gap-3 rounded-field-lg border border-line bg-surface px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
        data-testid="my-results-leaderboard"
      >
        <TrophyIcon className="size-6 shrink-0 text-prop" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">Leaderboard</span>
          <span className="block truncate text-field-body text-ink-muted">{summary ?? "Bristol branches"}</span>
        </span>
        <ChevronRightIcon className="size-5 shrink-0 text-ink-muted" />
      </Link>

      <MyWeek />
    </div>
  );
}

function Totals({ totals }: { totals: ReturnType<typeof myTotals> }) {
  const shown = TONE_ORDER.filter((t) => totals.tones[t] > 0);
  return (
    <>
      <dl className="grid grid-cols-3 gap-2">
        <Big value={String(totals.pitched)} label="Pitched" />
        <Big value={String(totals.sold)} label="Sold" />
        <Big value={totals.salesWithAmount > 0 ? poundsShort(totals.value) : "–"} label="Sales value" right />
      </dl>
      {totals.leads > 0 ? (
        <>
          <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {shown.map((t) => (
              <span key={t} className={`${TONE_FILL[t]} h-full`} style={{ flexGrow: totals.tones[t] }} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-field-body text-ink">
            {shown.map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <span aria-hidden className={`size-2.5 rounded-sm border-2 ${TONE_SQUARE[t]}`} />
                {TONE_LABEL[t]} {totals.tones[t]}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-field-body text-ink-muted">No CRM leads booked in this period yet.</p>
      )}
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
        <Small value={rate(totals.sold, totals.pitched)} label="Pitch → sale" sub={`${totals.sold} of ${totals.pitched}`} />
        <Small value={rate(totals.sat, totals.satOf)} label="Sit rate" sub={`${totals.sat} of ${totals.satOf}`} />
        <Small
          value={totals.salesWithAmount > 0 ? pounds(totals.value / totals.salesWithAmount) : "–"}
          label="Average sale"
          sub={totals.salesWithAmount === 1 ? "1 sale" : `${totals.salesWithAmount} sales`}
        />
      </dl>
    </>
  );
}

function Big({ value, label, right = false }: { value: string; label: string; right?: boolean }) {
  return (
    <div className={right ? "text-right" : ""}>
      <dd className="text-field-figure tabular-nums text-ink">{value}</dd>
      <dt className="text-field-body text-ink-muted">{label}</dt>
    </div>
  );
}

function Small({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div>
      <dd className="text-base font-semibold tabular-nums text-ink">{value}</dd>
      <dt className="text-field-body text-ink">{label}</dt>
      <dd className="text-field-body text-ink-muted tabular-nums">{sub}</dd>
    </div>
  );
}

const DAY_TITLE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function dayTitle(day: string): string {
  return DAY_TITLE.format(new Date(`${day}T12:00:00Z`)).replace(",", "");
}

function MyWeek() {
  const today = londonDate(new Date());
  const [start, setStart] = useState(() => weekStart(today));
  const [selected, setSelected] = useState(today);
  const end = shiftWeek(start, 1);
  const leads = useLoad(`week:${start}`, () => fetchMyLeads(londonMidnight(start), londonMidnight(end)));
  const days = weekDays(start, leads.kind === "ready" ? leads.data : [], new Date());
  const isThisWeek = start === weekStart(today);
  const chosen = days.find((d) => d.day === selected) ?? null;

  const move = (weeks: number) => {
    const next = shiftWeek(start, weeks);
    setStart(next);
    setSelected(next === weekStart(today) ? today : next);
  };

  return (
    <section className="mb-6 mt-4 rounded-field-lg border border-line bg-surface p-4" aria-label="My week" data-testid="my-week">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">
          {isThisWeek ? "This week" : "Week"} · {weekTitle(start)}
        </h2>
        <div className="flex">
          <button type="button" aria-label="Previous week" onClick={() => move(-1)} className="flex size-tap-min items-center justify-center text-ink">
            <ChevronLeftIcon className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next week"
            disabled={isThisWeek}
            onClick={() => move(1)}
            className="flex size-tap-min items-center justify-center text-ink disabled:text-ink-faint"
          >
            <ChevronRightIcon className="size-5" />
          </button>
        </div>
      </header>

      <div role="radiogroup" aria-label="Day" className="mt-2 grid grid-cols-7 gap-1">
        {days.map((d) => {
          const on = d.day === selected;
          return (
            <button
              key={d.day}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${dayTitle(d.day)}, ${d.leads.length === 1 ? "1 lead" : `${d.leads.length} leads`}`}
              disabled={d.future}
              onClick={() => setSelected(d.day)}
              className={`flex min-h-16 flex-col items-center justify-center rounded-field-md ${on ? "bg-prop-soft text-prop" : d.future ? "text-ink-faint" : "text-ink"}`}
            >
              <span className="text-field-body">{d.letter}</span>
              <span className="text-xl font-semibold tabular-nums">{d.date}</span>
              <span className="mt-0.5 flex h-2 gap-0.5" aria-hidden>
                {d.leads.slice(0, 4).map((l) => (
                  <span key={l.crm_id} className={`size-1.5 rounded-full ${TONE_FILL[statusTone(l.status)]}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {chosen ? <DayList day={chosen.day} leads={chosen.leads} loading={leads.kind !== "ready"} /> : null}
    </section>
  );
}

function DayList({ day, leads, loading }: { day: string; leads: MyCrmLead[]; loading: boolean }) {
  const title = dayTitle(day);
  return (
    <div className="mt-3">
      <h3 className="text-field-body-strong text-ink-muted">
        {title} · {loading ? "loading" : leads.length === 1 ? "1 lead" : `${leads.length} leads`}
      </h3>
      {!loading && leads.length > 0 ? (
        <ul className="mt-1 divide-y divide-line">
          {leads.map((l) => (
            <li key={l.crm_id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-ink">{doorLine(l)}</p>
                <p className="text-field-body text-ink-muted tabular-nums">
                  Booked {clock(l.crm_created_at)}
                  {l.appointment_at ? ` · sat ${dayAndTime(l.appointment_at)}` : ""}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-field-body text-ink">
                <span aria-hidden className={`size-2.5 rounded-sm border-2 ${TONE_SQUARE[statusTone(l.status)]}`} />
                {statusLabel(l.status as CrmStatus)}
                {l.status === "sale" && l.sale_amount !== null ? ` · ${pounds(l.sale_amount)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
