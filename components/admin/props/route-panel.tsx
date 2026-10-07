"use client";

import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { ChevronDownIcon, RouteIcon, WarningIcon } from "@/components/field/icons";
import { routeCards, routeDetailLine } from "@/lib/admin/draw-copy";
import type { WalkVariant } from "@/lib/geo/walk/types";

export type RoutePhase =
  | { status: "working" }
  | { status: "failed"; message: string }
  | { status: "ready"; variants: WalkVariant[]; notice: string | null };

/**
 * UI-10 F2d (owner A20, A23; frame 12). After Save: the prop's routes are
 * made and saved in one go, then shown here. Visits take turns between
 * Route A and Route B (the rotation decides, so nothing is "chosen" here);
 * tapping a card shows that route on the map. Spare routes and the numbers
 * behind them sit under Route details.
 */
export function RoutePanel({
  title,
  savedLine,
  phase,
  previewKey,
  onPreview,
  onRetry,
  onDone,
}: {
  title: string;
  /** "Saved Fulford Road east." or "New shape saved." */
  savedLine: string;
  phase: RoutePhase;
  previewKey: string | null;
  onPreview: (key: string) => void;
  onRetry: () => void;
  onDone: () => void;
}) {
  const [details, setDetails] = useState(false);
  const cards = phase.status === "ready" ? routeCards(phase.variants) : [];

  return (
    <>
      <header className="absolute inset-x-0 top-0 z-20 flex h-13 items-center justify-center border-b border-line bg-surface px-14 lg:hidden">
        <h1 className="truncate text-admin-headline">{title}</h1>
      </header>
      <section
        aria-label="Routes"
        className="absolute inset-x-0 bottom-0 z-20 flex max-h-[70dvh] flex-col rounded-t-admin-sheet bg-surface text-ink shadow-admin-sheet motion-safe:animate-admin-sheet-in lg:inset-x-auto lg:top-3 lg:bottom-3 lg:left-3 lg:max-h-none lg:w-[360px] lg:rounded-admin-sheet lg:border lg:border-line"
      >
        <div aria-hidden className="flex justify-center pt-2 pb-1 lg:hidden">
          <span className="h-1.5 w-9 rounded-full bg-ink-faint" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 lg:pt-4">
          <p className="text-admin-subhead text-ink-muted">{savedLine}</p>
          <h2 className="mt-1 text-admin-title">Routes</h2>
          {phase.status === "working" ? (
            <p className="mt-3 flex items-center gap-2 text-admin-body text-ink-soft" role="status">
              <RouteIcon className="size-5 motion-safe:animate-pulse" />
              Making the routes…
            </p>
          ) : null}
          {phase.status === "failed" ? (
            <div role="alert" className="mt-3 rounded-field-md bg-warn-bg p-3 text-warn-ink">
              <p className="flex gap-2 text-admin-subhead">
                <WarningIcon className="size-5 shrink-0" />
                {phase.message}
              </p>
              <Button kind="secondary" size="compact" className="mt-2" onClick={onRetry}>
                Try again
              </Button>
            </div>
          ) : null}
          {phase.status === "ready" ? (
            <>
              <p className="mt-0.5 text-admin-subhead text-ink-muted">Visits take turns. Tap one to see it.</p>
              <ul className="mt-3 flex flex-col gap-2">
                {cards.map((card) => {
                  const on = card.key === previewKey;
                  return (
                    <li key={card.key}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => onPreview(card.key)}
                        className={`flex w-full items-center gap-3 rounded-field-lg border px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
                          on ? "border-prop bg-prop-soft" : "border-line bg-surface"
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-prop" : "border-ink-faint"}`}
                        >
                          {on ? <span className="size-2.5 rounded-full bg-prop" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-admin-body-strong tabular-nums">{card.title}</span>
                          <span className="block truncate text-admin-subhead text-ink-muted">
                            {card.visits}
                            {card.start ? ` · starts on ${card.start}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                aria-expanded={details}
                onClick={() => setDetails((open) => !open)}
                className="mt-2 flex min-h-11 w-full items-center justify-between px-1 text-admin-body text-ink-soft focus-visible:outline-2 focus-visible:outline-prop"
              >
                Route details
                <ChevronDownIcon className={`size-5 transition-transform motion-reduce:transition-none ${details ? "rotate-180" : ""}`} />
              </button>
              {details ? (
                <div className="px-1 pb-2">
                  <ul className="flex flex-col gap-1 text-admin-caption text-ink-soft tabular-nums">
                    {phase.variants.map((variant) => (
                      <li key={variant.key}>{routeDetailLine(variant)}</li>
                    ))}
                  </ul>
                  {phase.notice ? <p className="mt-2 text-admin-caption text-ink-muted">{phase.notice}</p> : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button className="w-full" onClick={onDone}>
            Done
          </Button>
        </div>
      </section>
    </>
  );
}
