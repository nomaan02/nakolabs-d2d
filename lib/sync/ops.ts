import type { Database } from "@/lib/supabase/types";

/**
 * Wire types for everything the field app is allowed to write. These are
 * deliberately narrower than the generated `Insert` types: the generator
 * reflects nullability, not the column-level GRANTs in 003_core.sql, so the
 * raw types compile for payloads that fail at runtime with 42501.
 *
 * Nothing in this file talks to the network. The queue stores what it is
 * given and re-sends the identical bytes on retry.
 */

type Tables = Database["public"]["Tables"];
type KnockEventsInsert = Tables["knock_events"]["Insert"];
type LeadsInsert = Tables["leads"]["Insert"];
type PropertyObservationsInsert = Tables["property_observations"]["Insert"];
type AddressObservationsInsert = Tables["address_observations"]["Insert"];
type CrmCallbacksInsert = Tables["crm_callbacks"]["Insert"];

/** `knock_events.outcome` check constraint, 014_stage_8a_knock_logger_schema.sql. */
export const KNOCK_OUTCOMES = [
  "answered",
  "no_answer",
  "refused",
  "not_interested",
  "lead",
  "callback",
  "do_not_call",
  "inaccessible",
  "no_opportunity",
] as const;
export type KnockOutcome = (typeof KNOCK_OUTCOMES)[number];

/** `property_observations.tenure` check constraint, 014_stage_8a_knock_logger_schema.sql. */
export const TENURES = [
  "rented",
  "council",
  "student",
  "owner",
  "unknown",
  "no_opportunity",
] as const;
export type Tenure = (typeof TENURES)[number];

/** `address_observations.house_number` length check, 014. */
export const HOUSE_NUMBER_MAX = 12;

/** `knock_events.notes` length check, 014. */
export const NOTES_MAX = 280;

/**
 * One knock. `id` is REQUIRED and device-generated (not the server default)
 * because an offline lead must reference it through `leads.knock_event_id`
 * before the knock row exists. `synced_at` is never sent — server default.
 *
 * `notes` is required in the type but nullable on the wire: an omitted field
 * and an explicit null reach Postgres identically, and requiring it stops a
 * caller silently dropping a note the canvasser typed.
 */
export type KnockEventWrite = Required<
  Pick<
    KnockEventsInsert,
    "id" | "client_event_id" | "assignment_id" | "canvasser_id" | "uprn" | "occurred_at"
  >
> & {
  outcome: KnockOutcome;
  sequence_position: number | null;
  notes: string | null;
  /**
   * UI-8 (owner H4, 2026-10-06; migration 028). Sent ONLY for a door filled
   * as Not In by exceptions-only logging. Absent = the server default 'tap'.
   */
  origin?: "inferred";
};

/**
 * Exactly the seven columns a canvasser may insert on `leads`. Anything else
 * (`status`, `crm_ref`, …) is a 42501 at runtime; keeping them out of the type
 * closes that trap here rather than at the doorstep.
 *
 * `is_immediate` is deliberately EXCLUDED. It is owned by the
 * `leads_is_immediate_biu` trigger, which compares `booked_for` to the knock's
 * `occurred_at` in Europe/London. A client value is overwritten, so sending
 * one can only ever mislead whoever reads the payload back.
 */
export type CanvasserLeadInsert = Pick<
  LeadsInsert,
  "id" | "client_event_id" | "knock_event_id" | "uprn" | "canvasser_id" | "booked_for" | "notes"
>;

export type PropertyObservationWrite = Required<
  Pick<PropertyObservationsInsert, "client_event_id" | "uprn" | "canvasser_id" | "observed_at">
> & {
  id?: string;
  tenure: Tenure | null;
};

/**
 * A house number read off a real door, against a UPRN the canvasser has
 * ALREADY selected. Invariant 5, second narrowing: it describes the door, it
 * never selects it. `id` is the server default — nothing references this row.
 */
export type AddressObservationWrite = Required<
  Pick<
    AddressObservationsInsert,
    "client_event_id" | "uprn" | "canvasser_id" | "house_number" | "observed_at"
  >
