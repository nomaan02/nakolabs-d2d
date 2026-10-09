/**
 * UI-10 F5a (owner A9, A34; frame 20; owner 2026-10-09: a full canvasser
 * profile). Team: each canvasser's numbers for a period, and the profile
 * page behind each card.
 *
 * Pure: no React, no network. Knock rows are `v_latest_knock` rows (latest
 * outcome per door per visit), so a correction never counts twice; a door
 * belongs to whoever logged its latest outcome. Days are London days.
 * Contacts are bookable answers only (`answered`, owner 2026-09-28); a lead
 * is counted as a lead, never as a contact. Per-canvasser numbers are admin
 * only (invariant 2): nothing here is imported by /field. Checked by
 * `npm run verify:ui10`.
 */
import { NO_OUTCOMES, londonDay, outcomeKey, type CalendarKnock, type OutcomeCounts } from "@/lib/admin/calendar";
import { addDays } from "@/lib/admin/props";
import { isAnsweredOutcome } from "@/lib/admin/answered";

// ---- Periods (A34) ----------------------------------------------------------

export type TeamPeriod = "week" | "4w" | "all";

export const TEAM_PERIODS: ReadonlyArray<{ value: TeamPeriod; label: string }> = [
  { value: "week", label: "This week" },
  { value: "4w", label: "Last 4 weeks" },
  { value: "all", label: "All time" },
];

/** A34: This week is the default. Anything unknown reads as the default. */
export function parseTeamPeriod(value: string | null | undefined): TeamPeriod {
  return value === "4w" || value === "all" ? value : "week";
}

/** London dates, both ends included. `from` is null for all time. */
export type PeriodWindow = { from: string | null; to: string };

/** 0 = Monday … 6 = Sunday, for a London date. */
function weekdayIndex(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return (day + 6) % 7;
}

/** This week runs Monday to Sunday; Last 4 weeks is the 28 days up to today. */
export function periodWindow(period: TeamPeriod, today: string): PeriodWindow {
  if (period === "all") return { from: null, to: today };
  if (period === "4w") return { from: addDays(today, -27), to: today };
  const monday = addDays(today, -weekdayIndex(today));
  return { from: monday, to: addDays(monday, 6) };
}

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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

function parts(date: string): { day: number; month: number; year: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { day: day ?? 1, month: (month ?? 1) - 1, year: year ?? 1970 };
}

function shortMonth(month: number): string {
  return MONTHS[month]!.slice(0, 3);
}

/** Frame 20 subtitle: "Mon 5 – Sun 11 October", "14 Sep – 11 Oct", "All time". */
export function periodLine(period: TeamPeriod, today: string): string {
  const window = periodWindow(period, today);
  if (window.from === null) return "All time";
  const a = parts(window.from);
  const b = parts(window.to);
  if (period === "week") {
    const from = `${SHORT_DAYS[weekdayIndex(window.from)]} ${a.day}`;
    const to = `${SHORT_DAYS[weekdayIndex(window.to)]} ${b.day}`;
    return a.month === b.month ? `${from} – ${to} ${MONTHS[b.month]}` : `${from} ${shortMonth(a.month)} – ${to} ${shortMonth(b.month)}`;
  }
  return `${a.day} ${shortMonth(a.month)} – ${b.day} ${shortMonth(b.month)}`;
}

/** The lower-case phrase for a sentence: "this week", "in the last 4 weeks", "in total". */
export function periodPhrase(period: TeamPeriod): string {
  if (period === "week") return "this week";
  if (period === "4w") return "in the last 4 weeks";
  return "in total";
}

/** True when an instant falls on a London day inside the window. */
export function inWindow(iso: string, window: PeriodWindow): boolean {
  const day = londonDay(iso);
  return (window.from === null || day >= window.from) && day <= window.to;
}

/** The UTC instants a query needs: a day wider each side, bucketed in code. */
export function queryBounds(window: PeriodWindow): { fromAt: string | null; toAt: string } {
  return {
    fromAt: window.from === null ? null : `${addDays(window.from, -1)}T00:00:00Z`,
    toAt: `${addDays(window.to, 2)}T00:00:00Z`,
  };
}

// ---- Numbers -------------------------------------------------------------------

/** One lead: who logged it, when its knock happened, and the office's status (read-only). */
export type TeamLead = {
  id: string;
  canvasserId: string;
  occurredAt: string;
  status: string;
  uprn: number;
  assignmentId: string;
};

export type PersonStats = {
  doors: number;
  /** Bookable answers only (`answered`). */
  contacts: number;
  leads: number;
  /** The broad rule (`outcome not in ('no_answer','inaccessible')`), shown second (A8). */
  answered: number;
  /** London days with at least one door. */
  days: number;
  outcomes: OutcomeCounts;
  /** Leads the office has settled (anything but awaiting or re-app). */
  settled: number;
  sales: number;
};

