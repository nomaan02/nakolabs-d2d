/**
 * Ephemeral door signals on the assignment Realtime channel.
 * Nothing here is written to Postgres. The durable copy is always
 * `knock_events`; this is only the live sharing layer on top of it.
 *
 * Amended 2026-09-28 (owner, UI item 1). Claims, Take and reserve are
 * removed (reversing the 2026-09-26 deviation). There is no "next door"
 * concept here any more, and no door is ever blocked for anyone: a signal
 * only records that a door WAS knocked or was undone. `lib/field/cursor.ts`
 * decides where to go next, forward from wherever the canvasser is.
 */

export const DOOR_EVENT = "door";

/** 15 s between heartbeats; stale after 45 s of silence (agent proposal, owner ACCEPTED). */
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_STALE_MS = 45_000;

export function assignmentTopic(assignmentId: string): string {
  return `assignment:${assignmentId.toLowerCase()}`;
}

export type KnockSignalType = "knocked" | "unknocked";

export type DoorSignal =
  | {
      type: KnockSignalType;
      canvasser_id: string;
      uprn: number;
      sequence_position: number;
      at: string;
    }
  | {
      /** A heartbeat. No door, no coordinates — just "I am still here". */
      type: "here";
      canvasser_id: string;
      at: string;
    };

export type KnockMark = {
  at: string;
  sequence_position: number;
};

/** `knocks` this person has not withdrawn; `lastHeardAt` from ANY signal, including a heartbeat. */
export type PersonState = {
  knocks: Map<number, KnockMark>;
  lastHeardAt: string;
};

export function emptyPeople(): Map<string, PersonState> {
  return new Map();
}

export function doorSignal(
  type: KnockSignalType,
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

export function hereSignal(canvasserId: string, at: string = new Date().toISOString()): DoorSignal {
  return { type: "here", canvasser_id: canvasserId, at };
}

export function parseDoorSignal(value: unknown): DoorSignal | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.canvasser_id !== "string" || row.canvasser_id.length === 0) return null;
  if (typeof row.at !== "string" || Number.isNaN(Date.parse(row.at))) return null;

  if (row.type === "here") {
    return { type: "here", canvasser_id: row.canvasser_id, at: row.at };
  }

  // Rejects the old claim and release signal types, along with anything else
  // unrecognised — there is no code path left that sends either.
  if (row.type !== "knocked" && row.type !== "unknocked") return null;
  if (typeof row.uprn !== "number" || !Number.isInteger(row.uprn) || row.uprn <= 0) return null;
  if (
    typeof row.sequence_position !== "number" ||
    !Number.isInteger(row.sequence_position) ||
    row.sequence_position < 0
  ) {
    return null;
  }
  return {
    type: row.type,
    canvasser_id: row.canvasser_id,
    uprn: row.uprn,
    sequence_position: row.sequence_position,
    at: row.at,
  };
}

/**
 * `knocked` adds, `unknocked` deletes, and every signal — including a bare
 * heartbeat — bumps `lastHeardAt`, taking the newer of the two timestamps so
 * an out-of-order delivery cannot roll it backwards.
 */
