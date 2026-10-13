/**
 * CRM-5 C (owner 2026-10-11, P4b). Pure rules for the canvasser's own CRM
 * screens: the call-back list, "my results", the week and the leaderboard.
 * Nothing here fetches or writes; `lib/field/crm-data.ts` does that.
 *
 * AGENTS.md P4b exception: a canvasser sees their OWN CRM leads, the Bristol
 * leaderboard and their call-back list. Contacts (title, surname, phone)
 * are for the call-back list only.
 */

import { londonDate } from "@/lib/field/london-date";
import type { CallResult } from "@/lib/sync/ops";

// ------------------------------------------------------------------ types

export type CrmStatus = "sale" | "pm" | "blowout" | "utc" | "btc" | "re_app" | "confirmed" | "pending" | null;

export type CallbackReason =
  | "utc"
  | "no_outcome"
  | "reapp"
  | "single_sit"
  | "not_convenient"
  | "no_time"
  | "rta"
  | "rearrange"
  | "no_answer";

/** One row of `my_crm_callbacks`. */
export type CallbackLead = {
  crm_id: string;
  status: string | null;
  callback_reason: string | null;
  crm_created_at: string;
  appointment_at: string | null;
  title: string | null;
  surname: string | null;
  phone: string | null;
  alt_phone: string | null;
  uprn: number | null;
  house_number: string | null;
  building_name: string | null;
  street_name: string | null;
  postcode_sector: string | null;
  last_result: string | null;
  last_called_at: string | null;
  call_back_on: string | null;
  /** CRM-6 B: full postcode, the CRM address line and the CRM notes (own call-backs only). */
  postcode: string | null;
  address_line: string | null;
  result_note: string | null;
  product_interest: string | null;
  best_time: string | null;
  description: string | null;
};

/** One row of `my_crm_leads`. */
export type MyCrmLead = {
  crm_id: string;
  status: string | null;
  crm_created_at: string;
  appointment_at: string | null;
  sale_amount: number | null;
  callback_reason: string | null;
  uprn: number | null;
  lon: number | null;
  lat: number | null;
  house_number: string | null;
  building_name: string | null;
  street_name: string | null;
  postcode_sector: string | null;
};

/** One row of `crm_leaderboard`. */
export type LeaderRow = {
  canvasser: string;
  branch: string;
  leads: number;
  sold: number;
  pitched: number;
  revenue: number;
  sales_with_amount: number;
};

/** A call result logged on this phone that may not have synced yet. */
export type LocalCall = { crm_id: string; result: CallResult; called_at: string; call_back_on: string | null; synced?: boolean };

// ------------------------------------------------------------- vocabulary

export const REASON_LABEL: Record<CallbackReason, string> = {
  utc: "Unable to contact",
  no_outcome: "No outcome yet",
  reapp: "Re-app",
  single_sit: "Single sit",
  not_convenient: "Not convenient",
  no_time: "No time",
  rta: "Ring to arrange",
  rearrange: "Rearrange",
  no_answer: "No answer",
};

export function reasonLabel(reason: string | null): string {
  return reason && reason in REASON_LABEL ? REASON_LABEL[reason as CallbackReason] : "Call back";
}

/** Status words as the canvasser says them. */
export const STATUS_LABEL: Record<Exclude<CrmStatus, null>, string> = {
  sale: "Sold",
  pm: "Pitch & miss",
  blowout: "Blowout",
  utc: "Unable to contact",
  btc: "Back to canvasser",
  re_app: "Re-app",
  confirmed: "Booked",
  pending: "Booked",
};

export function statusLabel(status: string | null): string {
  return status && status in STATUS_LABEL ? STATUS_LABEL[status as Exclude<CrmStatus, null>] : "No outcome yet";
}

/** Colour group for squares, bars and map dots. Matches the admin CRM colours. */
export type StatusTone = "sale" | "pm" | "blowout" | "utc" | "other";

export function statusTone(status: string | null): StatusTone {
  if (status === "sale" || status === "pm" || status === "blowout" || status === "utc") return status;
  return "other";
}

