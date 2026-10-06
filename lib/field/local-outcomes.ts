"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import { fieldDb, type OutboxRow } from "@/lib/field/db";
import type { KnockOutcome } from "@/lib/sync/ops";

/**
 * What this device believes has been logged on the CURRENT assignment.
 *
 * Read from the outbox, not from the server, for two reasons. It is the only
 * source that exists in airplane mode, and it is the only one that can show a
 * door changing state the instant it is tapped — before any sync.
 *
 * Latest-wins is applied locally by taking the highest `seq`, which mirrors
 * what `v_latest_knock` will decide once the rows land. Corrections are new
 * rows here exactly as they are new rows there.
 *
 * Scoped to one assignment by query, never merged across assignments: a
 * previous visit's outcome colour on a new visit's map is cherry-picking
 * fuel and is banned by invariant 2.
 */

export type LocalOutcome = {
  uprn: number;
  outcome: KnockOutcome;
  clientEventId: string;
  occurredAt: string;
  notes: string | null;
  /** Still inside its undo window — deletable, and not yet sent anywhere. */
  undoable: boolean;
  bookedFor: string | null;
  isLead: boolean;
  /**
   * From the outbox row's own `canvasser_id`, not the payload. Stats are
   * this canvasser only (invariant 2) — a shared device could otherwise fold
   * a previous signed-in canvasser's rows into the current one's count.
   */
  canvasserId: string;
  /** UI-8: filled as Not In by exceptions-only logging (`origin = 'inferred'`). */
  inferred?: boolean;
};

export type LocalOutcomes = Map<number, LocalOutcome>;

type KnockPayload = {
  knock: {
    uprn: number;
    outcome: KnockOutcome;
    occurred_at: string;
    notes: string | null;
    origin?: string;
  };
  lead?: { booked_for: string | null };
};

function isKnockRow(row: OutboxRow): boolean {
  return row.kind === "knock_event";
}

export function foldOutcomes(rows: OutboxRow[]): LocalOutcomes {
  const map: LocalOutcomes = new Map();
  for (const row of rows) {
    if (!isKnockRow(row)) continue;
    // A row the server has permanently rejected did not happen. Leaving the
    // door coloured would tell the canvasser it is worked when it is not;
    // the rejection is surfaced separately by the sync status banner.
    if (row.status === "failed") continue;
    const payload = row.payload as KnockPayload;
    map.set(payload.knock.uprn, {
      uprn: payload.knock.uprn,
      outcome: payload.knock.outcome,
      clientEventId: row.client_event_id,
      occurredAt: payload.knock.occurred_at,
      notes: payload.knock.notes ?? null,
      undoable: row.status === "held_undo",
      bookedFor: payload.lead?.booked_for ?? null,
      isLead: payload.knock.outcome === "lead",
      canvasserId: row.canvasser_id,
      inferred: payload.knock.origin === "inferred",
    });
  }
  return map;
}

/** Live map of uprn → latest local outcome for one assignment. */
export function useLocalOutcomes(assignmentId: string | null): LocalOutcomes {
  const [outcomes, setOutcomes] = useState<LocalOutcomes>(() => new Map());

  useEffect(() => {
    if (!assignmentId) {
      setOutcomes(new Map());
      return;
    }
    const db = fieldDb();
    const observable = liveQuery(() =>
      // [assignment_id+seq] is indexed, so this stays a range scan as the
      // day's outbox grows.
      db.outbox.where("[assignment_id+seq]").between([assignmentId, 0], [assignmentId, Infinity]).toArray(),
    );
    const sub = observable.subscribe({
      next: (rows) => setOutcomes(foldOutcomes(rows)),
      error: () => setOutcomes(new Map()),
    });
    return () => sub.unsubscribe();
  }, [assignmentId]);

  return outcomes;
}

/** Today's leads on this assignment, oldest first. Never aggregated. */
export function leadsFromOutcomes(outcomes: LocalOutcomes): LocalOutcome[] {
  return Array.from(outcomes.values())
    .filter((entry) => entry.isLead)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
