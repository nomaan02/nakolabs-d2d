"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type TouchEvent } from "react";

import { DayPanel } from "@/components/admin/calendar/day-panel";
import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/field/icons";
import {
  calendarHref,
  dayCell,
  daySummary,
  dayTitle,
  monthGrid,
  monthOf,
  monthTitle,
  monthTotals,
  shiftMonth,
  swipeMonth,
  type DayEntry,
} from "@/lib/admin/calendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const noSubscribe = () => () => {};

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

const navLink =
  "inline-flex size-11 items-center justify-center rounded-full text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop";

/** One prop's line in a desktop cell: solid = worked, dashed = planned or not worked. */
function EntryBar({ solid }: { solid: boolean }) {
  return solid ? (
    <span aria-hidden className="block h-1 w-full rounded-full bg-prop" />
  ) : (
    <span aria-hidden className="block h-1.5 w-full rounded-full border border-dashed border-prop" />
  );
}

/**
 * UI-10 F4c (owner A38-A42; frames 34-37). Calendar is the history: a month
 * grid (Monday first) with one bar per visit per day and the doors knocked,
 * month totals on top, swipe or ‹ › between months. Tapping a day opens
 * every visit that day. `?month=` and `?day=` are the state, so Back from
 * Coverage lands on the same month with the same day open (A44). The day
 * entries are built on the server (`buildCalendar`), so no knock row is
 * sent to the browser.
 */
