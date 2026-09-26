"use client";

import { useEffect, useState } from "react";

import { formatTeammateLine, type TeammateRow } from "@/lib/field/door-signals";
import type { CachedAddress } from "@/lib/field/db";

/**
 * One line per other canvasser. A solo assignment renders nothing.
 * A stale line says when it was last heard, so grey text is not the only cue.
 */
export function TeammateLines({
  rows,
  labelFor,
}: {
  rows: TeammateRow[];
  labelFor: (uprn: number) => CachedAddress | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (rows.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [rows.length]);

  if (rows.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-2" data-testid="teammate-lines">
      {rows.map((row) => {
        const text = formatTeammateLine(row, row.uprn !== null ? labelFor(row.uprn) : undefined, now);
        return (
          <li
            key={row.canvasserId}
            data-testid="teammate-line"
            data-stale={row.stale ? "true" : "false"}
            data-empty={row.empty ? "true" : "false"}
            className={`text-base leading-snug ${row.stale ? "text-ink-soft" : "font-medium text-ink"}`}
          >
            {text}
          </li>
        );
      })}
    </ul>
  );
}
