import type { SequenceDoor } from "@/lib/field/sequence";
import { emptyRouteModel, toRoutePaintModel, type RoutePaintModel } from "@/lib/map/route-layers";
import type { DoorCollection, TodaysAssignment } from "@/lib/geo/todays-assignment";

/**
 * How the field app turns a frozen route into the thing on the doorstep.
 *
 * New-engine assignments (a step `kind` is set) place each door by the
 * step's `first_seq`/`last_seq`. Those are 0-based positions in the frozen
 * snapshot, which is the walk order. There is no geometric snap.
 *
 * Old-engine assignments have a centreline and `is_spur`, and every
 * `first_seq`/`last_seq`/`kind` is null. They keep the snapshot order and
 * the stranded tail, and they do not draw a route line.
 *
 * A transfer, cross or walk is shown on the first door of the working step
 * that follows it. Consecutive spur steps are one card.
 */

export type FieldRouteStep = {
  step_index: number;
  segment_id: number | null;
  street_name: string | null;
  instruction: string;
  is_spur: boolean;
  cumulative_m: number;
  /** Centreline. Kept so an old cached row still has a line to ignore. */
  coordinates: [number, number][];
  kind: "work" | "cross" | "walk" | null;
  side: "left" | "right" | null;
  walk: [number, number][] | null;
  first_seq: number | null;
  last_seq: number | null;
  is_dead_end: boolean;
};

export type FieldRoute = {
  hasRoute: boolean;
  strandedCount: number;
  line: GeoJSON.LineString | null;
  variantKey: string | null;
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
  /** True only for a new-engine route. The map paints nothing otherwise. */
  paintRoute: boolean;
  variantKey: string | null;
  hand: "left" | "right" | null;
  startStreet: string | null;
  /** First point of the pavement line, for the header compass. */
  startPoint: [number, number] | null;
  doors: DoorRouteView[];
};

const NOT_A_STREET = new Set(["service road", "unnamed road"]);

const EMPTY_DOOR: DoorRouteView = {
  stranded: false,
  stepIndex: null,
  routeStreet: null,
  cards: [],
};

const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

