"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { LiveMap } from "@/components/admin/today/live-map";
import { VisitCard } from "@/components/admin/today/visit-card";
import { VisitPanel, type VisitChange } from "@/components/admin/today/visit-panel";
import { Button } from "@/components/admin/ui/button";
import { ChevronRightIcon, WarningIcon } from "@/components/field/icons";
import { fetchLivePositions, LIVE_FADE_MS, type LiveRow } from "@/lib/admin/live";
import {
  attentionLine,
  cardStatus,
  dayNumeral,
  dayTotals,
  emptyDayLine,
  longDate,
  scheduleDays,
  staleVisits,
  teamOptions,
  type Canvasser,
  type TodayVisit,
  type VisitFigures,
} from "@/lib/admin/today";
import type { TodayProp } from "@/lib/admin/today-data";
import { londonDate } from "@/lib/field/london-date";
import { useResolvedTheme } from "@/lib/field/theme";
import { addMemberAction } from "@/lib/props/reallocation";
import { createClient } from "@/lib/supabase/client";

const POLL_MS = 30_000;
/** Every 4th tick (2 minutes) the figures are read again while a visit is out. */
const REFRESH_EVERY = 4;

const noSubscribe = () => () => {};

type Toast = { text: string; undo?: () => void };

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

/**
 * UI-10 F3c (owner A17, A26, A27, A36; frames 01, 14, 15, 25, D1). Today:
 * what needs attention, today's numbers, and the schedule (today, tomorrow,
 * then every later date with a visit). A visit opens as a sheet (phone) or
 * the right-hand panel (desktop); `?visit=<id>` keeps it open across a
 * reload and is what Props' "Open visit" links to.
 */
