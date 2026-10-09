/**
 * UI-10 F5a (owner A48; 2026-10-09: keep doors per prop per week, answer
 * rate by slot, lead outcomes, prop completion and stale props; Live now is
 * on Today). Insights: the old dashboard's panels as charts.
 *
 * Pure: no React, no network. Data comes from `admin_dashboard` (unchanged)
 * plus every lead's office status. Checked by `npm run verify:ui10`.
 */
import type { AnswerBySlot, CoverageCounts, PropLastVisit, WorkedPerWeek } from "@/lib/admin/dashboard";
import { LEAD_STATUSES, leadStatusLabel, leadMark, type LeadMark, type LeadStatus } from "@/lib/admin/leads";
import { addDays } from "@/lib/admin/props";
import { percentText, rate } from "@/lib/admin/team";

/** Weeks shown in "Doors per week". */
export const WEEKS_SHOWN = 8;

/** Mondays, oldest first, ending with this week's. */
export function weekColumns(today: string, count = WEEKS_SHOWN): string[] {
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(today, -weekday);
  return Array.from({ length: count }, (_, index) => addDays(monday, -7 * (count - 1 - index)));
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Oct" for a week's Monday. */
export function weekLabel(monday: string): string {
  const [, m, d] = monday.split("-").map(Number);
  return `${d} ${SHORT_MONTHS[(m ?? 1) - 1]}`;
}

export type WeeklyRow = { propId: string; name: string; counts: number[]; total: number };

/**
 * One row per prop with doors in the shown weeks (by visit date), busiest
 * first. `peak` is the largest weekly figure across every row, so all rows
 * share one scale.
 */
export function weeklyRows(rows: WorkedPerWeek[], weeks: string[]): { rows: WeeklyRow[]; peak: number } {
  const index = new Map(weeks.map((week, i) => [week, i] as const));
  const byProp = new Map<string, WeeklyRow>();
  for (const row of rows) {
    const at = index.get(row.week_start);
    if (at === undefined || row.worked <= 0) continue;
    let prop = byProp.get(row.territory_id);
    if (!prop) {
      prop = { propId: row.territory_id, name: row.name, counts: weeks.map(() => 0), total: 0 };
      byProp.set(row.territory_id, prop);
    }
    prop.counts[at] = (prop.counts[at] ?? 0) + row.worked;
    prop.total += row.worked;
  }
  const out = [...byProp.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "en-GB"));
  const peak = out.reduce((max, row) => Math.max(max, ...row.counts), 0);
  return { rows: out, peak };
}

/** Doors in each shown week across every prop. */
export function weekTotals(rows: WeeklyRow[], weeks: string[]): number[] {
  return weeks.map((_, i) => rows.reduce((sum, row) => sum + (row.counts[i] ?? 0), 0));
}

/** Bar height as a share of the peak; a non-zero week is never invisible. */
export function barShare(value: number, peak: number): number {
  if (value <= 0 || peak <= 0) return 0;
  return Math.max(0.06, value / peak);
}

export type SlotRow = { slot: string; label: string; rate: number | null; percent: string; detail: string };

const SLOT_LABELS: Record<string, string> = { early: "Early", mid: "Mid", late: "Late" };

/** Doors answered (the broad rule, A8) out of doors knocked, per slot. */
export function slotRows(rows: AnswerBySlot[]): SlotRow[] {
  return rows.map((row) => {
    const share = rate(row.answered, row.worked);
    return {
      slot: row.slot,
      label: SLOT_LABELS[row.slot] ?? row.slot,
      rate: share,
      percent: percentText(share),
      detail: row.worked === 0 ? "No doors" : `${row.answered.toLocaleString("en-GB")} of ${row.worked.toLocaleString("en-GB")} doors`,
    };
  });
}

export type LeadOutcomeBar = { status: LeadStatus; label: string; mark: LeadMark; count: number; share: number };

/** Every office status, in office order, zeros included; `share` of the largest. */
export function leadOutcomeBars(statuses: string[]): { bars: LeadOutcomeBar[]; total: number } {
  const counts = new Map<string, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  const peak = Math.max(0, ...LEAD_STATUSES.map((status) => counts.get(status) ?? 0));
  const bars = LEAD_STATUSES.map((status) => {
    const count = counts.get(status) ?? 0;
    return { status, label: leadStatusLabel(status), mark: leadMark(status), count, share: peak > 0 ? count / peak : 0 };
  });
  return { bars, total: statuses.length };
}

export type CompletionRow = { propId: string; name: string; worked: number; left: number; knockable: number; share: number };

/** A11: a bar plus worked and left, no percentage. Most left first. */
export function completionRows(rows: CoverageCounts[]): CompletionRow[] {
  return rows
    .map((row) => ({
      propId: row.territory_id,
      name: row.name,
      worked: row.worked,
      left: row.remaining,
      knockable: row.knockable,
      share: row.knockable > 0 ? Math.min(1, row.worked / row.knockable) : 0,
    }))
    .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, "en-GB"));
}

export function completionLine(row: Pick<CompletionRow, "worked" | "left">): string {
  return `${row.worked.toLocaleString("en-GB")} worked · ${row.left.toLocaleString("en-GB")} left`;
}

export type StaleRow = { propId: string; name: string; line: string };

/** Props not visited in the period: never visited first, then the oldest. */
export function staleRows(rows: PropLastVisit[]): StaleRow[] {
  return rows
    .filter((row) => row.stale)
    .sort((a, b) => {
      if (a.last_visited === null && b.last_visited === null) return a.name.localeCompare(b.name, "en-GB");
      if (a.last_visited === null) return -1;
      if (b.last_visited === null) return 1;
      return a.last_visited.localeCompare(b.last_visited) || a.name.localeCompare(b.name, "en-GB");
    })
    .map((row) => ({
      propId: row.territory_id,
      name: row.name,
      line: row.last_visited === null ? "Never visited" : `Last visited ${weekLabel(row.last_visited.slice(0, 10))}`,
    }));
}

export function staleTitle(weeks: number): string {
  return weeks === 1 ? "Not visited in a week" : `Not visited in ${weeks} weeks`;
}

/** The chart's text for screen readers: "Doors per week: 5 Oct 120, …". */
export function weeksSummary(weeks: string[], totals: number[]): string {
  return weeks.map((week, i) => `${weekLabel(week)} ${(totals[i] ?? 0).toLocaleString("en-GB")}`).join(", ");
}
