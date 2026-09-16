/**
 * EPC address-label parsing for Stage 1c.
 * Street is resolved per row: last of address3/address2/address1 that
 * contains a street-type suffix. There is no cross-row vote.
 */

const HOUSE_NUMBER_RE =
  /^(\d+[A-Za-z]?(?:\s*[-/]\s*\d+[A-Za-z]?)?)(?=\s|,|$)/;

const SUB_BUILDING_RE =
  /^(Flat|Studio|Unit)\s+[A-Za-z0-9][A-Za-z0-9-]*\b/i;

/**
 * Street-type suffixes, two tiers. Optional compass (North/South/East/West)
 * may follow. No named-locality stop-list — positional + tier only.
 *
 * STRONG: almost always a street. WEAK: often a locality; only used as the
 * street when no earlier field carries a STRONG suffix.
 */
export const STRONG_STREET_SUFFIXES = [
  "Street",
  "Road",
  "Avenue",
  "Lane",
  "Close",
  "Drive",
  "Crescent",
  "Way",
  "Gardens",
  "Grove",
  "Terrace",
  "Place",
  "Walk",
  "Court",
  "Row",
  "Square",
  "Parade",
  "Villas",
  "Buildings",
  "Wharf",
  "Quay",
  "Mews",
  "Causeway",
  "Promenade",
  "Passage",
  "Path",
  "Steps",
  "Hillside",
  "Meadows",
  "Fields",
  "Croft",
  "Orchard",
  "Approach",
  "Broadway",
  "Circus",
  "Embankment",
] as const;

export const WEAK_STREET_SUFFIXES = [
  "Park",
  "Vale",
  "Green",
  "Hill",
  "Cross",
  "Gate",
  "Barton",
  "View",
  "Rise",
  "Mead",
  "Bridge",
  "Paddock",
  "Hollow",
] as const;

export const STREET_TYPE_SUFFIXES = [
  ...STRONG_STREET_SUFFIXES,
  ...WEAK_STREET_SUFFIXES,
] as const;

const COMPASS_TAIL = "(?:\\s+(?:North|South|East|West))?\\.?";

