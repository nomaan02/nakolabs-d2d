/**
 * UI-8 D1b (owner H4 as amended by U8-1..U8-3, H7; 2026-10-06). Exceptions-only
 * logging: which doors to mark Not In when the canvasser logs a door.
 *
 * Pure: no React, no Dexie, no network. Checked by `npm run verify:ui8`.
 *
 * Rules:
 * - Only doors BETWEEN two real logs are filled (U8-3). A real log is any
 *   tapped outcome by this canvasser on this prop (Lead, Contact,
 *   Rented/Council, Not In, any Other). Filled ("inferred") rows never count
 *   as a real log.
 * - Logging at or before your most recent real log (by time) in route order
 *   is walking backwards or correcting a door: nothing is filled.
 * - Otherwise the anchor is your furthest real log, in route order, from that
 *   most recent log up to the door being logged. So after going back to fix
 *   an earlier door, the next forward log fills only from where you had got
 *   to, never the stretch you had already passed.
 * - A door that already has an outcome (anyone's, on this phone) or a
 *   teammate's knock is never filled.
 * - Under 25 doors on one street: fill silently (U8-1). 25 or more, or any
 *   change of street between the two logs: ask with the sheet (U8-2, H7).
 * - Each filled door gets a time spread evenly between your most recent real
 *   log and the new one, so the slot figures stay realistic.
 * - GL-C (owner C1, C6; 2026-10-18). After a manual correction to the other
 *   side of the road, or backwards, the caller passes `floorIndex` (the door
 *   moved to): nothing before it is filled, so the stretch the canvasser cut
 *   across is left open. A same-side forward correction passes no floor and
 *   fills as usual. The caller clears the floor after the next log.
 */

/** H7: this many doors or more always asks. */
export const ASK_AT_DOORS = 25;

export type InferenceDoor = {
  uprn: number;
  /** Snapshot position: `sequence_position` on the knock. */
  position: number;
};

/** What this phone knows about a door's latest outcome. `LocalOutcome` fits this. */
export type KnownOutcome = {
  occurredAt: string;
  canvasserId: string;
  /** True for a row this feature filled. Absent means a tapped row. */
  inferred?: boolean;
};

export type InferredDoor = {
  /** Index into the Logger's sequence. */
  index: number;
  uprn: number;
  position: number;
  occurredAt: string;
};

export type InferencePlan =
  | { kind: "none" }
  | { kind: "fill"; doors: InferredDoor[]; anchorIndex: number }
  | {
      kind: "ask";
      doors: InferredDoor[];
      anchorIndex: number;
      reason: "big_gap" | "street_change";
    };

const NONE: InferencePlan = { kind: "none" };

export function planInference(input: {
  /** The Logger's sequence (knockable doors, route order). */
  sequence: ReadonlyArray<InferenceDoor>;
  /** Latest outcome per UPRN on this phone, BEFORE the new log is written. */
  outcomes: ReadonlyMap<number, KnownOutcome>;
  /** Doors a teammate has knocked (a Set or the team's `knockedBy` map). */
  knockedByTeam?: { has(uprn: number): boolean };
  /** Street per sequence index (route street, else address street). Null = unknown. */
  streets: ReadonlyArray<string | null>;
  canvasserId: string;
  /** Index of the door being logged now. */
  triggerIndex: number;
  /** ISO time of the new log. */
  triggerAt: string;
  /**
   * GL-C (owner C1): fill nothing before this index when logging at or past
   * it. Null or absent = no floor. A floor past the trigger is ignored.
   */
  floorIndex?: number | null;
}): InferencePlan {
  const { sequence, outcomes, streets, canvasserId, triggerIndex } = input;
  const trigger = sequence[triggerIndex];
  if (!trigger) return NONE;

  // This canvasser's real logs, in route order, excluding the door being logged.
  const real: { index: number; time: number }[] = [];
  sequence.forEach((door, index) => {
    if (door.uprn === trigger.uprn) return;
    const known = outcomes.get(door.uprn);
    if (!known || known.inferred || known.canvasserId !== canvasserId) return;
    const time = Date.parse(known.occurredAt);
    if (Number.isFinite(time)) real.push({ index, time });
  });
  if (real.length === 0) return NONE;

  const latest = real.reduce((a, b) => (b.time > a.time ? b : a));
  if (triggerIndex <= latest.index) return NONE;
  let anchorIndex = latest.index;
  for (const log of real) {
    if (log.index > anchorIndex && log.index < triggerIndex) anchorIndex = log.index;
  }
  const floor = input.floorIndex;
  // A floor ahead of this log (the canvasser went back behind it) is ignored.
  if (typeof floor === "number" && Number.isInteger(floor) && floor <= triggerIndex) {
    anchorIndex = Math.max(anchorIndex, floor - 1);
  }

  const startTime = latest.time;
  const triggerTime = Date.parse(input.triggerAt);
  const end = Number.isFinite(triggerTime) && triggerTime > startTime ? triggerTime : startTime;

  const candidates: { index: number; door: InferenceDoor }[] = [];
  for (let index = anchorIndex + 1; index < triggerIndex; index++) {
    const door = sequence[index];
    if (!door) continue;
    if (outcomes.has(door.uprn)) continue;
    if (input.knockedByTeam?.has(door.uprn)) continue;
    candidates.push({ index, door });
  }
  if (candidates.length === 0) return NONE;

  const doors: InferredDoor[] = candidates.map(({ index, door }, k) => ({
    index,
    uprn: door.uprn,
    position: door.position,
    occurredAt: new Date(startTime + ((end - startTime) * (k + 1)) / (candidates.length + 1)).toISOString(),
  }));

  if (crossesStreet(streets, anchorIndex, triggerIndex)) {
    return { kind: "ask", doors, anchorIndex, reason: "street_change" };
  }
  if (doors.length >= ASK_AT_DOORS) {
    return { kind: "ask", doors, anchorIndex, reason: "big_gap" };
  }
  return { kind: "fill", doors, anchorIndex };
}

/** True when the known streets from `from` to `to` (inclusive) are not all the same. */
export function crossesStreet(
  streets: ReadonlyArray<string | null>,
  from: number,
  to: number,
): boolean {
  let first: string | null = null;
  for (let index = from; index <= to; index++) {
    const street = streets[index]?.trim().toLowerCase() || null;
    if (street === null) continue;
    if (first === null) first = street;
    else if (street !== first) return true;
  }
  return false;
}