/** Tailwind classes per tone: a hollow rounded square, as in the mockups. */
export const TONE_SQUARE: Record<StatusTone, string> = {
  sale: "border-crm-sale",
  pm: "border-crm-pm",
  blowout: "border-crm-blowout",
  utc: "border-ink-muted",
  other: "border-ink-faint",
};

export const TONE_FILL: Record<StatusTone, string> = {
  sale: "bg-crm-sale",
  pm: "bg-crm-pm",
  blowout: "bg-crm-blowout",
  utc: "bg-ink-muted",
  other: "bg-ink-faint",
};

export const TONE_ORDER: readonly StatusTone[] = ["sale", "pm", "blowout", "utc", "other"];

export const TONE_LABEL: Record<StatusTone, string> = {
  sale: "Sold",
  pm: "Pitch & miss",
  blowout: "Blowout",
  utc: "Unable to contact",
  other: "Other",
};

export const CALL_RESULT_OPTIONS: ReadonlyArray<{ value: CallResult; label: string; help: string }> = [
  { value: "rebooked", label: "Rebooked", help: "Taken off your list" },
  { value: "no_answer", label: "No answer", help: "Back on your list tomorrow" },
  { value: "later", label: "Call back later", help: "Choose a day" },
  { value: "not_interested", label: "Not interested", help: "Taken off your list" },
  { value: "wrong_number", label: "Wrong number", help: "Taken off your list" },
];

const RESULT_PAST: Record<CallResult, string> = {
  rebooked: "Rebooked",
  no_answer: "No answer",
  later: "Call back",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
};

// ------------------------------------------------------------- formatting

const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
const DAY_SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

/** "Wed 8 Oct" (London). */
export function shortDay(iso: string): string {
  return DAY_SHORT.format(new Date(iso)).replace(",", "");
}

/** "Thu 9 Oct, 18:00" (London). */
export function dayAndTime(iso: string): string {
  const d = new Date(iso);
  return `${shortDay(iso)}, ${TIME.format(d)}`;
}

/** "10:15" (London). */
export function clock(iso: string): string {
  return TIME.format(new Date(iso));
}

/** A YYYY-MM-DD as "Fri 16 Oct". */
export function isoDayLabel(day: string): string {
  return shortDay(`${day}T12:00:00Z`);
}

/** The door, as the canvasser knows it: "14 Upton Road", or the building, or the postcode sector. */
export function doorLine(row: Pick<CallbackLead, "house_number" | "building_name" | "street_name" | "postcode_sector">): string {
  const street = row.street_name?.trim() ?? "";
  const number = row.house_number?.trim() ?? "";
  const building = row.building_name?.trim() ?? "";
  if (number && street) return `${number} ${street}`;
  if (building && street) return `${building}, ${street}`;
  if (street) return street;
  if (building) return building;
  return row.postcode_sector ? `Near ${row.postcode_sector}` : "Address not matched";
}

/**
 * CRM-6 B (owner 2026-10-13): the address as the CRM has it, with the full
 * postcode: "14 Upton Road, BS7 9QD". Falls back to the matched door, then
 * the postcode.
 */
export function callbackAddress(
  row: Pick<CallbackLead, "address_line" | "postcode" | "house_number" | "building_name" | "street_name" | "postcode_sector">,
): string {
  const line = row.address_line?.trim() ?? "";
  const postcode = row.postcode?.trim() ?? "";
  if (line) {
    const compact = (text: string) => text.replace(/\s+/g, "").toUpperCase();
    return postcode && !compact(line).includes(compact(postcode)) ? `${line}, ${postcode}` : line;
  }
  const door = doorLine(row);
  const matched = Boolean(row.street_name?.trim() || row.building_name?.trim());
  if (matched) return postcode ? `${door}, ${postcode}` : door;
  return postcode || door;
}

/** "Booked Mon 6 Oct · was due Wed 8 Oct, 18:00" (or "· due …" when the appointment is still ahead). */
export function callbackBookedLine(row: Pick<CallbackLead, "crm_created_at" | "appointment_at">, now: Date): string {
  const booked = `Booked ${shortDay(row.crm_created_at)}`;
  if (!row.appointment_at) return booked;
  const word = Date.parse(row.appointment_at) < now.getTime() ? "was due" : "due";
  return `${booked} · ${word} ${dayAndTime(row.appointment_at)}`;
}

