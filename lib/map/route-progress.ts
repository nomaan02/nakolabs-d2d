/**
 * Which part of a frozen route is current, next, later or already walked.
 *
 * Pure. No MapLibre import. The one renderer in `route-layers.ts` paints
 * the result. Admin passes no position and gets no tiers.
 *
 * A leg is a run of one street. A cross starts a new leg, so the way out
 * and the way back are not the same leg. Walk and cross steps before a
 * work step belong to that work step's leg. Greying is per step: everything
 * before the current step is done, including earlier steps on this street.
 */

import { plateStreet } from "@/lib/map/street-name";

export type RouteTier = "done" | "focus" | "near" | "far";

/**
 * One step. `RoutePaintStep` satisfies this. `variantKey` is optional so a
 * direct read of `route_steps` can omit it; more than one distinct key
 * means the model is an admin overlay and progress does not apply.
 */
export type ProgressStep = {
  stepIndex: number;
  kind: string;
  street?: string | null;
  firstSeq?: number | null;
  lastSeq?: number | null;
  variantKey?: string | null;
};

/** Keyed by `stepIndex`. Single-variant models only. */
export type RouteTiers = ReadonlyMap<number, RouteTier>;

export type LegRun = {
  leg: number;
  firstStep: number;
  tier: RouteTier;
  stepIndexes: number[];
};

function byIndex(steps: readonly ProgressStep[]): ProgressStep[] {
  return [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
}

function legKey(step: ProgressStep): string {
  return plateStreet(step.street) ?? `unnamed:${step.stepIndex}`;
}

/**
 * Legs as lists of `stepIndex`.
 *
 * Walk and cross steps are buffered and attached to the next work step.
 * A work step joins the current leg only when its plate matches and the
 * buffer holds no cross. Trailing connectors join the last leg.
 */
export function routeLegs(steps: readonly ProgressStep[]): number[][] {
  const legs: number[][] = [];
  let buffer: number[] = [];
  let bufferHasCross = false;
  let currentKey: string | null = null;

  for (const step of byIndex(steps)) {
    if (step.kind !== "work") {
      buffer.push(step.stepIndex);
      if (step.kind === "cross") bufferHasCross = true;
      continue;
    }

    const key = legKey(step);
    const canJoin = currentKey !== null && key === currentKey && !bufferHasCross && legs.length > 0;
    if (canJoin) legs[legs.length - 1]!.push(...buffer, step.stepIndex);
    else legs.push([...buffer, step.stepIndex]);

    buffer = [];
    bufferHasCross = false;
    currentKey = key;
  }

  if (buffer.length > 0) {
    if (legs.length === 0) legs.push([...buffer]);
    else legs[legs.length - 1]!.push(...buffer);
  }

  return legs;
}

function variantCount(steps: readonly ProgressStep[]): number {
  const keys = new Set<string>();
  for (const step of steps) {
    if (step.variantKey) keys.add(step.variantKey);
  }
  return keys.size;
}

function currentWorkStep(steps: readonly ProgressStep[], position: number): number | null {
  const work = steps.filter(
    (step) =>
      step.kind === "work" &&
      typeof step.firstSeq === "number" &&
      typeof step.lastSeq === "number",
  );
  const containing = work.find((step) => step.firstSeq! <= position && position <= step.lastSeq!);
  if (containing) return containing.stepIndex;
  const ahead = work.find((step) => step.lastSeq! >= position);
  if (ahead) return ahead.stepIndex;
  return null;
}

/**
 * `undefined` (still loading), an empty route, or more than one variant
 * returns null. The renderer then paints every step as focus.
 * `null` means nothing is left: every step is done.
 */
export function computeRouteTiers(
  steps: readonly ProgressStep[],
  position: number | null | undefined,
): RouteTiers | null {
  if (position === undefined) return null;
  if (steps.length === 0) return null;
  if (variantCount(steps) > 1) return null;

  const ordered = byIndex(steps);
  const tiers = new Map<number, RouteTier>();
  if (position === null) {
    for (const step of ordered) tiers.set(step.stepIndex, "done");
    return tiers;
  }

  const current = currentWorkStep(ordered, position);
  if (current === null) {
    for (const step of ordered) tiers.set(step.stepIndex, "done");
    return tiers;
  }

  const legs = routeLegs(ordered);
  const legOf = new Map<number, number>();
  legs.forEach((leg, index) => {
    for (const stepIndex of leg) legOf.set(stepIndex, index);
  });
  const currentLeg = legOf.get(current);

  for (const step of ordered) {
    if (step.stepIndex < current || currentLeg === undefined) {
      tiers.set(step.stepIndex, "done");
      continue;
    }
    const leg = legOf.get(step.stepIndex);
    if (leg === currentLeg || leg === currentLeg + 1) tiers.set(step.stepIndex, "focus");
    else if (leg === currentLeg + 2) tiers.set(step.stepIndex, "near");
    else tiers.set(step.stepIndex, "far");
  }

  return tiers;
}

/**
 * Consecutive steps that share a leg and a tier. Chevrons are placed on
 * one line per run so spacing does not restart at every junction.
 * No tiers means one run per leg, all focus (the admin path).
 */
export function legRuns(steps: readonly ProgressStep[], tiers: RouteTiers | null): LegRun[] {
  const runs: LegRun[] = [];
  routeLegs(steps).forEach((indexes, leg) => {
    let current: LegRun | null = null;
    for (const stepIndex of indexes) {
      const tier = tiers?.get(stepIndex) ?? "focus";
      if (current && current.tier === tier) {
        current.stepIndexes.push(stepIndex);
      } else {
        current = { leg, firstStep: stepIndex, tier, stepIndexes: [stepIndex] };
        runs.push(current);
      }
    }
  });
  return runs;
}

/** `"done:n,focus:n,near:n,far:n"`, or `"none"` when progress does not apply. */
export function formatTierCounts(tiers: RouteTiers | null | undefined, stepCount: number): string {
  if (!tiers || stepCount === 0) return "none";
  let done = 0;
  let focus = 0;
  let near = 0;
  let far = 0;
  for (const tier of tiers.values()) {
    if (tier === "done") done += 1;
    else if (tier === "focus") focus += 1;
    else if (tier === "near") near += 1;
    else far += 1;
  }
  return `done:${done},focus:${focus},near:${near},far:${far}`;
}

function haversine(a: [number, number], b: [number, number]): number {
  const radius = 6_371_000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Haversine metres of each leg, summed along that leg's walk coordinates. */
export function legLengthsM(
  steps: readonly (ProgressStep & { walk?: readonly [number, number][] | null })[],
): number[] {
  const byStep = new Map(steps.map((step) => [step.stepIndex, step]));
  return routeLegs(steps).map((indexes) => {
    let metres = 0;
    for (const index of indexes) {
      const walk = byStep.get(index)?.walk;
      if (!walk) continue;
      for (let i = 1; i < walk.length; i += 1) {
        metres += haversine(walk[i - 1]!, walk[i]!);
      }
    }
    return metres;
  });
}
