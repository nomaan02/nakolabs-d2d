import type { SequenceDoor } from "@/lib/field/sequence";

/**
 * How the field app turns a generated route into the thing on the doorstep.
 *
 * Which step a door is on is not stored. The choice, applied the same way
 * every time:
 *
 * - Transfers (`segment_id` null) have no doors. A door is placed on a
 *   working step only.
 * - Doors are walked in snapshot order, which Stage 5b-a already made the
 *   route order. The cursor never moves backwards.
 * - Each door snaps to the working step at or after that cursor whose
 *   geometry is nearest. Two passes of one segment are the same line, so
 *   they tie: the earlier pass keeps the door.
 * - A U-turn is the tie breaking the other way. When the door's position
 *   along the current pass drops by more than 8% of that pass, and the next
 *   working step is just as close, the door belongs to the return pass.
 * - The last `strandedCount` doors are not given a step. They are the tail
 *   Stage 5b-a appended.
 *
 * A transfer is shown on the first door of the working step that follows it.
 * Consecutive spur steps are one card, not one card per step.
 */

export type FieldRouteStep = {
  step_index: number;
  segment_id: number | null;
  street_name: string | null;
  instruction: string;
  is_spur: boolean;
  cumulative_m: number;
  coordinates: [number, number][];
};

export type FieldRoute = {
  hasRoute: boolean;
  strandedCount: number;
  line: GeoJSON.LineString | null;
  steps: FieldRouteStep[];
};

export type InstructionCard = {
  kind: "transfer" | "spur" | "step" | "stranded";
  text: string;
};

export type DoorRouteView = {
  stranded: boolean;
  stepIndex: number | null;
  /** Named street on the step. Null when the road has no name. */
  routeStreet: string | null;
  cards: InstructionCard[];
};

export type RouteDescription = {
  /** False while the Dexie read has not finished. The banner stays hidden. */
  ready: boolean;
  hasRoute: boolean;
  doors: DoorRouteView[];
};

const TIE_M = 1.5;
const FRACTION_DROP = 0.08;
const NOT_A_STREET = new Set(["service road", "unnamed road"]);

const EMPTY_DOOR: DoorRouteView = {
  stranded: false,
  stepIndex: null,
  routeStreet: null,
  cards: [],
};

type Proj = { x: number; y: number };

type Working = {
  listIndex: number;
  step: FieldRouteStep;
  startM: number;
  endM: number;
};

function project(lon: number, lat: number, lat0: number): Proj {
  const rad = Math.PI / 180;
  const cos = Math.cos(lat0 * rad);
  return { x: lon * rad * cos * 6371000, y: lat * rad * 6371000 };
}

