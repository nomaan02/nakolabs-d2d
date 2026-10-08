/**
 * UI-10 F3a (owner A17, A24-A27, A36; 2026-10-07). Today: the schedule by
 * date, what a visit card says, the past-visits review, and Add visit's
 * prop and team lists.
 *
 * Pure: no React, no network. Dates are London calendar dates (YYYY-MM-DD)
 * and `today` / `now` are always passed in. Checked by `npm run verify:ui10`.
 */
import {
  addDays,
  dayDate,
  joinNames,
  nextVisitNumber,
  shortDate,
  slotLabel,
  sortProps,
  type PropRow,
  type PropState,
} from "@/lib/admin/props";
import type { Slot } from "@/lib/geo/rotation";

/** A team is 1 to 3 canvassers (AGENTS.md vocabulary; `allocate_prop` agrees). */
export const MAX_TEAM = 3;

export type TeamMember = {
  id: string;
  /** First name only. */
  name: string;
  /** Left the visit (removed). Kept for history, never shown as on the team. */
  left: boolean;
};

export type TodayVisit = {
  id: string;
  propId: string;
  propName: string;
  visitNumber: number;
  workDate: string;
  slot: Slot | null;
  startedAt: string | null;
  closedAt: string | null;
  routeVariantKey: string | null;
  routeLengthM: number | null;
  team: TeamMember[];
};

/** Per-visit figures. Contacts are bookable answers only (`outcome = 'answered'`). */
export type VisitFigures = {
  worked: number;
  remaining: number;
  contacts: number;
  leads: number;
  rented: number;
  notIn: number;
  /** The broad rule (`outcome not in ('no_answer','inaccessible')`), shown second (A8). */
  answered: number;
  /** Every knock row on the visit, corrections included. Zero = the visit can be deleted. */
  knocks: number;
  lastKnockAt: string | null;
};

export const NO_FIGURES: VisitFigures = {
  worked: 0,
  remaining: 0,
  contacts: 0,
  leads: 0,
  rented: 0,
  notIn: 0,
  answered: 0,
  knocks: 0,
  lastKnockAt: null,
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

function parts(iso: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate(), weekday: date.getUTCDay() };
}

/** "Wednesday 7 October" under the Today title. */
export function longDate(iso: string): string {
  const p = parts(iso);
  return `${WEEKDAYS[p.weekday]} ${p.d} ${MONTHS[p.m]}`;
}

/** The big numeral and weekday in the schedule's left column. */
export function dayNumeral(iso: string): { day: string; weekday: string } {
  const p = parts(iso);
  return { day: String(p.d), weekday: SHORT_WEEKDAYS[p.weekday]! };
}

/** "Today", "Tomorrow", or "Thu 9 Oct". */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return "Today";
  if (iso === addDays(today, 1)) return "Tomorrow";
  return dayDate(iso);
}

const SLOT_ORDER: Record<string, number> = { early: 0, mid: 1, late: 2 };

function byOpenThenSlot(a: TodayVisit, b: TodayVisit): number {
  const open = Number(a.closedAt !== null) - Number(b.closedAt !== null);
  if (open !== 0) return open;
  const slot = (SLOT_ORDER[a.slot ?? ""] ?? 3) - (SLOT_ORDER[b.slot ?? ""] ?? 3);
  if (slot !== 0) return slot;
  return a.propName.localeCompare(b.propName, "en-GB");
}

export type ScheduleDay = { date: string; label: string; visits: TodayVisit[] };

/**
 * A17: today first (open visits, then the ones already done today), then
 * every later date that has a visit. Today and tomorrow always show, even
 * empty, so "Add visit" is always one tap away. Past dates never show here:
 * an open past visit is "Needs attention" (A27); history is Calendar (A38).
 */
export function scheduleDays(visits: TodayVisit[], today: string): ScheduleDay[] {
  const tomorrow = addDays(today, 1);
  const byDate = new Map<string, TodayVisit[]>([
    [today, []],
    [tomorrow, []],
  ]);
  for (const visit of visits) {
    if (visit.workDate < today) continue;
    if (visit.workDate > today && visit.closedAt) continue;
    const list = byDate.get(visit.workDate) ?? [];
    list.push(visit);
    byDate.set(visit.workDate, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, label: dayLabel(date, today), visits: list.slice().sort(byOpenThenSlot) }));
}

/** The empty line inside a day with no visits (frames 01, 25). */
export function emptyDayLine(date: string, today: string): string {
  return date === today ? "No one is out today" : "Nothing planned yet";
}

export function activeTeam(visit: Pick<TodayVisit, "team">): TeamMember[] {
  return visit.team.filter((member) => !member.left);
}