export function plateStreet(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (NOT_A_STREET.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/** A new-engine freeze has `kind` on its steps. An old freeze does not. */
export function routeIsNewEngine(route: FieldRoute | null | undefined): boolean {
  if (!route) return false;
  return route.steps.some((step) => step.kind === "work" || step.kind === "cross" || step.kind === "walk");
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

function isBetween(step: FieldRouteStep): boolean {
  if (step.kind === "work") return false;
  if (step.kind === "cross" || step.kind === "walk") return true;
  return step.segment_id === null;
}

/**
 * Exact placement. `first_seq`/`last_seq` are snapshot positions. A door
 * outside every range is not given a step.
 */
function placeByRange(doors: SequenceDoor[], route: FieldRoute): Map<number, number> {
  const placed = new Map<number, number>();
  const ranges = route.steps.filter(
    (step) =>
      step.kind === "work" &&
      step.first_seq !== null &&
      step.last_seq !== null &&
      step.last_seq >= step.first_seq,
  );
  for (const door of doors) {
    const step = ranges.find(
      (row) => door.position >= row.first_seq! && door.position <= row.last_seq!,
    );
    if (step) placed.set(door.position, step.step_index);
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
      if (!isBetween(step)) continue;
      if (step.step_index <= after || step.step_index >= stepIndex) continue;
      cards.push({ kind: "transfer", text: step.instruction });
    }
  }
  const instruction = instructionForStep(steps, stepIndex);
  if (instruction.text) cards.push(instruction);
  return cards;
}

function routeFacts(route: FieldRoute | null, paintRoute: boolean): Pick<
  RouteDescription,
  "variantKey" | "hand" | "startStreet" | "startPoint"
> {
  if (!route || !paintRoute) {
    return { variantKey: route?.variantKey ?? null, hand: null, startStreet: null, startPoint: null };
  }
  const work = route.steps.find((step) => step.kind === "work");
  const hand = work?.side === "left" || work?.side === "right" ? work.side : null;
  const startStreet = plateStreet(work?.street_name);
  const start = route.steps.find((step) => step.walk && step.walk.length > 0)?.walk?.[0] ?? null;
  return {
    variantKey: route.variantKey,
    hand,
    startStreet,
    startPoint: start,
  };
}

function blank(sequence: SequenceDoor[], ready: boolean, hasRoute: boolean): RouteDescription {
  return {
    ready,
    hasRoute,
    paintRoute: false,
    variantKey: null,
    hand: null,
    startStreet: null,
    startPoint: null,
    doors: sequence.map(() => EMPTY_DOOR),
  };
}

export function describeRoute(
  sequence: SequenceDoor[],
  route: FieldRoute | null,
  ready: boolean,
): RouteDescription {
  if (!ready) return blank(sequence, false, false);
  if (!route?.hasRoute) return blank(sequence, true, false);

  const strandedFrom = Math.max(0, sequence.length - Math.max(0, route.strandedCount));
  const paintRoute = routeIsNewEngine(route);
  const facts = routeFacts(route, paintRoute);

  if (!paintRoute || route.steps.length === 0) {
    return {
      ready: true,
      hasRoute: true,
      paintRoute: false,
      ...facts,
      doors: sequence.map((door, index) =>
        index >= strandedFrom || door.position >= strandedFrom
          ? { stranded: true, stepIndex: null, routeStreet: null, cards: [{ kind: "stranded", text: "Off the drawn route" }] }
          : EMPTY_DOOR,
      ),
    };
  }

  const placed = placeByRange(sequence, route);
  const byIndex = new Map(route.steps.map((step) => [step.step_index, step]));
  let previousStep: number | null = null;
  const doors = sequence.map((door, index) => {
    const stranded = index >= strandedFrom || door.position >= strandedFrom;
    const stepIndex = stranded ? null : (placed.get(door.position) ?? null);
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

  return { ready: true, hasRoute: true, paintRoute: true, ...facts, doors };
}

/** Pavement line for the shared renderer. Empty for an old-engine route. */
export function fieldRoutePaintModel(route: FieldRoute | null): RoutePaintModel {
  if (!route || !routeIsNewEngine(route)) return emptyRouteModel();
  const key = route.variantKey || "route";
  return toRoutePaintModel({
    variantKey: key,
    steps: route.steps.map((step) => ({
      step_index: step.step_index,
      kind: step.kind,
      walk_geom: step.walk ? { type: "LineString", coordinates: step.walk } : null,
      variant_key: key,
    })),
  });
}

/** North-based eight-point compass. The word for the octant only. */
export function compassBetween(from: [number, number], to: [number, number]): string {
  const angle = Math.atan2(to[0] - from[0], to[1] - from[1]);
  const radians = angle < 0 ? angle + 2 * Math.PI : angle;
  const octant = Math.floor(((radians * 180) / Math.PI + 22.5) / 45) % 8;
  return COMPASS[octant] ?? "north";
}

function doorCentroid(doors: DoorCollection): [number, number] | null {
  if (doors.features.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const feature of doors.features) {
    lon += feature.geometry.coordinates[0];
    lat += feature.geometry.coordinates[1];
  }
  return [lon / doors.features.length, lat / doors.features.length];
}

/**
 * Header for the Map tab. A new-engine route contributes only facts the
 * freeze recorded: reversed or not, the start street, the hand, the door
 * count. An old or unrouted assignment keeps visit, slot and door count.
 */
export function formatFieldHeader(assignment: TodaysAssignment, route: RouteDescription): string {
  const doors = `${assignment.door_count.toLocaleString("en-GB")} doors`;
  if (!route.paintRoute) {
    return [`Visit ${assignment.visit_number}`, assignment.slot, doors].join(" · ");
  }

  const parts = [`Visit ${assignment.visit_number}`];
  if (route.variantKey === "best_reversed") parts.push("reversed");
  else if (route.variantKey) {
    const alt = /^alt_(\d+)$/.exec(route.variantKey);
    if (alt) parts.push(`alternative ${alt[1]}`);
  }
  if (route.startStreet) {
    const centroid = route.startPoint ? doorCentroid(assignment.doors) : null;
    const compass =
      centroid && route.startPoint ? compassBetween(centroid, route.startPoint) : null;
    parts.push(compass ? `start ${route.startStreet} (${compass})` : `start ${route.startStreet}`);
  }
  if (route.hand === "left") parts.push("doors on your left");
  else if (route.hand === "right") parts.push("doors on your right");
  parts.push(doors);
  return parts.join(" · ");
}
