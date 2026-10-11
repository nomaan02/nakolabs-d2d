/**
 * CRM-2 B (owner 2026-10-10, P4a; Figma CRM-2 C3–C6, D2 approved 2026-10-10).
 * Pure logic for CRM data on the admin maps:
 * the Coverage "CRM" chip (heat map or doors, in the URL as `crm=`), the
 * door outcome filter (Coverage and Props), the heat squares, and the words
 * for a tapped door or square. Admin only: nothing here is ever imported by
 * a /field file (`verify:crm` checks). Checked by `npm run verify:crm`.
 */
import { shortDate } from "@/lib/admin/props";
import { londonDay } from "@/lib/admin/calendar";
import { percent, pounds, poundsShort, share } from "@/lib/admin/crm-insights";

// ---- door outcomes -------------------------------------------------------------

export type CrmDoorGroup = "sale" | "pm" | "blowout" | "utc" | "other";
export type CrmDoorFilter = "all" | CrmDoorGroup;

export const CRM_DOOR_FILTERS: ReadonlyArray<{ value: CrmDoorFilter; label: string }> = [
  { value: "all", label: "All CRM doors" },
  { value: "sale", label: "Sold" },
  { value: "pm", label: "Pitch & miss" },
  { value: "blowout", label: "Blowout" },
  { value: "utc", label: "Unable to contact" },
  { value: "other", label: "Other" },
];

/** Short words for the Props filter buttons. */
export const CRM_FILTER_SHORT: Record<CrmDoorFilter, string> = { all: "All", sale: "Sold", pm: "P&M", blowout: "Blowout", utc: "UTC", other: "Other" };

export const CRM_GROUP_LABEL: Record<CrmDoorGroup, string> = {
  sale: "Sold",
  pm: "Pitch & miss",
  blowout: "Blowout",
  utc: "Unable to contact",
  other: "Other",
};

/** Booked, re-app, uncontacted and no outcome are all "Other" on the map. */
export function crmDoorGroup(status: string | null): CrmDoorGroup {
  return status === "sale" || status === "pm" || status === "blowout" || status === "utc" ? status : "other";
}

const STATUS_WORDS: Record<string, string> = {
  sale: "Sold",
  pm: "Pitch & miss",
  blowout: "Blowout",
  utc: "Unable to contact",
  re_app: "Re-app",
  confirmed: "Confirmed",
  pending: "Uncontacted",
};

export function crmStatusWords(status: string | null): string {
  return status ? (STATUS_WORDS[status] ?? status) : "No outcome";
}

