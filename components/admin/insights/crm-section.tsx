"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { Segmented } from "@/components/admin/ui/segmented";
import { Sheet } from "@/components/admin/ui/sheet";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "@/components/field/icons";
import {
  OUTCOME_SEGMENTS,
  PROP_SORTS,
  SEGMENT_LABEL,
  axisLabel,
  axisTicks,
  columnReadout,
  columnTitle,
  crmHref,
  outcomeSummary,
  pounds,
  sortedProps,
  type AreaRow,
  type ConfirmedDay,
  type CrmCounts,
  type CrmFigure,
  type CrmPeriod,
  type OutcomeColumn,
  type OutcomeSegment,
  type PropRow,
  type PropSort,
  type SplitRow,
} from "@/lib/admin/crm-insights";

/** Segment fills: three validated hues, then two neutrals (UTC, Other). Tokens only (globals.css). */
const SEGMENT_FILL: Record<OutcomeSegment, string> = {
  sale: "bg-crm-sale",
  pm: "bg-crm-pm",
  blowout: "bg-crm-blowout",
  utc: "bg-outcome-notin",
  other: "bg-line",
};

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

/** Share → a CSS length; data-driven, so it is a style, not a class. */
function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "0%";
}

export type CrmSectionData = {
  hero: CrmFigure[];
  rates: CrmFigure[];
  split: SplitRow[];
  totals: CrmCounts;
  columns: OutcomeColumn[];
  byDay: boolean;
  areas: { best: AreaRow[]; worst: AreaRow[]; ranked: number };
  areaMin: number;
  props: PropRow[];
};

/**
 * CRM-2 C (owner 2026-10-10; Figma CRM-2 C1, C2, C9, D1 approved). The
 * "Company CRM" view of Insights. Booked this week comes first and ignores
 * the period. One period button opens a sheet (links, so Back works). The
 * hero shows where every lead went; one chart switches Leads / Value and
 * reads out the chosen month (tap, drag, hover or arrow keys). Areas switch
 * Best / Worst; props sort three ways. Read-only, admin and office only.
 */
export function CrmSection({
  today,
  period,
  periodLabel,
  windowLine,
  periods,
  booked,
  bookedCount,
  data,
  failed,
  longer,
}: {
  today: string;
  period: CrmPeriod;
  periodLabel: string;
  windowLine: string;
  periods: Array<{ value: CrmPeriod; label: string; span: string }>;
  booked: ConfirmedDay[];
  bookedCount: number;
  data: CrmSectionData | null;
  failed: string | null;
  longer: { label: string; href: string } | null;
}) {
  const [sheet, setSheet] = useState(false);

  if (failed) {
    return (
      <div className="mt-4">
        <PeriodRow label={periodLabel} line={windowLine} onOpen={() => setSheet(true)} />
        <div role="alert" className="mt-2 rounded-field-lg bg-surface p-4 lg:border lg:border-line">
          <p className="text-admin-body-strong">CRM figures didn’t load</p>
          <p className="mt-1 text-admin-subhead text-ink-muted">Check your connection, then try again. Canvassing figures are unaffected.</p>
          <Link
            href={crmHref(period)}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-field-md border border-line text-admin-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
          >
            Try again
          </Link>
        </div>
        <PeriodSheet open={sheet} period={period} periods={periods} onClose={() => setSheet(false)} />
      </div>
    );
  }

  return (
    <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-x-6">
      <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2">
        <Booked days={booked} count={bookedCount} />
      </div>

      <div className="mt-6 lg:col-start-1 lg:row-start-1 lg:mt-0">
        <PeriodRow label={periodLabel} line={windowLine} onOpen={() => setSheet(true)} />
        {!data || data.totals.leads === 0 ? (
          <div className="mt-2 rounded-field-lg bg-surface p-4 lg:border lg:border-line">
            <p className="text-admin-body-strong">No CRM leads booked {period === "week" ? "yet this week" : "in this period"}</p>
            <p className="mt-1 text-admin-subhead text-ink-muted">Leads appear here the morning after they are booked in the CRM.</p>
            {longer ? (
              <Link
                href={longer.href}
                scroll={false}
                className="mt-2 inline-flex min-h-11 items-center text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
              >
                {longer.label}
              </Link>
            ) : null}
          </div>
        ) : (
          <Hero data={data} />
        )}
      </div>

      {data && data.totals.leads > 0 ? (
        <>
          <div className="mt-6 lg:col-span-2">
            <OutcomeChart columns={data.columns} totals={data.totals} byDay={data.byDay} today={today} />
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:col-span-2 lg:grid-cols-2 lg:items-start">
            <Areas areas={data.areas} min={data.areaMin} />
            <Props rows={data.props} />
          </div>
        </>
      ) : null}

      <PeriodSheet open={sheet} period={period} periods={periods} onClose={() => setSheet(false)} />
    </div>
  );
}