>;

type OpBase = {
  /** uuid v4, generated once per door-visit action by the caller. */
  client_event_id: string;
  /** Ordering group. Rows within one assignment reach the server in order. */
  assignment_id: string;
  /** Captured at enqueue. Rows for a different signed-in user are held. */
  canvasser_id: string;
};

export type KnockEventOp = OpBase & {
  kind: "knock_event";
  payload: {
    knock: KnockEventWrite;
    /** Present when the outcome is `lead`. Shares the knock's client_event_id. */
    lead?: CanvasserLeadInsert;
    /**
     * Present when the outcome is `no_opportunity` (Rented/Council). One tap
     * is one door-visit, so the tenure observation shares the knock's
     * client_event_id rather than being a second op — the outbox has a unique
     * index on that id and could not hold both.
     */
    observation?: PropertyObservationWrite;
  };
};

export type PropertyObservationOp = OpBase & {
  kind: "property_observation";
  payload: {
    observation: PropertyObservationWrite;
  };
};

/**
 * A number correction is independent of an outcome log — a canvasser may fix
 * a label on a door they have not knocked, or knock a door without touching
 * its label — so this is its own op with its own client_event_id.
 */
export type AddressObservationOp = OpBase & {
  kind: "address_observation";
  payload: {
    address: AddressObservationWrite;
  };
};

/** CRM-5 B: what a canvasser can record after ringing a call-back lead. */
export const CALL_RESULTS = ["rebooked", "no_answer", "later", "not_interested", "wrong_number"] as const;
export type CallResult = (typeof CALL_RESULTS)[number];

/**
 * CRM-5 B (owner 2026-10-11). One call to a call-back lead. Insert-only; the
 * latest row per lead wins. Never sent to the CRM. `id` and `created_at` are
 * server defaults.
 */
export type CrmCallbackWrite = Required<
  Pick<CrmCallbacksInsert, "client_event_id" | "crm_id" | "canvasser_id" | "call_back_on" | "called_at">
> & { result: CallResult };

/** Call results are not tied to a prop; they share one ordering group. */
export const CRM_CALLBACK_GROUP = "crm-callbacks";

export type CrmCallbackOp = OpBase & {
  kind: "crm_callback";
  payload: {
    callback: CrmCallbackWrite;
  };
};

export type SyncOp = KnockEventOp | PropertyObservationOp | AddressObservationOp | CrmCallbackOp;
export type SyncOpKind = SyncOp["kind"];

/**
 * Structural checks that do not need the network. The queue calls this on
 * enqueue and refuses ops that would be inconsistent on the wire — a lead
 * whose id differs from its knock's is exactly the bug Stage 8's acceptance
 * text warns about, and it must be impossible to queue.
 */