export function teamLine(visit: Pick<TodayVisit, "team">): string {
  return joinNames(activeTeam(visit).map((member) => member.name));
}

export type CardStatus = "live" | "out" | "not-started" | "done" | null;

/**
 * The pill on a visit card. Live = someone on it is sharing a current
 * position (A36; the pill opens the live map). Out = started, nobody
 * sharing. A visit on a later date has no pill.
 */
export function cardStatus(visit: Pick<TodayVisit, "workDate" | "startedAt" | "closedAt">, today: string, sharing: boolean): CardStatus {
  if (visit.closedAt) return visit.workDate === today ? "done" : null;
  if (visit.workDate > today) return null;
  if (sharing) return "live";
  return visit.startedAt ? "out" : "not-started";
}

/** "30 s ago" / "6 min ago" / "2 h ago" / "3 days ago". */
export function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${Math.max(10, Math.round(seconds / 10) * 10)} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Frame 01 card subline: "Visit 3 · Early · 6 min ago". */
export function cardMeta(visit: Pick<TodayVisit, "visitNumber" | "slot">, figures: Pick<VisitFigures, "lastKnockAt"> | null, now: number): string {
  const bits = [`Visit ${visit.visitNumber}`];
  const slot = slotLabel(visit.slot);
  if (slot) bits.push(slot);
  if (figures?.lastKnockAt) bits.push(ago(figures.lastKnockAt, now));
  return bits.join(" · ");
}

/** Frame 14 subline: "Visit 3 · today · Early slot". */
export function sheetMeta(visit: Pick<TodayVisit, "visitNumber" | "slot" | "workDate">, today: string): string {
  const when = visit.workDate === today ? "today" : dayDate(visit.workDate);
  const slot = slotLabel(visit.slot);
  return [`Visit ${visit.visitNumber}`, when, slot ? `${slot} slot` : null].filter(Boolean).join(" · ");
}

export type DayTotals = { doors: number; contacts: number; leads: number; answered: number };

/** The numbers card on Today: today's visits only. */
export function dayTotals(visits: TodayVisit[], figures: Map<string, VisitFigures>, today: string): DayTotals {
  const totals: DayTotals = { doors: 0, contacts: 0, leads: 0, answered: 0 };
  for (const visit of visits) {
    if (visit.workDate !== today) continue;
    const f = figures.get(visit.id);
    if (!f) continue;
    totals.doors += f.worked;
    totals.contacts += f.contacts;
    totals.leads += f.leads;
    totals.answered += f.answered;
  }
  return totals;
}

// ---- Needs attention and the past-visits review (A27) ----------------------

/** Open visits dated before today, newest date first. */
export function staleVisits(visits: TodayVisit[], today: string): TodayVisit[] {
  return visits
    .filter((visit) => !visit.closedAt && visit.workDate < today)
    .sort((a, b) => b.workDate.localeCompare(a.workDate) || a.propName.localeCompare(b.propName, "en-GB"));
}

/** Frame 01 warning row. Null when nothing is stale. */
export function attentionLine(stale: TodayVisit[], figures: Map<string, VisitFigures>): { title: string; detail: string } | null {
  if (stale.length === 0) return null;
  const empty = stale.filter((visit) => (figures.get(visit.id)?.knocks ?? 0) === 0).length;
  const title = stale.length === 1 ? "1 past visit still open" : `${stale.length} past visits still open`;
  let detail: string;
  if (empty === 0) detail = stale.length === 1 ? "Review and end it." : "Review and end them.";
  else if (empty === stale.length) detail = stale.length === 1 ? "It has no knocks. Review and delete it." : "None have knocks. Review and delete them.";
  else detail = `${empty} ${empty === 1 ? "has" : "have"} no knocks. Review and end them.`;
  return { title, detail };
}

export type StaleGroup = { date: string; label: string; visits: TodayVisit[] };

/** Frame 18: the review list, grouped by allocated date ("Mon 5 October"). */
export function staleGroups(stale: TodayVisit[]): StaleGroup[] {
  const groups: StaleGroup[] = [];
  for (const visit of stale) {
    const last = groups[groups.length - 1];
    if (last && last.date === visit.workDate) last.visits.push(visit);
    else {
      const p = parts(visit.workDate);
      groups.push({ date: visit.workDate, label: `${SHORT_WEEKDAYS[p.weekday]} ${p.d} ${MONTHS[p.m]}`, visits: [visit] });
    }
  }
  return groups;
}

/**
 * A visit that has started is always ended, never deleted: its phones may
 * still hold knocks that have not synced, and deleting the visit would make
 * them fail. Only a visit that never started and has no knocks is deleted
 * (`assignment_remove`'s own rule then agrees).
 */
