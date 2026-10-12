/**
 * CRM-1 B. Pure parsing of CRM (vtiger) lead rows into what `crm_leads` stores.
 *
 * Owner 2026-10-10: names, phones, notes and best time to call are never read
 * (they are not even requested; see CRM_LEAD_FIELDS). The street and house
 * number are parsed only to feed the matcher and are never stored.
 *
 * Owner 2026-10-11 (CRM-3): from about Nov 2025 the office stopped filling
 * "Sale Amount" (cf_861) and types the price into the free-text "Result"
 * (cf_867) or "Rep Result" (cf_881) box instead. Those two boxes are read
 * here, on the server, for Sold leads only; only the price number leaves this
 * file. The text itself is never stored, logged or returned.
 *
 * Owner 2026-10-11 (CRM-5, P4b): the same notes decide whether a lead goes on
 * its canvasser's call-back list (`callbackReason`); only the reason label
 * leaves this file. For call-back leads the title, surname and phone numbers
 * are read too (`contact`); lib/crm/sync.ts stores them in crm_contacts for
 * 90 days, readable only by that canvasser. First names are never read.
 */

export const CRM_LEAD_FIELDS = [
  "id",
  "lead_no",
  "lane",
  "code",
  "leadstatus",
  "createdtime",
  "modifiedtime",
  "cf_855",
  "cf_857",
  "cf_861",
  "cf_865",
  "cf_867",
  "cf_879",
  "cf_881",
  "cf_877",
  "lastname",
  "phone",
  "cf_1014",
] as const;

/** Contact fields (CRM-5): Title, Last Name, Primary Phone, Alt Phone. Never First Name. */
export const CRM_CONTACT_FIELDS = ["cf_877", "lastname", "phone", "cf_1014"] as const;

/** Free-text boxes read only for a price, never stored (owner 2026-10-11). */
export const CRM_PRICE_TEXT_FIELDS = ["cf_867", "cf_881"] as const;

export type CrmLeadField = (typeof CRM_LEAD_FIELDS)[number];
export type CrmLeadRow = Partial<Record<CrmLeadField, string | null>> & { id: string };

export type CrmDatetimeZone = "UTC" | "Europe/London";

export type AppCrmStatus = "sale" | "pm" | "blowout" | "utc" | "re_app" | "confirmed" | "pending";

/** Where a Sold lead's price came from: Sale Amount, Result or Rep Result. Counted, never stored. */
export type SaleAmountSource = "sale_amount" | "result" | "rep_result";

export type MatchInput = {
  crm_id: string;
  postcode: string | null;
  number: number | null;
  suffix: string;
  street: string | null;
};

/** Why a lead belongs on its canvasser's call-back list (CRM-5). */
export const CALLBACK_REASONS = ["utc", "no_outcome", "reapp", "single_sit", "not_convenient", "no_time", "rta", "rearrange", "no_answer"] as const;
export type CallbackReason = (typeof CALLBACK_REASONS)[number];

/** Held in memory for one sync; stored only for call-back leads (crm_contacts). */
export type CrmContact = { title: string | null; surname: string | null; phone: string | null; alt_phone: string | null };

export type ParsedCrmLead = {
  crm_id: string;
  lead_no: string | null;
  status_raw: string | null;
  status: AppCrmStatus | null;
  status_unknown: boolean;
  crm_created_at: string;
  crm_modified_at: string;
  appointment_at: string | null;
  branch: string;
  sale_amount: number | null;
  sale_amount_source: SaleAmountSource | null;
  callback_reason: CallbackReason | null;
  contact: CrmContact;
  postcode: string | null;
  postcode_sector: string | null;
  canvasser_first_name: string | null;
  match: MatchInput;
};

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

/** vtiger may HTML-encode text ('Pitch&amp;Miss', 'St Mary&#039;s Road'). Decode before anything else. */
export function decodeCrmText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return raw.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const POSTCODE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