// ---- pieces ----------------------------------------------------------------------

function SectionLabel({ children, control }: { children: ReactNode; control?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-1">
      <h2 className="text-admin-section text-ink-muted">{children}</h2>
      {control}
    </div>
  );
}

function PeriodRow({ label, line, onOpen }: { label: string; line: string; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="group inline-flex h-11 shrink-0 items-center focus-visible:outline-none"
      >
        <span className="inline-flex h-9 items-center gap-1 rounded-full bg-ink pr-3 pl-3.5 text-admin-pill text-paper group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-prop">
          {label}
          <ChevronDownIcon className="size-4" />
        </span>
      </button>
      <p className="text-admin-caption text-ink-muted">{line}, by date booked</p>
    </div>
  );
}

function PeriodSheet({
  open,
  period,
  periods,
  onClose,
}: {
  open: boolean;
  period: CrmPeriod;
  periods: Array<{ value: CrmPeriod; label: string; span: string }>;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Period" subtitle="By the date each lead was booked" onClose={onClose}>
      <ul aria-label="Period" className="px-5 pb-4">
        {periods.map((option) => {
          const on = option.value === period;
          return (
            <li key={option.value} className="border-b border-line last:border-b-0">
              <Link
                href={crmHref(option.value)}
                scroll={false}
                aria-current={on ? "page" : undefined}
                onClick={onClose}
                className="flex min-h-13 items-center gap-3 py-1.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
              >
                <span className="min-w-0 flex-1">
                  <span className={`block ${on ? "text-admin-body-strong" : "text-admin-body"}`}>{option.label}</span>
                  <span className="block text-admin-caption text-ink-muted">{option.span}</span>
                </span>
                {on ? <CheckIcon className="size-5 text-prop" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function Booked({ days, count }: { days: ConfirmedDay[]; count: number }) {
  return (
    <section aria-label="Booked this week">
      <SectionLabel>{count === 1 ? "1 booked this week" : `${n(count)} booked this week`}</SectionLabel>
      <div className="rounded-field-lg bg-surface px-4 py-2.5 lg:border lg:border-line">
        {days.length === 0 ? (
          <p className="py-1.5 text-admin-subhead text-ink-muted">No confirmed appointments this week.</p>
        ) : (
          <ul>
            {days.map((day) => (
              <li key={day.day}>
                <h3 className="pt-1 text-admin-caption text-ink-muted">{day.label}</h3>
                <ul>
                  {day.rows.map((row) => (
                    <li key={row.key} className="flex items-start gap-3 py-2">
                      <span className="w-12 shrink-0 text-admin-body-strong tabular-nums">{row.time}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-admin-body">{row.place}</span>
                        {row.meta ? <span className="block text-admin-caption text-ink-muted">{row.meta}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Hero({ data }: { data: CrmSectionData }) {
  return (
    <section aria-label="This period" className="mt-2 rounded-field-lg bg-surface p-4 lg:border lg:border-line">
      <dl className="grid grid-cols-3 gap-2">
        {data.hero.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col-reverse" title={f.detail ?? undefined}>
            <dt className="text-admin-caption text-ink-muted">{f.label}</dt>
            <dd className="truncate text-admin-figure tabular-nums">{f.value}</dd>
          </div>
        ))}
      </dl>

      <div aria-hidden className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full">
        {data.split
          .filter((row) => row.count > 0)
          .map((row) => (
            <span key={row.segment} className={`block h-full min-w-0.5 ${SEGMENT_FILL[row.segment]}`} style={{ flexGrow: row.count, flexBasis: 0 }} />
          ))}
      </div>
      <ul aria-label="Where leads went" className="mt-3">
        {data.split.map((row) => (
          <li key={row.segment} className="flex min-h-7 items-center gap-2.5 text-admin-subhead">
            <span aria-hidden className={`size-2.5 shrink-0 rounded-sm ${SEGMENT_FILL[row.segment]} ${row.segment === "other" ? "ring-1 ring-ink-faint" : ""}`} />
            <span className="min-w-0 flex-1">{row.label}</span>
            <span className="tabular-nums">{n(row.count)}</span>
            <span className="w-10 text-right text-ink-muted tabular-nums">{row.percent}</span>
          </li>
        ))}
      </ul>
      <p className="text-admin-caption text-ink-muted">Other: confirmed, rescheduled or no outcome yet</p>

      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
        {data.rates.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col-reverse">
            <dt className="text-admin-caption">
              {f.label}
              {f.detail ? <span className="block text-ink-muted">{f.detail}</span> : null}
            </dt>
            <dd className="text-admin-headline tabular-nums">{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function OutcomeChart({ columns, totals, byDay, today }: { columns: OutcomeColumn[]; totals: CrmCounts; byDay: boolean; today: string }) {
  const [mode, setMode] = useState<"leads" | "value">("leads");
  const [chosen, setChosen] = useState(columns.length - 1);
  const [hover, setHover] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement | null>(null);
  const index = Math.min(Math.max(0, hover ?? chosen), columns.length - 1);
  const col = columns[index];
  const peak = Math.max(1, ...columns.map((c) => (mode === "leads" ? c.leads : c.revenue)));
  const hasValue = columns.some((c) => c.revenue > 0);
  const phoneTicks = useMemo(() => new Set(axisTicks(columns.length, columns.length <= 12 ? 12 : 6)), [columns.length]);
  const deskTicks = useMemo(() => new Set(axisTicks(columns.length, 12)), [columns.length]);
  if (!col) return null;
  const readout = columnReadout(col, today, mode);

  const at = (event: PointerEvent<HTMLDivElement>): number => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || box.width === 0) return index;
    return Math.min(columns.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * columns.length)));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "End" ? columns.length : event.key === "Home" ? -columns.length : 0;
    if (step === 0) return;
    event.preventDefault();
    setHover(null);
    setChosen(Math.min(columns.length - 1, Math.max(0, index + step)));
  };

  return (
    <section aria-label={byDay ? "By day" : "By month"}>
      <SectionLabel>{byDay ? "By day" : "By month"}</SectionLabel>
      <div className="rounded-field-lg bg-surface p-4 lg:border lg:border-line lg:px-5">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0" aria-live="polite">
            <span className="block text-admin-caption text-ink-muted">{readout.title}</span>
            <span className="block text-admin-body-strong tabular-nums">{readout.line}</span>
          </p>
          {hasValue ? (
            <Segmented
              label="Chart shows"
              options={[
                { value: "leads", label: "Leads" },
                { value: "value", label: "Value" },
              ]}
              value={mode}
              onChange={setMode}
            />
          ) : null}
        </div>

        <p className="sr-only">{outcomeSummary(columns, totals)} Use the left and right arrow keys to read each {byDay ? "day" : "month"}.</p>
        <div
          ref={plot}
          role="slider"
          tabIndex={0}
          aria-label={`Choose a ${byDay ? "day" : "month"}`}
          aria-valuemin={1}
          aria-valuemax={columns.length}
          aria-valuenow={index + 1}
          aria-valuetext={columnTitle(col)}
          onKeyDown={onKey}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setChosen(at(event));
            setHover(null);
          }}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse" && event.buttons === 0) setHover(at(event));
            else if (event.buttons > 0) setChosen(at(event));
          }}
          onPointerLeave={() => setHover(null)}
          className="mt-4 flex h-36 cursor-pointer touch-pan-y items-end gap-px rounded-field-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-prop sm:gap-0.5 lg:h-48"
        >
          {columns.map((c, i) => {
            const value = mode === "leads" ? c.leads : c.revenue;
            const dim = i !== index ? "opacity-45" : "";
            return (
              <div key={c.key} className={`flex h-full min-w-0 flex-1 flex-col justify-end ${columns.length <= 31 ? "px-0.5 sm:px-1 lg:px-2" : ""}`}>
                {mode === "leads" ? (
                  <div className={`flex flex-col-reverse gap-px overflow-hidden rounded-t-sm ${dim}`} style={{ height: pct(value, peak) }}>
                    {OUTCOME_SEGMENTS.map((segment) =>
                      c.segments[segment] > 0 ? <span key={segment} className={`block w-full shrink-0 ${SEGMENT_FILL[segment]}`} style={{ height: pct(c.segments[segment], c.leads) }} /> : null,
                    )}
                  </div>
                ) : (
                  <span className={`block rounded-t-sm bg-ink-soft ${dim}`} style={{ height: pct(value, peak) }} />
                )}
              </div>
            );
          })}
        </div>
        <div aria-hidden className="relative mt-1.5 h-4 border-t border-line pt-1">
          {columns.map((c, i) =>
            phoneTicks.has(i) || deskTicks.has(i) ? (
              <span
                key={c.key}
                className={`absolute -translate-x-1/2 text-admin-caption whitespace-nowrap ${i === index ? "text-ink" : "text-ink-muted"} ${phoneTicks.has(i) ? "" : "hidden lg:inline"} ${deskTicks.has(i) ? "" : "lg:hidden"}`}
                style={{ left: pct(i + 0.5, columns.length) }}
              >
                <span className="lg:hidden">{axisLabel(c, columns.length <= 12)}</span>
                <span className="hidden lg:inline">{axisLabel(c, false)}</span>
              </span>
            ) : null,
          )}
        </div>
        {mode === "leads" ? (
          <ul aria-label="Key" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-admin-caption text-ink-soft">
            {OUTCOME_SEGMENTS.map((segment) => (
              <li key={segment} className="flex items-center gap-1.5">
                <span aria-hidden className={`size-2.5 rounded-sm ${SEGMENT_FILL[segment]} ${segment === "other" ? "ring-1 ring-ink-faint" : ""}`} />
                {SEGMENT_LABEL[segment]}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-admin-caption text-ink-muted">Sale amounts by {byDay ? "day" : "month"} booked. Total {pounds(totals.revenue)}.</p>
        )}
      </div>
    </section>
  );
}

function SortSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (next: T) => void }) {
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <label className="relative inline-flex min-h-11 items-center gap-1 text-admin-section text-prop focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-prop">
      <span className="sr-only">{label}</span>
      <span aria-hidden>{current}</span>
      <ChevronDownIcon className="size-4" />
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className="absolute inset-0 cursor-pointer appearance-none opacity-0">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const AREA_MODES = [
  { value: "best", label: "Best" },
  { value: "worst", label: "Worst" },
] as const;

function Areas({ areas, min }: { areas: { best: AreaRow[]; worst: AreaRow[]; ranked: number }; min: number }) {
  const [which, setWhich] = useState<"best" | "worst">("best");
  const rows = which === "best" ? areas.best : areas.worst;
  const top = Math.max(0.0001, ...areas.best.map((r) => r.saleRate), ...areas.worst.map((r) => r.saleRate));
  return (
    <section aria-label="Areas">
      <SectionLabel control={areas.ranked >= 2 ? <SortSelect label="Show" value={which} options={AREA_MODES} onChange={setWhich} /> : undefined}>
        Areas, {min}+ leads
      </SectionLabel>
      <div className="rounded-field-lg bg-surface px-4 py-0.5 lg:border lg:border-line">
        {areas.ranked < 2 ? (
          <p className="py-3.5 text-admin-subhead text-ink-muted">Not enough leads per area to compare. Try a longer period.</p>
        ) : (
          <ol aria-label={which === "best" ? "Best areas by sale rate" : "Worst areas by sale rate"}>
            {rows.map((row) => (
              <li key={row.sector} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-admin-body-strong">{row.sector}</span>
                  <span className="block text-admin-caption text-ink-muted tabular-nums">{row.line}</span>
                </span>
                <span aria-hidden className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-field-bg">
                  <span className="block h-full rounded-full bg-crm-sale" style={{ width: pct(row.saleRate, top) }} />
                </span>
                <span className="w-10 shrink-0 text-right text-admin-body-strong tabular-nums">{`${Math.round(row.saleRate * 100)}%`}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="mt-1.5 px-1 text-admin-caption text-ink-muted">Postcode sectors, by sale rate (sold ÷ leads)</p>
    </section>
  );
}

function Props({ rows }: { rows: PropRow[] }) {
  const [sort, setSort] = useState<PropSort>("sales");
  const shown = useMemo(() => sortedProps(rows, sort), [rows, sort]);
  return (
    <section aria-label="Props">
      <SectionLabel control={rows.length > 0 ? <SortSelect label="Sort props by" value={sort} options={PROP_SORTS} onChange={setSort} /> : undefined}>Props</SectionLabel>
      <div className="rounded-field-lg bg-surface lg:border lg:border-line">
        {shown.length === 0 ? (
          <p className="px-4 py-3.5 text-admin-subhead text-ink-muted">
            {rows.length === 0 ? "No CRM leads inside a live prop in this period." : "No priced sales inside a live prop in this period."}
          </p>
        ) : (
          <ul>
            {shown.map((row) => (
              <li key={row.id} className="border-b border-line last:border-b-0">
                <Link
                  href={`/admin/props?prop=${encodeURIComponent(row.id)}`}
                  className="flex min-h-15 items-center gap-3 px-4 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-admin-body-strong">{row.name}</span>
                    <span className="block text-admin-caption text-ink-muted tabular-nums">{row.line}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-admin-body-strong tabular-nums">{row.value}</span>
                    <span className="block text-admin-caption text-ink-muted">{row.sub}</span>
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-1.5 px-1 text-admin-caption text-ink-muted">Leads whose door is inside a live prop</p>
    </section>
  );
}