export const NO_STATS: PersonStats = {
  doors: 0,
  contacts: 0,
  leads: 0,
  answered: 0,
  days: 0,
  outcomes: NO_OUTCOMES,
  settled: 0,
  sales: 0,
};

/** Still with the office: not settled yet. */
export function isOpenLead(status: string): boolean {
  return status === "pending" || status === "re_app";
}

/** Each canvasser's numbers inside the window. */
export function personStats(knocks: CalendarKnock[], leads: TeamLead[], window: PeriodWindow): Map<string, PersonStats> {
  const out = new Map<string, PersonStats>();
  const days = new Map<string, Set<string>>();
  const get = (id: string): PersonStats => {
    let stats = out.get(id);
    if (!stats) {
      stats = { ...NO_STATS, outcomes: { ...NO_OUTCOMES } };
      out.set(id, stats);
    }
    return stats;
  };
  for (const knock of knocks) {
    if (!inWindow(knock.occurredAt, window)) continue;
    const stats = get(knock.canvasserId);
    stats.doors += 1;
    const key = outcomeKey(knock.outcome);
    stats.outcomes[key] += 1;
    if (key === "contacts") stats.contacts += 1;
    if (key === "leads") stats.leads += 1;
    if (isAnsweredOutcome(knock.outcome)) stats.answered += 1;
    const seen = days.get(knock.canvasserId) ?? new Set<string>();
    seen.add(londonDay(knock.occurredAt));
    days.set(knock.canvasserId, seen);
  }
  for (const lead of leads) {
    if (!inWindow(lead.occurredAt, window)) continue;
    const stats = get(lead.canvasserId);
    if (!isOpenLead(lead.status)) stats.settled += 1;
    if (lead.status === "sale") stats.sales += 1;
  }
  for (const [id, seen] of days) get(id).days = seen.size;
  return out;
}

