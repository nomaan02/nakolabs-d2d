"use client";

import { useMemo, useState } from "react";

import { AdminMenuButton } from "@/components/admin/shell/admin-shell";
import { CoverageMap, padDoors } from "@/components/admin/coverage-map";
import { ThreeNumbers } from "@/components/admin/three-numbers";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  totalsOf,
  type CoverageDoorCollection,
  type CoverageOutcome,
  type CoverageProp,
} from "@/lib/admin/coverage";

export function CoverageView({
  doors,
  outcomes,
  props,
  signedInAs,
  stressDots,
}: {
  doors: CoverageDoorCollection;
  outcomes: CoverageOutcome[];
  props: CoverageProp[];
  signedInAs: string;
  stressDots: number | null;
}) {
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const mapDoors = useMemo(
    () => (stressDots ? padDoors(doors, stressDots) : doors),
    [doors, stressDots],
  );
  const selected = props.find((row) => row.id === selectedPropId) ?? null;
  const totals = selected
    ? {
        worked: selected.worked,
        answered: selected.answered,
        remaining: selected.remaining,
      }
    : totalsOf(props);

  return (
    <div className="flex min-h-dvh flex-col bg-worksheet lg:h-dvh lg:flex-row lg:overflow-hidden">
      <aside className="flex w-full flex-col border-ink/15 lg:h-full lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-1 flex-col gap-6 p-6 lg:p-7">
          <header>
            <p className="font-data text-[10px] uppercase tracking-[0.22em] text-ink-soft">
              Coverage · Bristol
            </p>
            <h1 className="mt-2 font-display text-[27px] font-semibold leading-none tracking-[-0.02em] text-ink">
              Fog-lift
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
              Knocked doors reveal; unworked doors stay dim. Numbers are derived
              from knocks, not stored. Seeded history is on the map and is labelled
              as such.
            </p>
          </header>

          <AdminMenuButton />

          <ThreeNumbers
            worked={totals.worked}
            answered={totals.answered}
            remaining={totals.remaining}
          />
          <p className="font-data text-[10px] leading-relaxed text-ink-soft">
            Three numbers, not a percentage. Answered means someone came to the
            door — not only the Contact button.
          </p>

          <div>
            <p className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">
              Live props
            </p>
            <ul className="mt-3 flex flex-col gap-1">
              <li>
                <button
                  type="button"
                  onClick={() => setSelectedPropId(null)}
                  aria-pressed={selectedPropId === null}
                  className={`flex min-h-11 w-full items-baseline justify-between gap-3 px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
                    selectedPropId === null
                      ? "bg-prop text-paper"
                      : "bg-paper text-ink hover:bg-worksheet-deep"
                  }`}
                >
                  <span className="text-[14px]">All allocated</span>
                  <span
                    className={`shrink-0 font-data text-[10px] uppercase tracking-[0.12em] ${
                      selectedPropId === null ? "text-paper/80" : "text-ink-soft"
                    }`}
                  >
                    {props.length} props
                  </span>
                </button>
              </li>
              {props.map((row) => {
                const active = row.id === selectedPropId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedPropId(row.id)}
                      aria-pressed={active}
                      data-testid={`coverage-prop-${row.id}`}
                      className={`flex min-h-11 w-full items-baseline justify-between gap-3 px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
                        active ? "bg-prop text-paper" : "bg-paper text-ink hover:bg-worksheet-deep"
                      }`}
                    >
                      <span className="truncate text-[14px]">{displayName(row.name)}</span>
                      <span
                        className={`shrink-0 font-data text-[10px] uppercase tracking-[0.12em] ${
                          active ? "text-paper/80" : "text-ink-soft"
                        }`}
                      >
                        {row.remaining.toLocaleString("en-GB")} left
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <Legend />
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-ink/15 px-6 py-4 lg:px-7">
          <p className="truncate font-data text-[10px] text-ink-soft">{signedInAs}</p>
          <SignOutButton className="min-h-11 border border-ink/25 px-3 font-data text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop" />
        </footer>
      </aside>

      <div className="order-1 flex h-[54dvh] flex-col bg-ink p-3 lg:order-2 lg:h-full lg:flex-1">
        <div className="relative flex-1">
          <CoverageMap
            doors={mapDoors}
            outcomes={outcomes}
            props={props}
            selectedPropId={selectedPropId}
          />
        </div>
        <p className="mt-2 font-data text-[9px] leading-relaxed text-worksheet/70">
          Contains OS data © Crown copyright and database right 2026. Contains public sector
          information licensed under the Open Government Licence v3.0. Contains Energy
          Performance Certificate data © Crown copyright, Ministry of Housing, Communities and
          Local Government. Map data © OpenStreetMap contributors.
        </p>
      </div>
    </div>
  );
}

function displayName(name: string): string {
  return name.startsWith("DEMO - ") ? name.slice("DEMO - ".length) : name;
}

function Legend() {
  const items: { label: string; colour: string; dim?: boolean }[] = [
    { label: "Not yet worked", colour: "#4a5259", dim: true },
    { label: "No answer", colour: "#d2d6c9" },
    { label: "Contact", colour: "#1b4aa6" },
    { label: "Lead", colour: "#1e6b3a" },
    { label: "Rented/Council", colour: "#7a2b33" },
    { label: "Refused", colour: "#9c6212" },
  ];
  return (
    <div>
      <p className="font-data text-[10px] uppercase tracking-[0.2em] text-ink-soft">Legend</p>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-3 text-[13px] text-ink">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: item.colour, opacity: item.dim ? 0.35 : 1 }}
            />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
