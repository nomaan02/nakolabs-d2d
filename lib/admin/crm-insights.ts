/**
 * CRM-2 B (owner 2026-10-10, P4a; Figma CRM-2 C1–C9 approved 2026-10-10).
 * Pure logic for the "Company CRM" view of Insights: the view switch, the
 * period sheet, the windows sent to `crm_insights`, the figures and rates,
 * and the rows each panel shows. No React, no network. Checked by
 * `npm run verify:crm`.
 *
 * Definitions (CLAUDE 2026-10-10, shown to the owner):
 *   a lead's date      its CRM created time ("lead pulled"), London days
 *   pitched            sale + P&M
 *   pitch → sale       sales ÷ pitched
 *   sit rate           pitched ÷ (pitched + blowout + UTC)
 *   sale rate          sales ÷ leads (areas)
 *   average sale       revenue ÷ sales that carry an amount
 *   No outcome         counted in totals, left out of every rate
 */
import { addDays, dayDate, shortDate } from "@/lib/admin/props";
import { londonDay, londonTime } from "@/lib/admin/calendar";
import { crmStampToIso } from "@/lib/crm/parse";

// ---- periods ------------------------------------------------------------------

export type CrmPeriod = "week" | "month" | "3m" | "12m" | "ytd" | "all";

export const CRM_PERIODS: ReadonlyArray<{ value: CrmPeriod; label: string }> = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "3m", label: "Last 3 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
];

export const DEFAULT_CRM_PERIOD: CrmPeriod = "12m";

export function parseCrmPeriod(value: string | string[] | null | undefined): CrmPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  return CRM_PERIODS.some((p) => p.value === v) ? (v as CrmPeriod) : DEFAULT_CRM_PERIOD;
}

/** London dates, `to` exclusive. `from` null = since the start. */
export type CrmWindow = { from: string | null; to: string | null; byDay: boolean };

function weekday(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function crmWindow(period: CrmPeriod, today: string): CrmWindow {
  const tomorrow = addDays(today, 1);
  switch (period) {
    case "week": {
      const monday = addDays(today, -weekday(today));
      return { from: monday, to: addDays(monday, 7), byDay: true };
    }
    case "month": {
      const first = `${today.slice(0, 8)}01`;
      return { from: first, to: addMonths(first, 1), byDay: true };
    }
    case "3m":
      return { from: addDays(addMonths(today, -3), 1), to: tomorrow, byDay: true };
    case "12m":
      return { from: `${addMonths(today, -11).slice(0, 8)}01`, to: tomorrow, byDay: false };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: tomorrow, byDay: false };
    case "all":
      return { from: null, to: null, byDay: false };
  }
}

/** The instants `crm_insights` takes: London midnights. */
export function crmWindowBounds(window: CrmWindow): { p_from?: string; p_to?: string } {
  const at = (date: string | null) => (date ? (crmStampToIso(date, "Europe/London") ?? undefined) : undefined);
  const bounds: { p_from?: string; p_to?: string } = {};
  const from = at(window.from);
  const to = at(window.to);
  if (from) bounds.p_from = from;
  if (to) bounds.p_to = to;
  return bounds;
}

/** "Mon 5 to Sun 11 Oct", "1 to 10 Oct", "Nov 2025 to today", "All time". */
export function crmWindowLine(period: CrmPeriod, window: CrmWindow, today: string): string {
  if (!window.from) return "All time";
  switch (period) {
    case "week":
      return `${weekdayShort(window.from)} ${Number(window.from.slice(8))} to ${dayDate(addDays(window.from, 6))}`;
    case "month":
      return `1 to ${shortDate(today)}`;
    case "12m":
      return `${monthLabel(window.from.slice(0, 7))} to today`;
    default:
      return `${shortDate(window.from)} to today`;
  }
}

function weekdayShort(date: string): string {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday(date)] ?? "";
}

/** The period sheet: each choice with the dates it covers. */
export function periodOptions(today: string): Array<{ value: CrmPeriod; label: string; span: string }> {
  return CRM_PERIODS.map((p) => {
    const w = crmWindow(p.value, today);
    const span =
      p.value === "all"
        ? "Every CRM lead"
        : p.value === "week" || p.value === "month"
          ? crmWindowLine(p.value, w, today)
          : p.value === "12m"
            ? `Since 1 ${monthLabel(w.from!.slice(0, 7))}`
            : `Since ${shortDate(w.from!)}`;
    return { value: p.value, label: p.label, span };
  });
}

