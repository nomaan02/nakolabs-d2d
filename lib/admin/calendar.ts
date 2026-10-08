/**
 * UI-10 F4a (owner A38-A46; frames 34-37). Calendar: the month grid, what
 * each day shows, and the day overlay's visit cards.
 *
 * Pure: no React, no network. A visit sits on the London day its knocks
 * happened (A45), one entry per day when its knocks span two days. A visit
 * with no knocks sits on its allocated date: planned (today or later), not
 * worked (past and still open) or ended with nothing logged; one knocked
 * only on days outside the grid is left to the month it was knocked in
 * (`worked` from `v_prop_completion` says so). Knock rows are
 * `v_latest_knock` rows (latest outcome per door per visit), so corrections
 * never count twice. Checked by `npm run verify:ui10`.
 */
import { addDays, dayDate, joinNames, slotLabel } from "@/lib/admin/props";
import { longDate, type TeamMember } from "@/lib/admin/today";
import type { Slot } from "@/lib/geo/rotation";

export type CalendarKnock = {
  assignmentId: string;
  uprn: number;
  outcome: string;
  canvasserId: string;
  occurredAt: string;
};

export type CalendarVisit = {
  id: string;
  propId: string;
  propName: string;
  visitNumber: number;
  workDate: string;
  slot: Slot | null;
  startedAt: string | null;
  closedAt: string | null;
  /** Knockable doors still not worked on the whole visit (`v_prop_completion`). */
  remaining: number | null;
  /** Doors worked on the whole visit, any day (`v_prop_completion`); null when unknown. */
  worked: number | null;
  team: TeamMember[];
};

/** One lead row: its knock's visit and time, and the office's status (read-only). */
export type CalendarLead = { assignmentId: string; occurredAt: string; status: string };

export type OutcomeCounts = {
  contacts: number;
  leads: number;
  rented: number;
  notIn: number;
  refused: number;
  doNotCall: number;
  callback: number;
  cantReach: number;
};

export const NO_OUTCOMES: OutcomeCounts = {
  contacts: 0,
  leads: 0,
  rented: 0,
  notIn: 0,
  refused: 0,
  doNotCall: 0,
  callback: 0,
  cantReach: 0,
};

/** Every knock outcome, grouped the way the overlay lists them (frame 35). */
export function outcomeKey(outcome: string): keyof OutcomeCounts {
  switch (outcome) {
    case "answered":
      return "contacts";
    case "lead":
      return "leads";
    case "no_opportunity":
      return "rented";
    case "no_answer":
      return "notIn";
    case "do_not_call":
      return "doNotCall";
    case "callback":
      return "callback";
    case "inaccessible":
      return "cantReach";
    default:
      return "refused";
  }
}

export type EntryKind = "worked" | "planned" | "not-worked" | "ended";

export type DayEntry = {
  visit: CalendarVisit;
  date: string;
  kind: EntryKind;
  /** Doors whose latest knock on this visit fell on this day. */
  worked: number;
  outcomes: OutcomeCounts;
  firstAt: string | null;
  lastAt: string | null;
  /** First names of who knocked that day (or the team, when nobody did). */
  people: string[];
  /** Office status → count, for leads logged that day on this visit. */
  leadResults: Record<string, number>;
};

