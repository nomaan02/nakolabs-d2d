"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button, ButtonLink } from "@/components/admin/ui/button";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, WarningIcon } from "@/components/field/icons";
import { dayDate, nextVisitNumber, propState, matchesQuery, slotLabel, statePill, type PropRow } from "@/lib/admin/props";
import {
  addVisitGroups,
  addVisitLine,
  allocateButton,
  dayLabel,
  longDate,
  teamOptions,
  MAX_TEAM,
  type AddVisitProp,
  type Canvasser,
} from "@/lib/admin/today";
import { SLOTS } from "@/lib/geo/rotation";
import { allocatePropAction } from "@/lib/props/allocate";
import { generateRouteAction } from "@/lib/props/generate-route";

export type RouteKms = Record<string, { best?: number; best_reversed?: number }>;

/**
 * UI-10 F3d (owner A24; frames 16-17). Add visit, date first: the date, then
 * a prop (Due first), then the team, then Allocate. The URL is the state
 * (`?date=` then `&prop=`), so Back walks the steps. Allocating is the
 * existing `allocate_prop` path, then the route is frozen onto the visit
 * (`generateRouteAction` makes the prop's routes first if it has none); a
 * route failure never undoes the visit.
 */
export function AddVisit({
  today,
  date,
  rows,
  doorCounts,
  canvassers,
  bookings,
  routeKms,
  propId,
}: {
  today: string;
  date: string;
  rows: PropRow[];
  doorCounts: Promise<Record<string, number>>;
  canvassers: Canvasser[];
  bookings: { canvasserId: string; workDate: string; propName: string }[];
  routeKms: RouteKms;
  propId: string | null;
}) {
  const [doors, setDoors] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    void doorCounts.then((counts) => {
      if (live) setDoors(counts);
    });
    return () => {
      live = false;
    };
  }, [doorCounts]);

  const items = useMemo(
    () => rows.map((row) => ({ row, state: propState(row, today), doors: doors[row.id] ?? null })),
    [rows, today, doors],
  );
  // A deep link to a prop that is archived or already has a visit that date falls back to step 1.
  const picked = propId
    ? (items.find(
        (item) =>
          item.row.id === propId &&
          item.state.kind !== "archived" &&
          !item.row.visits.some((visit) => visit.workDate === date),
      ) ?? null)
    : null;

  if (picked) {
    return (
      <TeamStep
        date={date}
        item={picked}
        canvassers={canvassers}
        bookings={bookings}
        km={routeKms[picked.row.id]}
      />
    );
  }
  return <PropStep today={today} date={date} items={items} />;
}

