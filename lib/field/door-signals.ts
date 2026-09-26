import { mapLabel } from "@/lib/field/labels";
import type { SequenceDoor } from "@/lib/field/sequence";

/**
 * Ephemeral door signals on the assignment Realtime channel.
 * Nothing here is written to Postgres. A claim older than three minutes is
 * gone: the door is back in the pool. A knock broadcast is not a claim and
 * does not expire; the durable copy is still `knock_events`.
 */

export const CLAIM_TTL_MS = 3 * 60 * 1000;

export const DOOR_EVENT = "door";

export function assignmentTopic(assignmentId: string): string {
  return `assignment:${assignmentId.toLowerCase()}`;
}

export type DoorSignalType = "claim" | "release" | "knocked";

export type DoorSignal = {
  type: DoorSignalType;
  canvasser_id: string;
  uprn: number;
  sequence_position: number;
  at: string;
};

export type KnockMark = {
  at: string;
  sequence_position: number;
};

/** Latest position signal plus knocks this person has not withdrawn. */
export type PersonState = {
  latest: DoorSignal | null;
  knocks: Map<number, KnockMark>;
};

export function emptyPeople(): Map<string, PersonState> {
  return new Map();
}

export function doorSignal(
  type: DoorSignalType,
  canvasserId: string,
  uprn: number,
  sequencePosition: number,
  at: string = new Date().toISOString(),
): DoorSignal {
  return {
    type,
    canvasser_id: canvasserId,
    uprn,
    sequence_position: sequencePosition,
    at,
  };
}

export function parseDoorSignal(value: unknown): DoorSignal | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.type !== "claim" && row.type !== "release" && row.type !== "knocked") return null;
  if (typeof row.canvasser_id !== "string" || row.canvasser_id.length === 0) return null;
  if (typeof row.uprn !== "number" || !Number.isInteger(row.uprn) || row.uprn <= 0) return null;
  if (
    typeof row.sequence_position !== "number" ||
    !Number.isInteger(row.sequence_position) ||
    row.sequence_position < 0
  ) {
    return null;
  }
  if (typeof row.at !== "string" || Number.isNaN(Date.parse(row.at))) return null;
  return {
    type: row.type,
    canvasser_id: row.canvasser_id,
    uprn: row.uprn,
    sequence_position: row.sequence_position,
    at: row.at,
  };
}

/** A claim is live until it has been open for three minutes. At that instant it is over. */
export function claimIsLive(signal: DoorSignal, now: number): boolean {
  if (signal.type !== "claim") return false;
  const at = Date.parse(signal.at);
  if (Number.isNaN(at)) return false;
  return now - at < CLAIM_TTL_MS;
}

export function applyPerson(
  people: Map<string, PersonState>,
  signal: DoorSignal,
): Map<string, PersonState> {
  const next = new Map(people);
  const prev = next.get(signal.canvasser_id) ?? { latest: null, knocks: new Map() };
  const knocks = new Map(prev.knocks);
  if (signal.type === "knocked") {
    knocks.set(signal.uprn, { at: signal.at, sequence_position: signal.sequence_position });
  } else if (signal.type === "release") {
    knocks.delete(signal.uprn);
  }

  let latest = prev.latest;
  if (signal.type === "release") {
    // Withdrawing one door must not drop a newer claim on a different door.
    if (latest && latest.uprn === signal.uprn) latest = signal;
  } else if (!latest || signal.at >= latest.at) {
    latest = signal;
  }

  next.set(signal.canvasser_id, { latest, knocks });
  return next;
}

function beats(candidate: DoorSignal, current: DoorSignal): boolean {
  if (candidate.at !== current.at) return candidate.at < current.at;
  return candidate.canvasser_id < current.canvasser_id;
}

/** One holder per door. Earlier `at` wins; a tie goes to the lower canvasser id. */
export function winningHolds(people: Map<string, PersonState>, now: number): DoorSignal[] {
  const best = new Map<number, DoorSignal>();
  for (const person of people.values()) {
    const latest = person.latest;
    if (!latest || !claimIsLive(latest, now)) continue;
    const current = best.get(latest.uprn);
    if (!current || beats(latest, current)) best.set(latest.uprn, latest);
  }
  return [...best.values()];
}

