/**
 * UI-10 F4a (owner A32, A33, A44; frames 22, 38). Coverage filters: what the
 * URL holds, what each chip says, and which knock paints each door.
 *
 * Pure: no React, no network. Rows are `v_latest_knock` rows (latest outcome
 * per door per visit). A door shows the latest of ITS rows that pass the
 * filters; doors with none stay "not knocked". The outcome filter then
 * keeps only doors whose painted outcome matches, so "Early slot +
 * Contacts" shows contacts knocked on early-slot visits (A32). Coverage is
 * derived here, never stored. Checked by `npm run verify:ui10`.
 *
 * Days: with no prop picked the map opens on the last 30 days (frame 22),
 * so it stays quick as knocks grow; one prop opens on all time. Either
 * default is not counted as a filter. "All time" for everything is
 * `period=all`.
 */
import { addDays, dayDate, joinNames, shortDate, slotLabel } from "@/lib/admin/props";
import { londonDay, londonTime } from "@/lib/admin/calendar";
import type { Slot } from "@/lib/geo/rotation";

export type OutcomeFilter = "contact" | "lead" | "rented" | "notin" | "other";

export type CoverageFilters = {
  prop: string | null;
  /**
   * PP-1 (owner 2026-10-21): a folder's props only (Props → folder → "Open on
   * map"). The loader limits doors, props and visits to the folder, so the
   * pure functions here only need to know one is set. Opens on all time, like one prop.
   */
  folder: string | null;
  from: string | null;
  to: string | null;
  visit: number | null;
  who: string | null;
  outcome: OutcomeFilter | null;
  slot: Slot | null;
  /** Arrived from Calendar: the header shows "Calendar" as the way back. */
  via: "calendar" | null;
};

export const NO_FILTERS: CoverageFilters = {
  prop: null,
  folder: null,
  from: null,
  to: null,
  visit: null,
  who: null,
  outcome: null,
  slot: null,
  via: null,
};

export type CoverageRow = {
  assignmentId: string;
  uprn: number;
  outcome: string;
  canvasserId: string;
  occurredAt: string;
};