function snapToStep(
  point: Proj,
  step: FieldRouteStep,
  lat0: number,
): { dist: number; fraction: number } {
  const coords = step.coordinates;
  if (coords.length < 2) return { dist: Number.POSITIVE_INFINITY, fraction: 0 };

  let best = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let walked = 0;
  let total = 0;
  const lengths: number[] = [];
  const projected = coords.map(([lon, lat]) => project(lon, lat, lat0));
  for (let i = 1; i < projected.length; i += 1) {
    const a = projected[i - 1]!;
    const b = projected[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(len);
    total += len;
  }

  for (let i = 1; i < projected.length; i += 1) {
    const a = projected[i - 1]!;
    const b = projected[i]!;
    const len = lengths[i - 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let u = 0;
    if (len > 0) {
      u = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (len * len);
      if (u < 0) u = 0;
      else if (u > 1) u = 1;
    }
    const qx = a.x + u * dx;
    const qy = a.y + u * dy;
    const dist = Math.hypot(point.x - qx, point.y - qy);
    const along = walked + u * len;
    if (dist < best) {
      best = dist;
      bestAlong = along;
    }
    walked += len;
  }

  return { dist: best, fraction: total > 0 ? bestAlong / total : 0 };
}

function workingSteps(steps: FieldRouteStep[]): Working[] {
  const out: Working[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    if (step.segment_id === null) continue;
    const startM = i === 0 ? 0 : steps[i - 1]!.cumulative_m;
    out.push({ listIndex: out.length, step, startM, endM: step.cumulative_m });
  }
  return out;
}

export function plateStreet(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (NOT_A_STREET.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function spurCardText(run: FieldRouteStep[]): string {
  const names: string[] = [];
  for (const step of run) {
    const name = plateStreet(step.street_name);
    if (name && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) return "Spur — return the way you came";
  if (names.length === 1) return `Spur — ${names[0]}, return the way you came`;
  if (names.length === 2) return `Spur — ${names[0]} and ${names[1]}, return the way you came`;
  const last = names[names.length - 1];
  return `Spur — ${names.slice(0, -1).join(", ")} and ${last}, return the way you came`;
}

/** Consecutive `is_spur` steps become one card. The numbers are the before/after. */
export function collapseSpurRuns(steps: FieldRouteStep[]): { spurSteps: number; spurCards: number } {
  let spurSteps = 0;
  let spurCards = 0;
  let inRun = false;
  for (const step of steps) {
    if (step.is_spur) {
      spurSteps += 1;
      if (!inRun) {
        spurCards += 1;
        inRun = true;
      }
    } else {
      inRun = false;
    }
  }
  return { spurSteps, spurCards };
}

function instructionForStep(steps: FieldRouteStep[], stepIndex: number): InstructionCard {
  const at = steps.findIndex((step) => step.step_index === stepIndex);
  const step = at >= 0 ? steps[at] : undefined;
  if (!step) return { kind: "step", text: "" };
  if (!step.is_spur) return { kind: "step", text: step.instruction };

  let from = at;
  let to = at;
  while (from > 0 && steps[from - 1]!.is_spur) from -= 1;
  while (to + 1 < steps.length && steps[to + 1]!.is_spur) to += 1;
  const run = steps.slice(from, to + 1);
  if (run.length === 1) return { kind: "spur", text: step.instruction };
  return { kind: "spur", text: spurCardText(run) };
}

function placeDoors(doors: SequenceDoor[], route: FieldRoute): Array<number | null> {
  const strandedFrom = Math.max(0, doors.length - Math.max(0, route.strandedCount));
  const placed: Array<number | null> = doors.map(() => null);
  const working = workingSteps(route.steps);
  if (working.length === 0) return placed;

  const lat0 = route.steps[0]?.coordinates[0]?.[1] ?? doors[0]?.lngLat[1] ?? 51.45;
  let cursor = 0;
  let lastEst = Number.NEGATIVE_INFINITY;
  let prevFraction: number | null = null;
  let prevList = -1;

  for (let d = 0; d < doors.length; d += 1) {
    if (d >= strandedFrom) continue;
    const door = doors[d]!;
    const point = project(door.lngLat[0], door.lngLat[1], lat0);
    const snaps = working.map((row) => {
      const snap = snapToStep(point, row.step, lat0);
      const span = Math.max(0, row.endM - row.startM);
      return {
        listIndex: row.listIndex,
        dist: snap.dist,
        fraction: snap.fraction,
        est: row.startM + snap.fraction * span,
      };
    });

    let minDist = Number.POSITIVE_INFINITY;
    for (const snap of snaps) {
      if (snap.listIndex >= cursor && snap.dist < minDist) minDist = snap.dist;
    }

    const near = snaps.filter(
      (snap) => snap.listIndex >= cursor && snap.dist <= minDist + TIE_M,
    );
    const pool = near.length > 0 ? near : snaps.filter((snap) => snap.listIndex >= cursor);
    const forward = pool.filter((snap) => snap.est >= lastEst - 8);
    const choices = forward.length > 0 ? forward : pool;
    choices.sort((a, b) => a.est - b.est || a.listIndex - b.listIndex);
    let chosen = choices[0];
    if (!chosen) continue;

    if (
      chosen.listIndex === cursor &&
      prevList === cursor &&
      prevFraction !== null &&
      chosen.fraction < prevFraction - FRACTION_DROP
    ) {
      const next = pool.find((snap) => snap.listIndex === cursor + 1);
      if (next && next.dist <= minDist + TIE_M) chosen = next;
    }

    cursor = chosen.listIndex;
    lastEst = chosen.est;
    prevFraction = chosen.fraction;
    prevList = chosen.listIndex;
    placed[d] = working[chosen.listIndex]!.step.step_index;
  }

  return placed;
}

function cardsForDoor(
  steps: FieldRouteStep[],
  stepIndex: number | null,
  previousStep: number | null,
  stranded: boolean,
): InstructionCard[] {
  if (stranded) return [{ kind: "stranded", text: "Off the drawn route" }];
  if (stepIndex === null) return [];

  const cards: InstructionCard[] = [];
  const firstOfStep = previousStep !== stepIndex;
  if (firstOfStep) {
    const after = previousStep ?? -1;
    for (const step of steps) {
      if (step.segment_id !== null) continue;
      if (step.step_index <= after || step.step_index >= stepIndex) continue;
      cards.push({ kind: "transfer", text: step.instruction });
    }
  }
  const instruction = instructionForStep(steps, stepIndex);
  if (instruction.text) cards.push(instruction);
  return cards;
}

export function describeRoute(
  sequence: SequenceDoor[],
  route: FieldRoute | null,
  ready: boolean,
): RouteDescription {
  if (!ready) {
    return { ready: false, hasRoute: false, doors: sequence.map(() => EMPTY_DOOR) };
  }
  if (!route?.hasRoute) {
    return { ready: true, hasRoute: false, doors: sequence.map(() => EMPTY_DOOR) };
  }
  if (route.steps.length === 0) {
    const strandedFrom = Math.max(0, sequence.length - Math.max(0, route.strandedCount));
    return {
      ready: true,
      hasRoute: true,
      doors: sequence.map((_, index) =>
        index >= strandedFrom
          ? { stranded: true, stepIndex: null, routeStreet: null, cards: [{ kind: "stranded", text: "Off the drawn route" }] }
          : EMPTY_DOOR,
      ),
    };
  }

  const strandedFrom = Math.max(0, sequence.length - Math.max(0, route.strandedCount));
  const placed = placeDoors(sequence, route);
  const byIndex = new Map(route.steps.map((step) => [step.step_index, step]));
  let previousStep: number | null = null;
  const doors = sequence.map((_, index) => {
    const stranded = index >= strandedFrom;
    const stepIndex = stranded ? null : (placed[index] ?? null);
    const step = stepIndex === null ? undefined : byIndex.get(stepIndex);
    const view: DoorRouteView = {
      stranded,
      stepIndex,
      routeStreet: plateStreet(step?.street_name),
      cards: cardsForDoor(route.steps, stepIndex, previousStep, stranded),
    };
    if (!stranded && stepIndex !== null) previousStep = stepIndex;
    return view;
  });

  return { ready: true, hasRoute: true, doors };
}
