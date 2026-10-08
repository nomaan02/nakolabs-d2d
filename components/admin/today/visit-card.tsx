"use client";

import { StatusPill } from "@/components/admin/ui/status-pill";
import { outcomeSegments, type OutcomeSegment } from "@/lib/admin/props";
import { activeTeam, cardMeta, type CardStatus, type TodayVisit, type VisitFigures } from "@/lib/admin/today";

const SEGMENT_CLASS: Record<OutcomeSegment["key"], string> = {
  contacts: "bg-outcome-contact",
  leads: "bg-outcome-lead",
  rented: "bg-outcome-rented-edge",
  notIn: "bg-outcome-notin",
  other: "bg-ink-faint",
};

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

/** The outcome bar on a neutral track of the whole prop (A11: no % text). */
export function OutcomeBar({ figures }: { figures: VisitFigures | null }) {
  const bar = figures ? outcomeSegments(figures) : null;
  const label =
    bar && bar.segments.length > 0
      ? bar.segments.map((segment) => `${n(segment.value)} ${segment.key === "notIn" ? "not in" : segment.key === "rented" ? "rented or council" : segment.key}`).join(", ")
      : "No doors worked yet";
  return (
    <div role="img" aria-label={label} className="flex h-1.5 overflow-hidden rounded-full bg-line">
      {bar && bar.total > 0
        ? bar.segments.map((segment) => (
            <span key={segment.key} className={SEGMENT_CLASS[segment.key]} style={{ width: `${(segment.value / bar.total) * 100}%` }} />
          ))
        : null}
    </div>
  );
}

/**
 * UI-10 F3c (owner A11, A17, A36; frame 01, D1). One visit in the schedule:
 * prop, visit · slot · last knock, the state pill, the outcome bar, worked
 * and left, contacts and leads, and the team's initials. The whole card
 * opens the visit sheet; the Live pill opens the live map instead.
 */
export function VisitCard({
  visit,
  figures,
  status,
  now,
  selected,
  onOpen,
  onLive,
}: {
  visit: TodayVisit;
  figures: VisitFigures | null;
  status: CardStatus;
  now: number;
  selected: boolean;
  onOpen: () => void;
  onLive: () => void;
}) {
  const team = activeTeam(visit);
  // Only today's and past visits carry figures; a later visit shows its team only.
  const worked = figures !== null;
  return (
    <div
      className={`relative rounded-field-lg border bg-surface ${selected ? "border-prop" : "border-transparent lg:border-line"}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className="block w-full rounded-field-lg p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
      >
        <span className="block pr-20">
          <span className="block text-admin-headline text-balance">{visit.propName}</span>
          <span className="mt-0.5 block text-admin-subhead text-ink-muted">{cardMeta(visit, figures, now)}</span>
        </span>
        {worked && figures ? (
          <>
            <span className="mt-3 block">
              <OutcomeBar figures={figures} />
            </span>
            <span className="mt-2 flex items-baseline justify-between gap-3 tabular-nums">
              <span className="text-admin-body-strong">{n(figures.worked)} worked</span>
              <span className="text-admin-subhead text-ink-muted">{n(figures.remaining)} left</span>
            </span>
          </>
        ) : null}
        <span className="mt-2 flex items-center gap-3">
          {worked && figures ? (
            <span className="flex flex-1 flex-wrap items-center gap-x-3 text-admin-subhead text-ink-soft tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full bg-outcome-contact" />
                Contacts {n(figures.contacts)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full bg-outcome-lead" />
                Leads {n(figures.leads)}
              </span>
            </span>
          ) : (
            <span className="flex-1 text-admin-subhead text-ink-muted">{team.length === 0 ? "No one on it" : null}</span>
          )}
          <span className="flex -space-x-1.5" aria-label={team.map((member) => member.name).join(", ")}>
            {team.map((member) => (
              <span
                key={member.id}
                aria-hidden
                className="flex size-7 items-center justify-center rounded-full border-2 border-surface bg-field-bg text-admin-caption text-ink-soft"
              >
                {member.name.charAt(0).toUpperCase()}
              </span>
            ))}
          </span>
        </span>
      </button>
      {status ? (
        <span className="absolute top-3 right-3">
          <StatusPill status={status} onClick={status === "live" ? onLive : undefined} label={status === "live" ? "Live" : undefined} />
        </span>
      ) : null}
    </div>
  );
}