export function CalendarScreen({
  month,
  today,
  initialDay,
  entries: byDay,
}: {
  month: string;
  today: string;
  initialDay: string | null;
  /** Day (YYYY-MM-DD) → its visit entries. */
  entries: Record<string, DayEntry[]>;
}) {
  const router = useRouter();
  // The day panel picks sheet or side panel from the screen width: render it once mounted.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const gridDates = useMemo(() => new Set(weeks.flat().map((day) => day.date)), [weeks]);
  const days = useMemo(() => new Map(Object.entries(byDay)), [byDay]);
  const totals = monthTotals(days, month);
  const [selected, setSelected] = useState<string | null>(initialDay && gridDates.has(initialDay) ? initialDay : null);
  const [toast, setToast] = useState<string | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (selected && !gridDates.has(selected)) setSelected(null);
  }, [gridDates, selected]);

  useEffect(() => {
    // `null` state lets Next keep its router in step with the URL (UI-10 F3 review).
    window.history.replaceState(null, "", calendarHref(month, selected));
  }, [month, selected]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const onTouchStart = (event: TouchEvent) => {
    const first = event.touches[0];
    touch.current = first ? { x: first.clientX, y: first.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current;
    const end = event.changedTouches[0];
    touch.current = null;
    if (!start || !end) return;
    const step = swipeMonth(end.clientX - start.x, end.clientY - start.y);
    if (step !== 0) router.push(calendarHref(shiftMonth(month, step)));
  };

  const entries: DayEntry[] = selected ? (days.get(selected) ?? []) : [];

  return (
    <div className="flex h-full">
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-10 lg:pt-8">
          <div className="-ml-1.5 lg:hidden">
            <AdminMenuButton />
          </div>
          <h1 className="mt-1 text-admin-large-title">Calendar</h1>

          <div className="mt-3 flex items-center gap-1">
            <h2 className="min-w-0 flex-1 text-admin-headline" aria-live="polite">
              {monthTitle(month)}
            </h2>
            {monthOf(today) === month && selected === today ? null : (
              <Link
                href={calendarHref(monthOf(today), today)}
                onClick={(event) => {
                  // Same month: the page is already here, so just open today.
                  if (monthOf(today) !== month) return;
                  event.preventDefault();
                  setSelected(today);
                }}
                className="inline-flex min-h-11 items-center px-3 text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop"
              >
                Today
              </Link>
            )}
            <Link href={calendarHref(shiftMonth(month, -1))} aria-label="Previous month" title="Previous month" className={navLink}>
              <ChevronLeftIcon className="size-6" />
            </Link>
            <Link href={calendarHref(shiftMonth(month, 1))} aria-label="Next month" title="Next month" className={navLink}>
              <ChevronRightIcon className="size-6" />
            </Link>
          </div>

          <section aria-label="This month" className="mt-2 rounded-field-lg bg-surface p-4 lg:border lg:border-line">
            <dl className="grid grid-cols-3 gap-3">
              {[
                { label: "Days worked", value: totals.daysWorked },
                { label: "Doors", value: totals.doors },
                { label: "Leads", value: totals.leads },
              ].map((figure) => (
                <div key={figure.label} className="flex flex-col-reverse">
                  <dt className="text-admin-subhead text-ink-muted">{figure.label}</dt>
                  <dd className="text-admin-headline tabular-nums">{n(figure.value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="-mx-4 mt-4 select-none lg:mx-0" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div aria-hidden className="grid grid-cols-7 border-b border-line pb-2 text-center text-admin-caption text-ink-muted">
              {WEEKDAYS.map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            {weeks.map((week) => (
              <div key={week[0]!.date} className="grid grid-cols-7 border-b border-line">
                {week.map((day) => {
                  const list = days.get(day.date);
                  const cell = dayCell(list);
                  const isToday = day.date === today;
                  const isSelected = day.date === selected;
                  const numeral = Number(day.date.slice(8));
                  const label = `${dayTitle(day.date)}${list && list.length > 0 ? `: ${daySummary(list)}` : ""}`;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      aria-label={label}
                      aria-pressed={isSelected}
                      onClick={() => setSelected(day.date)}
                      className={`flex min-h-[4.75rem] min-w-0 flex-col items-center gap-1 px-1 pt-2 pb-1.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-prop lg:min-h-28 lg:items-stretch lg:px-2 ${
                        isSelected ? "bg-prop-soft/60" : ""
                      } ${day.inMonth ? "" : "opacity-50"}`}
                    >
                      <span
                        className={`flex size-8 items-center justify-center rounded-full text-admin-body-strong tabular-nums lg:size-7 ${
                          isToday ? "bg-prop text-paper" : cell.bars.length > 0 ? "text-ink" : "text-ink-muted"
                        }`}
                      >
                        {numeral}
                      </span>
                      {/* Phone: bars. Desktop: the prop names. */}
                      <span className="flex w-full flex-col items-center gap-0.5 px-1.5 lg:hidden">
                        {cell.bars.map((bar) => (
                          <EntryBar key={bar.id} solid={bar.solid} />
                        ))}
                      </span>
                      <span className="hidden w-full flex-col gap-1 lg:flex">
                        {(list ?? [])
                          .filter((entry) => entry.kind !== "ended")
                          .slice(0, 3)
                          .map((entry) => (
                            <span key={entry.visit.id} className="flex min-w-0 flex-col gap-0.5 text-left">
                              <span className="truncate text-admin-caption text-ink-soft">{entry.visit.propName}</span>
                              <EntryBar solid={entry.kind === "worked"} />
                            </span>
                          ))}
                      </span>
                      {cell.more > 0 ? <span className="text-admin-caption text-ink-muted">+{cell.more}</span> : null}
                      {cell.doors > 0 ? (
                        <span className="text-admin-caption text-ink-muted tabular-nums lg:mt-auto lg:text-right">{n(cell.doors)}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-admin-caption text-ink-soft">
            <span className="flex items-center gap-2">
              <span className="w-5">
                <EntryBar solid />
              </span>
              Worked
            </span>
            <span className="flex items-center gap-2">
              <span className="w-5">
                <EntryBar solid={false} />
              </span>
              Planned, not worked
            </span>
            <span>Numbers are doors knocked</span>
          </div>
        </div>
      </main>

      {selected && mounted ? (
        <DayPanel
          key={selected}
          date={selected}
          entries={entries}
          onClose={() => setSelected(null)}
          onChanged={(text) => {
            setToast(text);
            router.refresh();
          }}
        />
      ) : null}

      {toast ? (
        <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] mx-auto max-w-md">
          <p role="status" className="rounded-field-lg bg-ink px-4 py-3 text-admin-body text-paper shadow-field-toast motion-safe:animate-admin-fade-in">
            {toast}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Frame 27 for Calendar: the month could not be read. */
export function CalendarFailed({ message }: { message: string }) {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-2xl px-4 pt-2 lg:px-10 lg:pt-8">
      <div className="-ml-1.5 lg:hidden">
        <AdminMenuButton />
      </div>
      <h1 className="mt-1 text-admin-large-title">Calendar</h1>
      <div role="alert" className="mt-6 rounded-field-lg bg-surface p-5">
        <p className="text-admin-body">{message}</p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 inline-flex min-h-11 items-center text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
