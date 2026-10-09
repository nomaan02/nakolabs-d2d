import Link from "next/link";
import type { ReactNode } from "react";

import { LeadMarkDot } from "@/components/admin/leads/lead-mark";
import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { ChevronRightIcon } from "@/components/field/icons";
import type { CompletionRow, LeadOutcomeBar, SlotRow, StaleRow, WeeklyRow } from "@/lib/admin/insights";
import { barShare, completionLine, weekLabel, weeksSummary } from "@/lib/admin/insights";

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

/** Share → a CSS width; data-driven, so it is a style, not a class. */
function pct(share: number): string {
  return `${Math.round(Math.max(0, Math.min(1, share)) * 1000) / 10}%`;
}

/**
 * UI-10 F5d (owner A48; panels kept by the owner 2026-10-09). Insights: the
 * old dashboard as charts. A glance page (Dashboard pattern): no filters,
 * no drill-down except a prop's name opening it on Props. Single-series
 * bars are neutral ink; colour only where it means something (the office's
 * lead marks). Every chart carries its numbers as text.
 */
export function InsightsScreen({
  asOf,
  weeks,
  weekTotals,
  weekly,
  weeklyPeak,
  slots,
  leads,
  leadTotal,
  completion,
  stale,
  staleTitle,
}: {
  asOf: string;
  weeks: string[];
  weekTotals: number[];
  weekly: WeeklyRow[];
  weeklyPeak: number;
  slots: SlotRow[];
  leads: LeadOutcomeBar[];
  leadTotal: number;
  completion: CompletionRow[];
  stale: StaleRow[];
  staleTitle: string;
}) {
  const totalPeak = Math.max(0, ...weekTotals);
  return (
    <main className="mx-auto max-w-2xl px-4 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] lg:max-w-5xl lg:px-10 lg:pt-8">
      <div className="-ml-1.5 flex min-h-11 items-center lg:hidden">
        <AdminMenuButton />
      </div>
      <h1 className="mt-1 text-admin-large-title">Insights</h1>
      <p className="text-admin-subhead text-ink-muted">{asOf} · live props only</p>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <Card title="Doors per week" note="By visit date, last 8 weeks">
          <p className="sr-only">{weeksSummary(weeks, weekTotals)}</p>
          <div aria-hidden className="flex h-28 items-end gap-1.5">
            {weeks.map((week, i) => {
              const value = weekTotals[i] ?? 0;
              return (
                <div key={week} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`Week of ${weekLabel(week)}: ${n(value)} doors`}>
                  <span className="mb-1 text-center text-admin-caption text-ink-muted tabular-nums">{value > 0 ? n(value) : ""}</span>
                  <span
                    className={`block rounded-t-sm ${i === weeks.length - 1 ? "bg-ink" : "bg-ink-soft"}`}
                    style={{ height: pct(barShare(value, totalPeak) * 0.78) }}
                  />
                </div>
              );
            })}
          </div>
          <div aria-hidden className="mt-1.5 flex gap-1.5 border-t border-line pt-1.5">
            {weeks.map((week, i) => (
              <span key={week} className={`min-w-0 flex-1 whitespace-nowrap text-center text-admin-caption text-ink-muted ${i % 2 === 0 ? "invisible sm:visible" : ""}`}>
                {weekLabel(week)}
              </span>
            ))}
          </div>

          {weekly.length > 0 ? (
            <>
              <h3 className="mt-5 text-admin-section text-ink-muted">By prop</h3>
              <ul className="mt-1">
                {weekly.slice(0, 8).map((row) => (
                  <li key={row.propId} className="flex min-h-11 items-center gap-3 border-t border-line py-2 first:border-t-0">
                    <span className="min-w-0 flex-1 truncate text-admin-body">{row.name}</span>
                    <span aria-hidden className="flex h-6 w-24 shrink-0 items-end gap-0.5">
                      {row.counts.map((value, i) => (
                        <span
                          key={weeks[i]}
                          title={`Week of ${weekLabel(weeks[i]!)}: ${n(value)} doors`}
                          className="block min-w-0 flex-1 rounded-t-xs bg-ink-soft"
                          style={{ height: pct(barShare(value, weeklyPeak)) }}
                        />
                      ))}
                    </span>
                    <span className="w-14 shrink-0 text-right text-admin-body tabular-nums">{n(row.total)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-4 text-admin-body text-ink-muted">No doors in the last 8 weeks.</p>
          )}
        </Card>

        <Card title="Doors answered by slot" note="Anyone came to the door, all visits">
          <ul className="flex flex-col gap-3">
            {slots.map((row) => (
              <li key={row.slot} className="grid grid-cols-[3.25rem_1fr_3rem] items-center gap-x-3">
                <span className="text-admin-body-strong">{row.label}</span>
                <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-field-bg" title={row.detail}>
                  <span className="block h-full rounded-full bg-ink-soft" style={{ width: pct(row.rate ?? 0) }} />
                </span>
                <span className="text-right text-admin-headline tabular-nums">{row.percent}</span>
                <span className="col-start-2 text-admin-caption text-ink-muted">{row.detail}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Lead outcomes" note={`All ${n(leadTotal)} leads, every prop · set by the office`}>
          <ul className="flex flex-col gap-2">
            {leads.map((bar) => (
              <li key={bar.status} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-x-3" title={`${bar.label}: ${n(bar.count)}`}>
                <span className="flex min-w-0 items-center gap-2 text-admin-subhead text-ink-soft">
                  <LeadMarkDot status={bar.status} />
                  <span className="truncate">{bar.label}</span>
                </span>
                <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-field-bg">
                  <span className="block h-full rounded-full bg-ink-soft" style={{ width: pct(bar.share) }} />
                </span>
                <span className={`text-right text-admin-body tabular-nums ${bar.count === 0 ? "text-ink-faint" : ""}`}>{n(bar.count)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Prop completion" note="Doors knocked at least once, every visit">
          {completion.length === 0 ? (
            <p className="text-admin-body text-ink-muted">No live props with a visit yet.</p>
          ) : (
            <ul>
              {completion.map((row) => (
                <li key={row.propId} className="border-t border-line py-2.5 first:border-t-0 first:pt-0">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-admin-body-strong">{row.name}</span>
                    <span className="shrink-0 text-admin-caption text-ink-muted tabular-nums">{completionLine(row)}</span>
                  </span>
                  <span aria-hidden className="mt-1.5 block h-2 overflow-hidden rounded-full bg-field-bg">
                    <span className="block h-full rounded-full bg-ink-soft" style={{ width: pct(row.share) }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={staleTitle} note="Live props with no visit in that time">
          {stale.length === 0 ? (
            <p className="text-admin-body text-ink-muted">Every live prop has had a visit.</p>
          ) : (
            <ul className="-mx-4 -mb-4">
              {stale.map((row) => (
                <li key={row.propId} className="border-t border-line first:border-t-0">
                  <Link
                    href={`/admin/props?prop=${encodeURIComponent(row.propId)}`}
                    className="flex min-h-14 items-center gap-3 px-4 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-admin-body-strong">{row.name}</span>
                      <span className="block text-admin-subhead text-ink-muted">{row.line}</span>
                    </span>
                    <ChevronRightIcon className="size-5 shrink-0 text-ink-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}

function Card({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-1.5 px-1">
        <h2 className="text-admin-headline">{title}</h2>
        <p className="text-admin-caption text-ink-muted">{note}</p>
      </div>
      <div className="rounded-field-lg bg-surface p-4 lg:border lg:border-line">{children}</div>
    </section>
  );
}
