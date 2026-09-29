"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import { fieldDb, type OutboxRow } from "@/lib/field/db";
import { sharedKnockMessage } from "@/lib/field/shared-knock";

type SharedDoor = {
  count: number;
  example: string | null;
};

function exampleLabel(rows: OutboxRow[]): string | null {
  let best: number | null = null;
  for (const row of rows) {
    if (row.kind !== "knock_event") continue;
    const payload = row.payload as { knock?: { sequence_position?: number | null } };
    const position = payload.knock?.sequence_position;
    if (typeof position !== "number") continue;
    const human = position + 1;
    if (best === null || human < best) best = human;
  }
  return best === null ? null : `door ${best}`;
}

/**
 * Exported (UI item 1, Session C, 2026-09-29): the Logger's single banner
 * slot (P3/P6) needs this count and example to decide whether the Info
 * banner is the highest-priority one showing, without rendering a second
 * copy of this component. `SharedKnockNotice` below is unchanged and still
 * usable standalone.
 */
export function useSharedDoors(assignmentId: string | null): SharedDoor {
  const [value, setValue] = useState<SharedDoor>({ count: 0, example: null });

  useEffect(() => {
    if (!assignmentId) {
      setValue({ count: 0, example: null });
      return;
    }
    const observable = liveQuery(() =>
      fieldDb()
        .outbox.where("[assignment_id+seq]")
        .between([assignmentId, 0], [assignmentId, Infinity])
        .toArray(),
    );
    const sub = observable.subscribe({
      next: (rows) => {
        const shared = rows.filter((row) => row.kind === "knock_event" && row.shared_door);
        const uprns = new Set<number>();
        for (const row of shared) {
          const payload = row.payload as { knock?: { uprn?: number } };
          if (typeof payload.knock?.uprn === "number") uprns.add(payload.knock.uprn);
        }
        setValue({ count: uprns.size, example: exampleLabel(shared) });
      },
      error: () => setValue({ count: 0, example: null }),
    });
    return () => sub.unsubscribe();
  }, [assignmentId]);

  return value;
}

/** Shown after resync when a teammate logged the same UPRN. Coverage still counts it once. */
export function SharedKnockNotice({ assignmentId }: { assignmentId: string | null }) {
  const { count, example } = useSharedDoors(assignmentId);
  const message = sharedKnockMessage(count, example);
  if (!message) return null;

  return (
    <p
      role="status"
      data-testid="shared-knock"
      className="mx-3 mb-2 flex items-start gap-2 rounded-md border-2 border-ink bg-paper px-3 py-2 text-sm font-medium leading-snug text-ink"
    >
      <span aria-hidden className="font-data text-base leading-none">
        !
      </span>
      <span>{message}</span>
    </p>
  );
}
