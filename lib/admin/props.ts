/**
 * UI-10 F2a (owner A22, A25, A47; 2026-10-06). The Props list and prop
 * detail: what state each prop is in, what its row says, and how the filter
 * chips count.
 *
 * Pure: no React, no network. Dates are London calendar dates (YYYY-MM-DD)
 * and `today` is always passed in, so the same input gives the same output.
 * Checked by `npm run verify:ui10`.
 */
import type { Slot } from "@/lib/geo/rotation";

/**
 * CLAUDE decision (F2, no owner rule exists yet): a prop is due for its next
 * visit when nothing is planned and its last visit that counted for rotation
 * is at least this many days old (or it has never been visited). 28 matches
 * the old dashboard's default "not visited in over 4 weeks". One place to
 * change it.
 */
export const PROP_DUE_AFTER_DAYS = 28;

export type PropVisit = {
  id: string;
  visitNumber: number;
  /** London date the visit is allocated for. */
  workDate: string;
  slot: Slot | null;
  startedAt: string | null;
  closedAt: string | null;
  countsForRotation: boolean;
  /** The saved route variant frozen onto this visit, if it has one. */
  routeVariantKey: string | null;
  /** First names of everyone allocated, in allocation order. */
  team: string[];
};

export type PropRow = {
  id: string;
  name: string;
  archivedAt: string | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  /** Oldest first. */
  visits: PropVisit[];
  /** PP-1 (owner 2026-10-21): the prop's folder. Null or absent = "No folder". */
  folderId?: string | null;
};

export type PropState =
  | { kind: "archived" }
  | { kind: "today"; visit: PropVisit }
  | { kind: "planned"; visit: PropVisit }
  | { kind: "due"; lastDate: string | null }
  | { kind: "resting"; lastDate: string; dueFrom: string };