/** 'bs78ab ' -> 'BS7 8AB'; anything that is not a full UK postcode -> null. */
export function normaliseCrmPostcode(raw: string | null | undefined): string | null {
  const compact = (raw ?? "").toUpperCase().replace(/\s+/g, "");
  const m = POSTCODE.exec(compact);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** 'BS7 8AB' -> 'BS7 8'. */
export function postcodeSector(postcode: string | null): string | null {
  return postcode ? postcode.slice(0, -2) : null;
}

export type StreetParts = { number: number | null; suffix: string; street: string | null };

/**
 * First address line -> house number, letter and street. Handles
 * '23 Upton Road', '23A Upton Road', '21-23 Upton Road', '23, Upton Road',
 * 'Flat 2, 23 Upton Road', multi-line and trailing town after a comma.
 */
export function parseStreetLine(raw: string | null | undefined): StreetParts {
  const text = (raw ?? "")
    .replace(/\r?\n|\|/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { number: null, suffix: "", street: null };

  const lead = /^(\d{1,4})(?:\s*-\s*\d{1,4})?([A-Za-z])?(?=[\s,]|$)[\s,]*(.*)$/.exec(text);
  const inner = lead ? null : /(?:^|[\s,])(\d{1,4})([A-Za-z])?[\s,]+([A-Za-z][^,]*)/.exec(text);
  const hit = lead ?? inner;
  if (!hit) return { number: null, suffix: "", street: firstPart(text) };

  const number = Number.parseInt(hit[1] ?? "", 10);
  return {
    number: Number.isFinite(number) && number > 0 ? number : null,
    suffix: (hit[2] ?? "").toUpperCase(),
    street: firstPart(hit[3] ?? ""),
  };
}

function firstPart(text: string): string | null {
  const part = (text.split(",")[0] ?? "").trim();
  return /[A-Za-z]/.test(part) ? part : null;
}

/** 'JOHN smith' -> 'John'; 'o'neil' -> "O'neil"; blank -> null. First name only (AGENTS). */
export function canvasserFirstName(raw: string | null | undefined): string | null {
  const m = /[A-Za-z][A-Za-z'-]*/.exec(raw ?? "");
  if (!m) return null;
  const word = m[0].toLowerCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** CRM currency text -> pounds, or null when blank / zero / not a number. */
export function saleAmount(raw: string | null | undefined): number | null {
  const n = Number.parseFloat((raw ?? "").replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  const pounds = Math.round(n * 100) / 100;
  return pounds > 0 && pounds < 1e10 ? pounds : null;
}

const POUND_MIN = 100;
const BARE_MIN = 300;
const PRICE_MAX = 100_000;
const POUND_PRICE = /£\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?![\d,])/g;
/** A bare 3–6 digit number not starting with 0: not part of a time (11:45, 11.45), a phone or a longer number. */
const BARE_PRICE = /(?<![\d:.,£])([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,5})(?![\d:,]|\.\d)/g;

function firstPrice(text: string, pattern: RegExp, min: number): number | null {
  for (const m of text.matchAll(pattern)) {
    const n = Number.parseInt((m[1] ?? "").replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n >= min && n <= PRICE_MAX) return n;
  }
  return null;
}

/**
 * A price typed into free text ("Bristol Earl £2534", "Bristol 4792 Ryan H").
 * A £ amount (£100 to £100,000) wins; otherwise the first bare number from
 * 300 to 100,000. Times, phone numbers and years written with other digits are skipped.
 * Returns the number only; the text is not kept.
 */
export function priceInText(raw: string | null | undefined): number | null {
  const text = (raw ?? "").replace(/\s+/g, " ");
  if (!text.trim()) return null;
  return firstPrice(text, POUND_PRICE, POUND_MIN) ?? firstPrice(text, BARE_PRICE, BARE_MIN);
}

/** Sale Amount first; for a Sold lead only, then the price in Result, then in Rep Result. */
export function leadSaleAmount(
  status: AppCrmStatus | null,
  amountField: string | null | undefined,
  resultText: string | null | undefined,
  repResultText: string | null | undefined,
): { amount: number | null; source: SaleAmountSource | null } {
  const amount = saleAmount(amountField);
  if (amount !== null) return { amount, source: "sale_amount" };
  if (status !== "sale") return { amount: null, source: null };
  const fromResult = priceInText(resultText);
  if (fromResult !== null) return { amount: fromResult, source: "result" };
  const fromRep = priceInText(repResultText);
  if (fromRep !== null) return { amount: fromRep, source: "rep_result" };
  return { amount: null, source: null };
}

// ---- call-back list (owner 2026-10-11, CRM-5) --------------------------------

/** Any of these in the notes keeps a lead OFF the list, whatever else matches. */
const CALLBACK_NEVER: readonly RegExp[] = [
  /\b(titc|ritc)\b/i, // texted / rang in to cancel
  /\bcancel(l?ed|s|ling|lation)?\b/i,
  /not interested|\bn\/i\b|no interest/i,
  /chang(ed|e of) (their |her |his )?mind/i,
  /wrong (number|no\b|num)/i,
  /already (had|got|has|have|done)|had (it|them|the windows?|the doors?|windows?|doors?) done|\bwithin (the last )?\d+ ?(years?|yrs?)\b/i,
  /do not (call|contact)|don'?t (call|contact)|deceased|passed away/i,
];

/** Blowout notes that make a lead worth ringing back, in priority order. */
const CALLBACK_BLOWOUT: readonly [CallbackReason, RegExp][] = [
  ["single_sit", /single sit|\b(1|one)[ -]?leg(ger)?\b|\b(partner|hubby|husband|wife|other half)\b.{0,25}\b(not|wasn'?t|isn'?t|out|away|work|working|late)\b/i],
  ["not_convenient", /\b(not|wasn'?t|isn'?t|wasnt|isnt) (a )?(convenient|good time)|inconvenient|bad time/i],
  ["no_time", /\bno time\b|(didn'?t|did not|don'?t|dont|didnt) have (the )?time|not enough time|running late|in a rush|had to (go|leave)|\bbusy\b/i],
  ["rta", /\brta\b/i],
  ["rearrange", /call ?back|ring back|re-?book|re-?arrange|re-?app|another (day|time)|next week|tomorrow/i],
  ["no_answer", /no answer|\bnot in\b|nobody (in|home)|no show|didn'?t answer/i],
  ["utc", /\butc\b/i],
];

/**
 * UTC, no outcome and Re-App are always call-backs; a Blowout is one when its
 * notes give a reason. Any "never" note (cancelled, not interested, wrong
 * number, already done …) wins. Returns the label only; the notes stay here.
 */
export function callbackReason(
  status: AppCrmStatus | null,
  statusUnknown: boolean,
  resultText: string | null | undefined,
  repResultText: string | null | undefined,
): CallbackReason | null {
  if (statusUnknown) return null;
  const notes = `${resultText ?? ""} ${repResultText ?? ""}`.replace(/\s+/g, " ");
  if (CALLBACK_NEVER.some((re) => re.test(notes))) return null;
  if (status === "utc") return "utc";
  if (status === null) return "no_outcome";
  if (status === "re_app") return "reapp";
  if (status !== "blowout") return null;
  for (const [reason, re] of CALLBACK_BLOWOUT) if (re.test(notes)) return reason;
  return null;
}

/** '07700 900 123' -> '07700900123'; '+44 7700…' kept with its +; blank or under 7 digits -> null. */
export function tidyPhone(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  const digits = text.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return text.startsWith("+") ? `+${digits}` : digits;
}

/** 'SMITH' or 'smith' -> 'Smith'; mixed case kept as typed ('McDonald'). */
export function tidyName(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text !== text.toUpperCase() && text !== text.toLowerCase()) return text;
  return text.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

export type StatusResult = { status_raw: string | null; status: AppCrmStatus | null; unknown: boolean };

/** Blank -> "No outcome" (null). A value missing from the map is kept raw and flagged, never guessed. */
export function mapCrmStatus(raw: string | null | undefined, map: ReadonlyMap<string, AppCrmStatus>): StatusResult {
  const text = (raw ?? "").trim();
  if (!text) return { status_raw: null, status: null, unknown: false };
  const status = map.get(text) ?? null;
  return { status_raw: text, status, unknown: status === null };
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

/** Minutes London is ahead of UTC at a given instant (0 or 60). */
function londonOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(utcMs / 60000) * 60000) / 60000);
}

/** 'YYYY-MM-DD[ HH:MM[:SS]]' in the given zone -> ISO UTC string, or null. */
export function crmStampToIso(raw: string | null | undefined, zone: CrmDatetimeZone): string | null {
  const m = STAMP.exec((raw ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h12, mi, s] = m.slice(1, 7).map((v) => Number(v ?? "0"));
  const meridiem = (m[7] ?? "").toUpperCase();
  if (meridiem && ((h12 ?? 0) < 1 || (h12 ?? 0) > 12)) return null;
  const h = meridiem === "PM" ? ((h12 ?? 0) % 12) + 12 : meridiem === "AM" ? (h12 ?? 0) % 12 : (h12 ?? 0);
  if (h > 23 || (mi ?? 0) > 59 || (s ?? 0) > 59) return null;
  const wall = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h, mi ?? 0, s ?? 0);
  const check = new Date(wall);
  if (Number.isNaN(wall) || check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) return null;
  if (zone === "UTC") return new Date(wall).toISOString();
  const first = wall - londonOffsetMinutes(wall) * 60000;
  const utc = wall - londonOffsetMinutes(first) * 60000;
  return new Date(utc).toISOString();
}

/** ISO instant -> 'YYYY-MM-DD HH:MM:SS' in the CRM's zone (for "modified since" queries). */
export function isoToCrmStamp(iso: string, zone: CrmDatetimeZone): string {
  const ms = Date.parse(iso);
  const shifted = zone === "UTC" ? ms : ms + londonOffsetMinutes(ms) * 60000;
  return new Date(shifted).toISOString().slice(0, 19).replace("T", " ");
}

/** Appointment date + time are wall-clock entries in the office: always London. */
export function appointmentToIso(date: string | null | undefined, time: string | null | undefined): string | null {
  const d = (date ?? "").trim();
  if (!d) return null;
  const t = (time ?? "").trim();
  return crmStampToIso(t ? `${d} ${t}` : d, "Europe/London");
}

export class CrmParseError extends Error {}

export function parseCrmLead(
  raw: CrmLeadRow,
  statusMap: ReadonlyMap<string, AppCrmStatus>,
  zone: CrmDatetimeZone,
): ParsedCrmLead {
  const row: CrmLeadRow = { id: raw.id };
  for (const field of CRM_LEAD_FIELDS) {
    if (field !== "id") row[field] = decodeCrmText(raw[field]);
  }
  const created = crmStampToIso(row.createdtime, zone);
  const modified = crmStampToIso(row.modifiedtime, zone);
  if (!created || !modified) {
    throw new CrmParseError(`CRM lead ${row.id}: unreadable created/modified time`);
  }
  const postcode = normaliseCrmPostcode(row.code);
  const street = parseStreetLine(row.lane);
  const status = mapCrmStatus(row.leadstatus, statusMap);
  const sale = leadSaleAmount(status.status, row.cf_861, row.cf_867, row.cf_881);
  const phone = tidyPhone(row.phone);
  const altPhone = tidyPhone(row.cf_1014);
  return {
    crm_id: row.id,
    lead_no: (row.lead_no ?? "").trim() || null,
    status_raw: status.status_raw,
    status: status.status,
    status_unknown: status.unknown,
    crm_created_at: created,
    crm_modified_at: modified,
    appointment_at: appointmentToIso(row.cf_855, row.cf_857),
    branch: (row.cf_879 ?? "").trim() || "Unknown",
    sale_amount: sale.amount,
    sale_amount_source: sale.source,
    callback_reason: callbackReason(status.status, status.unknown, row.cf_867, row.cf_881),
    contact: { title: tidyName(row.cf_877), surname: tidyName(row.lastname), phone: phone ?? altPhone, alt_phone: phone ? altPhone : null },
    postcode,
    postcode_sector: postcodeSector(postcode),
    canvasser_first_name: canvasserFirstName(row.cf_865),
    match: { crm_id: row.id, postcode, number: street.number, suffix: street.suffix, street: street.street },
  };
}
