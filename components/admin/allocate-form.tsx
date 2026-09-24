"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { FrozenRouteMap } from "@/components/admin/frozen-route-map";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { defaultVariantKey } from "@/lib/geo/walk/freeze";
import { allocatePropAction } from "@/lib/props/allocate";
import { freezeVariantAction } from "@/lib/props/freeze-variant";
import { generateRouteAction, type RouteActionResult } from "@/lib/props/generate-route";
import { compareVariantKeys, variantLabel } from "@/lib/map/route-layers";
import { formatSlot, formatSweep, type Slot, type SweepDirection } from "@/lib/geo/rotation";

export type AllocatableProp = {
  id: string;
  name: string;
  /**
   * Stage 5b-R2: how many assignments this prop already has. The next
   * allocation is visit allocationCount + 1 — the same count allocate_prop
   * takes under its row lock. Not territories.visit_count.
   */
  allocationCount: number;
};

export type SavedRouteVariant = {
  territoryId: string;
  variantKey: string;
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
  /** Null until Stage 5b's generator has drawn a route for this allocation. */
  routeLengthM: number | null;
  routeStrandedCount: number;
  /** Stage 5b-R2: the saved variant frozen on. Null on 5b-a routes and unrouted rows. */
  routeVariantKey: string | null;
};

/** Stage 5b. What the admin sees for the route after allocation. Never an error. */
type RouteState = { status: "drawing" } | { status: "done"; result: RouteActionResult };

type Saved = {
  assignmentId: string;
  name: string;
  workDate: string;
  visitNumber: number;
  entryVertexIndex: number;
  sweepDirection: SweepDirection;
  slot: Slot;
  knockableDoors: number;
  teamSize: number;
  route: RouteState;
};

function formatKm(metres: number): string {
  return `${(metres / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} km`;
}

function formatVariant(key: string): string {
  if (key === "best") return "best route";
  if (key === "best_reversed") return "best route, walked backwards";
  return key.replace("_", " ");
}

function routeSentence(result: RouteActionResult): string {
  if (!result.ok) return `Route not drawn: ${result.message}`;
  const { summary } = result;
  const stranded =
    summary.strandedCount > 0
      ? ` ${summary.strandedCount.toLocaleString("en-GB")} ${summary.strandedCount === 1 ? "door is" : "doors are"} more than 40 m from any road and sit at the end of the order.`
      : "";
  const regenerated =
    summary.regenerated && summary.variants !== null
      ? ` ${summary.variants} route variants were generated and saved for this prop.`
      : "";
  return (
    `Route frozen: ${formatVariant(summary.variantKey)}, ${summary.hand} hand, ` +
    `${formatKm(summary.routeLengthM)}, ${summary.steps.toLocaleString("en-GB")} steps.` +
    stranded +
    regenerated
  );
}

function tomorrowISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const next = new Date(Date.UTC(value("year"), value("month") - 1, value("day") + 1));
  return next.toISOString().slice(0, 10);
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
  savedVariants,
  initialPropId,
  signedInAs,
}: {
  props: AllocatableProp[];
  canvassers: CanvasserOption[];
  allocations: ExistingAllocation[];
  savedVariants: SavedRouteVariant[];
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
  // Stage 5b: "Draw route" on an already-allocated row. Keyed by assignment id.
  const [redraw, setRedraw] = useState<{ id: string; state: RouteState } | null>(null);
  const [redrawPending, startRedraw] = useTransition();
  /** Empty string means the parity default. A value is passed to assignment_route_freeze. */
  const [variantOverride, setVariantOverride] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);

  const drawRouteFor = (assignmentId: string) => {
    setRedraw({ id: assignmentId, state: { status: "drawing" } });
    startRedraw(async () => {
      try {
        const result = await generateRouteAction(assignmentId);
        setRedraw({ id: assignmentId, state: { status: "done", result } });
        router.refresh();
      } catch {
        setRedraw({
          id: assignmentId,
          state: {
            status: "done",
            result: {
              ok: false,
              code: "unavailable",
              message: "The route reply could not be read. Refresh the page before drawing it again.",
            },
          },
        });
      }
    });
  };

  const selected = props.find((prop) => prop.id === territoryId) ?? null;
  const nextVisit = (selected?.allocationCount ?? 0) + 1;
  const existingForProp = useMemo(
    () => allocations.filter((row) => row.territoryId === territoryId),
    [allocations, territoryId],
  );
  const propVariants = useMemo(
    () =>
      savedVariants
        .filter((row) => row.territoryId === territoryId)
        .sort((a, b) => compareVariantKeys(a.variantKey, b.variantKey)),
    [savedVariants, territoryId],
  );
  const defaultKey = defaultVariantKey(nextVisit);
  const viewing = allocations.find((row) => row.id === viewingId && row.routeVariantKey) ?? null;

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
      let base: Saved | null = null;
      try {
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
        // Allocation is saved and confirmed before the route is attempted.
        // The route is a second call so a route failure can never undo it.
        // Do not refresh until that second call returns: a refresh in flight
        // at the same time is not a server-action payload, and Next replaces
        // the page with "An unexpected response was received from the server."
        base = {
          assignmentId: result.allocation.id,
          name: selected?.name ?? "prop",
          workDate,
          visitNumber: result.allocation.visitNumber,
          entryVertexIndex: result.allocation.entryVertexIndex,
          sweepDirection: result.allocation.sweepDirection,
          slot: result.allocation.slot,
          knockableDoors: result.allocation.knockableDoors,
          teamSize: picked.length,
          route: { status: "drawing" },
        };
        setSaved(base);
        setPicked([]);
        setVariantOverride("");

        const chosen = propVariants.length > 0 ? variantOverride : "";
        const route = chosen
          ? await freezeVariantAction(result.allocation.id, chosen)
          : await generateRouteAction(result.allocation.id);
        setSaved((current) =>
          current && current.assignmentId === base?.assignmentId
            ? { ...current, route: { status: "done", result: route } }
            : current,
        );
        router.refresh();
      } catch {
        if (base) {
          setSaved((current) =>
            current && current.assignmentId === base?.assignmentId
              ? {
                  ...current,
                  route: {
                    status: "done",
                    result: {
                      ok: false,
                      code: "unavailable",
                      message:
                        "The allocation is saved, but the route reply could not be read. Refresh the page to see it.",
                    },
                  },
                }
              : current,
          );
          return;
        }
        setError(
          "That request did not complete. Refresh the page before allocating again — the visit may already have been saved.",
        );
      }
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
                        setVariantOverride("");
                        setViewingId(null);
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
                        next visit {prop.allocationCount + 1}
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
        <div className={`relative flex-1 bg-paper ${viewing ? "flex min-h-[54dvh] flex-col" : "p-6 lg:p-10"}`}>
          {viewing?.routeVariantKey ? (
            <FrozenRouteMap
              assignmentId={viewing.id}
              variantKey={viewing.routeVariantKey}
              title={`${props.find((prop) => prop.id === viewing.territoryId)?.name ?? "Prop"} · Visit ${viewing.visitNumber}`}
              onClose={() => setViewingId(null)}
            />
          ) : !selected ? (
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
                  {selected.name}. The visit number counts this prop&apos;s allocations, not
                  anything on this screen: this would be allocation {nextVisit}. Odd visits walk
                  the best route forwards, even visits walk it backwards.
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

              {propVariants.length > 0 ? (
                <label className="flex flex-col gap-2">
                  <span className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                    Route variant
                  </span>
                  <select
                    value={variantOverride}
                    onChange={(event) => setVariantOverride(event.target.value)}
                    data-testid="variant-override"
                    className="min-h-11 w-full max-w-xs border border-ink/25 bg-worksheet px-3 font-data text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-prop"
                  >
                    <option value="">Default for this visit · {variantLabel(defaultKey)}</option>
                    {propVariants.map((variant) => (
                      <option key={variant.variantKey} value={variant.variantKey}>
                        {variantLabel(variant.variantKey)}
                      </option>
                    ))}
                  </select>
                  <span className="text-[13px] leading-snug text-ink-soft">
                    Leave this on the default and the visit number picks the route. Pick another
                    saved variant to override that for this day.
                  </span>
                </label>
              ) : null}

              <button
                type="submit"
                disabled={pending || picked.length === 0}
                className="min-h-11 w-full max-w-xs bg-prop px-4 font-data text-[11px] uppercase tracking-[0.16em] text-paper hover:bg-ink disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {pending ? "Allocating…" : "Allocate"}
              </button>

              {saved ? (
                <div className="flex flex-col gap-2" role="status">
                  <p className="text-[14px] leading-relaxed text-ink">
                    Allocated {saved.name} for {formatWorkDate(saved.workDate)} to a team of{" "}
                    {saved.teamSize}. Visit {saved.visitNumber} starts at vertex{" "}
                    {saved.entryVertexIndex}, {formatSweep(saved.sweepDirection)},{" "}
                    {formatSlot(saved.slot)} slot.{" "}
                    {saved.knockableDoors.toLocaleString("en-GB")} knockable doors frozen.
                  </p>
                  <p className="text-[14px] leading-relaxed text-ink-soft">
                    {saved.route.status === "drawing"
                      ? "Drawing the route…"
                      : routeSentence(saved.route.result)}
                  </p>
                </div>
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
                    {existingForProp.map((row) => {
                      const mine = redraw?.id === row.id ? redraw.state : null;
                      const routed = row.routeLengthM !== null;
                      return (
                        <li key={row.id} className="flex flex-col gap-1 text-[13px] text-ink">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <span>{formatWorkDate(row.workDate)}</span>
                            <span className="font-data text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                              visit {row.visitNumber} · vertex {row.entryVertexIndex} ·{" "}
                              {formatSweep(row.sweepDirection)} · {formatSlot(row.slot)} ·{" "}
                              {routed
                                ? `route ${formatKm(row.routeLengthM as number)}${
                                    row.routeVariantKey ? ` · ${row.routeVariantKey.replace("_", " ")}` : ""
                                  }${
                                    row.routeStrandedCount > 0
                                      ? ` · ${row.routeStrandedCount} off-route`
                                      : ""
                                  }`
                                : "no route"}
                            </span>
                          </div>
                          {row.routeVariantKey ? (
                            <button
                              type="button"
                              onClick={() => setViewingId(row.id)}
                              className="min-h-11 w-fit border border-ink/25 px-3 font-data text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
                            >
                              View route
                            </button>
                          ) : null}
                          {!row.routeVariantKey && !routed && !mine ? (
                            <button
                              type="button"
                              disabled={redrawPending}
                              onClick={() => drawRouteFor(row.id)}
                              className="min-h-11 w-fit border border-ink/25 px-3 font-data text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet-deep disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
                            >
                              Draw route
                            </button>
                          ) : null}
                          {mine ? (
                            <p className="text-[13px] leading-relaxed text-ink-soft" role="status">
                              {mine.status === "drawing" ? "Drawing the route…" : routeSentence(mine.result)}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
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