export type CrmDoor = {
  uprn: number;
  lon: number;
  lat: number;
  latestStatus: string | null;
  latestAt: string | null;
  leads: number;
  sale: number;
  pm: number;
  blowout: number;
  utc: number;
  other: number;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** `crm_door_history` rows; a row without a usable door or point is dropped. */
export function parseCrmDoors(raw: unknown): CrmDoor[] {
  if (!Array.isArray(raw)) return [];
  const out: CrmDoor[] = [];
  for (const r of raw) {
    if (!isObj(r)) continue;
    const uprn = num(r.uprn);
    const lon = num(r.lon);
    const lat = num(r.lat);
    if (uprn === null || lon === null || lat === null) continue;
    out.push({
      uprn,
      lon,
      lat,
      latestStatus: typeof r.latest_status === "string" ? r.latest_status : null,
      latestAt: typeof r.latest_at === "string" ? r.latest_at : null,
      leads: num(r.leads) ?? 0,
      sale: num(r.sale) ?? 0,
      pm: num(r.pm) ?? 0,
      blowout: num(r.blowout) ?? 0,
      utc: num(r.utc) ?? 0,
      other: num(r.other) ?? 0,
    });
  }
  return out;
}

export function filterCrmDoors(doors: CrmDoor[], filter: CrmDoorFilter): CrmDoor[] {
  return filter === "all" ? doors : doors.filter((d) => crmDoorGroup(d.latestStatus) === filter);
}

export function crmDoorFeatures(doors: CrmDoor[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: doors.map((d) => ({
      type: "Feature",
      id: d.uprn,
      geometry: { type: "Point", coordinates: [d.lon, d.lat] },
      properties: { uprn: d.uprn, group: crmDoorGroup(d.latestStatus) },
    })),
  };
}

/** "Sold, 12 Mar 2025". */
export function crmDoorLatest(d: Pick<CrmDoor, "latestStatus" | "latestAt">): string {
  if (!d.latestAt) return crmStatusWords(d.latestStatus);
  const day = londonDay(d.latestAt);
  return `${crmStatusWords(d.latestStatus)}, ${shortDate(day)} ${day.slice(0, 4)}`;
}

/** "3 CRM leads: 1 sold, 1 pitch & miss, 1 blowout". */
export function crmDoorCounts(d: Pick<CrmDoor, "leads" | "sale" | "pm" | "blowout" | "utc" | "other">): string {
  const parts = (
    [
      [d.sale, "sold"],
      [d.pm, "pitch & miss"],
      [d.blowout, "blowout"],
      [d.utc, "unable to contact"],
      [d.other, "other"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`);
  const head = d.leads === 1 ? "1 CRM lead" : `${d.leads} CRM leads`;
  return parts.length > 1 ? `${head}: ${parts.join(", ")}` : head;
}

/** How many doors each filter would show (the picker's counts). */
export function crmDoorTally(doors: CrmDoor[]): Record<CrmDoorFilter, number> {
  const tally: Record<CrmDoorFilter, number> = { all: doors.length, sale: 0, pm: 0, blowout: 0, utc: 0, other: 0 };
  for (const d of doors) tally[crmDoorGroup(d.latestStatus)] += 1;
  return tally;
}

// ---- the Coverage chip ----------------------------------------------------------

export type CrmView = "off" | "heat-rate" | "heat-leads" | `doors-${CrmDoorFilter}`;

export const CRM_VIEWS: ReadonlyArray<{ value: CrmView; label: string }> = [
  { value: "off", label: "No CRM layer" },
  { value: "heat-rate", label: "Heat map: sale rate" },
  { value: "heat-leads", label: "Heat map: number of leads" },
  ...CRM_DOOR_FILTERS.map((f) => ({ value: `doors-${f.value}` as CrmView, label: f.value === "all" ? "Doors: every CRM door" : `Doors: ${f.label}` })),
];

export function parseCrmView(value: string | string[] | null | undefined): CrmView {
  const v = Array.isArray(value) ? value[0] : value;
  return CRM_VIEWS.some((o) => o.value === v) ? (v as CrmView) : "off";
}

export function crmViewKind(view: CrmView): "off" | "heat" | "doors" {
  return view === "off" ? "off" : view.startsWith("heat-") ? "heat" : "doors";
}

export function crmViewDoorFilter(view: CrmView): CrmDoorFilter {
  const f = view.startsWith("doors-") ? view.slice(6) : "all";
  return CRM_DOOR_FILTERS.some((o) => o.value === f) ? (f as CrmDoorFilter) : "all";
}

export function crmChip(view: CrmView): string {
  if (view === "off") return "CRM";
  if (view === "heat-rate") return "CRM: sale rate";
  if (view === "heat-leads") return "CRM: leads";
  const f = crmViewDoorFilter(view);
  return f === "all" ? "CRM doors" : `CRM: ${CRM_GROUP_LABEL[f]}`;
}

/** Keeps the CRM layer across every other Coverage filter change. */
export function withCrmView(href: string, view: CrmView): string {
  if (view === "off") return href;
  return `${href}${href.includes("?") ? "&" : "?"}crm=${view}`;
}

// ---- heat squares -----------------------------------------------------------------

export type HeatCell = { lon: number; lat: number; leads: number; sales: number; pitched: number; revenue: number };

export function parseHeatCells(raw: unknown): HeatCell[] {
  if (!Array.isArray(raw)) return [];
  const out: HeatCell[] = [];
  for (const r of raw) {
    if (!isObj(r)) continue;
    const lon = num(r.lon);
    const lat = num(r.lat);
    if (lon === null || lat === null) continue;
    out.push({ lon, lat, leads: num(r.leads) ?? 0, sales: num(r.sales) ?? 0, pitched: num(r.pitched) ?? 0, revenue: num(r.revenue) ?? 0 });
  }
  return out;
}

/** Sale-rate steps (sales ÷ leads). Squares with fewer than 3 pitched read "too few". */
export const RATE_STEPS: ReadonlyArray<{ min: number; label: string }> = [
  { min: 0, label: "Under 2%" },
  { min: 0.02, label: "2–5%" },
  { min: 0.05, label: "5–10%" },
  { min: 0.1, label: "10% or more" },
];

export const LEAD_STEPS: ReadonlyArray<{ min: number; label: string }> = [
  { min: 5, label: "5–9 leads" },
  { min: 10, label: "10–19" },
  { min: 20, label: "20–34" },
  { min: 35, label: "35 or more" },
];

/** 0–3 (a step of the single-hue ramp) or -1 for "too few to say". */
export function heatStep(cell: HeatCell, metric: "rate" | "leads"): number {
  if (metric === "leads") {
    let step = 0;
    LEAD_STEPS.forEach((s, i) => {
      if (cell.leads >= s.min) step = i;
    });
    return step;
  }
  if (cell.pitched < 3) return -1;
  const rate = cell.sales / cell.leads;
  let step = 0;
  RATE_STEPS.forEach((s, i) => {
    if (rate >= s.min) step = i;
  });
  return step;
}

const HALF = 125;

/** A 250 m square around the centre (metres → degrees at that latitude; close enough at this size). */
export function cellSquare(cell: Pick<HeatCell, "lon" | "lat">): GeoJSON.Polygon {
  const dLat = HALF / 111_320;
  const dLon = HALF / (111_320 * Math.cos((cell.lat * Math.PI) / 180));
  const { lon, lat } = cell;
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - dLon, lat - dLat],
        [lon + dLon, lat - dLat],
        [lon + dLon, lat + dLat],
        [lon - dLon, lat + dLat],
        [lon - dLon, lat - dLat],
      ],
    ],
  };
}

export function heatFeatures(cells: HeatCell[], metric: "rate" | "leads"): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: "FeatureCollection",
    features: cells.map((cell, i) => ({
      type: "Feature",
      id: i,
      geometry: cellSquare(cell),
      properties: { i, step: heatStep(cell, metric) },
    })),
  };
}

/** A tapped square: four figures and one line of working. */
export function heatCellFigures(cell: HeatCell): { figures: Array<{ value: string; label: string }>; line: string } {
  return {
    figures: [
      { value: cell.leads.toLocaleString("en-GB"), label: "Leads" },
      { value: cell.sales.toLocaleString("en-GB"), label: "Sold" },
      { value: percent(share(cell.sales, cell.leads)), label: "Sale rate" },
      { value: cell.revenue > 0 ? poundsShort(cell.revenue) : "–", label: "Sales value" },
    ],
    line: `${cell.pitched.toLocaleString("en-GB")} pitched, pitch → sale ${percent(share(cell.sales, cell.pitched))}${cell.revenue > 0 ? `, ${pounds(cell.revenue)} in total` : ""}`,
  };
}

/** The square's corners for fitting the map to it. */
export function cellBox(cell: Pick<HeatCell, "lon" | "lat">): [[number, number], [number, number]] {
  const ring = cellSquare(cell).coordinates[0]!;
  return [ring[0] as [number, number], ring[2] as [number, number]];
}

/** How many CRM doors fall inside a square (for "Show its N doors"). */
export function doorsInCell(doors: CrmDoor[], cell: Pick<HeatCell, "lon" | "lat">): number {
  const [[w, s], [e, n]] = cellBox(cell);
  return doors.filter((d) => d.lon >= w && d.lon <= e && d.lat >= s && d.lat <= n).length;
}