/** A share, or null when there is nothing to divide by. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** "21%", or "–" when there is nothing to divide by. */
export function percentText(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)}%`;
}

/**
 * Contact → lead: leads out of every bookable answer. A lead was a contact
 * before it was booked, and contacts as shown exclude leads, so the base is
 * contacts + leads (never above 100%).
 */
export function contactToLead(stats: Pick<PersonStats, "contacts" | "leads">): number | null {
  return rate(stats.leads, stats.contacts + stats.leads);
}

// ---- The Team list (frame 20) --------------------------------------------------

/** `canvasser` is false for the admin and office accounts (they show only once they knock). */
export type TeamPerson = { id: string; name: string; active: boolean; canvasser: boolean };

export type TeamRow = { person: TeamPerson; stats: PersonStats };

/** Every active canvasser, plus anyone else who knocked in the period. */
export function teamRows(people: TeamPerson[], stats: Map<string, PersonStats>): TeamRow[] {
  const rows: TeamRow[] = [];
  for (const person of people) {
    const mine = stats.get(person.id);
    const listed = (person.canvasser && person.active) || (mine !== undefined && mine.doors > 0);
    if (listed) rows.push({ person, stats: mine ?? NO_STATS });
  }
  return rows;
}

export type TeamSort = "conversion" | "leads" | "contacts" | "doors" | "days" | "name";

export const TEAM_SORTS: ReadonlyArray<{ value: TeamSort; label: string }> = [
  { value: "conversion", label: "Contact → lead" },
  { value: "leads", label: "Leads" },
  { value: "contacts", label: "Contacts" },
  { value: "doors", label: "Doors" },
  { value: "days", label: "Days" },
  { value: "name", label: "Name" },
];

export function parseTeamSort(value: string | null | undefined): TeamSort {
  return TEAM_SORTS.some((option) => option.value === value) ? (value as TeamSort) : "conversion";
}

function sortValue(row: TeamRow, sort: Exclude<TeamSort, "name">): number | null {
  switch (sort) {
    case "conversion":
      return contactToLead(row.stats);
    case "leads":
      return row.stats.leads;
    case "contacts":
      return row.stats.contacts;
    case "doors":
      return row.stats.doors;
    case "days":
      return row.stats.days;
  }
}

/** Highest first; no figure (nobody to divide by) goes last; ties by name. */
export function sortTeam(rows: TeamRow[], sort: TeamSort): TeamRow[] {
  const byName = (a: TeamRow, b: TeamRow) => a.person.name.localeCompare(b.person.name, "en-GB");
  if (sort === "name") return [...rows].sort(byName);
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort);
    const y = sortValue(b, sort);
    if (x === null && y === null) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || byName(a, b);
  });
}

export function peopleCount(n: number): string {
  return n === 1 ? "1 canvasser" : `${n.toLocaleString("en-GB")} canvassers`;
}

export function daysLabel(n: number): string {
  if (n === 0) return "No days";
  return n === 1 ? "1 day" : `${n.toLocaleString("en-GB")} days`;
}

export function teamHref(period: TeamPeriod, sort: TeamSort = "conversion"): string {
  const params = new URLSearchParams();
  if (period !== "week") params.set("period", period);
  if (sort !== "conversion") params.set("sort", sort);
  const query = params.toString();
  return query ? `/admin/team?${query}` : "/admin/team";
}

export function profileHref(id: string, period: TeamPeriod): string {
  const base = `/admin/team/${encodeURIComponent(id)}`;
  return period === "week" ? base : `${base}?period=${period}`;
}

// ---- The canvasser profile -----------------------------------------------------

export type FunnelStep = { key: "contact" | "lead" | "sale"; label: string; rate: number | null; detail: string };

function n(value: number): string {
  return value.toLocaleString("en-GB");
}

function count(value: number, one: string, many: string): string {
  return `${n(value)} ${value === 1 ? one : many}`;
}

/**
 * Doors → contacts → leads → sales, as three conversions. Here a lead also
 * counts as a contact (it was one before it was booked); a sale is counted
 * out of the leads the office has settled.
 */
export function funnel(stats: PersonStats): FunnelStep[] {
  const bookable = stats.contacts + stats.leads;
  return [
    {
      key: "contact",
      label: "Door → contact",
      rate: rate(bookable, stats.doors),
      detail: stats.doors === 0 ? "No doors" : `${n(bookable)} of ${count(stats.doors, "door", "doors")}`,
    },
    {
      key: "lead",
      label: "Contact → lead",
      rate: rate(stats.leads, bookable),
      detail: bookable === 0 ? "No contacts" : `${n(stats.leads)} of ${count(bookable, "contact", "contacts")}`,
    },
    {
      key: "sale",
      label: "Lead → sale",
      rate: rate(stats.sales, stats.settled),
      detail: stats.settled === 0 ? "No leads settled yet" : `${n(stats.sales)} of ${count(stats.settled, "settled lead", "settled leads")}`,
    },
  ];
}

export type DayRow = { date: string; props: string[]; doors: number; contacts: number; leads: number };

/** One row per London day the canvasser knocked, newest first. */
export function recentDays(knocks: CalendarKnock[], propOf: ReadonlyMap<string, string>, window: PeriodWindow, limit = 14): DayRow[] {
  const days = new Map<string, DayRow & { propSet: Set<string> }>();
  for (const knock of knocks) {
    if (!inWindow(knock.occurredAt, window)) continue;
    const date = londonDay(knock.occurredAt);
    let row = days.get(date);
    if (!row) {
      row = { date, props: [], doors: 0, contacts: 0, leads: 0, propSet: new Set() };
      days.set(date, row);
    }
    row.doors += 1;
    const key = outcomeKey(knock.outcome);
    if (key === "contacts") row.contacts += 1;
    if (key === "leads") row.leads += 1;
    row.propSet.add(propOf.get(knock.assignmentId) ?? "Prop");
  }
  return [...days.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map(({ propSet, ...row }) => ({ ...row, props: [...propSet].sort((a, b) => a.localeCompare(b, "en-GB")) }));
}

/** The latest doors in the window, newest first. */
export function recentDoors(knocks: CalendarKnock[], window: PeriodWindow, limit = 20): CalendarKnock[] {
  return knocks
    .filter((knock) => inWindow(knock.occurredAt, window))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit);
}

/** The latest leads in the window, newest first. */
export function recentLeads(leads: TeamLead[], window: PeriodWindow, limit = 10): TeamLead[] {
  return leads
    .filter((lead) => inWindow(lead.occurredAt, window))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit);
}

/** "2 props" style line for a day row: one prop by name, more by count. */
export function propsLine(props: string[]): string {
  if (props.length === 0) return "";
  if (props.length === 1) return props[0]!;
  return `${props[0]} and ${props.length - 1} more`;
}

/** Day row second line: "4 contacts · 1 lead · Northville" (the prop last, so it is what truncates). */
export function dayLine(row: Pick<DayRow, "contacts" | "leads" | "props">): string {
  return [count(row.contacts, "contact", "contacts"), count(row.leads, "lead", "leads"), propsLine(row.props)].filter(Boolean).join(" · ");
}

/** "48 doors". */
export function doorsCount(value: number): string {
  return count(value, "door", "doors");
}

/** Profile subtitle: "Canvasser · 3 days this week" or "Inactive · no days in the last 4 weeks". */
export function profileLine(person: TeamPerson, stats: PersonStats, period: TeamPeriod): string {
  const who = !person.active ? "Inactive" : person.canvasser ? "Canvasser" : "Admin";
  const days = stats.days === 0 ? `no days ${periodPhrase(period)}` : `${daysLabel(stats.days)} ${periodPhrase(period)}`;
  return `${who} · ${days}`;
}