export function mustEnd(visit: Pick<TodayVisit, "startedAt">, figures: Pick<VisitFigures, "knocks"> | undefined | null): boolean {
  return visit.startedAt !== null || (figures?.knocks ?? 0) > 0;
}

/** What happens to each ticked visit: end (started or knocked) or delete. */
export function splitReview(
  visits: TodayVisit[],
  selected: ReadonlySet<string>,
  figures: Map<string, VisitFigures>,
): { end: TodayVisit[]; remove: TodayVisit[] } {
  const end: TodayVisit[] = [];
  const remove: TodayVisit[] = [];
  for (const visit of visits) {
    if (!selected.has(visit.id)) continue;
    if (mustEnd(visit, figures.get(visit.id))) end.push(visit);
    else remove.push(visit);
  }
  return { end, remove };
}

function visits(n: number): string {
  return n === 1 ? "1 visit" : `${n.toLocaleString("en-GB")} visits`;
}

/** Frame 18 button: names the result. */
export function reviewButton(end: number, remove: number): string {
  if (end > 0 && remove > 0) return `End ${end} and delete ${remove}`;
  if (end > 0) return `End ${visits(end)}`;
  if (remove > 0) return `Delete ${visits(remove)}`;
  return "Tick the visits to close";
}

/** Frame 19 confirm. */
export function reviewConfirm(end: number, remove: number): { title: string; body: string; confirm: string } {
  if (end > 0 && remove > 0) {
    return {
      title: `End ${visits(end)} and delete ${remove}?`,
      body: `The ${remove} never started, so nothing is lost. The ${end} ended ${end === 1 ? "visit keeps" : "visits keep"} all ${end === 1 ? "its" : "their"} knocks.`,
      confirm: "End and delete",
    };
  }
  if (end > 0) {
    return {
      title: `End ${visits(end)}?`,
      body: `${end === 1 ? "It keeps" : "They keep"} all ${end === 1 ? "its" : "their"} knocks. Ending frees each prop for its next visit.`,
      confirm: end === 1 ? "End visit" : "End visits",
    };
  }
  return {
    title: `Delete ${visits(remove)}?`,
    body: `${remove === 1 ? "It" : "They"} never started, so nothing is lost.`,
    confirm: remove === 1 ? "Delete visit" : "Delete visits",
  };
}

/** Frame 18 row: "Visit 1 · Leon · 214 knocks". */
export function reviewRowMeta(visit: TodayVisit, figures: VisitFigures | undefined): string {
  const knocks = figures?.knocks ?? 0;
  const team = activeTeam(visit).map((member) => member.name);
  const who = team.length > 0 ? joinNames(team) : "No one";
  const what =
    knocks > 0
      ? knocks === 1
        ? "1 knock"
        : `${knocks.toLocaleString("en-GB")} knocks`
      : visit.startedAt
        ? "started, no knocks synced"
        : "no knocks";
  return `Visit ${visit.visitNumber} · ${who} · ${what}`;
}

// ---- One visit: End or Delete (A26, frame 33) ----------------------------

export type RemovalPreviewLike =
  | { kind: "delete" }
  | { kind: "close"; worked: number; total: number; countsForRotation: boolean };

/** Frame 33: a named confirm that says exactly what happens. */
export function endVisitConfirm(
  visit: Pick<TodayVisit, "visitNumber" | "propName" | "team">,
  preview: RemovalPreviewLike,
): { title: string; body: string; confirm: string } {
  const name = `visit ${visit.visitNumber} of ${visit.propName}`;
  if (preview.kind === "delete") {
    return {
      title: `Delete ${name}?`,
      body: "It never started, so nothing is lost. The prop is free to plan again.",
      confirm: "Delete visit",
    };
  }
  const who = activeTeam(visit).map((member) => member.name);
  const left = Math.max(0, preview.total - preview.worked);
  const people = who.length > 0 ? `${joinNames(who)} ${who.length === 1 ? "stops" : "stop"} logging here. ` : "";
  const reach =
    preview.total === 0
      ? ""
      : left === 0
        ? "Every door was reached. "
        : `${left.toLocaleString("en-GB")} ${left === 1 ? "door wasn't" : "doors weren't"} reached. `;
  const rotation = preview.countsForRotation
    ? `It counts as visit ${visit.visitNumber}.`
    : `It is under the visit threshold, so the next visit is still visit ${visit.visitNumber}.`;
  return { title: `End ${name}?`, body: `${people}${reach}${rotation}`, confirm: "End visit" };
}

// ---- Add visit (A24, frames 16-17) ----------------------------------------

/** Add visit opens on tomorrow; a date in the past is never offered. */
export function defaultVisitDate(requested: string | null | undefined, today: string): string {
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested >= today) return requested;
  return addDays(today, 1);
}