export function TodayScreen({
  today,
  serverNow,
  visits,
  figures,
  props,
  canvassers,
  initialVisitId,
}: {
  today: string;
  /** The server's clock, so the first render matches on both sides. */
  serverNow: number;
  visits: TodayVisit[];
  figures: Record<string, VisitFigures>;
  props: Record<string, TodayProp>;
  canvassers: Canvasser[];
  initialVisitId: string | null;
}) {
  const router = useRouter();
  const mode = useResolvedTheme();
  // The visit panel picks sheet or side panel from the screen width, which the
  // server cannot know: render it only once mounted, so it never flips.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [now, setNow] = useState(serverNow);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialVisitId && visits.some((visit) => visit.id === initialVisitId) ? initialVisitId : null,
  );
  const [liveId, setLiveId] = useState<string | null>(null);
  const [live, setLive] = useState<{ rows: LiveRow[]; at: number }>({ rows: [], at: serverNow });
  const [toast, setToast] = useState<Toast | null>(null);

  const figureMap = useMemo(() => new Map(Object.entries(figures)), [figures]);
  const days = useMemo(() => scheduleDays(visits, today), [visits, today]);
  const stale = useMemo(() => staleVisits(visits, today), [visits, today]);
  const attention = attentionLine(stale, figureMap);
  const totals = dayTotals(visits, figureMap, today);
  const selected = visits.find((visit) => visit.id === selectedId) ?? null;
  const liveVisit = visits.find((visit) => visit.id === liveId) ?? null;
  const anyOpenToday = visits.some((visit) => visit.workDate === today && !visit.closedAt);

  // Bookings that make a canvasser busy on a date: every open visit's active team.
  const bookings = useMemo(
    () =>
      visits.flatMap((visit) =>
        visit.closedAt
          ? []
          : visit.team.filter((member) => !member.left).map((member) => ({ canvasserId: member.id, workDate: visit.workDate, propName: visit.propName })),
      ),
    [visits],
  );

  // Clock for "6 min ago", and the live positions behind the Live pill (A36).
  useEffect(() => {
    let cancelled = false;
    let ticks = 0;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      // Past midnight (London) the page is a day out of date: read it again.
      if (londonDate() !== today) {
        router.refresh();
        return;
      }
      if (!anyOpenToday) return;
      ticks += 1;
      if (ticks % REFRESH_EVERY === 0) router.refresh();
      const result = await fetchLivePositions(createClient());
      if (!cancelled && result.ok) setLive({ rows: result.rows, at: Date.now() });
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [anyOpenToday, today, router]);

  // A visit that is gone after a refresh (ended elsewhere) closes its panel.
  useEffect(() => {
    if (selectedId && !visits.some((visit) => visit.id === selectedId)) setSelectedId(null);
    if (liveId && !visits.some((visit) => visit.id === liveId)) setLiveId(null);
  }, [visits, selectedId, liveId]);

  // `null` state: Next syncs its own router with the new URL (passing the old
  // state would let a later refresh put the previous `?visit=` back).
  useEffect(() => {
    const url = selectedId ? `/admin/today?visit=${encodeURIComponent(selectedId)}` : "/admin/today";
    window.history.replaceState(null, "", url);
  }, [selectedId]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const sharing = (visitId: string) =>
    live.rows.some((row) => row.assignmentId === visitId && now - Date.parse(row.reportedAt) <= LIVE_FADE_MS);

  const onChanged = (change: VisitChange) => {
    router.refresh();
    if (change.kind === "removed-member") {
      setToast({
        text: `Removed ${change.member.name}.`,
        undo: () => {
          setToast(null);
          void addMemberAction(change.visitId, change.member.id).then((result) => {
            if (result.ok) router.refresh();
            else setToast({ text: result.message });
          });
        },
      });
    } else if (change.kind === "added-member") {
      setToast({ text: `Added ${change.name}.` });
    } else {
      setToast({ text: change.text });
    }
  };

  const toastNode: ReactNode = toast ? (
    <div
      role="status"
      className="mb-3 flex items-center gap-3 rounded-field-lg bg-ink px-4 py-2 text-paper shadow-field-toast motion-safe:animate-admin-fade-in"
    >
      <span className="min-w-0 flex-1 text-admin-body">{toast.text}</span>
      {toast.undo ? (
        <button
          type="button"
          onClick={toast.undo}
          className="min-h-11 px-2 text-admin-body-strong text-prop-soft focus-visible:outline-2 focus-visible:outline-paper"
        >
          Undo
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="flex h-full">
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-10 lg:pt-8">
          <div className="-ml-1.5 lg:hidden">
            <AdminMenuButton />
          </div>
          <h1 className="mt-1 text-admin-large-title">Today</h1>
          <p className="text-admin-subhead text-ink-muted">{longDate(today)}</p>

          {attention ? (
            <Link
              href="/admin/today/review"
              className="mt-4 flex items-center gap-3 rounded-field-lg bg-warn-bg p-4 text-warn-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
            >
              <WarningIcon className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-admin-body-strong">{attention.title}</span>
                <span className="block text-admin-subhead">{attention.detail}</span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0" />
            </Link>
          ) : null}

          <section aria-label="Today's numbers" className="mt-4 rounded-field-lg bg-surface p-4 lg:border lg:border-line">
            <dl className="grid grid-cols-3 gap-3 lg:grid-cols-4">
              {[
                { label: "Doors", value: totals.doors },
                { label: "Contacts", value: totals.contacts },
                { label: "Leads", value: totals.leads },
              ].map((figure) => (
                <div key={figure.label} className="flex flex-col-reverse">
                  <dt className="text-admin-subhead text-ink-muted">{figure.label}</dt>
                  <dd className="text-admin-figure tabular-nums">{n(figure.value)}</dd>
                </div>
              ))}
              <div className="hidden flex-col-reverse lg:flex">
                <dt className="text-admin-subhead text-ink-muted">Doors answered</dt>
                <dd className="text-admin-figure tabular-nums">{n(totals.answered)}</dd>
              </div>
            </dl>
            <p className="mt-3 flex justify-between border-t border-line pt-3 text-admin-subhead text-ink-muted tabular-nums lg:hidden">
              <span>Doors answered</span>
              <span>{n(totals.answered)}</span>
            </p>
          </section>

          {days.map((day) => {
            const numeral = dayNumeral(day.date);
            const isToday = day.date === today;
            return (
              <section key={day.date} aria-label={day.label} className="mt-6 grid grid-cols-[2.75rem_1fr] gap-x-2">
                <p className="pt-0.5 text-center" aria-hidden>
                  <span className={`block text-admin-day tabular-nums ${isToday ? "text-prop" : ""}`}>{numeral.day}</span>
                  <span className={`block text-admin-caption ${isToday ? "text-prop" : "text-ink-muted"}`}>{numeral.weekday}</span>
                </p>
                <div className="min-w-0">
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <h2 className="text-admin-headline">{day.label}</h2>
                    {day.visits.length > 0 ? (
                      <Link
                        href={`/admin/today/add?date=${day.date}`}
                        className="inline-flex min-h-11 items-center px-1 text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop"
                      >
                        Add visit
                      </Link>
                    ) : null}
                  </div>
                  {day.visits.length === 0 ? (
                    <div className="flex min-h-16 items-center justify-between gap-3 rounded-field-lg border border-dashed border-line px-4">
                      <span className="text-admin-body text-ink-muted">{emptyDayLine(day.date, today)}</span>
                      <Link
                        href={`/admin/today/add?date=${day.date}`}
                        className="inline-flex min-h-11 items-center px-1 text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop"
                      >
                        Add visit
                      </Link>
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {day.visits.map((visit) => (
                        <li key={visit.id}>
                          <VisitCard
                            visit={visit}
                            figures={figureMap.get(visit.id) ?? null}
                            status={cardStatus(visit, today, sharing(visit.id))}
                            now={now}
                            selected={visit.id === selectedId}
                            onOpen={() => setSelectedId(visit.id)}
                            onLive={() => setLiveId(visit.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>

      {selected && mounted ? (
        <VisitPanel
          key={selected.id}
          visit={selected}
          figures={figureMap.get(selected.id) ?? null}
          prop={props[selected.propId] ?? null}
          today={today}
          now={now}
          mode={mode}
          options={teamOptions(canvassers, bookings, selected.workDate)}
          onClose={() => setSelectedId(null)}
          onChanged={onChanged}
          notice={toastNode}
        />
      ) : null}

      {liveVisit ? (
        <LiveMap
          visit={liveVisit}
          prop={props[liveVisit.propId] ?? null}
          rows={live.rows.filter((row) => row.assignmentId === liveVisit.id)}
          updatedAt={live.at}
          now={now}
          mode={mode}
          onClose={() => setLiveId(null)}
        />
      ) : null}

      {toastNode && !(selected && mounted) ? (
        <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] mx-auto max-w-md">{toastNode}</div>
      ) : null}
    </div>
  );
}

/** Frame 27: Today did not load. Try again re-runs the server read. */
export function TodayFailed({ today, message }: { today: string; message: string }) {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-2xl px-4 pt-2 lg:px-10 lg:pt-8">
      <div className="-ml-1.5 lg:hidden">
        <AdminMenuButton />
      </div>
      <h1 className="mt-1 text-admin-large-title">Today</h1>
      <p className="text-admin-subhead text-ink-muted">{longDate(today)}</p>
      <div role="alert" className="mt-4 flex items-center gap-3 rounded-field-lg bg-error-bg p-4 text-oxide">
        <WarningIcon className="size-5 shrink-0" />
        <p className="min-w-0 flex-1 text-admin-subhead">{message}</p>
        <Button kind="secondary" size="compact" onClick={() => router.refresh()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
