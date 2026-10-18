/**
 * GPS-LOCK GL-1 (owner G2, G5, G6, G7, 2026-10-18). Jump on reopen: when the
 * canvasser comes back to the app, the Logger may move ONCE to the door
 * nearest them on the route. The near-you chip covers the rest of the time.
 *
 * Pure: no React, no browser APIs, no network, no storage, so it runs under
 * tsx and is checked by `npm run verify:gl`. Nothing here stores or sends a
 * coordinate; it only sees distances along the route (server metres).
 *
 * Rules (all must hold, or the chip is left to suggest instead):
 * - The app was hidden for REOPEN_HIDDEN_MS or more, or the page has just
 *   loaded (a cold start: the phone may have dropped the page while hidden).
 * - JUMP_AGREE fixes of JUMP_ACCURACY_M or better, after the reopen, whose
 *   places along the route agree within AGREE_SPREAD_M. Their median is used.
 * - Forward only: never at or behind the furthest door this canvasser has
 *   really logged (filled Not In rows do not count).
 * - Within walking reach of where they were when the app was hidden
 *   (WALK_SPEED_MPS × time hidden + accuracy). Skipped on a cold start.
 * - At most MAX_JUMP_DOORS from max(cursor, furthest log), or
 *   MAX_COLD_JUMP_DOORS on a cold start.
 * - A door already knocked (by anyone) is skipped for the nearest open one
 *   (owner G5).
 * The side of the road is never taken from the raw fix: the snap onto the
 * route (lib/field/geo.ts, continuity) has already chosen the pass (G1).
 */

import { nearestDoorIndex } from "./geo";

/** Hidden at least this long before a reopen may jump. */
export const REOPEN_HIDDEN_MS = 20_000;
/** After a reopen, wait this long at most for good fixes ("Finding you…"). */
export const FIND_WINDOW_MS = 8_000;
/** A fix used for a jump is this good or better (the chip accepts 30 m). */
export const JUMP_ACCURACY_M = 20;
/** This many good fixes must agree before a jump. */
export const JUMP_AGREE = 2;
/** At most this many of the latest good fixes are used for the median. */
export const JUMP_SAMPLES = 3;
/** The agreeing fixes lie within this many metres of each other along the route. */
export const AGREE_SPREAD_M = 12;
/** Brisk walking pace for the reach check. */
export const WALK_SPEED_MPS = 1.5;
/** Never jump further than this many doors. Under the 25-door ask in Exceptions only. */
export const MAX_JUMP_DOORS = 24;
/** On a cold start there is no walking-reach check, so the jump is shorter. */
export const MAX_COLD_JUMP_DOORS = 12;
/** "Moved to … · Undo" shows this long. */
export const MOVED_SHOW_MS = 5_000;
/** A fix this much older than the reopen is from before it and is ignored. */
export const FRESH_FIX_SLACK_MS = 2_000;

/** A snapped fix: its place along the route (null = more than 100 m off it). */
export type PlaceSample = { alongM: number | null; accuracyM: number; at: number };

/**
 * One return to the app. `hiddenMs` is null on a cold start (the page has
 * just loaded). `placeBeforeM` is the last place along the route before it
 * was hidden, when known.
 */
export type Reopen = { id: number; at: number; hiddenMs: number | null; placeBeforeM: number | null };

export type ChipReason = "off_route" | "no_doors" | "behind" | "too_far" | "too_fast" | "no_open_door";

export type JumpPlan =
  | { kind: "wait" }
  | { kind: "stay" }
  | { kind: "jump"; index: number }
  | { kind: "chip"; reason: ChipReason };

/** True when this reopen may try a jump at all. */
export function isJumpReopen(reopen: Pick<Reopen, "hiddenMs">): boolean {
  return reopen.hiddenMs === null || reopen.hiddenMs >= REOPEN_HIDDEN_MS;
}

/** True for a sample taken after the reopen (cached fixes from before it are dropped). */
export function isFreshSample(sample: Pick<PlaceSample, "at">, reopenAt: number): boolean {
  return sample.at >= reopenAt - FRESH_FIX_SLACK_MS;
}

/** What a door's latest known outcome needs for `furthestOwnLogIndex`. `LocalOutcome` fits. */
export type OwnLog = { canvasserId: string; inferred?: boolean };

/**
 * The furthest door in walk order that this canvasser really logged
 * (a tapped outcome, not a filled Not In). -1 when there is none.
 */