/** For an empty period: the next longer one to offer. */
export function longerPeriod(period: CrmPeriod): CrmPeriod | null {
  const order: CrmPeriod[] = ["week", "month", "3m", "12m", "all"];
  const i = order.indexOf(period);
  return i >= 0 && i < order.length - 1 ? (order[i + 1] ?? null) : period === "ytd" ? "12m" : null;
}

// ---- the view switch --------------------------------------------------------------

export type InsightsView = "canvassing" | "crm";

export function parseInsightsView(value: string | string[] | null | undefined): InsightsView {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "crm" ? "crm" : "canvassing";
}

// ---- the RPC's document -------------------------------------------------------

export type CrmCounts = {
  leads: number;
  sale: number;
  pm: number;
  blowout: number;
  utc: number;
  re_app: number;
  confirmed: number;
  pending: number;
  no_outcome: number;
  revenue: number;
  sales_with_amount: number;
};

export type CrmBucket = CrmCounts & { key: string };
export type CrmSector = { sector: string; leads: number; sale: number; pitched: number; blowout: number; utc: number; revenue: number; sales_with_amount: number };
export type CrmProp = { id: string; name: string; leads: number; sale: number; pitched: number; revenue: number; sales_with_amount: number };
export type CrmConfirmed = {
  crmId: string;
  at: string | null;
  sector: string | null;
  uprn: number | null;
  houseNumber: string | null;
  buildingName: string | null;
  streetName: string | null;
  branch: string;
  canvasser: string | null;
};