/** Frame 17 button: "Allocate Tom and Ada · Wed 7 Oct". */
export function allocateButton(names: string[], date: string): string {
  if (names.length === 0) return "Pick the team";
  return `Allocate ${joinNames(names)} · ${dayDate(date)}`;
}

export type Canvasser = { id: string; name: string };

export type TeamOption = Canvasser & {
  /** Already out on another prop that date: shown, not pickable. */
  busyWith: string | null;
};

/**
 * Frame 17: every active canvasser, alphabetical; anyone already on an open
 * visit that date is greyed with the prop they are on (`allocate_prop`
 * refuses a double booking anyway).
 */
export function teamOptions(
  canvassers: Canvasser[],
  bookings: { canvasserId: string; workDate: string; propName: string }[],
  date: string,
): TeamOption[] {
  const busy = new Map<string, string>();
  for (const booking of bookings) {
    if (booking.workDate === date && !busy.has(booking.canvasserId)) busy.set(booking.canvasserId, booking.propName);
  }
  return canvassers
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
    .map((canvasser) => ({ ...canvasser, busyWith: busy.get(canvasser.id) ?? null }));
}

/** Add person on the visit sheet: active canvassers not on this visit and free that date. */
export function addableCanvassers(
  options: TeamOption[],
  visit: Pick<TodayVisit, "team">,
): TeamOption[] {
  const on = new Set(activeTeam(visit).map((member) => member.id));
  return options.filter((option) => !on.has(option.id) && option.busyWith === null);
}

/** Frame 18 header: "All 21 selected" / "12 of 21 selected". */
export function selectionLine(selected: number, total: number): string {
  if (total > 0 && selected === total) return `All ${total} selected`;
  return `${selected} of ${total} selected`;
}

/** Live map card (frame 15): "9 Small Street" ladder, property-level only. */
export function doorLabelLine(label: { house_number?: string | null; building_name?: string | null; street_name?: string | null } | null): string | null {
  const number = label?.house_number?.trim();
  const building = label?.building_name?.trim();
  const street = label?.street_name?.trim();
  if (number && street) return `${number} ${street}`;
  if (building && street) return `${building}, ${street}`;
  return number || building || street || null;
}

/** Route details on the visit sheet. */
export function routeLine(visit: Pick<TodayVisit, "routeLengthM" | "routeVariantKey">): string {
  if (visit.routeLengthM === null) return "No route yet";
  const km = `${(visit.routeLengthM / 1000).toFixed(1)} km`;
  const which =
    visit.routeVariantKey === "best"
      ? "Route A"
      : visit.routeVariantKey === "best_reversed"
        ? "Route B"
        : visit.routeVariantKey
          ? `Spare ${visit.routeVariantKey.replace("alt_", "")}`
          : null;
  return which ? `${which} · ${km}` : km;
}

export type AddVisitProp = {
  row: PropRow;
  state: PropState;
  doors: number | null;
  /** Already has an open visit on the chosen date. Shown, not pickable. */
  booked: boolean;
};

/** Frame 16 subline: "1,225 doors · visit 3 · last 27 Sep" or "Already booked on 7 Oct". */
export function addVisitLine(item: AddVisitProp, date: string): string {
  if (item.booked) return `Already booked on ${shortDate(date)}`;
  const bits: string[] = [];
  if (item.doors !== null) bits.push(`${item.doors.toLocaleString("en-GB")} doors`);
  bits.push(`visit ${nextVisitNumber(item.row.visits)}`);
  const state = item.state;
  if (state.kind === "due" || state.kind === "resting") bits.push(state.lastDate ? `last ${shortDate(state.lastDate)}` : "not visited yet");
  else if (state.kind === "planned" || state.kind === "today") bits.push(`next ${dayDate(state.visit.workDate)}`);
  return bits.join(" · ");
}

/**
 * Frame 16: live props only, Due first (A24), then the rest; booked-that-date
 * props sink to the bottom of their group. Order inside a group follows the
 * Props list (most recently visited first).
 */
export function addVisitGroups(
  items: { row: PropRow; state: PropState; doors: number | null }[],
  date: string,
): { due: AddVisitProp[]; other: AddVisitProp[] } {
  const live = items.filter((item) => item.state.kind !== "archived");
  const withBooked = sortProps(live).map((item) => ({
    ...item,
    // Any visit on that date, ended ones too: a prop takes one visit per date.
    booked: item.row.visits.some((visit) => visit.workDate === date),
  }));
  const sink = (list: AddVisitProp[]) => [...list.filter((item) => !item.booked), ...list.filter((item) => item.booked)];
  return {
    due: sink(withBooked.filter((item) => item.state.kind === "due")),
    other: sink(withBooked.filter((item) => item.state.kind !== "due")),
  };
}