export function knockedUprns(
  people: Map<string, PersonState>,
  serverUprns: Iterable<number>,
  localUprns: Iterable<number>,
): Set<number> {
  const set = new Set<number>(serverUprns);
  for (const uprn of localUprns) set.add(uprn);
  for (const person of people.values()) {
    for (const uprn of person.knocks.keys()) set.add(uprn);
  }
  return set;
}

export type ReserveDecision =
  | { action: "none" }
  | { action: "hold" }
  | { action: "wait" }
  | { action: "claim"; uprn: number; sequence_position: number };

/**
 * Whether this canvasser should broadcast a claim.
 * `wantReserve` is false after they back out, and after a claim they won
 * until they knock the next door. An expired claim does not set it again:
 * the door has to be able to return to the pool.
 */
export function reserveDecision(input: {
  wantReserve: boolean;
  connectionLive: boolean;
  sequence: SequenceDoor[];
  knocked: Set<number>;
  people: Map<string, PersonState>;
  selfId: string;
  now: number;
}): ReserveDecision {
  if (!input.wantReserve || !input.connectionLive) return { action: "none" };
  const holds = winningHolds(input.people, input.now).filter(
    (hold) => !input.knocked.has(hold.uprn),
  );
  if (holds.some((hold) => hold.canvasser_id === input.selfId)) return { action: "hold" };

  const others = new Set(
    holds.filter((hold) => hold.canvasser_id !== input.selfId).map((hold) => hold.uprn),
  );
  const door = input.sequence.find((item) => !input.knocked.has(item.uprn) && !others.has(item.uprn));
  if (!door) return { action: "none" };

  const latest = input.people.get(input.selfId)?.latest ?? null;
  if (
    latest &&
    latest.type === "claim" &&
    claimIsLive(latest, input.now) &&
    latest.uprn === door.uprn
  ) {
    return { action: "wait" };
  }
  return { action: "claim", uprn: door.uprn, sequence_position: door.position };
}

/**
 * The door the card shows. While the channel is live and this canvasser holds
 * a door, that door is the card — a lower door freeing up does not pull them
 * off it. Offline, claims are ignored and the card is the Dexie knock set.
 */
export function shownDoor(
  sequence: SequenceDoor[],
  knocked: Set<number>,
  people: Map<string, PersonState>,
  selfId: string,
  now: number,
  connectionLive: boolean,
): SequenceDoor | null {
  if (!connectionLive) {
    return sequence.find((door) => !knocked.has(door.uprn)) ?? null;
  }
  const holds = winningHolds(people, now);
  const mine = holds.find((hold) => hold.canvasser_id === selfId);
  if (mine) {
    const door = sequence.find((item) => item.uprn === mine.uprn);
    if (door && !knocked.has(door.uprn)) return door;
  }
  const others = new Set(
    holds.filter((hold) => hold.canvasser_id !== selfId).map((hold) => hold.uprn),
  );
  return sequence.find((door) => !knocked.has(door.uprn) && !others.has(door.uprn)) ?? null;
}

export type ServerKnock = {
  canvasser_id: string;
  uprn: number;
  sequence_position: number | null;
  occurred_at: string;
};

export type TeamMember = {
  canvasser_id: string;
  full_name: string | null;
  /** Read so a null stays an empty line. Stage 16 is off; the value is not a door. */
  route_position_m: number | null;
  route_position_at: string | null;
};

export type TeammateRow = {
  canvasserId: string;
  name: string;
  uprn: number | null;
  sequencePosition: number | null;
  at: string | null;
  stale: boolean;
  empty: boolean;
};

function displayName(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : "A canvasser";
}

type Place = { uprn: number; sequencePosition: number | null; at: string };

