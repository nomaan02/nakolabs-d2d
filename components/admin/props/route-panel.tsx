"use client";

import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { ChevronDownIcon, ChevronRightIcon, DrawIcon, RouteIcon, WarningIcon } from "@/components/field/icons";
import { routeCards, routeDetailLine, type RouteSummary } from "@/lib/admin/draw-copy";
import type { RouteMode } from "@/lib/geo/walk/manual-save";

export type RoutePhase =
  | { status: "working" }
  | { status: "failed"; message: string }
  | { status: "ready"; variants: RouteSummary[]; notice: string | null };

/** RT-3 (R1, R6): the prop's drawn route, if it has one. */
export type DrawnRoute = {
  mode: RouteMode;
  /** "61 doors · 11 left out". */
  line: string;
  /** False when doors were added since it was saved (status needs_finishing): visits use A / B until it is saved again. */
  finished: boolean;
};

/**
 * UI-10 F2d (owner A20, A23; frame 12). After Save: the prop's routes are
 * made and saved in one go, then shown here. Visits take turns between
 * Route A and Route B (the rotation decides, so nothing is "chosen" here);
 * tapping a card shows that route on the map. Spare routes and the numbers
 * behind them sit under Route details.
 *
 * RT-3 (owner 2026-10-13; R1, R6): "Draw your own route" sits under the
 * cards. Once a route is drawn the choice is real: "Your route" (visits walk
 * it as drawn, then reversed) or "Automatic routes" (A and B by turns).
 */
export function RoutePanel({
  title,
  savedLine,
  phase,
  previewKey,
  onPreview,
  onRetry,
  onDone,
  drawn,
  modeBusy,
  onDrawOwn,
  onMode,
}: {
  title: string;
  /** "Saved Fulford Road east." or "New shape saved." */
  savedLine: string;
  phase: RoutePhase;
  previewKey: string | null;
  onPreview: (key: string) => void;
  onRetry: () => void;
  onDone: () => void;
  /** Null: no drawn route yet (R1). */
  drawn: DrawnRoute | null;
  modeBusy: boolean;
  onDrawOwn: () => void;
  onMode: (mode: RouteMode) => void;
}) {
  const [details, setDetails] = useState(false);
  const cards = phase.status === "ready" ? routeCards(phase.variants) : [];
  // The prop may have no automatic routes yet (they are made when it is first allocated).
  const hasAuto = cards.length > 0;

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
          {savedLine ? <p className="text-admin-subhead text-ink-muted">{savedLine}</p> : null}
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
          {phase.status === "ready" && drawn ? (
            <>
              <p className="mt-0.5 text-admin-subhead text-ink-muted">
                {drawn.mode === "manual" && !drawn.finished
                  ? hasAuto
                    ? "Your route needs finishing: new doors are not on it. Visits use Route A and B until you save it again."
                    : "Your route needs finishing: new doors are not on it. Save it again before the next visit."
                  : drawn.mode === "manual"
                    ? "Visits use your route: as drawn, then reversed, by turns."
                    : "Visits take turns between Route A and B."}
              </p>
              <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Which route visits use">
                <Choice
                  on={drawn.mode === "manual"}
                  disabled={modeBusy}
                  title="Your route"
                  sub={drawn.finished ? drawn.line : `${drawn.line} · needs finishing`}
                  onClick={() => {
                    onPreview("manual");
                    if (drawn.mode !== "manual") onMode("manual");
                  }}
                />
                <Choice
                  on={drawn.mode === "auto"}
                  disabled={modeBusy || (!hasAuto && drawn.mode !== "auto")}
                  title="Automatic routes"
                  sub={hasAuto ? "Route A and B take turns" : "None yet: made when the prop is first allocated"}
                  onClick={() => {
                    onPreview("best");
                    if (drawn.mode !== "auto") onMode("auto");
                  }}
                />
              </div>
              <LinkRow
                title={drawn.finished ? "Edit your route" : "Finish your route"}
                sub={drawn.finished ? "Opens the drawing where you left it" : "New doors are ringed on the map"}
                onClick={onDrawOwn}
              />
            </>
          ) : null}
          {phase.status === "ready" && !drawn ? (
            <>
              <p className="mt-0.5 text-admin-subhead text-ink-muted">
                {hasAuto ? "Visits take turns. Tap one to see it." : "No automatic routes yet: they are made when the prop is first allocated."}
              </p>
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
              <LinkRow title="Draw your own route" sub="Drag through the doors in walking order" onClick={onDrawOwn} />
            </>
          ) : null}
          {phase.status === "ready" && phase.variants.length > 0 ? (
            <>
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

function Choice({ on, disabled, title, sub, onClick }: { on: boolean; disabled: boolean; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-field-lg border px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop disabled:opacity-60 ${
        on ? "border-prop bg-prop-soft" : "border-line bg-surface"
      }`}
    >
      <span aria-hidden className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-prop" : "border-ink-faint"}`}>
        {on ? <span className="size-2.5 rounded-full bg-prop" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-admin-body-strong">{title}</span>
        <span className="block truncate text-admin-subhead text-ink-muted tabular-nums">{sub}</span>
      </span>
    </button>
  );
}

function LinkRow({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex w-full items-center gap-3 rounded-field-lg border border-line bg-surface px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
    >
      <DrawIcon className="size-5 shrink-0 text-prop" />
      <span className="min-w-0 flex-1">
        <span className="block text-admin-body-strong">{title}</span>
        <span className="block truncate text-admin-subhead text-ink-muted">{sub}</span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-ink-muted" />
    </button>
  );
}