export type CallbackDetail = { label: string; value: string };

/** The CRM notes shown when a call-back is opened, in this order, blanks left out. */
export function callbackDetails(row: Pick<CallbackLead, "result_note" | "product_interest" | "best_time" | "description">): CallbackDetail[] {
  const all: [string, string | null][] = [
    ["Result", row.result_note],
    ["Product interest", row.product_interest],
    ["Best time to call", row.best_time],
    ["Description", row.description],
  ];
  return all.flatMap(([label, value]) => (value?.trim() ? [{ label, value: value.trim() }] : []));
}

/** "Mrs Ashworth". Title and surname only (never a first name). */
export function contactName(row: Pick<CallbackLead, "title" | "surname">): string | null {
  const parts = [row.title?.trim(), row.surname?.trim()].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" ") : null;
}

/** £6,240 / £9.8k. */
export function pounds(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

export function poundsShort(value: number): string {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (value >= 10_000) return `£${Math.round(value / 1000)}k`;
  if (value >= 1000) return `£${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return pounds(value);
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

// -------------------------------------------------------------- call-backs

export const CALLBACK_WINDOWS = [7, 30, 90] as const;
export type CallbackWindow = (typeof CALLBACK_WINDOWS)[number];
export const DEFAULT_CALLBACK_WINDOW: CallbackWindow = 30;

export function parseCallbackWindow(value: unknown): CallbackWindow {
  const n = Number(value);
  return (CALLBACK_WINDOWS as readonly number[]).includes(n) ? (n as CallbackWindow) : DEFAULT_CALLBACK_WINDOW;
}

export type CallbackRow = CallbackLead & {
  /** The latest result: a pending local one beats the server's. */
  result: CallResult | null;
  calledAt: string | null;
  callBackOn: string | null;
  /** True while that latest result is still waiting to sync. */
  pending: boolean;
};

export type CallbackSections = {
  toCall: CallbackRow[];
  doneToday: CallbackRow[];
  later: CallbackRow[];
};

const RESULTS = new Set<string>(["rebooked", "no_answer", "later", "not_interested", "wrong_number"]);

/**
 * Where each call-back belongs today (London):
 * - Done today: called today, whatever the result.
 * - Off the list: rebooked, not interested, wrong number (on an earlier day).
 * - Later: "call back later" for a day after today.
 * - To call: never called; no answer on an earlier day; "later" due today or before.
 * To call is oldest-booked first, so nothing sits at the bottom for ever.
 */
export function sectionCallbacks(rows: readonly CallbackLead[], local: readonly LocalCall[], now: Date): CallbackSections {
  const today = londonDate(now);
  const latestLocal = new Map<string, LocalCall>();
  for (const call of local) {
    const seen = latestLocal.get(call.crm_id);
    if (!seen || seen.called_at < call.called_at) latestLocal.set(call.crm_id, call);
  }
  const out: CallbackSections = { toCall: [], doneToday: [], later: [] };
  for (const row of rows) {
    const mine = latestLocal.get(row.crm_id);
    const serverResult = row.last_result && RESULTS.has(row.last_result) ? (row.last_result as CallResult) : null;
    const useLocal = mine !== undefined && (row.last_called_at === null || mine.called_at >= row.last_called_at);
    const merged: CallbackRow = {
      ...row,
      result: useLocal ? mine.result : serverResult,
      calledAt: useLocal ? mine.called_at : row.last_called_at,
      callBackOn: useLocal ? mine.call_back_on : row.call_back_on,
      pending: useLocal && mine.synced !== true,
    };
    const calledDay = merged.calledAt ? londonDate(new Date(merged.calledAt)) : null;
    if (calledDay === today) out.doneToday.push(merged);
    else if (merged.result === "rebooked" || merged.result === "not_interested" || merged.result === "wrong_number") continue;
    else if (merged.result === "later" && merged.callBackOn !== null && merged.callBackOn > today) out.later.push(merged);
    else out.toCall.push(merged);
  }
  out.toCall.sort((a, b) => a.crm_created_at.localeCompare(b.crm_created_at));
  out.doneToday.sort((a, b) => (b.calledAt ?? "").localeCompare(a.calledAt ?? ""));
  out.later.sort((a, b) => (a.callBackOn ?? "").localeCompare(b.callBackOn ?? ""));
  return out;
}

/** The small line under the door: why it is on the list, or what happened. */
export function callbackLine(row: CallbackRow, now: Date): string {
  if (row.result && row.calledAt && londonDate(new Date(row.calledAt)) === londonDate(now)) {
    const at = clock(row.calledAt);
    if (row.result === "no_answer") return `No answer at ${at} · back tomorrow`;
    if (row.result === "later" && row.callBackOn) return `Call back ${isoDayLabel(row.callBackOn)} · rang ${at}`;
    return `${RESULT_PAST[row.result]} at ${at}`;
  }
  if (row.result === "later" && row.callBackOn) return `${reasonLabel(row.callback_reason)} · due ${isoDayLabel(row.callBackOn)}`;
  if (row.callback_reason === "reapp") return "Re-app · needs a new date";
  return `${reasonLabel(row.callback_reason)} · ${shortDay(row.crm_created_at)}`;
}

/** Next 7 days after today, as YYYY-MM-DD, for "Call back later". */
export function laterDays(now: Date): string[] {
  const days: string[] = [];
  for (let i = 1; i <= 7; i += 1) days.push(londonDate(new Date(now.getTime() + i * 86_400_000)));
  return [...new Set(days)];
}

// --------------------------------------------------------------- results

export const RESULT_PERIODS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "ytd", label: "This year" },
] as const;
export type ResultPeriod = (typeof RESULT_PERIODS)[number]["value"];
export const DEFAULT_RESULT_PERIOD: ResultPeriod = "month";

export function parseResultPeriod(value: unknown): ResultPeriod {
  return RESULT_PERIODS.some((p) => p.value === value) ? (value as ResultPeriod) : DEFAULT_RESULT_PERIOD;
}

/** London midnight of a YYYY-MM-DD, as an ISO instant. */
export function londonMidnight(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  // London is UTC or UTC+1: try both and keep the one that lands on that London day at 00:00.
  for (const offsetHours of [1, 0]) {
    const at = new Date(guess - offsetHours * 3_600_000);
    if (londonDate(at) === day && clock(at.toISOString()) === "00:00") return at.toISOString();
  }
  return new Date(guess).toISOString();
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/** Monday of the London week holding `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export type Span = { fromDay: string; toDay: string; from: string; to: string; line: string };

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

function dayNum(day: string): number {
  return Number(day.slice(8, 10));
}

function monthName(day: string): string {
  return MONTH.format(new Date(`${day}T12:00:00Z`));
}

/** "1 to 11 Oct" / "29 Sep to 5 Oct". `toDay` inclusive. */
export function spanLine(fromDay: string, toDay: string): string {
  if (fromDay === toDay) return `${dayNum(fromDay)} ${monthName(fromDay)}`;
  if (fromDay.slice(0, 7) === toDay.slice(0, 7)) return `${dayNum(fromDay)} to ${dayNum(toDay)} ${monthName(toDay)}`;
  return `${dayNum(fromDay)} ${monthName(fromDay)} to ${dayNum(toDay)} ${monthName(toDay)}`;
}

/** The window for a period, up to and including today (London). `to` is exclusive. */
export function periodSpan(period: ResultPeriod, now: Date): Span {
  const today = londonDate(now);
  let fromDay: string;
  let lastDay = today;
  if (period === "week") fromDay = weekStart(today);
  else if (period === "month") fromDay = `${today.slice(0, 7)}-01`;
  else if (period === "ytd") fromDay = `${today.slice(0, 4)}-01-01`;
  else {
    const firstThis = `${today.slice(0, 7)}-01`;
    lastDay = addDays(firstThis, -1);
    fromDay = `${lastDay.slice(0, 7)}-01`;
  }
  return { fromDay, toDay: lastDay, from: londonMidnight(fromDay), to: londonMidnight(addDays(lastDay, 1)), line: spanLine(fromDay, lastDay) };
}

export type MyTotals = {
  leads: number;
  sold: number;
  pitched: number;
  value: number;
  salesWithAmount: number;
  tones: Record<StatusTone, number>;
  /** Pitched ÷ leads that reached the door (sale, P&M, blowout, UTC). */
  sat: number;
  satOf: number;
};

export function myTotals(leads: readonly MyCrmLead[]): MyTotals {
  const tones: Record<StatusTone, number> = { sale: 0, pm: 0, blowout: 0, utc: 0, other: 0 };
  let value = 0;
  let salesWithAmount = 0;
  for (const lead of leads) {
    tones[statusTone(lead.status)] += 1;
    if (lead.status === "sale" && lead.sale_amount !== null) {
      value += Number(lead.sale_amount);
      salesWithAmount += 1;
    }
  }
  const pitched = tones.sale + tones.pm;
  return {
    leads: leads.length,
    sold: tones.sale,
    pitched,
    value,
    salesWithAmount,
    tones,
    sat: pitched,
    satOf: tones.sale + tones.pm + tones.blowout + tones.utc,
  };
}

export function rate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

// ------------------------------------------------------------------ week

export type WeekDay = { day: string; letter: string; date: number; leads: MyCrmLead[]; future: boolean };

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Seven days from Monday `start`, each with its leads (by date booked, London). */
export function weekDays(start: string, leads: readonly MyCrmLead[], now: Date): WeekDay[] {
  const today = londonDate(now);
  return LETTERS.map((letter, i) => {
    const day = addDays(start, i);
    return {
      day,
      letter,
      date: dayNum(day),
      leads: leads.filter((l) => londonDate(new Date(l.crm_created_at)) === day).sort((a, b) => a.crm_created_at.localeCompare(b.crm_created_at)),
      future: day > today,
    };
  });
}

export function shiftWeek(start: string, weeks: number): string {
  return addDays(start, weeks * 7);
}

export function weekTitle(start: string): string {
  return spanLine(start, addDays(start, 6));
}

// ------------------------------------------------------------ leaderboard

/** Owner 2026-10-13: canvassers are paid on pitches (sale + P&M), so Pitched leads and is the default. */
export const BOARD_METRICS = [
  { value: "pitched", label: "Pitched" },
  { value: "sales", label: "Sales" },
  { value: "value", label: "Value" },
] as const;
export type BoardMetric = (typeof BOARD_METRICS)[number]["value"];

export function parseBoardMetric(value: unknown): BoardMetric {
  return BOARD_METRICS.some((m) => m.value === value) ? (value as BoardMetric) : "pitched";
}

export type RankedRow = LeaderRow & { rank: number; you: boolean; main: string; sub: string };

/** The number that ranks a row, highest first. */
function score(row: LeaderRow, metric: BoardMetric): number {
  if (metric === "value") return Number(row.revenue);
  if (metric === "pitched") return row.pitched;
  return row.sold;
}

/** The figure that breaks a tie: sales on Pitched, pitches on Sales / Value. */
function tieBreak(row: LeaderRow, metric: BoardMetric): number {
  return metric === "pitched" ? row.sold : row.pitched;
}

/** "6 sold · 9 P&M" */
export function pitchSplit(row: { sold: number; pitched: number }): string {
  return `${row.sold} sold · ${row.pitched - row.sold} P&M`;
}

/**
 * Ranked for one metric. Ties share a rank ("2, 2, 4"). People with nothing
 * to rank on (no pitches for Pitched, no sales for Sales / Value) are left
 * off, except you.
 */
export function rankBoard(rows: readonly LeaderRow[], metric: BoardMetric, me: { name: string | null; branch: string | null }): RankedRow[] {
  const isMe = (r: LeaderRow) => me.name !== null && r.canvasser === me.name && (me.branch === null || r.branch === me.branch);
  const counted = rows.filter((r) => isMe(r) || (metric === "pitched" ? r.pitched > 0 : r.sold > 0));
  const sorted = [...counted].sort((a, b) => score(b, metric) - score(a, metric) || tieBreak(b, metric) - tieBreak(a, metric) || a.canvasser.localeCompare(b.canvasser));
  let rank = 0;
  let last: number | null = null;
  return sorted.map((r, i) => {
    const s = score(r, metric);
    if (last === null || s !== last) {
      rank = i + 1;
      last = s;
    }
    const main = metric === "value" ? poundsShort(Number(r.revenue)) : metric === "pitched" ? String(r.pitched) : String(r.sold);
    const sub = metric === "value" ? `${r.sold} sold` : metric === "pitched" ? pitchSplit(r) : `of ${r.pitched} pitched`;
    return { ...r, rank, you: isMe(r), main, sub };
  });
}

/** Top `n`, plus you underneath when you are not in it. */
export function boardView(ranked: readonly RankedRow[], n = 8): { top: RankedRow[]; me: RankedRow | null } {
  const top = ranked.slice(0, n);
  const me = ranked.find((r) => r.you) ?? null;
  return { top, me: me && !top.includes(me) ? me : null };
}

/** "You're 4th of 23 this month, by pitches" (rank from rankBoard(…, "pitched", …)). */
export function boardSummary(ranked: readonly RankedRow[], peopleWithLeads: number, periodWords: string): string {
  const me = ranked.find((r) => r.you);
  if (!me) return `${peopleWithLeads} people booked leads ${periodWords}`;
  if (me.pitched === 0) return `No pitches yet ${periodWords}. ${peopleWithLeads} people booked leads`;
  return `You're ${ordinal(me.rank)} of ${peopleWithLeads} ${periodWords}, by pitches`;
}

export const PERIOD_WORDS: Record<ResultPeriod, string> = {
  week: "this week",
  month: "this month",
  last_month: "last month",
  ytd: "this year",
};

// ------------------------------------------------------------- map layer

/**
 * CRM-5 C2 (owner 2026-10-12): the Map tab's "My CRM leads" layer. Own leads
 * only, OFF by default. The one place previous-visit outcome colour may
 * appear on the field map (AGENTS.md P4b exception).
 */
export const MAP_LAYER_WINDOWS = [0, 7, 30, 90] as const;
export type MapLayerWindow = (typeof MAP_LAYER_WINDOWS)[number];

export function parseMapLayerWindow(value: unknown): MapLayerWindow {
  const n = Number(value);
  return (MAP_LAYER_WINDOWS as readonly number[]).includes(n) ? (n as MapLayerWindow) : 0;
}

/** Ring colours on the map, matching the --color-crm-* tokens per theme. */
export const CRM_MAP_RING: Record<"light" | "dark", Record<StatusTone, string>> = {
  light: { sale: "#2f8f57", pm: "#3f74d0", blowout: "#c0505a", utc: "#6a7078", other: "#a5abb3" },
  dark: { sale: "#3f9e69", pm: "#5b8ff0", blowout: "#e06a72", utc: "#8c96a3", other: "#5b6470" },
};

/** Leads with a place on the map, as GeoJSON points (newest wins when two share a door). */
export function crmLeadPoints(leads: readonly MyCrmLead[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const newestFirst = [...leads].sort((a, b) => b.crm_created_at.localeCompare(a.crm_created_at));
  const seen = new Set<string>();
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const lead of newestFirst) {
    if (lead.lon === null || lead.lat === null) continue;
    const spot = `${lead.lon.toFixed(6)},${lead.lat.toFixed(6)}`;
    if (seen.has(spot)) continue;
    seen.add(spot);
    features.push({
      type: "Feature",
      id: lead.crm_id,
      properties: { crm_id: lead.crm_id, tone: statusTone(lead.status) },
      geometry: { type: "Point", coordinates: [lead.lon, lead.lat] },
    });
  }
  return { type: "FeatureCollection", features };
}

/** "Blowout · single sit · Thu 2 Oct". */
export function crmLeadLine(lead: Pick<MyCrmLead, "status" | "callback_reason" | "crm_created_at">): string {
  const parts = [statusLabel(lead.status)];
  if (lead.callback_reason && lead.callback_reason !== "utc" && lead.callback_reason !== "no_outcome" && lead.callback_reason !== "reapp") {
    parts.push(reasonLabel(lead.callback_reason).toLowerCase());
  }
  parts.push(shortDay(lead.crm_created_at));
  return parts.join(" · ");
}

export function toneCounts(leads: readonly MyCrmLead[]): Record<StatusTone, number> {
  const out: Record<StatusTone, number> = { sale: 0, pm: 0, blowout: 0, utc: 0, other: 0 };
  for (const lead of leads) out[statusTone(lead.status)] += 1;
  return out;
}