function latestServerKnock(knocks: ServerKnock[], canvasserId: string): Place | null {
  let best: ServerKnock | null = null;
  for (const knock of knocks) {
    if (knock.canvasser_id !== canvasserId) continue;
    if (!best || knock.occurred_at > best.occurred_at) best = knock;
  }
  if (!best) return null;
  return { uprn: best.uprn, sequencePosition: best.sequence_position, at: best.occurred_at };
}

function latestBroadcastKnock(person: PersonState | undefined): Place | null {
  if (!person || person.knocks.size === 0) return null;
  let best: Place | null = null;
  for (const [uprn, mark] of person.knocks) {
    if (!best || mark.at > best.at) {
      best = { uprn, sequencePosition: mark.sequence_position, at: mark.at };
    }
  }
  return best;
}

/**
 * One row per other active member. Never sliced: a trio is two rows.
 * No claim and no knock is an empty line. `route_position_m` is not turned
 * into a door while Stage 16 is off, including when the column is non-null.
 */
export function teammateRows(input: {
  selfId: string;
  members: TeamMember[];
  people: Map<string, PersonState>;
  serverKnocks: ServerKnock[];
  now: number;
  connectionLive: boolean;
}): TeammateRow[] {
  const holds = winningHolds(input.people, input.now);
  const others = input.members
    .filter((member) => member.canvasser_id !== input.selfId)
    .sort((a, b) => {
      const byName = displayName(a.full_name).localeCompare(displayName(b.full_name), "en-GB");
      if (byName !== 0) return byName;
      return a.canvasser_id.localeCompare(b.canvasser_id);
    });

  return others.map((member) => {
    const person = input.people.get(member.canvasser_id);
    const latest = person?.latest ?? null;
    const winning =
      latest?.type === "claim" &&
      claimIsLive(latest, input.now) &&
      holds.some((hold) => hold.canvasser_id === member.canvasser_id && hold.uprn === latest.uprn);

    let place: Place | null = null;
    if (winning && latest) {
      place = { uprn: latest.uprn, sequencePosition: latest.sequence_position, at: latest.at };
    } else if (latest?.type === "claim" && claimIsLive(latest, input.now) && !input.connectionLive) {
      // A claim we cannot confirm is shown as last-heard, not as a live hold.
      place = { uprn: latest.uprn, sequencePosition: latest.sequence_position, at: latest.at };
    } else {
      const fromServer = latestServerKnock(input.serverKnocks, member.canvasser_id);
      const fromBroadcast = latestBroadcastKnock(person);
      if (fromServer && fromBroadcast) {
        place = fromBroadcast.at >= fromServer.at ? fromBroadcast : fromServer;
      } else {
        place = fromBroadcast ?? fromServer;
      }
    }

    if (!place) {
      return {
        canvasserId: member.canvasser_id,
        name: displayName(member.full_name),
        uprn: null,
        sequencePosition: null,
        at: null,
        stale: false,
        empty: true,
      };
    }

    return {
      canvasserId: member.canvasser_id,
      name: displayName(member.full_name),
      uprn: place.uprn,
      sequencePosition: place.sequencePosition,
      at: place.at,
      stale: !input.connectionLive,
      empty: false,
    };
  });
}

export function heardLabel(at: string, now: number): string {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

type LineLabel = {
  house_number: string | null;
  building_name: string | null;
  street_name: string | null;
};

/** Address ladder first (`9 Small Street`), then `on #16` when the door has no label. */
export function formatTeammateLine(
  row: TeammateRow,
  label: LineLabel | undefined,
  now: number,
): string {
  if (row.empty || row.uprn === null) return `${row.name} · no door yet`;
  const pretty = mapLabel(
    label && row.uprn !== null
      ? {
          uprn: row.uprn,
          house_number: label.house_number,
          building_name: label.building_name,
          street_name: label.street_name,
        }
      : undefined,
  );
  const place =
    pretty ??
    (row.sequencePosition !== null ? `on #${row.sequencePosition + 1}` : "no door yet");
  const base = `${row.name} · ${place}`;
  if (!row.stale || !row.at) return base;
  return `${base} · last heard ${heardLabel(row.at, now)}`;
}