function PropStep({
  today,
  date,
  items,
}: {
  today: string;
  date: string;
  items: { row: PropRow; state: ReturnType<typeof propState>; doors: number | null }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const groups = addVisitGroups(items, date);
  const filter = (list: AddVisitProp[]) => list.filter((item) => matchesQuery(item.row.name, query));
  const due = filter(groups.due);
  const other = filter(groups.other);

  const row = (item: AddVisitProp) => {
    const pill = statePill(item.state);
    const body = (
      <>
        <span className="min-w-0 flex-1">
          <span className="block text-admin-body-strong">{item.row.name}</span>
          <span className="block truncate text-admin-subhead text-ink-muted tabular-nums">{addVisitLine(item, date)}</span>
        </span>
        {pill === "due" && !item.booked ? <StatusPill status="due" /> : null}
        {item.booked ? null : <ChevronRightIcon className="size-5 shrink-0 text-ink-faint" />}
      </>
    );
    return (
      <li key={item.row.id} className="border-b border-line last:border-b-0">
        {item.booked ? (
          <div aria-disabled className="flex min-h-16 items-center gap-3 py-2 opacity-50">
            {body}
          </div>
        ) : (
          <Link
            href={`/admin/today/add?date=${date}&prop=${encodeURIComponent(item.row.id)}`}
            className="flex min-h-16 items-center gap-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
          >
            {body}
          </Link>
        )}
      </li>
    );
  };

  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 lg:px-10 lg:pt-6">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center py-2">
        <ButtonLink href="/admin/today" kind="quiet" size="compact" className="justify-self-start -ml-3.5">
          Cancel
        </ButtonLink>
        <div className="text-center">
          <h1 className="text-admin-headline">Add visit</h1>
          <p className="text-admin-caption text-ink-muted">Step 1 of 2</p>
        </div>
        <span />
      </header>

      <label className="relative mt-2 flex items-center gap-3 rounded-field-lg bg-surface p-4 focus-within:outline-2 focus-within:outline-prop lg:border lg:border-line">
        <CalendarIcon className="size-5 shrink-0 text-ink-soft" />
        <span className="min-w-0 flex-1">
          <span className="block text-admin-body-strong">{longDate(date)}</span>
          <span className="block text-admin-subhead text-ink-muted">{dayLabel(date, today)}</span>
        </span>
        <span className="text-admin-body-strong text-prop">Change</span>
        <input
          type="date"
          aria-label="Date of the visit"
          min={today}
          value={date}
          onChange={(event) => {
            const next = event.target.value;
            if (next && next >= today) router.replace(`/admin/today/add?date=${next}`);
          }}
          onClick={(event) => {
            try {
              event.currentTarget.showPicker?.();
            } catch {
              // Older browsers open their own picker on tap.
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>

      <label className="mt-3 flex h-11 items-center gap-2 rounded-field-md bg-surface px-3 text-ink-muted focus-within:outline-2 focus-within:outline-prop lg:border lg:border-line">
        <SearchIcon className="size-5 shrink-0" />
        <span className="sr-only">Search props</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search props"
          className="min-w-0 flex-1 bg-transparent text-admin-body text-ink outline-none placeholder:text-ink-muted"
        />
      </label>

      {due.length > 0 ? (
        <section className="mt-5">
          <h2 className="text-admin-section text-ink-muted">Due</h2>
          <ul>{due.map(row)}</ul>
        </section>
      ) : null}
      {other.length > 0 ? (
        <section className="mt-5">
          <h2 className="text-admin-section text-ink-muted">{due.length > 0 ? "Other props" : "Props"}</h2>
          <ul>{other.map(row)}</ul>
        </section>
      ) : null}
      {due.length === 0 && other.length === 0 ? (
        <p className="mt-6 text-admin-body text-ink-muted">
          {query.trim() ? `No props match “${query.trim()}”.` : "No props yet. Draw one on Props first."}
        </p>
      ) : null}
    </main>
  );
}

function TeamStep({
  date,
  item,
  canvassers,
  bookings,
  km,
}: {
  date: string;
  item: { row: PropRow; doors: number | null };
  canvassers: Canvasser[];
  bookings: { canvasserId: string; workDate: string; propName: string }[];
  km: { best?: number; best_reversed?: number } | undefined;
}) {
  const router = useRouter();
  const [team, setTeam] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "allocating" | "routing">("idle");
  const [error, setError] = useState<string | null>(null);
  const options = teamOptions(canvassers, bookings, date);
  const next = nextVisitNumber(item.row.visits);
  // Rotation: the slot is visit_number % 3 (lib/geo/rotation.ts); odd visits walk Route A, even Route B.
  const slot = slotLabel(SLOTS[next % 3] ?? null);
  const metres = next % 2 === 0 ? km?.best_reversed : km?.best;
  const names = team.map((id) => options.find((option) => option.id === id)?.name ?? "");

  const toggle = (id: string) =>
    setTeam((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX_TEAM ? current : [...current, id]));

  const allocate = async () => {
    if (team.length === 0 || phase !== "idle") return;
    setError(null);
    setPhase("allocating");
    let allocated: string;
    try {
      const result = await allocatePropAction({ territoryId: item.row.id, workDate: date, canvasserIds: team });
      if (!result.ok) {
        setPhase("idle");
        setError(result.message);
        return;
      }
      allocated = result.allocation.id;
    } catch {
      setPhase("idle");
      setError("That didn't go through, and the visit may or may not be saved. Check Today before trying again.");
      return;
    }
    // The visit exists now. A route failure is shown on the visit, never undoes it.
    setPhase("routing");
    await generateRouteAction(allocated).catch(() => null);
    router.push(`/admin/today?visit=${encodeURIComponent(allocated)}`);
    router.refresh();
  };

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col px-4 lg:px-10 lg:pt-6">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center py-2">
        <Link
          href={`/admin/today/add?date=${date}`}
          aria-label="Back to props"
          className="inline-flex size-11 items-center justify-center justify-self-start -ml-2.5 focus-visible:outline-2 focus-visible:outline-prop"
        >
          <ChevronLeftIcon className="size-6" />
        </Link>
        <div className="text-center">
          <h1 className="text-admin-headline">Add visit</h1>
          <p className="text-admin-caption text-ink-muted">Step 2 of 2</p>
        </div>
        <span />
      </header>

      <section aria-label="The visit" className="mt-2 rounded-field-lg bg-surface p-4 lg:border lg:border-line">
        <h2 className="text-admin-headline">{item.row.name}</h2>
        <p className="text-admin-subhead text-ink-muted">
          {dayDate(date)} · visit {next}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: "Doors", value: item.doors === null ? "…" : item.doors.toLocaleString("en-GB") },
            { label: "Slot (rotation)", value: slot ?? "—" },
            { label: "Route", value: metres === undefined ? "On allocate" : `${(metres / 1000).toFixed(1)} km` },
          ].map((figure) => (
            <div key={figure.label} className="flex min-w-0 flex-col-reverse">
              <dt className="text-admin-caption text-ink-muted">{figure.label}</dt>
              <dd className="text-admin-headline tabular-nums">{figure.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Team" className="mt-5 flex-1">
        <div className="flex items-baseline justify-between">
          <h2 className="text-admin-section text-ink-muted">Team</h2>
          <p className="text-admin-subhead text-prop tabular-nums">
            {team.length} of {MAX_TEAM}
          </p>
        </div>
        {options.length === 0 ? (
          <p className="mt-2 text-admin-body text-ink-muted">No active canvassers yet. Add one in Settings.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" role="group" aria-label="Pick 1 to 3 people">
            {options.map((option) => {
              const on = team.includes(option.id);
              const full = !on && team.length >= MAX_TEAM;
              const disabled = option.busyWith !== null || full || phase !== "idle";
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => toggle(option.id)}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-field-lg border px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop disabled:opacity-45 ${
                      on ? "border-prop bg-prop-soft" : "border-line bg-surface"
                    }`}
                  >
                    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-field-bg text-admin-caption text-ink-soft">
                      {option.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-admin-body-strong">{option.name}</span>
                      {option.busyWith ? <span className="block truncate text-admin-caption text-ink-muted">Out on {option.busyWith}</span> : null}
                    </span>
                    <span
                      aria-hidden
                      className={`flex size-6 shrink-0 items-center justify-center rounded-field-sm border-2 ${on ? "border-prop bg-prop text-paper" : "border-ink-faint"}`}
                    >
                      {on ? <CheckIcon className="size-4" /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-field-bg px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:static lg:mx-0 lg:border-0 lg:px-0">
        {error ? (
          <p role="alert" className="mb-3 flex gap-2 text-admin-subhead text-oxide">
            <WarningIcon className="size-5 shrink-0" />
            {error}
          </p>
        ) : null}
        <Button className="w-full" disabled={team.length === 0 || phase !== "idle"} onClick={() => void allocate()}>
          {phase === "allocating" ? "Allocating…" : phase === "routing" ? "Making the route…" : allocateButton(names, date)}
        </Button>
      </div>
    </main>
  );
}