export type PropFilter = "all" | "due" | "today" | "archived";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDate(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

export function addDays(iso: string, days: number): string {
  const date = parseDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "27 Sep". Month names are fixed (en-GB ICU now says "Sept"). */
export function shortDate(iso: string): string {
  const date = parseDate(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "Mon 20 Oct". */
export function dayDate(iso: string): string {
  const date = parseDate(iso);
  return `${DAYS[date.getUTCDay()]} ${shortDate(iso)}`;
}

/** "Tom", "Tom and Ada", "Tom, Ada and Sam". */
export function joinNames(names: string[]): string {
  const list = names.filter((name) => name.trim() !== "");
  if (list.length === 0) return "No one yet";
  if (list.length === 1) return list[0]!;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || "Unnamed";
}

export function slotLabel(slot: Slot | null): string | null {
  if (slot === "early") return "Early";
  if (slot === "mid") return "Mid";
  if (slot === "late") return "Late";
  return null;
}

/** Same rule as `allocate_prop`: 1 + the highest visit number that counted. */
export function nextVisitNumber(visits: PropVisit[]): number {
  let max = 0;
  for (const visit of visits) {
    if (visit.countsForRotation && visit.visitNumber > max) max = visit.visitNumber;
  }
  return max + 1;
}

/** The last visit before today that counted for rotation. */
export function lastVisitDate(visits: PropVisit[], today: string): string | null {
  let last: string | null = null;
  for (const visit of visits) {
    if (!visit.countsForRotation || visit.workDate >= today) continue;
    if (!last || visit.workDate > last) last = visit.workDate;
  }
  return last;
}

export function propState(row: PropRow, today: string): PropState {
  if (row.archivedAt) return { kind: "archived" };
  const todays = row.visits.filter((visit) => visit.workDate === today);
  const open = todays.find((visit) => !visit.closedAt) ?? todays[todays.length - 1];
  if (open) return { kind: "today", visit: open };
  const planned = row.visits
    .filter((visit) => visit.workDate > today && !visit.closedAt)
    .sort((a, b) => a.workDate.localeCompare(b.workDate))[0];
  if (planned) return { kind: "planned", visit: planned };
  const lastDate = lastVisitDate(row.visits, today);
  if (!lastDate) return { kind: "due", lastDate: null };
  const dueFrom = addDays(lastDate, PROP_DUE_AFTER_DAYS);
  if (dueFrom <= today) return { kind: "due", lastDate };
  return { kind: "resting", lastDate, dueFrom };
}

/** The pill on a list row, or null for no pill. */
export function statePill(state: PropState): "live" | "not-started" | "done" | "due" | null {
  if (state.kind === "due") return "due";
  if (state.kind !== "today") return null;
  if (state.visit.closedAt) return "done";
  return state.visit.startedAt ? "live" : "not-started";
}

/** Second line of a list row (frame 04): "1,682 doors · visit 3 today". */
export function propSubtitle(state: PropState, doors: number | null, archivedAt: string | null): string {
  const parts: string[] = [];
  if (doors !== null) parts.push(`${doors.toLocaleString("en-GB")} doors`);
  if (state.kind === "today") parts.push(`visit ${state.visit.visitNumber} today`);
  else if (state.kind === "planned") parts.push(`visit ${state.visit.visitNumber} · ${dayDate(state.visit.workDate)}`);
  else if (state.kind === "archived") parts.push(archivedAt ? `archived ${shortDate(archivedAt)}` : "archived");
  else if (state.lastDate) parts.push(`last ${shortDate(state.lastDate)}`);
  else parts.push("not visited yet");
  return parts.join(" · ");
}

/** The "next visit" line in prop detail (frame 05). Null while a visit is today or planned. */
export function nextVisitLine(row: PropRow, state: PropState): string | null {
  const next = nextVisitNumber(row.visits);
  if (state.kind === "resting") return `Visit ${next} due from ${dayDate(state.dueFrom)}`;
  if (state.kind === "due") return `Visit ${next} is due`;
  return null;
}

const ORDER: Record<PropState["kind"], number> = { today: 0, due: 1, planned: 2, resting: 3, archived: 4 };

/** Today first, then due, planned, resting; most recently visited first within each. */
export function sortProps<T extends { row: PropRow; state: PropState }>(items: T[]): T[] {
  const recent = (item: T): string => {
    const state = item.state;
    if (state.kind === "today" || state.kind === "planned") return state.visit.workDate;
    if (state.kind === "due" || state.kind === "resting") return state.lastDate ?? "";
    return item.row.archivedAt ?? "";
  };
  return items.slice().sort((a, b) => {
    const byState = ORDER[a.state.kind] - ORDER[b.state.kind];
    if (byState !== 0) return byState;
    const byDate = recent(b).localeCompare(recent(a));
    if (byDate !== 0) return byDate;
    return a.row.name.localeCompare(b.row.name, "en-GB");
  });
}

export function matchesFilter(state: PropState, filter: PropFilter): boolean {
  if (filter === "archived") return state.kind === "archived";
  if (state.kind === "archived") return false;
  if (filter === "due") return state.kind === "due";
  if (filter === "today") return state.kind === "today";
  return true;
}

export function matchesQuery(name: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  return needle === "" || name.toLocaleLowerCase("en-GB").includes(needle);
}

export function filterCounts(states: PropState[]): { live: number; due: number; today: number; archived: number } {
  let live = 0;
  let due = 0;
  let today = 0;
  let archived = 0;
  for (const state of states) {
    if (state.kind === "archived") {
      archived += 1;
      continue;
    }
    live += 1;
    if (state.kind === "due") due += 1;
    if (state.kind === "today") today += 1;
  }
  return { live, due, today, archived };
}

/** "14 live · 4 due" under the title. */
export function countsLine(counts: { live: number; due: number }): string {
  return `${counts.live.toLocaleString("en-GB")} live · ${counts.due.toLocaleString("en-GB")} due`;
}

/** Per-visit figures from `v_prop_completion` and `v_latest_knock` (contacts = bookable answers only). */
export type VisitStats = {
  worked: number;
  remaining: number;
  contacts: number;
  leads: number;
  rented: number;
  notIn: number;
};

export type OutcomeSegment = { key: "contacts" | "leads" | "rented" | "notIn" | "other"; value: number };

/** The progress bar on a visit (frame 05): coloured by outcome on a neutral track of the whole prop. */
export function outcomeSegments(stats: VisitStats): { segments: OutcomeSegment[]; total: number } {
  const other = Math.max(0, stats.worked - stats.contacts - stats.leads - stats.rented - stats.notIn);
  const segments: OutcomeSegment[] = [
    { key: "contacts", value: stats.contacts },
    { key: "leads", value: stats.leads },
    { key: "rented", value: stats.rented },
    { key: "notIn", value: stats.notIn },
    { key: "other", value: other },
  ];
  return { segments: segments.filter((segment) => segment.value > 0), total: stats.worked + stats.remaining };
}

/** "1,402 worked · 7 leads" on a history row. */
export function historyFigures(stats: Pick<VisitStats, "worked" | "leads">): string {
  const leads = stats.leads === 1 ? "1 lead" : `${stats.leads.toLocaleString("en-GB")} leads`;
  return `${stats.worked.toLocaleString("en-GB")} worked · ${leads}`;
}

/** "Visit 2 · Thu 24 Sep", or "Visit 3 · today". */
export function visitTitle(visit: PropVisit, today: string): string {
  return `Visit ${visit.visitNumber} · ${visit.workDate === today ? "today" : dayDate(visit.workDate)}`;
}

/** Edit shape banner (frame 13) when a visit is today or planned: its snapshot is already frozen. */
export function frozenVisitNote(state: PropState): string | null {
  if (state.kind === "today" && !state.visit.closedAt) {
    return `Visit ${state.visit.visitNumber} is ${state.visit.startedAt ? "live" : "today"}. Changes apply from visit ${state.visit.visitNumber + 1}.`;
  }
  if (state.kind === "planned") {
    return `Visit ${state.visit.visitNumber} is planned. Changes apply from visit ${state.visit.visitNumber + 1}.`;
  }
  return null;
}

/** Office lead status → the pin on the map (A22; read-only, admin never sets it). */
export type LeadPin = "lead" | "pitched" | "sale" | "closed";

export function leadPinOf(status: string): LeadPin {
  if (status === "pending" || status === "re_app") return "lead";
  if (status === "pm") return "pitched";
  if (status === "sale") return "sale";
  return "closed";
}

export type LeadStatusRow = {
  uprn: number;
  status: string;
  status_set_at: string | null;
  booked_for: string | null;
};

/** One pin per door: the lead whose status changed last (then the latest booking). */
export function latestLeadPerDoor(rows: LeadStatusRow[]): Map<number, LeadPin> {
  const best = new Map<number, LeadStatusRow>();
  const stamp = (row: LeadStatusRow) => `${row.status_set_at ?? "0000"}|${row.booked_for ?? "0000"}`;
  for (const row of rows) {
    const current = best.get(row.uprn);
    if (!current || stamp(row) > stamp(current)) best.set(row.uprn, row);
  }
  const pins = new Map<number, LeadPin>();
  for (const [uprn, row] of best) pins.set(uprn, leadPinOf(row.status));
  return pins;
}

// ---- folders (PP-1, owner 2026-10-21) -----------------------------------

/** An admin-named folder of props (`prop_folders`). */
export type PropFolder = { id: string; name: string };

export const FOLDER_NAME_MAX = 60;

/** One folder in the list: its props (already filtered and sorted) and its counts across ALL its props. */
export type FolderGroup<T> = {
  /** Null = "No folder". */
  folder: PropFolder | null;
  items: T[];
  counts: { live: number; today: number; archived: number };
};

/**
 * The Props list in folders: named folders A–Z, then "No folder". A prop whose
 * folder is unknown (deleted, or not loaded) counts as "No folder". Counts are
 * over every prop in the folder; `items` keeps only `visible`, in its order.
 * A folder with nothing visible is left out while a filter or search is on,
 * and "No folder" is left out when it holds no props at all.
 */
export function groupByFolder<T extends { row: PropRow; state: PropState }>(
  all: T[],
  visible: T[],
  folders: PropFolder[],
  narrowed: boolean,
): FolderGroup<T>[] {
  const known = new Map(folders.map((folder) => [folder.id, folder] as const));
  const keyOf = (item: T): string => {
    const id = item.row.folderId ?? null;
    return id && known.has(id) ? id : "";
  };
  const groups = new Map<string, FolderGroup<T>>();
  const sorted = folders.slice().sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
  for (const folder of sorted) groups.set(folder.id, { folder, items: [], counts: { live: 0, today: 0, archived: 0 } });
  groups.set("", { folder: null, items: [], counts: { live: 0, today: 0, archived: 0 } });
  const total = new Map<string, number>();
  for (const item of all) {
    const key = keyOf(item);
    const group = groups.get(key)!;
    total.set(key, (total.get(key) ?? 0) + 1);
    if (item.state.kind === "archived") group.counts.archived += 1;
    else {
      group.counts.live += 1;
      if (item.state.kind === "today") group.counts.today += 1;
    }
  }
  for (const item of visible) groups.get(keyOf(item))!.items.push(item);
  return [...groups.entries()]
    .filter(([key, group]) => (narrowed ? group.items.length > 0 : key !== "" || (total.get("") ?? 0) > 0))
    .map(([, group]) => group);
}

/** "17 live · 2 out today · 11 archived" under a folder name. Counts only (no quality signals). */
export function folderLine(counts: FolderGroup<unknown>["counts"]): string {
  const parts = [`${counts.live.toLocaleString("en-GB")} live`];
  if (counts.today > 0) parts.push(`${counts.today.toLocaleString("en-GB")} out today`);
  if (counts.archived > 0) parts.push(`${counts.archived.toLocaleString("en-GB")} archived`);
  return parts.join(" · ");
}

/** A folder name as it is saved: trimmed, inner spaces collapsed. Null when empty or too long. */
export function cleanFolderName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return name && name.length <= FOLDER_NAME_MAX ? name : null;
}