export function applyPerson(
  people: Map<string, PersonState>,
  signal: DoorSignal,
): Map<string, PersonState> {
  const next = new Map(people);
  const prev = next.get(signal.canvasser_id) ?? { knocks: new Map<number, KnockMark>(), lastHeardAt: signal.at };
  const knocks = new Map(prev.knocks);
  if (signal.type === "knocked") {
    knocks.set(signal.uprn, { at: signal.at, sequence_position: signal.sequence_position });
  } else if (signal.type === "unknocked") {
    knocks.delete(signal.uprn);
  }
  const lastHeardAt = signal.at > prev.lastHeardAt ? signal.at : prev.lastHeardAt;
  next.set(signal.canvasser_id, { knocks, lastHeardAt });
  return next;
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

export type TeamKnock = {
  canvasserId: string;
  firstName: string;
  at: string;
};

export type TeammateRow = {
  canvasserId: string;
  /** First name only (P7) — "Tom", never "Tom Holt". */
  name: string;
  uprn: number | null;
  sequencePosition: number | null;
  /** When this canvasser was last heard from at all (knock or heartbeat) — not the door's own timestamp. */
  at: string | null;
  stale: boolean;
  empty: boolean;
};

/** First name only (P7). "A canvasser" when the profile has no name at all. */
function firstName(name: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return "A canvasser";
  return trimmed.split(/\s+/)[0] ?? "A canvasser";
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
 * Latest-wins per door across every teammate's broadcast knocks and server
 * knocks, EXCLUDING `selfId`. This is B1: which door to grey on the map and
 * whose name tags it. Never this canvasser's own door.
 */
export function teammateKnocks(
  people: Map<string, PersonState>,
  serverKnocks: ServerKnock[],
  selfId: string,
  members: TeamMember[],
): Map<number, TeamKnock> {
  const names = new Map(members.map((member) => [member.canvasser_id, firstName(member.full_name)]));
  const result = new Map<number, TeamKnock>();

  const consider = (canvasserId: string, uprn: number, at: string) => {
    if (canvasserId === selfId) return;
    const name = names.get(canvasserId);
    if (!name) return;
    const current = result.get(uprn);
    if (!current || at > current.at) {
      result.set(uprn, { canvasserId, firstName: name, at });
    }
  };

  for (const knock of serverKnocks) consider(knock.canvasser_id, knock.uprn, knock.occurred_at);
  for (const [canvasserId, person] of people) {
    for (const [uprn, mark] of person.knocks) consider(canvasserId, uprn, mark.at);
  }
  return result;
}

/**
 * One row per other active member. Never sliced: a trio is two rows.
 * The place is the newer of the broadcast knock and the server knock.
 * `stale` is a heartbeat fact, independent of whether a door is known:
 * `!connectionLive || now - lastHeardAt > 45 s`.
 */
export function teammateRows(input: {
  selfId: string;
  members: TeamMember[];
  people: Map<string, PersonState>;
  serverKnocks: ServerKnock[];
  now: number;
  connectionLive: boolean;
}): TeammateRow[] {
  const others = input.members
    .filter((member) => member.canvasser_id !== input.selfId)
    .sort((a, b) => {
      const byName = firstName(a.full_name).localeCompare(firstName(b.full_name), "en-GB");
      if (byName !== 0) return byName;
      return a.canvasser_id.localeCompare(b.canvasser_id);
    });

  return others.map((member) => {
    const person = input.people.get(member.canvasser_id);
    const lastHeardAt = person?.lastHeardAt ?? null;
    const silentFor = lastHeardAt ? input.now - Date.parse(lastHeardAt) : NaN;
    const stale = !input.connectionLive || silentFor > HEARTBEAT_STALE_MS;

    const fromServer = latestServerKnock(input.serverKnocks, member.canvasser_id);
    const fromBroadcast = latestBroadcastKnock(person);
    const place =
      fromServer && fromBroadcast
        ? (fromBroadcast.at >= fromServer.at ? fromBroadcast : fromServer)
        : (fromBroadcast ?? fromServer);

    if (!place) {
      return {
        canvasserId: member.canvasser_id,
        name: firstName(member.full_name),
        uprn: null,
        sequencePosition: null,
        at: lastHeardAt,
        stale,
        empty: true,
      };
    }

    return {
      canvasserId: member.canvasser_id,
      name: firstName(member.full_name),
      uprn: place.uprn,
      sequencePosition: place.sequencePosition,
      at: lastHeardAt,
      stale,
      empty: false,
    };
  });
}

/** Figma wording: "2 min", never "2 min ago". */
export function heardLabel(at: string, now: number): string {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins === 1) return "1 min";
  return `${mins} min`;
}

type LineLabel = {
  house_number: string | null;
  building_name: string | null;
  street_name: string | null;
};

/** The plate ladder only: house number, then building name, then null. Mirrors `doorPlate`. */
function plateFor(label: LineLabel | undefined): string | null {
  const number = label?.house_number?.trim();
  if (number) return number;
  const building = label?.building_name?.trim();
  if (building) return building;
  return null;
}

/**
 * C1. Stale beats everything else: if the heartbeat has lapsed, the most
 * useful fact is when this canvasser was last heard from, not a door we can
 * no longer vouch for.
 *
 *   "Tom · last knocked #80"   — plate known (P1's N = plate)
 *   "Tom · last knocked #12"   — no plate, falls back to the door's number
 *   "Tom · last heard 2 min"   — stale
 *   "Tom · no door yet"        — nothing knocked, not stale
 */
export function formatTeammateLine(
  row: TeammateRow,
  label: LineLabel | undefined,
  now: number,
): string {
  if (row.stale) {
    return row.at ? `${row.name} · last heard ${heardLabel(row.at, now)}` : `${row.name} · no door yet`;
  }
  if (row.empty || row.uprn === null) return `${row.name} · no door yet`;
  const plate = plateFor(label);
  const doorNumber = plate ?? (row.sequencePosition !== null ? String(row.sequencePosition + 1) : null);
  if (doorNumber === null) return `${row.name} · no door yet`;
  return `${row.name} · last knocked #${doorNumber}`;
}
