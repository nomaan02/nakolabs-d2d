/**
 * RT-START P1 (owner 2026-10-19). The saved routes one visit can walk, read
 * through `assignment_route_options` (migration 043), and the words both the
 * admin and the field use for them. Choosing one is `freezeAssignmentRoute`
 * with a key (lib/geo/walk/freeze.ts): only before the visit's first knock.
 *
 * Pure apart from `fetchVisitRouteOptions`. Distances are worked out on the
 * device; nothing about the canvasser's position is sent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { VariantKey } from "@/lib/geo/walk/types";
import type { Database } from "@/lib/supabase/types";

export type RouteOption = {
  key: string;
  totalM: number;
  hand: "left" | "right";
  /** Where the walk starts (its first node). Null when not known (Add visit, before allocation). */
  start: { lon: number; lat: number } | null;
  startStreet: string | null;
  /** False when the route no longer fits the visit's doors: shown, not pickable. */
  usable: boolean;
};

export type VisitRouteOptions = {
  assignmentId: string;
  visitNumber: number;
  workDate: string;
  closed: boolean;
  knocks: number;
  currentKey: string | null;
  defaultKey: string;
  /** The recorded choice, or null when the visit is on the default. */
  choice: string | null;
  chosenBy: string | null;
  chosenAt: string | null;
  sourceId: string | null;
  /** The server's frozen door order as one number (orderCheckOf). Null from an older server. */
  orderCheck: number | null;
  routes: RouteOption[];
};

export type RouteOptionsResult =
  | { ok: true; options: VisitRouteOptions }
  | { ok: false; message: string };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseRoute(raw: unknown): RouteOption | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const key = text(row.key);
  const totalM = num(row.total_m);
  if (!key || totalM === null) return null;
  const lon = num(row.start_lon);
  const lat = num(row.start_lat);
  return {
    key,
    totalM,
    hand: row.hand === "left" ? "left" : "right",
    start: lon !== null && lat !== null ? { lon, lat } : null,
    startStreet: text(row.start_street)?.trim() ?? null,
    usable: row.usable === true,
  };
}

/** Null when the document is not the 043 shape. */
export function parseVisitRouteOptions(raw: unknown): VisitRouteOptions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const assignmentId = text(row.assignment_id);
  const visitNumber = num(row.visit_number);
  const defaultKey = text(row.default_key);
  if (!assignmentId || visitNumber === null || !defaultKey || !Array.isArray(row.routes)) return null;
  return {
    assignmentId,
    visitNumber,
    workDate: text(row.work_date) ?? "",
    closed: row.closed === true,
    knocks: num(row.knocks) ?? 0,
    currentKey: text(row.current_key),
    defaultKey,
    choice: text(row.choice),
    chosenBy: text(row.chosen_by),
    chosenAt: text(row.chosen_at),
    sourceId: text(row.source_id),
    orderCheck: num(row.order_check),
    routes: row.routes.flatMap((route) => {
      const parsed = parseRoute(route);
      return parsed ? [parsed] : [];
    }),
  };
}

/** Never throws. Admin, or a canvasser on the visit. */
export async function fetchVisitRouteOptions(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
): Promise<RouteOptionsResult> {
  try {
    const { data, error } = await supabase.rpc("assignment_route_options", { p_assignment_id: assignmentId });
    if (error) return { ok: false, message: "This visit's routes could not be read." };
    const options = parseVisitRouteOptions(data);
    if (!options) return { ok: false, message: "This visit's routes could not be read." };
    return { ok: true, options };
  } catch {
    return { ok: false, message: "This visit's routes could not be read." };
  }
}

/** "Route A", "Route B", "Your route", "Your route, reversed", "Alternative 2". */
export function routeName(key: string): string {
  if (key === "best") return "Route A";
  if (key === "best_reversed") return "Route B";
  if (key === "manual") return "Your route";
  if (key === "manual_reversed") return "Your route, reversed";
  const alt = /^alt_(\d+)$/.exec(key);
  return alt ? `Alternative ${alt[1]}` : key;
}

