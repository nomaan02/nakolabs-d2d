import type { CachedAddress } from "@/lib/field/db";
import type { DoorLabels } from "@/lib/field/labels";
import type { LocalOutcomes } from "@/lib/field/local-outcomes";
import type { SequenceDoor } from "@/lib/field/sequence";
import type { KnockOutcome } from "@/lib/sync/ops";

/**
 * UI-6 B2a (owner B2-1..B2-4, 2026-10-04). The Survey Overview as plain data:
 * the paper survey the canvassers used to fill in, one row per knockable
 * door in route order, with a street header each time the street changes.
 * Pure — no React, no Dexie, no network — so it works offline and is
 * checked by `npm run verify:ui6`.
 */

export type SurveyCode = "L" | "C" | "R" | "NI" | "O";

export type SurveyStreetRow = { kind: "street"; key: string; street: string };

export type SurveyDoorRow = {
  kind: "door";
  key: string;
  uprn: number;
  /** Index into the Logger's sequence; Logging jumps here on tap. */
  index: number;
  street: string;
  address: string;
  /** True when the address text is the "<street> · door N" fallback. */
  fallback: boolean;
  /** This device's latest outcome, or null while the door is still to knock. */
  code: SurveyCode | null;
  /** First name of the teammate who knocked it, when this device has no outcome. */
  knockedBy: string | null;
  current: boolean;
};

export type SurveyRow = SurveyStreetRow | SurveyDoorRow;

export type SurveySummary = { knocked: number; toGo: number };

const UNNAMED = "Unnamed road";

/** Owner B2-3. Not_interested is a legacy value with no button; it reads as Other. */
export function surveyCode(outcome: KnockOutcome): SurveyCode {
  switch (outcome) {
    case "lead":
      return "L";
    case "answered":
      return "C";
    case "no_opportunity":
      return "R";
    case "no_answer":
      return "NI";
    default:
      return "O";
  }
}

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** Route street first, then the address street, then "Unnamed road". */
export function surveyStreet(routeStreet: string | null | undefined, label: CachedAddress | undefined): string {
  return clean(routeStreet) ?? clean(label?.street_name) ?? UNNAMED;
}

/** Owner B2-4: "<street> · door N" when there is no number and no building name. */
export function surveyAddress(
  label: CachedAddress | undefined,
  street: string,
  index: number,
): { address: string; fallback: boolean } {
  const number = clean(label?.house_number);
  if (number) return { address: `${number} ${street}`, fallback: false };
  const building = clean(label?.building_name);
  if (building) return { address: `${building}, ${street}`, fallback: false };
  return { address: `${street} · door ${index + 1}`, fallback: true };
}

export function surveyRows(input: {
  sequence: SequenceDoor[];
  labels: DoorLabels;
  outcomes: LocalOutcomes;
  /** `routeProgress.doors[i].routeStreet`, index-aligned with `sequence`. */
  routeStreets: ReadonlyArray<string | null | undefined>;
  knockedBy: ReadonlyMap<number, { firstName: string }>;
  currentIndex: number;
}): SurveyRow[] {
  const rows: SurveyRow[] = [];
  let previousStreet: string | null = null;
  input.sequence.forEach((door, index) => {
    const label = input.labels.get(door.uprn);
    const street = surveyStreet(input.routeStreets[index], label);
    if (street !== previousStreet) {
      rows.push({ kind: "street", key: `street-${index}`, street });
      previousStreet = street;
    }
    const { address, fallback } = surveyAddress(label, street, index);
    const local = input.outcomes.get(door.uprn);
    rows.push({
      kind: "door",
      key: `door-${door.uprn}`,
      uprn: door.uprn,
      index,
      street,
      address,
      fallback,
      code: local ? surveyCode(local.outcome) : null,
      knockedBy: local ? null : (input.knockedBy.get(door.uprn)?.firstName ?? null),
      current: index === input.currentIndex,
    });
  });
  return rows;
}

/** "41 knocked · 47 to go": a door counts once it has a code or a teammate's knock. */
export function surveySummary(rows: SurveyRow[]): SurveySummary {
  let knocked = 0;
  let total = 0;
  for (const row of rows) {
    if (row.kind !== "door") continue;
    total += 1;
    if (row.code !== null || row.knockedBy !== null) knocked += 1;
  }
  return { knocked, toGo: total - knocked };
}
