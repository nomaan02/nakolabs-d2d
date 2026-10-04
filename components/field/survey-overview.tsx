"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  surveySummary,
  type SurveyCode,
  type SurveyDoorRow,
  type SurveyRow,
} from "@/lib/field/survey-rows";

/**
 * UI-6 B2b (owners B2-1..B2-4, 2026-10-04). The paper survey on the phone:
 * every knockable door in route order, its outcome code, and the doors
 * still to knock. Figma: "Logger / Survey Overview (UI-6 B2)".
 *
 * Draws only the rows on screen (fixed heights), so a 1,700-door prop
 * scrolls smoothly with no new dependency. Tapping a row hands the door's
 * sequence index back to the Logger, which switches to Logging on it.
 */

const DOOR_H = 48;
const STREET_H = 32;
const OVERSCAN = 8;
/** Generous fixed window height; overscan covers any phone. No measuring in an effect. */
const VIEWPORT_H = 900;

const CODE_CLASS: Record<SurveyCode, string> = {
  L: "bg-outcome-lead text-outcome-on-pill",
  C: "bg-outcome-contact text-outcome-on-pill",
  R: "border border-outcome-rented-edge bg-outcome-rented text-outcome-rented-ink",
  NI: "bg-outcome-notin text-outcome-on-pill",
  O: "bg-ink-soft text-surface",
};

const CODE_NAME: Record<SurveyCode, string> = {
  L: "Lead",
  C: "Contact",
  R: "Rented or council",
  NI: "Not in",
  O: "Other",
};

function heightOf(row: SurveyRow): number {
  return row.kind === "street" ? STREET_H : DOOR_H;
}

/** Index of the last row whose top is at or above `y` (binary search). */
function rowAt(tops: number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function CodeChip({ code }: { code: SurveyCode | null }) {
  if (code === null) {
    return (
      <span
        aria-label="Still to knock"
        className="h-7 w-11 shrink-0 rounded-full border border-dashed border-line"
      />
    );
  }
  return (
    <span
      aria-label={CODE_NAME[code]}
      className={`flex h-7 w-11 shrink-0 items-center justify-center rounded-full text-field-button-label ${CODE_CLASS[code]}`}
    >
      {code}
    </span>
  );
}

function DoorLine({ row, onPick }: { row: SurveyDoorRow; onPick: (index: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(row.index)}
      className={
        row.current
          ? "flex h-12 w-full items-center gap-3 border-b border-l-4 border-b-line border-l-prop bg-prop/10 pr-4 pl-3 text-left"
          : "flex h-12 w-full items-center gap-3 border-b border-line bg-surface px-4 text-left"
      }
      aria-current={row.current ? "true" : undefined}
      data-testid="survey-row"
    >
      <span className="min-w-0 flex-1 truncate text-field-body-strong text-ink">{row.address}</span>
      {row.knockedBy && row.code === null ? (
        <span className="shrink-0 text-field-body text-ink-muted">{row.knockedBy}</span>
      ) : null}
      <CodeChip code={row.code} />
    </button>
  );
}

export function SurveyOverview({
  rows,
  onPick,
}: {
  rows: SurveyRow[];
  onPick: (index: number) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const { tops, total } = useMemo(() => {
    const out: number[] = [];
    let y = 0;
    for (const row of rows) {
      out.push(y);
      y += heightOf(row);
    }
    return { tops: out, total: y };
  }, [rows]);

  const summary = useMemo(() => surveySummary(rows), [rows]);

  // Open on the current door, a third of the way down. Runs once per mount.
  // Setting scrollTop fires onScroll, which updates state; no setState here.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const current = rows.findIndex((row) => row.kind === "door" && row.current);
    if (current > 0) node.scrollTop = Math.max(0, tops[current]! - node.clientHeight / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-field-body text-ink-soft" data-testid="survey-empty">
        No doors on this prop.
      </p>
    );
  }

  const first = Math.max(0, rowAt(tops, scrollTop) - OVERSCAN);
  const last = Math.min(rows.length - 1, rowAt(tops, scrollTop + VIEWPORT_H) + OVERSCAN);
  const pinnedIndex = rowAt(tops, scrollTop);
  const pinned = rows[pinnedIndex];
  const pinnedStreet = pinned?.street ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="survey-overview">
      <p className="shrink-0 px-4 pt-1 pb-2 text-field-body text-ink-soft" data-testid="survey-summary">
        {summary.knocked.toLocaleString("en-GB")} knocked · {summary.toGo.toLocaleString("en-GB")} to go
      </p>
      <div className="relative min-h-0 flex-1">
        {scrollTop > 0 && pinnedStreet ? (
          <p
            className="absolute inset-x-0 top-0 z-[1] flex h-8 items-end bg-field-bg px-4 pb-1.5 text-field-eyebrow uppercase text-ink-soft"
            data-testid="survey-pinned-street"
          >
            {pinnedStreet}
          </p>
        ) : null}
        <div
          ref={scroller}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="absolute inset-0 overflow-y-auto bg-surface"
          data-testid="survey-list"
        >
          <div className="relative" style={{ height: total }}>
            {rows.slice(first, last + 1).map((row, offset) => {
              const i = first + offset;
              return (
                <div key={row.key} className="absolute inset-x-0" style={{ top: tops[i], height: heightOf(row) }}>
                  {row.kind === "street" ? (
                    <p className="flex h-8 items-end bg-field-bg px-4 pb-1.5 text-field-eyebrow uppercase text-ink-soft">
                      {row.street}
                    </p>
                  ) : (
                    <DoorLine row={row} onPick={onPick} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