export function furthestOwnLogIndex(
  sequence: ReadonlyArray<{ uprn: number }>,
  outcomes: ReadonlyMap<number, OwnLog>,
  canvasserId: string | null,
): number {
  if (!canvasserId) return -1;
  for (let index = sequence.length - 1; index >= 0; index--) {
    const known = outcomes.get(sequence[index]!.uprn);
    if (known && !known.inferred && known.canvasserId === canvasserId) return index;
  }
  return -1;
}

function spread(samples: ReadonlyArray<{ alongM: number }>): number {
  const alongs = samples.map((sample) => sample.alongM);
  return Math.max(...alongs) - Math.min(...alongs);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The open door nearest `target`, forward first on a tie, never at or behind `anchorIndex`. -1 if none. */
export function nearestOpenIndex(
  target: number,
  total: number,
  anchorIndex: number,
  isOpen: (index: number) => boolean,
): number {
  for (let step = 0; step <= MAX_JUMP_DOORS; step++) {
    const ahead = target + step;
    if (ahead < total && ahead > anchorIndex && isOpen(ahead)) return ahead;
    const back = target - step;
    if (step > 0 && back >= 0 && back > anchorIndex && isOpen(back)) return back;
  }
  return -1;
}

export function planJump(input: {
  /** Snapped fixes since the reopen, oldest first. */
  samples: ReadonlyArray<PlaceSample>;
  /** Each sequence door's distance along the route, index-aligned with the sequence. */
  doorAlongsM: ReadonlyArray<number>;
  cursorIndex: number;
  /** `furthestOwnLogIndex`. -1 when nothing is logged yet. */
  anchorIndex: number;
  /** Null on a cold start: the reach check is skipped. */
  hiddenMs: number | null;
  /** Place along the route when the app was hidden; else the cursor door's is used. */
  placeBeforeM: number | null;
  /** False for a door already knocked (by anyone). */
  isOpen: (index: number) => boolean;
}): JumpPlan {
  const { samples, doorAlongsM, cursorIndex, anchorIndex, hiddenMs, placeBeforeM, isOpen } = input;
  if (doorAlongsM.length === 0) return { kind: "chip", reason: "no_doors" };

  // One sample per fix, even if a caller passes the same fix twice.
  const good = samples
    .filter((sample, i) => sample.accuracyM <= JUMP_ACCURACY_M && samples.findIndex((s) => s.at === sample.at) === i);
  // Off route only when the latest JUMP_AGREE good fixes all are: one stray fix just waits.
  const tail = good.slice(-JUMP_AGREE);
  if (tail.length === JUMP_AGREE && tail.every((sample) => sample.alongM === null)) {
    return { kind: "chip", reason: "off_route" };
  }

  const onRoute = good.filter((sample): sample is PlaceSample & { alongM: number } => sample.alongM !== null);
  let recent = onRoute.slice(-JUMP_SAMPLES);
  if (recent.length < JUMP_AGREE) return { kind: "wait" };
  if (spread(recent) > AGREE_SPREAD_M) recent = onRoute.slice(-JUMP_AGREE);
  if (spread(recent) > AGREE_SPREAD_M) return { kind: "wait" };
  const alongM = median(recent.map((sample) => sample.alongM));

  const nearest = nearestDoorIndex(doorAlongsM, alongM);
  if (nearest <= anchorIndex) return { kind: "chip", reason: "behind" };
  const target = nearestOpenIndex(nearest, doorAlongsM.length, anchorIndex, isOpen);
  if (target < 0) return { kind: "chip", reason: "no_open_door" };

  // From the cursor, or from the furthest log when the cursor is behind it
  // (a cold start puts the cursor back on door 1).
  const cap = hiddenMs === null ? MAX_COLD_JUMP_DOORS : MAX_JUMP_DOORS;
  if (Math.abs(target - Math.max(cursorIndex, anchorIndex)) > cap) {
    return { kind: "chip", reason: "too_far" };
  }

  if (hiddenMs !== null) {
    const from = placeBeforeM ?? doorAlongsM[cursorIndex];
    const accuracy = Math.max(...recent.map((sample) => sample.accuracyM));
    const reach = (WALK_SPEED_MPS * hiddenMs) / 1000 + accuracy;
    if (from !== undefined && Math.abs(doorAlongsM[target]! - from) > reach) {
      return { kind: "chip", reason: "too_fast" };
    }
  }

  return target === cursorIndex ? { kind: "stay" } : { kind: "jump", index: target };
}