export type CoverageVisit = { id: string; propId: string; visitNumber: number; slot: Slot | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OUTCOMES: readonly OutcomeFilter[] = ["contact", "lead", "rented", "notin", "other"];

function one(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.trim() !== "" ? v.trim() : null;
}

function realDate(value: string | null): string | null {
  if (!value || !DATE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toISOString().slice(0, 10) === value ? value : null;
}

/** The days a view opens on: one prop, all time; everything, the last 30 days. */
export function defaultPeriod(prop: string | null, today: string): { from: string | null; to: string | null } {
  return prop ? { from: null, to: null } : { from: addDays(today, -29), to: today };
}

/** One prop or one folder opens on all time; everything opens on the last 30 days. */
function narrowedTo(filters: Pick<CoverageFilters, "prop" | "folder">): string | null {
  return filters.prop ?? filters.folder;
}

function isDefaultPeriod(filters: Pick<CoverageFilters, "prop" | "folder" | "from" | "to">, today: string): boolean {
  const base = defaultPeriod(narrowedTo(filters), today);
  return filters.from === base.from && filters.to === base.to;
}

/** Reads the page's search params; anything malformed is dropped, never guessed. */
export function parseFilters(params: Record<string, string | string[] | undefined>, today: string): CoverageFilters {
  const rawProp = one(params.prop);
  const prop = rawProp && UUID.test(rawProp) ? rawProp : null;
  const rawFolder = one(params.folder);
  const folder = rawFolder && UUID.test(rawFolder) ? rawFolder : null;
  const who = one(params.who);
  const date = realDate(one(params.date));
  let from = date ?? realDate(one(params.from));
  let to = date ?? realDate(one(params.to));
  if (from && to && from > to) [from, to] = [to, from];
  if (!from && !to && one(params.period) !== "all") ({ from, to } = defaultPeriod(prop ?? folder, today));
  const visitRaw = Number(one(params.visit));
  const outcome = one(params.outcome);
  const slot = one(params.slot);
  return {
    prop,
    folder,
    from,
    to,
    visit: Number.isInteger(visitRaw) && visitRaw >= 1 && visitRaw <= 999 ? visitRaw : null,
    who: who && UUID.test(who) ? who : null,
    outcome: OUTCOMES.includes(outcome as OutcomeFilter) ? (outcome as OutcomeFilter) : null,
    slot: slot === "early" || slot === "mid" || slot === "late" ? slot : null,
    via: one(params.via) === "calendar" ? "calendar" : null,
  };
}

/** The URL for a set of filters (stable key order; one day is written as `date`; the default days are left out). */
export function filtersHref(filters: CoverageFilters, today: string): string {
  const params = new URLSearchParams();
  if (filters.prop) params.set("prop", filters.prop);
  if (filters.folder) params.set("folder", filters.folder);
  if (isDefaultPeriod(filters, today)) {
    // Nothing to write: the page opens on these days anyway.
  } else if (!filters.from && !filters.to) params.set("period", "all");
  else if (filters.from && filters.from === filters.to) params.set("date", filters.from);
  else {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }
  if (filters.visit !== null) params.set("visit", String(filters.visit));
  if (filters.slot) params.set("slot", filters.slot);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.who) params.set("who", filters.who);
  if (filters.via) params.set("via", filters.via);
  const query = params.toString();
  return query ? `/admin/coverage?${query}` : "/admin/coverage";
}

/** Whether the days chip narrows the view beyond where it opens. */
export function periodIsFilter(filters: CoverageFilters, today: string): boolean {
  return !isDefaultPeriod(filters, today);
}

/** "2 filters" in the header (where you came from, and the default days, are not filters). */
export function filterCount(filters: CoverageFilters, today: string): number {
  return [filters.prop, filters.folder, periodIsFilter(filters, today) ? "days" : null, filters.visit, filters.who, filters.outcome, filters.slot].filter(
    (value) => value !== null,
  ).length;
}

export function filterCountLine(filters: CoverageFilters, today: string): string | null {
  const n = filterCount(filters, today);
  return n === 0 ? null : n === 1 ? "1 filter" : `${n} filters`;
}

/** Clear: back to where Coverage opens (keeps the way back to Calendar). */
export function clearedFilters(filters: CoverageFilters, today: string): CoverageFilters {
  return { ...NO_FILTERS, ...defaultPeriod(null, today), via: filters.via };
}

/** Removing the prop: its "all time" default becomes everything's 30 days (or stays all time inside a folder); picked days stay. */
export function withoutProp(filters: CoverageFilters, today: string): CoverageFilters {
  const days = isDefaultPeriod(filters, today) ? defaultPeriod(filters.folder, today) : { from: filters.from, to: filters.to };
  return { ...filters, prop: null, ...days };
}

/** PP-1: removing the folder, the same way as removing the prop. */
export function withoutFolder(filters: CoverageFilters, today: string): CoverageFilters {
  const days = isDefaultPeriod(filters, today) ? defaultPeriod(filters.prop, today) : { from: filters.from, to: filters.to };
  return { ...filters, folder: null, ...days };
}

// ---- the period chip --------------------------------------------------------

export type PeriodPreset = "all" | "today" | "7" | "30";

export function periodOf(preset: PeriodPreset, today: string): { from: string | null; to: string | null } {
  if (preset === "today") return { from: today, to: today };
  if (preset === "7") return { from: addDays(today, -6), to: today };
  if (preset === "30") return { from: addDays(today, -29), to: today };
  return { from: null, to: null };
}

/** "All time", "Today", "Last 7 days", "Last 30 days", "Thu 1 Oct", "1 Oct – 8 Oct", "Since 1 Oct", "Until 8 Oct". */
export function periodLabel(filters: Pick<CoverageFilters, "from" | "to">, today: string): string {
  const { from, to } = filters;
  if (!from && !to) return "All time";
  if (from && to && from === to) return from === today ? "Today" : dayDate(from);
  if (to === today && from === addDays(today, -6)) return "Last 7 days";
  if (to === today && from === addDays(today, -29)) return "Last 30 days";
  if (from && to) return `${shortDate(from)} – ${shortDate(to)}`;
  return from ? `Since ${shortDate(from)}` : `Until ${shortDate(to!)}`;
}

export const OUTCOME_FILTERS: ReadonlyArray<{ value: OutcomeFilter; label: string }> = [
  { value: "contact", label: "Contacts" },
  { value: "lead", label: "Leads" },
  { value: "rented", label: "Rented / council" },
  { value: "notin", label: "Not in" },
  { value: "other", label: "Other" },
];

export function outcomeChip(outcome: OutcomeFilter | null): string {
  return OUTCOME_FILTERS.find((option) => option.value === outcome)?.label ?? "All outcomes";
}

export function slotChip(slot: Slot | null): string {
  const label = slotLabel(slot);
  return label ? `${label} slot` : "All slots";
}

export function visitChip(visit: number | null): string {
  return visit === null ? "All visits" : `Visit ${visit}`;
}

export function whoChip(who: string | null, names: Map<string, string>): string {
  return who ? (names.get(who) ?? "One person") : "Everyone";
}

// ---- which knock paints each door ------------------------------------------

/** The map's five dot colours (Map style v1). */
export function outcomeGroup(outcome: string): OutcomeFilter {
  if (outcome === "answered") return "contact";
  if (outcome === "lead") return "lead";
  if (outcome === "no_opportunity") return "rented";
  if (outcome === "no_answer") return "notin";
  return "other";
}

/**
 * Visits that pass the prop, visit-number and slot filters; null = every visit.
 * With a folder, `visits` is already that folder's (the loader limits it), so
 * the scope is never null: knocks on other props stay out.
 */
export function visitScope(visits: CoverageVisit[], filters: CoverageFilters): Set<string> | null {
  if (!filters.prop && !filters.folder && filters.visit === null && !filters.slot) return null;
  return new Set(
    visits
      .filter(
        (visit) =>
          (!filters.prop || visit.propId === filters.prop) &&
          (filters.visit === null || visit.visitNumber === filters.visit) &&
          (!filters.slot || visit.slot === filters.slot),
      )
      .map((visit) => visit.id),
  );
}

export type PaintedDoor = CoverageRow & { group: OutcomeFilter };

/** Doors that keep their colour under the outcome filter. */
export function paintedOf(worked: Map<number, PaintedDoor>, outcome: OutcomeFilter | null): Map<number, PaintedDoor> {
  if (!outcome) return worked;
  const painted = new Map<number, PaintedDoor>();
  for (const [uprn, door] of worked) if (door.group === outcome) painted.set(uprn, door);
  return painted;
}

/**
 * Door → the knock that paints it. `worked` is every door with a passing
 * knock (before the outcome filter); `painted` keeps only doors whose
 * outcome matches it.
 */
export function resolveDoors(
  rows: CoverageRow[],
  visits: CoverageVisit[],
  filters: CoverageFilters,
): { worked: Map<number, PaintedDoor>; painted: Map<number, PaintedDoor> } {
  const scope = visitScope(visits, filters);
  const worked = new Map<number, PaintedDoor>();
  for (const row of rows) {
    if (scope && !scope.has(row.assignmentId)) continue;
    if (filters.who && row.canvasserId !== filters.who) continue;
    if (filters.from || filters.to) {
      const day = londonDay(row.occurredAt);
      if (filters.from && day < filters.from) continue;
      if (filters.to && day > filters.to) continue;
    }
    const current = worked.get(row.uprn);
    if (!current || row.occurredAt > current.occurredAt || (row.occurredAt === current.occurredAt && row.assignmentId > current.assignmentId)) {
      worked.set(row.uprn, { ...row, group: outcomeGroup(row.outcome) });
    }
  }
  return { worked, painted: paintedOf(worked, filters.outcome) };
}

export type CoverageFigures = {
  worked: number;
  contacts: number;
  leads: number;
  /** Doors in scope with no passing knock. */
  notKnocked: number;
  /** The outcome filter's count, when one is set. */
  matched: number | null;
};

export function coverageFigures(
  doorsInScope: number[],
  resolved: { worked: Map<number, PaintedDoor>; painted: Map<number, PaintedDoor> },
  filters: CoverageFilters,
): CoverageFigures {
  let worked = 0;
  let contacts = 0;
  let leads = 0;
  for (const uprn of doorsInScope) {
    const door = resolved.worked.get(uprn);
    if (!door) continue;
    worked += 1;
    if (door.group === "contact") contacts += 1;
    if (door.group === "lead") leads += 1;
  }
  let matched: number | null = null;
  if (filters.outcome) {
    matched = 0;
    for (const uprn of doorsInScope) if (resolved.painted.has(uprn)) matched += 1;
  }
  return { worked, contacts, leads, notKnocked: Math.max(0, doorsInScope.length - worked), matched };
}

/** The matched figure's label: "Contacts, early", "Leads", "Not in, late". */
export function matchedLabel(filters: Pick<CoverageFilters, "outcome" | "slot">): string {
  const base = outcomeChip(filters.outcome);
  const slot = slotLabel(filters.slot);
  return slot ? `${base}, ${slot.toLowerCase()}` : base;
}

/**
 * Frame 38's line under the prop name, when one visit on one day is shown:
 * "Visit 2 · Thu 1 Oct · Tom and Ada · 16:10–19:35".
 */
export function scopeLine(
  filters: CoverageFilters,
  painted: Map<number, PaintedDoor>,
  names: Map<string, string>,
  doorsInScope: number[],
): string | null {
  const bits: string[] = [];
  if (filters.visit !== null) bits.push(`Visit ${filters.visit}`);
  if (filters.from && filters.from === filters.to) bits.push(dayDate(filters.from));
  if (bits.length === 0) return null;
  const inScope = new Set(doorsInScope);
  const doors = [...painted.values()].filter((door) => inScope.has(door.uprn));
  if (doors.length > 0) {
    const people = [...new Set(doors.map((door) => names.get(door.canvasserId) ?? "Unnamed"))].sort((a, b) => a.localeCompare(b, "en-GB"));
    bits.push(joinNames(people));
    if (filters.from && filters.from === filters.to) {
      const times = doors.map((door) => door.occurredAt).sort();
      bits.push(`${londonTime(times[0]!)}–${londonTime(times[times.length - 1]!)}`);
    }
  }
  return bits.join(" · ");
}

// ---- the door popup ---------------------------------------------------------

const OUTCOME_WORDS: Record<string, string> = {
  answered: "Contact",
  lead: "Lead",
  no_opportunity: "Rented / council",
  no_answer: "Not in",
  refused: "Refused",
  not_interested: "Not interested",
  callback: "Callback",
  do_not_call: "Do not call",
  inaccessible: "Can't reach",
};

export function outcomeWords(outcome: string): string {
  return OUTCOME_WORDS[outcome] ?? "Knocked";
}

/** "Thu 1 Oct, 16:42". */
export function knockWhen(occurredAt: string): string {
  return `${dayDate(londonDay(occurredAt))}, ${londonTime(occurredAt)}`;
}

/** The popup's second line: "Visit 2 · Whitechurch Lane - Hartcliffe". */
export function doorMeta(visitNumber: number | null, propName: string): string {
  return visitNumber === null ? propName : `Visit ${visitNumber} · ${propName}`;
}
