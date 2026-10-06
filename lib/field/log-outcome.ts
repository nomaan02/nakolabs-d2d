import { applyLocalHouseNumber } from "@/lib/field/labels";
import { tenureFor } from "@/lib/field/outcomes";
import {
  newClientEventId,
  newRowId,
  NOTES_MAX,
  type AddressObservationOp,
  type CanvasserLeadInsert,
  type KnockEventOp,
  type KnockEventWrite,
  type KnockOutcome,
} from "@/lib/sync/ops";
import { enqueue, UNDO_WINDOW_MS } from "@/lib/sync/queue";

/**
 * The one function that records a door.
 *
 * Both logging surfaces call it: the Logger's sequence cursor, which is the
 * primary path, and a tap on the map, which is the secondary path and the
 * recovery route. There is no second write anywhere — everything leaves
 * through `lib/sync/queue.ts`.
 *
 * A correction is a new call with a NEW `client_event_id`, producing a NEW
 * `knock_events` row. Nothing is ever updated or deleted server-side, because
 * canvassers hold no UPDATE or DELETE grant on `knock_events` or `leads`;
 * `v_latest_knock` decides which row is current.
 */

export type LeadDetails = {
  /** ISO instant. Null means the canvasser booked no time. */
  booked_for: string | null;
  notes: string | null;
};

export type LogOutcomeInput = {
  assignmentId: string;
  canvasserId: string;
  uprn: number;
  /** Index into the sequence, zero-based. Null for a door reached off-sequence. */
  sequencePosition: number | null;
  outcome: KnockOutcome;
  notes?: string | null;
  lead?: LeadDetails;
  /**
   * Generated once, at the moment of the action. For a lead this is the id
   * created at the Lead TAP and carried through the sheet, so a dismissed and
   * reopened sheet still submits the same id.
   */
  clientEventId?: string;
  occurredAt?: string;
};

export type LogOutcomeResult = {
  clientEventId: string;
  outcome: KnockOutcome;
  uprn: number;
  /** False when this id was already in the outbox — a replayed double tap. */
  queued: boolean;
};

function trimNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const text = notes.trim();
  if (!text) return null;
  return text.slice(0, NOTES_MAX);
}

export async function logOutcome(input: LogOutcomeInput): Promise<LogOutcomeResult> {
  const clientEventId = input.clientEventId ?? newClientEventId();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const knockId = newRowId();

  const knock: KnockEventWrite = {
    id: knockId,
    client_event_id: clientEventId,
    assignment_id: input.assignmentId,
    canvasser_id: input.canvasserId,
    uprn: input.uprn,
    outcome: input.outcome,
    sequence_position: input.sequencePosition,
    occurred_at: occurredAt,
    notes: trimNotes(input.notes),
  };

  const payload: KnockEventOp["payload"] = { knock };

  if (input.outcome === "lead") {
    // `is_immediate` is absent on purpose: the leads_is_immediate_biu trigger
    // derives it from booked_for against this knock's occurred_at in
    // Europe/London. A client value would be overwritten.
    const lead: CanvasserLeadInsert = {
      id: newRowId(),
      client_event_id: clientEventId,
      knock_event_id: knockId,
      uprn: input.uprn,
      canvasser_id: input.canvasserId,
      booked_for: input.lead?.booked_for ?? null,
      notes: trimNotes(input.lead?.notes),
    };
    payload.lead = lead;
  }

  const tenure = tenureFor(input.outcome);
  if (tenure) {
    payload.observation = {
      id: newRowId(),
      client_event_id: clientEventId,
      uprn: input.uprn,
      canvasser_id: input.canvasserId,
      tenure,
      observed_at: occurredAt,
    };
  }

  const op: KnockEventOp = {
    kind: "knock_event",
    client_event_id: clientEventId,
    assignment_id: input.assignmentId,
    canvasser_id: input.canvasserId,
    payload,
  };

  const result = await enqueue(op, { undoWindowMs: UNDO_WINDOW_MS });
  return { clientEventId, outcome: input.outcome, uprn: input.uprn, queued: result.queued };
}

/**
 * Record a house number read off a real door.
 *
 * Invariant 5, second narrowing: the UPRN was already selected, by the cursor
 * or by a tap on its dot. This describes that door; it never finds one. There
 * is no search, no autocomplete and no street or postcode entry anywhere in
 * the field app.
 *
 * Its own op and its own `client_event_id` — a number correction is
 * independent of any outcome. No undo window: it is not destructive, and a
 * wrong number is fixed by typing the right one (newest observation wins in
 * `v_door_label`).
 */
export async function logHouseNumber(input: {
  assignmentId: string;
  canvasserId: string;
  uprn: number;
  houseNumber: string;
}): Promise<{ clientEventId: string; queued: boolean }> {
  const clientEventId = newClientEventId();
  const houseNumber = input.houseNumber.trim();

  const op: AddressObservationOp = {
    kind: "address_observation",
    client_event_id: clientEventId,
    assignment_id: input.assignmentId,
    canvasser_id: input.canvasserId,
    payload: {
      address: {
        client_event_id: clientEventId,
        uprn: input.uprn,
        canvasser_id: input.canvasserId,
        house_number: houseNumber,
        observed_at: new Date().toISOString(),
      },
    },
  };

  const result = await enqueue(op);
  if (result.queued) await applyLocalHouseNumber(input.uprn, houseNumber).catch(() => undefined);
  return { clientEventId, queued: result.queued };
}

/**
 * UI-8 D2c (owner H4, U8-1..U8-3; 2026-10-06). Doors passed between two
 * tapped logs in exceptions-only mode, recorded as Not In with origin
 * 'inferred'. Which doors is decided by `lib/field/inference.ts`.
 *
 * Each door is its own knock with its own client_event_id, held in the same
 * undo window as a tap, so Undo deletes them before anything is sent. Returns
 * the ids that were queued, in route order.
 */
export async function logInferredNotIn(input: {
  assignmentId: string;
  canvasserId: string;
  doors: ReadonlyArray<{ uprn: number; position: number; occurredAt: string }>;
}): Promise<string[]> {
  const queued: string[] = [];
  for (const door of input.doors) {
    const clientEventId = newClientEventId();
    const knock: KnockEventWrite = {
      id: newRowId(),
      client_event_id: clientEventId,
      assignment_id: input.assignmentId,
      canvasser_id: input.canvasserId,
      uprn: door.uprn,
      outcome: "no_answer",
      sequence_position: door.position,
      occurred_at: door.occurredAt,
      notes: null,
      origin: "inferred",
    };
    const op: KnockEventOp = {
      kind: "knock_event",
      client_event_id: clientEventId,
      assignment_id: input.assignmentId,
      canvasser_id: input.canvasserId,
      payload: { knock },
    };
    const result = await enqueue(op, { undoWindowMs: UNDO_WINDOW_MS });
    if (result.queued) queued.push(clientEventId);
  }
  return queued;
}
