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

/** `knock_events.outcome` check constraint, 003_core.sql. */
export const KNOCK_OUTCOMES = [
  "answered",
  "no_answer",
  "refused",
  "not_interested",
  "lead",
  "callback",
  "do_not_call",
  "inaccessible",
] as const;
export type KnockOutcome = (typeof KNOCK_OUTCOMES)[number];

/** `property_observations.tenure` check constraint, 003_core.sql. */
export const TENURES = ["rented", "council", "student", "owner", "unknown"] as const;
export type Tenure = (typeof TENURES)[number];

/**
 * One knock. `id` is REQUIRED and device-generated (not the server default)
 * because an offline lead must reference it through `leads.knock_event_id`
 * before the knock row exists. `synced_at` is never sent — server default.
 */
export type KnockEventWrite = Required<
  Pick<
    KnockEventsInsert,
    "id" | "client_event_id" | "assignment_id" | "canvasser_id" | "uprn" | "occurred_at"
  >
> & {
  outcome: KnockOutcome;
  sequence_position: number | null;
};

/**
 * Exactly the eight columns `authenticated` may insert on `leads`. Anything
 * else (`status`, `crm_ref`, …) is a 42501 at runtime; keeping them out of the
 * type closes that trap here rather than in Stage 8.
 */
export type CanvasserLeadInsert = Pick<
  LeadsInsert,
  | "id"
  | "client_event_id"
  | "knock_event_id"
  | "uprn"
  | "canvasser_id"
  | "booked_for"
  | "is_immediate"
  | "notes"
>;

export type PropertyObservationWrite = Required<
  Pick<PropertyObservationsInsert, "client_event_id" | "uprn" | "canvasser_id" | "observed_at">
> & {
  id?: string;
  tenure: Tenure | null;
};

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
  };
};

export type PropertyObservationOp = OpBase & {
  kind: "property_observation";
  payload: {
    observation: PropertyObservationWrite;
  };
};

export type SyncOp = KnockEventOp | PropertyObservationOp;
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
    const { knock, lead } = op.payload;
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
    }
    return null;
  }

  const { observation } = op.payload;
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
