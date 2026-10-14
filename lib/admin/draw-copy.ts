/**
 * UI-10 F2a (owner A20, A21, A23; 2026-10-06). The words around drawing a
 * prop: door counts, what was left out, and the two route cards.
 *
 * Pure: no React, no network. Checked by `npm run verify:ui10`.
 */
import type { KnockableCount } from "@/lib/geo/count-knockable";
import type { Hand } from "@/lib/geo/walk/types";

/**
 * What the route cards and Route details need from a variant. A fresh
 * `WalkVariant` fits, and so does a saved route read back from
 * `territory_routes` (RT-3: the Routes panel opened from the prop menu).
 */
export type RouteSummary = {
  key: string;
  hand: Hand;
  total_m: number;
  stranded_count: number;
  steps: readonly { street_name: string | null }[];
};

/** Frame 11: "6 doors left out: No Cold Calling zone". Null when none are. */
export function ncczNote(count: Pick<KnockableCount, "nccz">): string | null {
  if (count.nccz <= 0) return null;
  const doors = count.nccz === 1 ? "1 door" : `${count.nccz.toLocaleString("en-GB")} doors`;
  return `${doors} left out: No Cold Calling zone`;
}

/** Under the count: flats in buildings of 3+ units are never knocked. Null when none. */
export function flatsNote(count: Pick<KnockableCount, "multiUnit">): string | null {
  if (count.multiUnit <= 0) return null;
  return count.multiUnit === 1 ? "1 flat left out" : `${count.multiUnit.toLocaleString("en-GB")} flats left out`;
}

/** Frame 05: "1,682 doors · 34 excluded". */
export function doorsLine(count: Pick<KnockableCount, "knockable" | "excluded">): string {
  const doors = `${count.knockable.toLocaleString("en-GB")} doors`;
  return count.excluded > 0 ? `${doors} · ${count.excluded.toLocaleString("en-GB")} excluded` : doors;
}

/** Frame 13: "+32 since last save". */
export function doorDelta(now: number, before: number | null): string | null {
  if (before === null) return null;
  const change = now - before;
  if (change === 0) return "No change since last save";
  const size = Math.abs(change).toLocaleString("en-GB");
  return `${change > 0 ? "+" : "−"}${size} since last save`;
}

export function kmOf(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

/** The first named street a variant walks. */
export function startStreet(variant: Pick<RouteSummary, "steps">): string | null {
  for (const step of variant.steps) {
    if (step.street_name && step.street_name.trim() !== "") return step.street_name.trim();
  }
  return null;
}

export type RouteCard = {
  key: string;
  title: string;
  /** Which visits use it, so the choice is honest: the rotation picks, not the admin. */
  visits: string;
  start: string | null;
};

/**
 * Frame 12, made truthful: A and B are the two routes visits alternate
 * between (`defaultVariantKey`: odd visits walk `best`, even visits walk
 * `best_reversed`). Tapping a card previews it; nothing is "chosen". The
 * alternatives live under Route details (A23).
 */
export function routeCards(variants: readonly Pick<RouteSummary, "key" | "total_m" | "steps">[]): RouteCard[] {
  const cards: RouteCard[] = [];
  const a = variants.find((variant) => variant.key === "best");
  const b = variants.find((variant) => variant.key === "best_reversed");
  if (a) cards.push({ key: a.key, title: `Route A · ${kmOf(a.total_m)}`, visits: "Visits 1, 3, 5…", start: startStreet(a) });
  if (b) cards.push({ key: b.key, title: `Route B · ${kmOf(b.total_m)}`, visits: "Visits 2, 4, 6…", start: startStreet(b) });
  return cards;
}

/** One line per saved variant for Route details. */
export function routeDetailLine(variant: RouteSummary): string {
  const name =
    variant.key === "best" ? "Route A" : variant.key === "best_reversed" ? "Route B" : `Spare ${variant.key.replace("alt_", "")}`;
  const hand = variant.hand === "left" ? "doors on the left" : "doors on the right";
  const stranded = variant.stranded_count > 0 ? ` · ${variant.stranded_count} off route` : "";
  const steps = variant.steps.length === 1 ? "1 step" : `${variant.steps.length.toLocaleString("en-GB")} steps`;
  return `${name} · ${kmOf(variant.total_m)} · ${hand} · ${steps}${stranded}`;
}
