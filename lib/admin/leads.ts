/**
 * UI-10 F5a (frame 21; owner 2026-10-09: period chips like Team). Leads,
 * read-only: the office settles every lead (admin never gets a status
 * control). Rows carry the property's address label or UPRN, the prop, the
 * canvasser's first name and the knock time: no resident, no note, no CRM
 * reference.
 *
 * Pure: no React, no network. Checked by `npm run verify:ui10`.
 */
import { londonDay } from "@/lib/admin/calendar";
import { inWindow, periodPhrase, type PeriodWindow, type TeamPeriod } from "@/lib/admin/team";

/** Office order for the chips and the Insights chart. */
export const LEAD_STATUSES = ["pending", "re_app", "sale", "pm", "blowout", "utc", "btc", "cancelled"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

const LABELS: Record<LeadStatus, string> = {
  pending: "Awaiting",
  re_app: "Re-app",
  sale: "Sale",
  pm: "Pitched",
  blowout: "Blowout",
  utc: "Unable to contact",
  btc: "Back to canvasser",
  cancelled: "Cancelled",
};

export function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

export function leadStatusLabel(status: string): string {
  return isLeadStatus(status) ? LABELS[status] : "Unknown";
}

/**
 * The mark beside a status (frame 21): a ring while the office still has it
 * (awaiting green, re-app blue), a filled dot once settled (sale green,
 * pitched dark, the rest muted). Always shown with its word, never alone.
 */
export type LeadMark = "awaiting" | "reapp" | "sale" | "pitched" | "closed";

export function leadMark(status: string): LeadMark {
  if (status === "pending") return "awaiting";
  if (status === "re_app") return "reapp";
  if (status === "sale") return "sale";
  if (status === "pm") return "pitched";
  return "closed";
}

export type LeadItem = {
  id: string;
  uprn: number;
  /** "41 Bishport Avenue", or null when the door has no address label. */
  door: string | null;
  propName: string;
  /** The canvasser's first name. */
  canvasser: string;
  occurredAt: string;
  status: string;
};

/** The row title: the address label, else the UPRN (never a resident). */
export function doorTitle(item: Pick<LeadItem, "door" | "uprn">): string {
  return item.door ?? `UPRN ${item.uprn}`;
}

const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "today 14:10", "yesterday 09:05", "27 Sep", "27 Sep 2025". */
export function whenLine(iso: string, today: string): string {
  const day = londonDay(iso);
  if (day === today) return `today ${TIME.format(new Date(iso))}`;
  const [y, m, d] = day.split("-").map(Number);
  const [ty] = today.split("-").map(Number);
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return `yesterday ${TIME.format(new Date(iso))}`;
  const label = `${d} ${SHORT_MONTHS[(m ?? 1) - 1]}`;
  return y === ty ? label : `${label} ${y}`;
}

/** Frame 21 row meta: "Whitechurch Lane · Tom · today 14:10". */
export function leadMeta(item: Pick<LeadItem, "propName" | "canvasser" | "occurredAt">, today: string): string {
  return [item.propName, item.canvasser, whenLine(item.occurredAt, today)].join(" · ");
}

/** Leads whose knock fell in the window, newest first. */
export function leadsInWindow<T extends Pick<LeadItem, "occurredAt" | "id">>(items: T[], window: PeriodWindow): T[] {
  return items
    .filter((item) => inWindow(item.occurredAt, window))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
}

export type StatusFilter = "all" | LeadStatus;

export function parseStatusFilter(value: string | null | undefined): StatusFilter {
  return value && isLeadStatus(value) ? value : "all";
}

export type StatusChip = { value: StatusFilter; label: string; count: number };

/** "All 51", then each status that has a lead, in office order. */
export function statusChips(items: Pick<LeadItem, "status">[]): StatusChip[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  const chips: StatusChip[] = [{ value: "all", label: "All", count: items.length }];
  for (const status of LEAD_STATUSES) {
    const count = counts.get(status) ?? 0;
    if (count > 0) chips.push({ value: status, label: LABELS[status], count });
  }
  return chips;
}

export function filterByStatus<T extends Pick<LeadItem, "status">>(items: T[], filter: StatusFilter): T[] {
  return filter === "all" ? items : items.filter((item) => item.status === filter);
}

/** Frame 21 subtitle: "13 this week · settled by the office". */
export function leadsSubtitle(count: number, period: TeamPeriod): string {
  return `${count.toLocaleString("en-GB")} ${periodPhrase(period)} · settled by the office`;
}

/** Rows shown before "Show more". */
export const LEADS_PAGE = 50;

export function showMoreLabel(shown: number, total: number): string {
  const next = Math.min(LEADS_PAGE, total - shown);
  return `Show ${next.toLocaleString("en-GB")} more`;
}

/** The filtered-zero line inside the list frame. */
export function emptyLeadsLine(filter: StatusFilter, period: TeamPeriod): string {
  const what = filter === "all" ? "No leads" : `No ${LABELS[filter].toLowerCase()} leads`;
  return `${what} ${periodPhrase(period)}.`;
}

export function leadsHref(period: TeamPeriod, status: StatusFilter = "all"): string {
  const params = new URLSearchParams();
  if (period !== "week") params.set("period", period);
  if (status !== "all") params.set("status", status);
  const query = params.toString();
  return query ? `/admin/leads?${query}` : "/admin/leads";
}