function endingSuffixRe(list: readonly string[]): RegExp {
  const sorted = [...list].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(?:${sorted.join("|")})\\b${COMPASS_TAIL}$`, "i");
}

const STRONG_SUFFIX_RE = endingSuffixRe(STRONG_STREET_SUFFIXES);
const WEAK_SUFFIX_RE = endingSuffixRe(WEAK_STREET_SUFFIXES);

export type SuffixTier = "strong" | "weak";

export type ParsedLabel = {
  house_number: string | null;
  street_name: string | null;
  building_name: string | null;
  sub_building: string | null;
  ambiguous: boolean;
};

export function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function toTitleCase(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase().replace(/\b[a-z]/g, (ch) =>
    ch.toUpperCase(),
  );
}

/** Letter suffixes on a house number ('12a' → '12A'). Digits are unchanged. */
export function titleHouseNumber(value: string): string {
  return collapseWs(value).replace(/[a-z]/g, (ch) => ch.toUpperCase());
}

/** Merge 'St' and 'St.' so they display as one form. */
export function standardiseSt(value: string): string {
  return value.replace(/\bSt\b\.?/g, "St.");
}

export function normalisePostcode(value: string): string {
  return collapseWs(value).toUpperCase();
}

export function stripLeadingHouseNumber(raw: string): {
  number: string | null;
  rest: string;
} {
  const s = collapseWs(raw);
  if (!s) return { number: null, rest: "" };
  const match = HOUSE_NUMBER_RE.exec(s);
  if (!match) return { number: null, rest: s };
  const rest = s.slice(match[0].length).replace(/^[\s,]+/, "").trim();
  return { number: collapseWs(match[1]).replace(/\s+/g, ""), rest };
}

function tidyField(raw: string): string {
  return collapseWs(raw).replace(/[,/]+$/g, "").trim();
}

function suffixProbe(raw: string): string | null {
  const s = tidyField(raw);
  if (!s) return null;
  const { rest } = stripLeadingHouseNumber(s);
  return tidyField(rest || s) || null;
}

/** Ending suffix tier of a field, or null if it has neither. */
export function fieldSuffixTier(raw: string): SuffixTier | null {
  const probe = suffixProbe(raw);
  if (!probe) return null;
  if (STRONG_SUFFIX_RE.test(probe)) return "strong";
  if (WEAK_SUFFIX_RE.test(probe)) return "weak";
  return null;
}

export function fieldHasStreetSuffix(raw: string): boolean {
  return fieldSuffixTier(raw) !== null;
}

export function isHouseNumberOnly(raw: string): boolean {
  const s = collapseWs(raw).replace(/,/g, "");
  if (!s) return false;
  const { number, rest } = stripLeadingHouseNumber(s);
  return number !== null && rest === "";
}

function fieldStartsWithHouseNumber(raw: string): boolean {
  return stripLeadingHouseNumber(raw).number !== null;
}

/** Strong field is a street, not a building, if it carries a door number. */
export function strongFieldHasHouseNumber(
  fields: string[],
  index: number,
): boolean {
  if (index < 0 || index >= fields.length) return false;
  if (fieldStartsWithHouseNumber(fields[index])) return true;
  return index > 0 && isHouseNumberOnly(fields[index - 1]);
}

export function lastSuffixFieldIndex(fields: string[]): number {
  for (let i = fields.length - 1; i >= 0; i -= 1) {
    if (fieldSuffixTier(fields[i])) return i;
  }
  return -1;
}

/**
 * Last suffix-bearing field, unless that field is WEAK-only and an earlier
 * STRONG field looks like a street (has a house number on it, or the field
 * immediately before it is only a house number). A strong field without a
 * number is treated as a building name and is not promoted.
 */
export function chooseStreetFieldIndex(fields: string[]): number {
  const lastSuffix = lastSuffixFieldIndex(fields);
  if (lastSuffix < 0) return -1;
  if (fieldSuffixTier(fields[lastSuffix]) !== "weak") return lastSuffix;
  for (let i = lastSuffix - 1; i >= 0; i -= 1) {
    if (
      fieldSuffixTier(fields[i]) === "strong" &&
      strongFieldHasHouseNumber(fields, i)
    ) {
      return i;
    }
  }
  return lastSuffix;
}

function startsWithDigit(raw: string): boolean {
  return /^\d/.test(collapseWs(raw));
}

function matchSubBuilding(raw: string): string | null {
  const s = collapseWs(raw);
  const match = SUB_BUILDING_RE.exec(s);
  if (!match) return null;
  return standardiseSt(toTitleCase(match[0]));
}

function normaliseStreetName(raw: string): string | null {
  const s = tidyField(raw);
  if (!s) return null;
  return standardiseSt(toTitleCase(s)) || null;
}

const EMPTY: ParsedLabel = {
  house_number: null,
  street_name: null,
  building_name: null,
  sub_building: null,
  ambiguous: false,
};

/**
 * Per-row parse. Scan address3, then address2, then address1; the street is
 * the last field that contains a street-type suffix, except a trailing WEAK
 * suffix yields to an earlier STRONG field that itself has a house number
 * (or is preceded by a house-number-only field). Strong fields without a
 * number are buildings, not streets.
 *
 * House number is the leading number of that same field. If that field has
 * none, and the field immediately before it is only a house number, take
 * that. If both the street field and the preceding field start with a
 * digit, the number is ambiguous — leave it null. Never borrow a number
 * from Flat/Studio/Unit text.
 */
export function parseAddressRow(
  address1: string,
  address2: string,
  address3: string,
): ParsedLabel {
  const fields = [address1, address2, address3].map((f) => collapseWs(f));

  const streetIdx = chooseStreetFieldIndex(fields);
  if (streetIdx < 0) return EMPTY;

  const streetField = fields[streetIdx];
  const stripped = stripLeadingHouseNumber(streetField);
  const streetName = normaliseStreetName(stripped.rest);
  if (!streetName) return EMPTY;

  const prev = streetIdx > 0 ? fields[streetIdx - 1] : "";
  const ambiguous =
    startsWithDigit(streetField) && prev !== "" && startsWithDigit(prev);

  let houseNumber: string | null = null;
  if (ambiguous) {
    houseNumber = null;
  } else if (stripped.number) {
    houseNumber = titleHouseNumber(stripped.number);
  } else if (prev && isHouseNumberOnly(prev)) {
    const fromPrev = stripLeadingHouseNumber(prev).number;
    houseNumber = fromPrev ? titleHouseNumber(fromPrev) : null;
  }

  let subBuilding: string | null = null;
  let subIdx = -1;
  for (let i = 0; i < streetIdx; i += 1) {
    const sub = matchSubBuilding(fields[i]);
    if (sub) {
      subBuilding = sub;
      subIdx = i;
      break;
    }
  }

  let buildingName: string | null = null;
  if (streetIdx > 0) {
    const before = streetIdx - 1;
    if (
      before !== subIdx &&
      fields[before] &&
      !isHouseNumberOnly(fields[before])
    ) {
      buildingName = standardiseSt(toTitleCase(fields[before]));
    }
  }

  return {
    house_number: houseNumber,
    street_name: streetName,
    building_name: buildingName,
    sub_building: subBuilding,
    ambiguous,
  };
}

/** RFC 4180 single-line parse. Quoted fields may contain commas. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function resolveColumn(headers: string[], name: string): number {
  const i = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  if (i < 0) {
    throw new Error(`Required column '${name}' not found in header`);
  }
  return i;
}

/**
 * Fail fast if nothing matches /uprn/i. Prefer the exact name 'uprn' over
 * 'uprn_source'. Never fall back to address-based matching.
 */
export function resolveUprnColumn(headers: string[]): number {
  const exact = headers.findIndex((h) => h.toLowerCase() === "uprn");
  if (exact >= 0) return exact;
  const withoutSource = headers.findIndex(
    (h) => /uprn/i.test(h) && !/source/i.test(h),
  );
  if (withoutSource >= 0) return withoutSource;
  const any = headers.findIndex((h) => /uprn/i.test(h));
  if (any >= 0) return any;
  throw new Error(
    "No column matching /uprn/i in the header. Refusing to fall back to address-based matching.",
  );
}

/**
 * Detect lodgement/inspection date without assuming a column name.
 * Prefer more precise lodgement timestamps when several match.
 */
export function resolveDateColumn(headers: string[]): number {
  const lower = headers.map((h) => h.toLowerCase());
  const preferred = [
    "lodgement_datetime",
    "lodgement_date",
    "inspection_datetime",
    "inspection_date",
  ];
  for (const name of preferred) {
    const i = lower.indexOf(name);
    if (i >= 0) return i;
  }
  const i = headers.findIndex(
    (h) => /(lodgement|inspection)/i.test(h) && /date/i.test(h),
  );
  if (i >= 0) return i;
  throw new Error(
    "No lodgement/inspection date column in the header. Cannot pick the most recent certificate per UPRN.",
  );
}

/**
 * Parse a lodgement/inspection timestamp from the stored column value.
 * Accepts YYYY-MM-DD with an optional time. Does not parse display text.
 */
export function parseWhen(raw: string): number {
  const s = collapseWs(raw);
  if (!s) return Number.NEGATIVE_INFINITY;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?))?/.exec(
    s,
  );
  if (!m) return Number.NEGATIVE_INFINITY;
  const iso = m[2] ? `${m[1]}T${m[2]}` : `${m[1]}T00:00:00`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

export function isAddressMatchedSource(raw: string): boolean {
  return collapseWs(raw) === "Address Matched";
}

/** Prefer Address Matched; tie-break on most recent stored lodgement time. */
export function isBetterCertificate(
  next: { uprn_source: string; when: number },
  prev: { uprn_source: string; when: number },
): boolean {
  const nextMatched = isAddressMatchedSource(next.uprn_source);
  const prevMatched = isAddressMatchedSource(prev.uprn_source);
  if (nextMatched !== prevMatched) return nextMatched;
  return next.when >= prev.when;
}

export function assertKnownExamples(): void {
  const cases: Array<{
    a1: string;
    a2: string;
    a3: string;
    expect: ParsedLabel;
  }> = [
    {
      a1: "Studio C3",
      a2: "Creswicke House",
      a3: "9 Small Street",
      expect: {
        house_number: "9",
        street_name: "Small Street",
        building_name: "Creswicke House",
        sub_building: "Studio C3",
        ambiguous: false,
      },
    },
    {
      a1: "Flat 1",
      a2: "15 Small Street",
      a3: "",
      expect: {
        house_number: "15",
        street_name: "Small Street",
        building_name: null,
        sub_building: "Flat 1",
        ambiguous: false,
      },
    },
    {
      a1: "Flat 17",
      a2: "St. Giles Court",
      a3: "Small Street",
      expect: {
        house_number: null,
        street_name: "Small Street",
        building_name: "St. Giles Court",
        sub_building: "Flat 17",
        ambiguous: false,
      },
    },
    {
      a1: "14 ST GILES COURT",
      a2: "SMALL STREET",
      a3: "CITY CENTRE",
      expect: {
        house_number: null,
        street_name: "Small Street",
        building_name: "14 St. Giles Court",
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "229, Creswicke Road",
      a2: "",
      a3: "",
      expect: {
        house_number: "229",
        street_name: "Creswicke Road",
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "14A",
      a2: "Small Street",
      a3: "",
      expect: {
        house_number: "14A",
        street_name: "Small Street",
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "14-16 Small Street",
      a2: "",
      a3: "",
      expect: {
        house_number: "14-16",
        street_name: "Small Street",
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "12 FIDDES ROAD",
      a2: "",
      a3: "",
      expect: {
        house_number: "12",
        street_name: "Fiddes Road",
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "Flat 2",
      a2: "35 Herbert Street",
      a3: "",
      expect: {
        house_number: "35",
        street_name: "Herbert Street",
        building_name: null,
        sub_building: "Flat 2",
        ambiguous: false,
      },
    },
    {
      a1: "2",
      a2: "35 Herbert Street",
      a3: "",
      expect: {
        house_number: null,
        street_name: "Herbert Street",
        building_name: null,
        sub_building: null,
        ambiguous: true,
      },
    },
    {
      a1: "36 New Pooles Lodge",
      a2: "31 Maywood Crescent",
      a3: "",
      expect: {
        house_number: null,
        street_name: "Maywood Crescent",
        building_name: "36 New Pooles Lodge",
        sub_building: null,
        ambiguous: true,
      },
    },
    {
      a1: "149 WELLS ROAD",
      a2: "TOTTERDOWN",
      a3: "",
      expect: {
        house_number: "149",
        street_name: "Wells Road",
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "Grange Close North",
      a2: "",
      a3: "",
      expect: {
        house_number: null,
        street_name: "Grange Close North",
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "Studio C3",
      a2: "Creswicke House",
      a3: "CITY CENTRE",
      expect: {
        house_number: null,
        street_name: null,
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "14",
      a2: "Etloe Road",
      a3: "Westbury Park",
      expect: {
        house_number: "14",
        street_name: "Etloe Road",
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "12",
      a2: "Windmill Hill",
      a3: "",
      expect: {
        house_number: "12",
        street_name: "Windmill Hill",
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "5 Cotham Park",
      a2: "",
      a3: "",
      expect: {
        house_number: "5",
        street_name: "Cotham Park",
        building_name: null,
        sub_building: null,
        ambiguous: false,
      },
    },
    {
      a1: "Flat 3",
      a2: "Claremont Court",
      a3: "Henleaze Park",
      expect: {
        house_number: null,
        street_name: "Henleaze Park",
        building_name: "Claremont Court",
        sub_building: "Flat 3",
        ambiguous: false,
      },
    },
    {
      a1: "Flat 2",
      a2: "Cedar Row",
      a3: "Park Hill",
      expect: {
        house_number: null,
        street_name: "Park Hill",
        building_name: "Cedar Row",
        sub_building: "Flat 2",
        ambiguous: false,
      },
    },
    {
      a1: "Flat X",
      a2: "Frome Terrace",
      a3: "Blackberry Hill",
      expect: {
        house_number: null,
        street_name: "Blackberry Hill",
        building_name: "Frome Terrace",
        sub_building: "Flat X",
        ambiguous: false,
      },
    },
  ];

  for (const c of cases) {
    const got = parseAddressRow(c.a1, c.a2, c.a3);
    const ok =
      got.house_number === c.expect.house_number &&
      got.street_name === c.expect.street_name &&
      got.building_name === c.expect.building_name &&
      got.sub_building === c.expect.sub_building &&
      got.ambiguous === c.expect.ambiguous;
    if (!ok) {
      throw new Error(
        `Parser example failed for ${JSON.stringify(c)} → ${JSON.stringify(got)}`,
      );
    }
  }

  if (titleHouseNumber("12a") !== "12A") {
    throw new Error("titleHouseNumber failed for 12a");
  }
  if (parseWhen("2025-08-19 10:11:12") <= parseWhen("2025-08-19")) {
    throw new Error("parseWhen must read the stored datetime, not display text");
  }
  if (parseWhen("12 FIDDES ROAD") !== Number.NEGATIVE_INFINITY) {
    throw new Error("parseWhen must not parse display text");
  }
  if (
    !isBetterCertificate(
      { uprn_source: "Address Matched", when: 1 },
      { uprn_source: "Energy Assessor", when: 99 },
    )
  ) {
    throw new Error("Address Matched must beat a newer Energy Assessor row");
  }
}