const MONTH = /^(\d{4})-(\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const LONDON_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** The London calendar day of an instant. */
export function londonDay(iso: string): string {
  return LONDON_DAY.format(new Date(iso));
}

/** "16:10" in London. */
export function londonTime(iso: string): string {
  return LONDON_TIME.format(new Date(iso));
}

/** "2026-10" from a date. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** `?month=` if it is a real month, else today's month. */
export function parseMonth(value: string | null | undefined, today: string): string {
  const match = MONTH.exec(value ?? "");
  if (!match) return monthOf(today);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? (value as string) : monthOf(today);
}

/** `?day=` if it is a real date, else null. */
export function parseDay(value: string | null | undefined): string | null {
  if (!value || !DATE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.toISOString().slice(0, 10) === value ? value : null;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

/** "October 2026". */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

export type GridDay = { date: string; inMonth: boolean };

/** Whole weeks, Monday first, covering the month (5 or 6 rows). */
export function monthGrid(month: string): GridDay[][] {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, 1)).getUTCDay();
  const start = addDays(first, -((weekday + 6) % 7));
  const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  const weeks: GridDay[][] = [];
  let cursor = start;
  while (cursor <= last) {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({ date: cursor, inMonth: monthOf(cursor) === month });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** First and last date on the grid (the loader reads knocks for this span). */
export function gridSpan(month: string): { from: string; to: string } {
  const weeks = monthGrid(month);
  return { from: weeks[0]![0]!.date, to: weeks[weeks.length - 1]![6]!.date };
}

const KIND_ORDER: Record<EntryKind, number> = { worked: 0, "not-worked": 1, planned: 2, ended: 3 };

/**
 * Every visit entry, keyed by day. `today` decides planned vs not worked.
 * Lead results come from `leads` (the office's status), counted on the day
 * the lead's knock happened.
 */
export function buildCalendar({
  knocks,
  visits,
  leads,
  names,
  today,
}: {
  knocks: CalendarKnock[];
  visits: CalendarVisit[];
  leads: CalendarLead[];
  names: Map<string, string>;
  today: string;
}): Map<string, DayEntry[]> {
  const byVisit = new Map(visits.map((visit) => [visit.id, visit] as const));
  const entries = new Map<string, DayEntry>();
  const people = new Map<string, Set<string>>();
  const key = (visitId: string, date: string) => `${visitId}|${date}`;

  for (const knock of knocks) {
    const visit = byVisit.get(knock.assignmentId);
    if (!visit) continue;
    const date = londonDay(knock.occurredAt);
    const id = key(visit.id, date);
    let entry = entries.get(id);
    if (!entry) {
      entry = { visit, date, kind: "worked", worked: 0, outcomes: { ...NO_OUTCOMES }, firstAt: null, lastAt: null, people: [], leadResults: {} };
      entries.set(id, entry);
      people.set(id, new Set());
    }
    entry.worked += 1;
    entry.outcomes[outcomeKey(knock.outcome)] += 1;
    if (!entry.firstAt || knock.occurredAt < entry.firstAt) entry.firstAt = knock.occurredAt;
    if (!entry.lastAt || knock.occurredAt > entry.lastAt) entry.lastAt = knock.occurredAt;
    people.get(id)!.add(knock.canvasserId);
  }

  for (const [id, entry] of entries) {
    entry.people = [...people.get(id)!].map((canvasserId) => names.get(canvasserId) ?? "Unnamed").sort((a, b) => a.localeCompare(b, "en-GB"));
  }

  const knocked = new Set([...entries.values()].map((entry) => entry.visit.id));
  for (const visit of visits) {
    if (knocked.has(visit.id) || (visit.worked ?? 0) > 0) continue;
    const kind: EntryKind = visit.closedAt ? "ended" : visit.workDate >= today ? "planned" : "not-worked";
    entries.set(key(visit.id, visit.workDate), {
      visit,
      date: visit.workDate,
      kind,
      worked: 0,
      outcomes: { ...NO_OUTCOMES },
      firstAt: null,
      lastAt: null,
      people: visit.team.filter((member) => !member.left).map((member) => member.name),
      leadResults: {},
    });
  }

  for (const lead of leads) {
    const entry = entries.get(key(lead.assignmentId, londonDay(lead.occurredAt)));
    if (!entry) continue;
    entry.leadResults[lead.status] = (entry.leadResults[lead.status] ?? 0) + 1;
  }

  const days = new Map<string, DayEntry[]>();
  for (const entry of entries.values()) {
    const list = days.get(entry.date) ?? [];
    list.push(entry);
    days.set(entry.date, list);
  }
  for (const list of days.values()) {
    list.sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (a.firstAt ?? "").localeCompare(b.firstAt ?? "") ||
        a.visit.propName.localeCompare(b.visit.propName, "en-GB"),
    );
  }
  return days;
}

/** Bars drawn in a grid cell: solid = worked, dashed = planned or not worked. Three at most. */
export const MAX_BARS = 3;

export type DayCell = {
  bars: Array<{ id: string; solid: boolean }>;
  more: number;
  doors: number;
};

export function dayCell(entries: DayEntry[] | undefined): DayCell {
  const list = entries ?? [];
  const shown = list.filter((entry) => entry.kind !== "ended");
  return {
    bars: shown.slice(0, MAX_BARS).map((entry) => ({ id: entry.visit.id, solid: entry.kind === "worked" })),
    more: Math.max(0, shown.length - MAX_BARS),
    doors: list.reduce((sum, entry) => sum + entry.worked, 0),
  };
}

export type MonthTotals = { daysWorked: number; doors: number; leads: number };

/** The figures above the grid: days in this month with any knock, doors and leads logged. */
export function monthTotals(days: Map<string, DayEntry[]>, month: string): MonthTotals {
  let daysWorked = 0;
  let doors = 0;
  let leads = 0;
  for (const [date, list] of days) {
    if (monthOf(date) !== month) continue;
    const worked = list.filter((entry) => entry.kind === "worked");
    if (worked.length > 0) daysWorked += 1;
    for (const entry of worked) {
      doors += entry.worked;
      leads += entry.outcomes.leads;
    }
  }
  return { daysWorked, doors, leads };
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

/** "Thursday 1 October". */
export function dayTitle(date: string): string {
  return longDate(date);
}

/**
 * Under the overlay title: "2 worked · 1 not worked · 402 doors · 5 leads",
 * or "1 visit · 64 doors · 1 lead" for a single worked visit.
 */
export function daySummary(entries: DayEntry[]): string {
  const worked = entries.filter((entry) => entry.kind === "worked");
  const doors = worked.reduce((sum, entry) => sum + entry.worked, 0);
  const leads = worked.reduce((sum, entry) => sum + entry.outcomes.leads, 0);
  const figures = [plural(doors, "door", "doors"), plural(leads, "lead", "leads")];
  if (entries.length === 0) return "Nothing on this day";
  if (entries.length === 1 && worked.length === 1) return [plural(1, "visit", "visits"), ...figures].join(" · ");
  const bits: string[] = [];
  if (worked.length > 0) bits.push(`${worked.length} worked`);
  const notWorked = entries.filter((entry) => entry.kind === "not-worked").length;
  const planned = entries.filter((entry) => entry.kind === "planned").length;
  const ended = entries.filter((entry) => entry.kind === "ended").length;
  if (notWorked > 0) bits.push(`${notWorked} not worked`);
  if (planned > 0) bits.push(`${planned} planned`);
  if (ended > 0) bits.push(`${ended} ended empty`);
  if (worked.length > 0) bits.push(...figures);
  return bits.join(" · ");
}

/** "Visit 2 · Mid slot". */
export function entryMeta(visit: Pick<CalendarVisit, "visitNumber" | "slot">): string {
  const slot = slotLabel(visit.slot);
  return slot ? `Visit ${visit.visitNumber} · ${slot} slot` : `Visit ${visit.visitNumber}`;
}

/** "Tom and Ada · 16:10–19:35" (a one-visit day adds "on the doors"). */
export function peopleLine(entry: Pick<DayEntry, "people" | "firstAt" | "lastAt">, alone = false): string {
  const who = joinNames(entry.people);
  if (!entry.firstAt || !entry.lastAt) return who;
  const span = `${londonTime(entry.firstAt)}–${londonTime(entry.lastAt)}`;
  return `${who} · ${span}${alone ? " on the doors" : ""}`;
}

/** A45: the card notes when the knocks fell on another day than the one allocated. */
export function allocatedNote(entry: Pick<DayEntry, "visit" | "date" | "kind">): string | null {
  if (entry.kind !== "worked" || entry.visit.workDate === entry.date) return null;
  return `Allocated for ${dayDate(entry.visit.workDate)}`;
}

/** "18 contacts · 20 rented · 150 not in · 60 other". */
export function outcomesLine(outcomes: OutcomeCounts): string {
  const other = outcomes.refused + outcomes.doNotCall + outcomes.callback + outcomes.cantReach;
  const bits = [
    outcomes.contacts > 0 ? plural(outcomes.contacts, "contact", "contacts") : null,
    outcomes.leads > 0 ? plural(outcomes.leads, "lead", "leads") : null,
    outcomes.rented > 0 ? `${outcomes.rented.toLocaleString("en-GB")} rented` : null,
    outcomes.notIn > 0 ? `${outcomes.notIn.toLocaleString("en-GB")} not in` : null,
    other > 0 ? `${other.toLocaleString("en-GB")} other` : null,
  ].filter((bit): bit is string => bit !== null);
  return bits.length > 0 ? bits.join(" · ") : "No knocks";
}

export const OUTCOME_ROWS: ReadonlyArray<{ key: keyof OutcomeCounts; label: string }> = [
  { key: "contacts", label: "Contacts" },
  { key: "leads", label: "Leads" },
  { key: "rented", label: "Rented / council" },
  { key: "notIn", label: "Not in" },
  { key: "refused", label: "Refused" },
  { key: "doNotCall", label: "Do not call" },
  { key: "callback", label: "Callback" },
  { key: "cantReach", label: "Can't reach" },
];

/** The office's lead statuses in plain words (admin reads, never sets them). */
const LEAD_WORDS: Record<string, { one: string; many: string }> = {
  sale: { one: "sale", many: "sales" },
  pm: { one: "pitched", many: "pitched" },
  pending: { one: "awaiting", many: "awaiting" },
  re_app: { one: "re-app", many: "re-apps" },
  blowout: { one: "blowout", many: "blowouts" },
  utc: { one: "unable to contact", many: "unable to contact" },
  btc: { one: "back to canvasser", many: "back to canvasser" },
  cancelled: { one: "cancelled", many: "cancelled" },
};

const LEAD_ORDER = ["sale", "pm", "pending", "re_app", "blowout", "utc", "btc", "cancelled"];

/** "3 leads · 1 sale · 1 pitched · 1 awaiting", or "No leads". */
export function leadResultsLine(results: Record<string, number>): string {
  const total = Object.values(results).reduce((sum, n) => sum + n, 0);
  if (total === 0) return "No leads";
  const bits = [plural(total, "lead", "leads")];
  for (const status of LEAD_ORDER) {
    const n = results[status] ?? 0;
    const words = LEAD_WORDS[status];
    if (n > 0 && words) bits.push(`${n.toLocaleString("en-GB")} ${n === 1 ? words.one : words.many}`);
  }
  return bits.join(" · ");
}

/** The expanded Lead results list, office order. */
export function leadResultRows(results: Record<string, number>): Array<{ status: string; label: string; value: number }> {
  return LEAD_ORDER.filter((status) => (results[status] ?? 0) > 0).map((status) => {
    const label = LEAD_WORDS[status]!.one;
    return { status, label: label.charAt(0).toUpperCase() + label.slice(1), value: results[status]! };
  });
}

/**
 * A46, as amended by the owner 2026-10-08: a past visit nobody worked is
 * ended, never deleted (its day has come, so a phone may still hold knocks
 * that have not synced). Planned visits are managed on Today.
 */
export function notWorkedCopy(entry: Pick<DayEntry, "visit" | "kind">): { line: string; canEnd: boolean } {
  const who = joinNames(entry.visit.team.filter((member) => !member.left).map((member) => member.name));
  if (entry.kind === "ended") return { line: "Ended with no knocks logged.", canEnd: false };
  if (entry.kind === "planned") return { line: `Planned for ${who}.`, canEnd: false };
  return { line: `Planned for ${who}. No knocks have synced. Ending it keeps any that arrive late.`, canEnd: true };
}

export function calendarHref(month: string, day: string | null = null): string {
  return day ? `/admin/calendar?month=${month}&day=${day}` : `/admin/calendar?month=${month}`;
}

/** A44: Coverage filtered to that prop, day and visit, with the way back. */
export function openOnMapHref(entry: Pick<DayEntry, "visit" | "date">): string {
  const params = new URLSearchParams({
    prop: entry.visit.propId,
    date: entry.date,
    visit: String(entry.visit.visitNumber),
    via: "calendar",
  });
  return `/admin/coverage?${params.toString()}`;
}

/** Swipe on the grid: this far sideways, and more sideways than down, changes month. */
export const SWIPE_PX = 56;

export function swipeMonth(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
