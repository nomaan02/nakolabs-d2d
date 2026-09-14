"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { allocatePropAction } from "@/lib/props/allocate";
import { formatSlot, formatSweep, type Slot, type SweepDirection } from "@/lib/geo/rotation";

export type AllocatableProp = {
  id: string;
  name: string;
  visitCount: number;
};

export type CanvasserOption = {
  id: string;
  fullName: string;
};

export type ExistingAllocation = {
  id: string;
  territoryId: string;
  workDate: string;
  visitNumber: number;
  entryVertexIndex: number;
  sweepDirection: SweepDirection;
  slot: Slot;
};

type Saved = {
  name: string;
  workDate: string;
  visitNumber: number;
  entryVertexIndex: number;
  sweepDirection: SweepDirection;
  slot: Slot;
  knockableDoors: number;
  teamSize: number;
};

function tomorrowISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + 36 * 3600 * 1000));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function formatWorkDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function AllocateForm({
  props,
  canvassers,
  allocations,
  initialPropId,
  signedInAs,
}: {
  props: AllocatableProp[];
  canvassers: CanvasserOption[];
  allocations: ExistingAllocation[];
  initialPropId: string | null;
  signedInAs: string;
}) {
  const router = useRouter();
  const [territoryId, setTerritoryId] = useState(
    initialPropId && props.some((prop) => prop.id === initialPropId)
      ? initialPropId
      : (props[0]?.id ?? ""),
  );
  const [workDate, setWorkDate] = useState(tomorrowISO);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = props.find((prop) => prop.id === territoryId) ?? null;
  const nextVisit = (selected?.visitCount ?? 0) + 1;
  const existingForProp = useMemo(
    () => allocations.filter((row) => row.territoryId === territoryId),
    [allocations, territoryId],
  );

  const toggle = (id: string) => {
    setSaved(null);
    setError(null);
    setPicked((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!territoryId) return;
    setError(null);

    startTransition(async () => {
      const result = await allocatePropAction({
        territoryId,
        workDate,
        canvasserIds: picked,
      });
      if (!result.ok) {
        setSaved(null);
        setError(result.message);
        return;
      }
      setSaved({
        name: selected?.name ?? "prop",
        workDate,
        visitNumber: result.allocation.visitNumber,
        entryVertexIndex: result.allocation.entryVertexIndex,
        sweepDirection: result.allocation.sweepDirection,
        slot: result.allocation.slot,
        knockableDoors: result.allocation.knockableDoors,
        teamSize: picked.length,
      });
      setPicked([]);
      router.refresh();
    });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-worksheet lg:h-dvh lg:flex-row lg:overflow-hidden">
      <aside className="flex w-full flex-col border-ink/15 lg:h-full lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-1 flex-col gap-6 p-6 lg:p-7">
          <header>
            <p className="font-data text-[10px] uppercase tracking-[0.22em] text-ink-soft">
              Props · Bristol
            </p>
            <h1 className="mt-2 font-display text-[27px] font-semibold leading-none tracking-[-0.02em] text-ink">
              Allocate a prop
            </h1>
          </header>

          <AdminNav current="allocate" />

          {props.length === 0 ? (
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Draw a prop first. Allocation needs a saved polygon to freeze a door list against.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {props.map((prop) => {
                const active = prop.id === territoryId;
                return (
                  <li key={prop.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setTerritoryId(prop.id);
                        setSaved(null);
                        setError(null);
                      }}
                      aria-pressed={active}
                      className={`flex min-h-11 w-full items-baseline justify-between gap-3 px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
                        active ? "bg-prop text-paper" : "bg-paper text-ink hover:bg-worksheet-deep"
                      }`}
                    >
                      <span className="truncate text-[14px]">{prop.name}</span>
                      <span
                        className={`shrink-0 font-data text-[10px] uppercase tracking-[0.12em] ${
                          active ? "text-paper/80" : "text-ink-soft"
                        }`}
                      >
                        visit {prop.visitCount}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-ink/15 px-6 py-4 lg:px-7">
          <p className="truncate font-data text-[10px] text-ink-soft">{signedInAs}</p>
          <SignOutButton className="min-h-11 border border-ink/25 px-3 font-data text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop" />
        </footer>
      </aside>

      <main className="flex flex-1 flex-col bg-ink p-3 lg:h-full lg:overflow-y-auto">
        <div className="relative flex-1 bg-paper p-6 lg:p-10">
          {!selected ? (
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Nothing to allocate yet. Draw a prop, then come back here and pick a date and a team.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-8">
              <div>
                <p className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                  Next visit
                </p>
                <p className="mt-2 font-data text-[64px] leading-[0.88] tracking-[-0.04em] text-ink tabular-nums">
                  {nextVisit}
                </p>
                <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
                  {selected.name}. Rotation is taken from how many times this prop has been
                  closed, not from this screen. Closing a shift (later) is what advances the count.
                </p>
              </div>

              <label className="flex flex-col gap-2">
                <span className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                  Work date
                </span>
                <input
                  type="date"
                  required
                  value={workDate}
                  onChange={(event) => {
                    setWorkDate(event.target.value);
                    setSaved(null);
                    setError(null);
                  }}
                  className="min-h-11 w-full max-w-xs border border-ink/25 bg-worksheet px-3 font-data text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-prop"
                />
              </label>

              <fieldset>
                <legend className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                  Team · one to three
                </legend>
                {canvassers.length === 0 ? (
                  <p className="mt-3 text-[14px] text-ink-soft">
                    No active canvassers to allocate to. They need an account first.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-1">
                    {canvassers.map((person) => {
                      const on = picked.includes(person.id);
                      const full = !on && picked.length >= 3;
                      return (
                        <li key={person.id}>
                          <label
                            className={`flex min-h-11 cursor-pointer items-center gap-3 border px-3 ${
                              on
                                ? "border-prop bg-prop-soft"
                                : full
                                  ? "border-ink/10 text-ink-soft"
                                  : "border-ink/15 bg-worksheet hover:border-ink/30"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={full}
                              onChange={() => toggle(person.id)}
                              className="size-4 accent-prop"
                            />
                            <span className="text-[15px] text-ink">{person.fullName}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-2 font-data text-[10px] text-ink-soft">
                  {picked.length} of 3 selected. Same side, same route — they bunny-hop.
                </p>
              </fieldset>

              <button
                type="submit"
                disabled={pending || picked.length === 0}
                className="min-h-11 w-full max-w-xs bg-prop px-4 font-data text-[11px] uppercase tracking-[0.16em] text-paper hover:bg-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {pending ? "Allocating…" : "Allocate"}
              </button>

              {saved ? (
                <p className="text-[14px] leading-relaxed text-ink" role="status">
                  Allocated {saved.name} for {formatWorkDate(saved.workDate)} to a team of{" "}
                  {saved.teamSize}. Visit {saved.visitNumber} starts at vertex{" "}
                  {saved.entryVertexIndex}, {formatSweep(saved.sweepDirection)}, {formatSlot(saved.slot)}{" "}
                  slot. {saved.knockableDoors.toLocaleString("en-GB")} knockable doors frozen.
                </p>
              ) : null}

              {error ? (
                <p className="text-[14px] text-oxide" role="alert">
                  {error}
                </p>
              ) : null}

              {existingForProp.length > 0 ? (
                <div className="border-t border-ink/15 pt-6">
                  <p className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                    Already allocated
                  </p>
                  <ul className="mt-3 flex flex-col gap-2">
                    {existingForProp.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] text-ink"
                      >
                        <span>{formatWorkDate(row.workDate)}</span>
                        <span className="font-data text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                          visit {row.visitNumber} · vertex {row.entryVertexIndex} ·{" "}
                          {formatSweep(row.sweepDirection)} · {formatSlot(row.slot)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