export function validateOp(op: SyncOp): string | null {
  if (!op.client_event_id) return "client_event_id is empty";
  if (!op.assignment_id) return "assignment_id is empty";
  if (!op.canvasser_id) return "canvasser_id is empty";

  if (op.kind === "knock_event") {
    const { knock, lead, observation } = op.payload;
    if (!knock.id) return "knock.id is empty (must be generated on device)";
    if (knock.client_event_id !== op.client_event_id) {
      return "knock.client_event_id differs from the op's client_event_id";
    }
    if (knock.assignment_id !== op.assignment_id) {
      return "knock.assignment_id differs from the op's assignment_id";
    }
    if (knock.canvasser_id !== op.canvasser_id) {
      return "knock.canvasser_id differs from the op's canvasser_id";
    }
    if (!KNOCK_OUTCOMES.includes(knock.outcome)) return `unknown outcome ${String(knock.outcome)}`;
    if (knock.notes !== null && knock.notes.length > NOTES_MAX) {
      return `knock.notes is longer than ${NOTES_MAX} characters`;
    }
    if (knock.origin !== undefined) {
      if (knock.origin !== "inferred") return `unknown origin ${String(knock.origin)}`;
      if (knock.outcome !== "no_answer") return "an inferred knock must be Not In (no_answer)";
      if (lead || observation) return "an inferred knock carries no lead or observation";
    }
    if (lead) {
      if (lead.client_event_id !== op.client_event_id) {
        return "lead.client_event_id differs from the knock's client_event_id";
      }
      if (lead.knock_event_id !== knock.id) return "lead.knock_event_id does not reference knock.id";
      if (lead.canvasser_id !== op.canvasser_id) {
        return "lead.canvasser_id differs from the op's canvasser_id";
      }
      if (lead.uprn !== knock.uprn) return "lead.uprn differs from knock.uprn";
      if ("status" in lead) return "lead payload must not carry status";
      // The trigger owns it. A client value is overwritten, so a payload
      // carrying one is a misreading of the schema, not a harmless extra.
      if ("is_immediate" in lead) return "lead payload must not carry is_immediate";
      if (knock.outcome !== "lead") return "a lead payload requires outcome 'lead'";
    }
    if (observation) {
      const problem = checkObservation(op, observation);
      if (problem) return problem;
      if (observation.uprn !== knock.uprn) return "observation.uprn differs from knock.uprn";
      if (knock.outcome !== "no_opportunity") {
        return "a tenure observation requires outcome 'no_opportunity'";
      }
    }
    return null;
  }

  if (op.kind === "property_observation") {
    return checkObservation(op, op.payload.observation);
  }

  if (op.kind === "crm_callback") return checkCallback(op, op.payload.callback);

  const { address } = op.payload;
  if (address.client_event_id !== op.client_event_id) {
    return "address.client_event_id differs from the op's client_event_id";
  }
  if (address.canvasser_id !== op.canvasser_id) {
    return "address.canvasser_id differs from the op's canvasser_id";
  }
  if (!Number.isFinite(address.uprn)) return "address.uprn is not a UPRN";
  const houseNumber = address.house_number.trim();
  if (houseNumber.length < 1 || houseNumber.length > HOUSE_NUMBER_MAX) {
    return `address.house_number must be 1 to ${HOUSE_NUMBER_MAX} characters`;
  }
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkCallback(op: CrmCallbackOp, callback: CrmCallbackWrite): string | null {
  if (op.assignment_id !== CRM_CALLBACK_GROUP) return `a call result must use assignment_id '${CRM_CALLBACK_GROUP}'`;
  if (callback.client_event_id !== op.client_event_id) {
    return "callback.client_event_id differs from the op's client_event_id";
  }
  if (callback.canvasser_id !== op.canvasser_id) {
    return "callback.canvasser_id differs from the op's canvasser_id";
  }
  if (!/^\d+x\d+$/.test(callback.crm_id)) return "callback.crm_id is not a CRM lead id";
  if (!CALL_RESULTS.includes(callback.result)) return `unknown call result ${String(callback.result)}`;
  if (Number.isNaN(Date.parse(callback.called_at))) return "callback.called_at is not a time";
  if (callback.result === "later") {
    if (!callback.call_back_on || !ISO_DATE.test(callback.call_back_on)) return "'later' needs a call_back_on date (YYYY-MM-DD)";
  } else if (callback.call_back_on !== null) {
    return "only 'later' carries a call_back_on date";
  }
  return null;
}

function checkObservation(
  op: Pick<OpBase, "client_event_id" | "canvasser_id">,
  observation: PropertyObservationWrite,
): string | null {
  if (observation.client_event_id !== op.client_event_id) {
    return "observation.client_event_id differs from the op's client_event_id";
  }
  if (observation.canvasser_id !== op.canvasser_id) {
    return "observation.canvasser_id differs from the op's canvasser_id";
  }
  if (observation.tenure !== null && !TENURES.includes(observation.tenure)) {
    return `unknown tenure ${String(observation.tenure)}`;
  }
  return null;
}

function uuidV4(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("No cryptographic random source is available on this device");
  }
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One per door-visit action, generated on the device at the moment of the action. */
export function newClientEventId(): string {
  return uuidV4();
}

/** Device-generated primary key for a row that another offline row must reference. */
export function newRowId(): string {
  return uuidV4();
}