export type CrmInsights = {
  totals: CrmCounts & { placed: number };
  months: CrmBucket[];
  days: CrmBucket[] | null;
  sectors: CrmSector[];
  props: CrmProp[];
  confirmed: CrmConfirmed[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

function counts(o: Obj): CrmCounts {
  return {
    leads: num(o.leads),
    sale: num(o.sale),
    pm: num(o.pm),
    blowout: num(o.blowout),
    utc: num(o.utc),
    re_app: num(o.re_app),
    confirmed: num(o.confirmed),
    pending: num(o.pending),
    no_outcome: num(o.no_outcome),
    revenue: num(o.revenue),
    sales_with_amount: num(o.sales_with_amount),
  };
}

/** Reads `crm_insights` defensively: anything missing is zero or empty, never a crash. */
export function parseCrmInsights(raw: unknown): CrmInsights {
  const o = isObj(raw) ? raw : {};
  const totals = isObj(o.totals) ? o.totals : {};
  return {
    totals: { ...counts(totals), placed: num(totals.placed) },
    months: list(o.months).map((m) => ({ ...counts(m), key: str(m.month) ?? "" })).filter((m) => m.key !== ""),
    days: Array.isArray(o.days) ? list(o.days).map((d) => ({ ...counts(d), key: str(d.day) ?? "" })).filter((d) => d.key !== "") : null,
    sectors: list(o.sectors)
      .map((s) => ({
        sector: str(s.sector) ?? "",
        leads: num(s.leads),
        sale: num(s.sale),
        pitched: num(s.pitched),
        blowout: num(s.blowout),
        utc: num(s.utc),
        revenue: num(s.revenue),
        sales_with_amount: num(s.sales_with_amount),
      }))
      .filter((s) => s.sector !== ""),
    props: list(o.props)
      .map((p) => ({
        id: str(p.id) ?? "",
        name: str(p.name) ?? "Unnamed prop",
        leads: num(p.leads),
        sale: num(p.sale),
        pitched: num(p.pitched),
        revenue: num(p.revenue),
        sales_with_amount: num(p.sales_with_amount),
      }))
      .filter((p) => p.id !== ""),
    confirmed: list(o.confirmed).map((c) => ({
      crmId: str(c.crm_id) ?? "",
      at: str(c.at),
      sector: str(c.sector),
      uprn: c.uprn === null || c.uprn === undefined ? null : num(c.uprn),
      houseNumber: str(c.house_number),
      buildingName: str(c.building_name),
      streetName: str(c.street_name),
      branch: str(c.branch) ?? "",
      canvasser: str(c.canvasser),
    })),
  };
}

// ---- rates and money ----------------------------------------------------------

export function share(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function pitched(c: Pick<CrmCounts, "sale" | "pm">): number {
  return c.sale + c.pm;
}

export function pitchToSale(c: Pick<CrmCounts, "sale" | "pm">): number | null {
  return share(c.sale, pitched(c));
}

export function sitRate(c: Pick<CrmCounts, "sale" | "pm" | "blowout" | "utc">): number | null {
  return share(pitched(c), pitched(c) + c.blowout + c.utc);
}

export function averageSale(c: Pick<CrmCounts, "revenue" | "sales_with_amount">): number | null {
  return c.sales_with_amount > 0 ? c.revenue / c.sales_with_amount : null;
}

/** "34%", "–" when there is nothing to divide by. */
export function percent(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

const POUNDS = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

export function pounds(value: number | null): string {
  return value === null ? "–" : POUNDS.format(Math.round(value));
}

/** "£3.5m", "£48k", "£950" for tight spaces; full figure in the title. */
export function poundsShort(value: number): string {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 10_000) return `£${Math.round(value / 1000)}k`;
  if (value >= 1000) return `£${(value / 1000).toFixed(1)}k`;
  return POUNDS.format(Math.round(value));
}

const n = (v: number): string => v.toLocaleString("en-GB");

export type CrmFigure = { label: string; value: string; detail: string | null };

/** The three big numbers at the top of the CRM view. */
export function heroFigures(t: CrmCounts): CrmFigure[] {
  return [
    { label: "Leads", value: n(t.leads), detail: null },
    { label: "Sold", value: n(t.sale), detail: null },
    { label: "Sales value", value: poundsShort(t.revenue), detail: pounds(t.revenue) },
  ];
}

/** The three rates under the bar, each with its working. */
export function rateFigures(t: CrmCounts): CrmFigure[] {
  const p = pitched(t);
  const sat = p + t.blowout + t.utc;
  const missing = t.sale - t.sales_with_amount;
  return [
    { label: "Pitch → sale", value: percent(pitchToSale(t)), detail: `${n(t.sale)} of ${n(p)}` },
    { label: "Sit rate", value: percent(sitRate(t)), detail: `${n(p)} of ${n(sat)}` },
    {
      label: "Average sale",
      value: pounds(averageSale(t)),
      detail: missing > 0 ? (missing === 1 ? "1 sale has no amount" : `${n(missing)} sales have no amount`) : t.sale > 0 ? "Every sale priced" : null,
    },
  ];
}

export type SplitRow = { segment: OutcomeSegment; label: string; count: number; share: number; percent: string };

/** Where every lead in the period went: one row per segment, in key order. */
export function leadSplit(t: CrmCounts): SplitRow[] {
  const seg = segmentsOf(t);
  return OUTCOME_SEGMENTS.map((segment) => {
    const count = seg[segment];
    const s = t.leads > 0 ? count / t.leads : 0;
    return { segment, label: SEGMENT_LABEL[segment], count, share: s, percent: t.leads > 0 ? `${Math.round(s * 100)}%` : "–" };
  });
}

// ---- outcomes by month / day ---------------------------------------------------

export const OUTCOME_SEGMENTS = ["sale", "pm", "blowout", "utc", "other"] as const;
export type OutcomeSegment = (typeof OUTCOME_SEGMENTS)[number];

export const SEGMENT_LABEL: Record<OutcomeSegment, string> = {
  sale: "Sold",
  pm: "Pitch & miss",
  blowout: "Blowout",
  utc: "Unable to contact",
  other: "Other",
};

export type OutcomeColumn = {
  key: string;
  label: string;
  title: string;
  leads: number;
  segments: Record<OutcomeSegment, number>;
  revenue: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

function nextMonth(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function segmentsOf(b: CrmCounts): Record<OutcomeSegment, number> {
  return { sale: b.sale, pm: b.pm, blowout: b.blowout, utc: b.utc, other: Math.max(0, b.leads - b.sale - b.pm - b.blowout - b.utc) };
}

const EMPTY: CrmCounts = { leads: 0, sale: 0, pm: 0, blowout: 0, utc: 0, re_app: 0, confirmed: 0, pending: 0, no_outcome: 0, revenue: 0, sales_with_amount: 0 };

/**
 * One column per day (short windows) or per month, gaps filled, so the axis
 * is continuous. All time runs from the first month with a lead.
 */
export function outcomeColumns(data: CrmInsights, window: CrmWindow, today: string): OutcomeColumn[] {
  if (window.byDay && data.days && window.from) {
    const byKey = new Map(data.days.map((d) => [d.key, d] as const));
    const last = window.to ? addDays(window.to, -1) : today;
    const cols: OutcomeColumn[] = [];
    for (let day = window.from; day <= last && cols.length < 93; day = addDays(day, 1)) {
      const b = byKey.get(day) ?? { ...EMPTY, key: day };
      cols.push({ key: day, label: shortDate(day), title: dayDate(day), leads: b.leads, segments: segmentsOf(b), revenue: b.revenue });
    }
    return cols;
  }
  const byKey = new Map(data.months.map((m) => [m.key, m] as const));
  const first = window.from ? window.from.slice(0, 7) : (data.months[0]?.key ?? today.slice(0, 7));
  const lastDay = window.to ? addDays(window.to, -1) : today;
  const last = (lastDay > today ? today : lastDay).slice(0, 7);
  const cols: OutcomeColumn[] = [];
  for (let key = first; key <= last && cols.length < 120; key = nextMonth(key)) {
    const b = byKey.get(key) ?? { ...EMPTY, key };
    cols.push({ key, label: MONTHS[Number(key.slice(5, 7)) - 1] ?? key, title: monthLabel(key), leads: b.leads, segments: segmentsOf(b), revenue: b.revenue });
  }
  return cols;
}

export function columnTitle(col: OutcomeColumn): string {
  const parts = OUTCOME_SEGMENTS.filter((s) => col.segments[s] > 0).map((s) => `${col.segments[s]} ${SEGMENT_LABEL[s].toLowerCase()}`);
  return `${col.title}: ${col.leads.toLocaleString("en-GB")} leads${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

/** Screen-reader summary of the outcomes chart. */
export function outcomeSummary(cols: OutcomeColumn[], totals: CrmCounts): string {
  if (cols.length === 0) return "No CRM leads in this period.";
  return `${totals.leads} leads over ${cols.length} ${cols.length === 1 ? "column" : "columns"}: ${totals.sale} sold, ${totals.pm} pitch and miss, ${totals.blowout} blowouts, ${totals.utc} unable to contact.`;
}

/** The line above the chart for the chosen column: "Oct 2026 so far" / "167 leads, 4 sold". */
export function columnReadout(col: OutcomeColumn, today: string, mode: "leads" | "value"): { title: string; line: string } {
  const current = col.key.length === 7 ? col.key === today.slice(0, 7) : col.key === today;
  const title = current ? (col.key.length === 7 ? `${col.title} so far` : `${col.title}, today`) : col.title;
  const sold = col.segments.sale;
  if (mode === "value") return { title, line: col.revenue > 0 ? `${pounds(col.revenue)} from ${n(sold)} sold` : sold > 0 ? `${n(sold)} sold, no amounts` : "No sales" };
  return { title, line: `${n(col.leads)} ${col.leads === 1 ? "lead" : "leads"}, ${n(sold)} sold${col.revenue > 0 ? `, ${poundsShort(col.revenue)}` : ""}` };
}

/** Which columns get an axis label: at most `max`, evenly spaced, always the last. */
export function axisTicks(count: number, max: number): number[] {
  if (count <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil(count / max);
  const ticks: number[] = [];
  for (let i = count - 1; i >= 0; i -= step) ticks.unshift(i);
  return ticks;
}

/** Axis words: a month's first letter on a phone when all 12 fit, else its short name. */
export function axisLabel(col: OutcomeColumn, compact: boolean): string {
  if (col.key.length === 7) return compact ? col.label.charAt(0) : col.label;
  return compact ? String(Number(col.key.slice(8))) : col.label;
}

// ---- areas ---------------------------------------------------------------------

/** Short windows have fewer leads per area, so the bar to be ranked is lower. */
export function minLeadsForAreas(period: CrmPeriod): number {
  return period === "week" || period === "month" ? 5 : 20;
}

export type AreaRow = { sector: string; leads: number; sale: number; saleRate: number; line: string };

export function areaRankings(sectors: CrmSector[], minLeads: number, size = 5): { best: AreaRow[]; worst: AreaRow[]; ranked: number } {
  const rows = sectors
    .filter((s) => s.leads >= minLeads)
    .map((s) => ({
      sector: s.sector,
      leads: s.leads,
      sale: s.sale,
      saleRate: s.sale / s.leads,
      line: `${n(s.sale)} sold of ${n(s.leads)} leads`,
    }));
  const byBest = [...rows].sort((a, b) => b.saleRate - a.saleRate || b.leads - a.leads || a.sector.localeCompare(b.sector));
  // Few areas: split them so "worst" is never empty while "best" holds them all.
  const best = byBest.slice(0, Math.min(size, Math.ceil(rows.length / 2)));
  const bestKeys = new Set(best.map((r) => r.sector));
  const worst = [...rows]
    .sort((a, b) => a.saleRate - b.saleRate || b.leads - a.leads || a.sector.localeCompare(b.sector))
    .filter((r) => !bestKeys.has(r.sector))
    .slice(0, size);
  return { best, worst, ranked: rows.length };
}

// ---- props ---------------------------------------------------------------------

export type PropRow = {
  id: string;
  name: string;
  leads: number;
  sale: number;
  pitched: number;
  pitchToSale: number | null;
  average: number | null;
  revenue: number;
  line: string;
};

export function propRows(props: CrmProp[]): PropRow[] {
  return props
    .filter((p) => p.leads > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      leads: p.leads,
      sale: p.sale,
      pitched: p.pitched,
      pitchToSale: share(p.sale, p.pitched),
      average: averageSale(p),
      revenue: p.revenue,
      line: `${n(p.sale)} sold of ${n(p.pitched)} pitched, ${n(p.leads)} leads`,
    }))
    .sort((a, b) => b.sale - a.sale || b.pitched - a.pitched || b.leads - a.leads || a.name.localeCompare(b.name));
}

export type PropSort = "sales" | "high" | "low";

export const PROP_SORTS: ReadonlyArray<{ value: PropSort; label: string }> = [
  { value: "sales", label: "Most sales" },
  { value: "high", label: "Highest average" },
  { value: "low", label: "Lowest average" },
];

/** The props list in the chosen order, with the figure on the right. Averages need a priced sale. */
export function sortedProps(rows: PropRow[], sort: PropSort, size = 10): Array<PropRow & { value: string; sub: string }> {
  const priced = rows.filter((r) => r.average !== null);
  const ordered =
    sort === "sales"
      ? rows
      : [...priced].sort((a, b) => (sort === "high" ? (b.average ?? 0) - (a.average ?? 0) : (a.average ?? 0) - (b.average ?? 0)) || a.name.localeCompare(b.name));
  return ordered.slice(0, size).map((r) =>
    sort === "sales"
      ? { ...r, value: r.revenue > 0 ? pounds(r.revenue) : `${n(r.sale)} sold`, sub: r.pitched > 0 ? `${percent(r.pitchToSale)} of pitches sold` : "Nothing pitched" }
      : { ...r, value: pounds(r.average), sub: `${pounds(r.revenue)} from ${n(r.sale)} ${r.sale === 1 ? "sale" : "sales"}` },
  );
}

// ---- confirmed this week ---------------------------------------------------------

export type ConfirmedDay = { day: string; label: string; rows: { key: string; time: string; place: string; meta: string }[] };

/** "21 Upton Road", "Creswicke House, Upton Road", or "BS7 8 area" when the door is not matched. */
export function confirmedPlace(c: Pick<CrmConfirmed, "houseNumber" | "buildingName" | "streetName" | "sector">): string {
  const street = c.streetName?.trim();
  if (street) {
    const front = [c.houseNumber?.trim(), c.buildingName?.trim()].filter(Boolean);
    if (front.length > 0) return c.houseNumber ? `${c.houseNumber} ${street}` : `${front[0]}, ${street}`;
    return street;
  }
  return c.sector ? `${c.sector} area` : "Area not known";
}

export function confirmedByDay(rows: CrmConfirmed[]): ConfirmedDay[] {
  const days = new Map<string, ConfirmedDay>();
  for (const c of rows) {
    if (!c.at) continue;
    const day = londonDay(c.at);
    const group = days.get(day) ?? { day, label: dayDate(day), rows: [] };
    group.rows.push({
      key: c.crmId || `${day}-${group.rows.length}`,
      time: londonTime(c.at),
      place: confirmedPlace(c),
      meta: [c.branch, c.canvasser].filter((v): v is string => Boolean(v)).join(", "),
    });
    days.set(day, group);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The CRM view at a period (the default period keeps the URL short). */
export function crmHref(period: CrmPeriod): string {
  return period === DEFAULT_CRM_PERIOD ? "/admin/insights?view=crm" : `/admin/insights?view=crm&crm=${period}`;
}

export function canvassingHref(): string {
  return "/admin/insights";
}