/** "30.0 km". */
export function kmText(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

/** "Route B · 30.0 km". */
export function routeTitle(option: Pick<RouteOption, "key" | "totalM">): string {
  return `${routeName(option.key)} · ${kmText(option.totalM)}`;
}

/** A, B and the drawn pair first, then alternatives in number order. */
export function routeRank(key: string): number {
  if (key === "best") return 0;
  if (key === "best_reversed") return 1;
  if (key === "manual") return 2;
  if (key === "manual_reversed") return 3;
  const alt = /^alt_(\d+)$/.exec(key);
  return alt ? 100 + Number(alt[1]) : 1000;
}

/** The default by turns, as the database works it out (043). `drawnFits`: a drawn route that fits the visit. */
export function defaultRouteKey(visitNumber: number, drawnFits: boolean): string {
  const odd = visitNumber % 2 === 1;
  if (drawnFits) return odd ? "manual" : "manual_reversed";
  return odd ? "best" : "best_reversed";
}

/** The key the next visit gets by default, for "Visit 2 goes back to Route B". */
export function nextVisitLine(visitNumber: number, defaultKey: string): string {
  const drawn = defaultKey === "manual" || defaultKey === "manual_reversed";
  return `Only this visit changes. Visit ${visitNumber + 1} goes back to ${routeName(defaultRouteKey(visitNumber + 1, drawn))}.`;
}

/** Great-circle metres. Used on the device only. */
export function metresBetween(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "90 m", "420 m", "1.2 km". Rounded so a jittery fix does not flicker the list. */
export function distanceText(metres: number): string {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/**
 * Usable routes first, each group nearest start first when `from` is known,
 * else in route order (A, B, drawn, alternatives).
 */
export function sortRoutes(
  routes: readonly RouteOption[],
  from: { lon: number; lat: number } | null,
): RouteOption[] {
  const away = (route: RouteOption) => (from && route.start ? metresBetween(from, route.start) : Infinity);
  return [...routes].sort(
    (a, b) =>
      Number(b.usable) - Number(a.usable) ||
      (from ? away(a) - away(b) : 0) ||
      routeRank(a.key) - routeRank(b.key),
  );
}

/** A visit's route can change only while it is open and nobody has knocked. */
export function routeChangeable(options: Pick<VisitRouteOptions, "closed" | "knocks">, localKnocks = 0): boolean {
  return !options.closed && options.knocks === 0 && localKnocks === 0;
}

/** Under the route's name: "Starts on Henleaze Road · default", "· chosen by Ada". */
export function routeSubline(input: {
  option: Pick<RouteOption, "startStreet"> | null;
  isDefault: boolean;
  chosenBy?: string | null;
}): string {
  const parts: string[] = [];
  if (input.option?.startStreet) parts.push(`Starts on ${input.option.startStreet}`);
  if (input.chosenBy) parts.push(`chosen by ${input.chosenBy}`);
  else if (input.isDefault) parts.push("default");
  return parts.join(" · ") || "Start not known";
}

/** Words for a refused route change (freeze failure codes, lib/geo/walk/freeze.ts). */
export function routeChangeMessage(code: string, fallback: string): string {
  switch (code) {
    case "frozen":
      return "Someone has knocked on this visit, so its route is locked.";
    case "closed":
      return "This visit has ended, so its route can't change.";
    case "not_today":
      return "Only today's visit can change its route from the phone.";
    case "missing_variant":
    case "stale_variant":
    case "snapshot_mismatch":
      return "That route no longer fits this visit. Pick another one.";
    case "manual_unfinished":
      return "The drawn route needs finishing before a visit can use it.";
    case "not_admin":
      return "Only someone on this visit can change its route.";
    case "unavailable":
      return "The route didn't change. Check your signal, then try again.";
    default:
      return fallback;
  }
}

/** A saved-route key as the freeze takes it, or null for anything else. */
export function asVariantKey(key: string): VariantKey | null {
  return /^(best|best_reversed|alt_[1-9][0-9]*|manual|manual_reversed)$/.test(key) ? (key as VariantKey) : null;
}

/**
 * The frozen door order as one number, worked out exactly as
 * `assignment_route_options.order_check` (043): sum of (uprn mod 1000003) x
 * position (1-based), mod 2147483647, over EVERY door of the snapshot
 * (`sequence` is the 0-based snapshot index). A phone whose number differs
 * from the server's is walking an old order.
 */
export function orderCheckOf(doors: readonly { uprn: number; sequence: number }[]): number {
  let sum = BigInt(0);
  for (const door of doors) sum += BigInt(door.uprn % 1_000_003) * BigInt(door.sequence + 1);
  return Number(sum % BigInt(2_147_483_647));
}
