/**
 * UI-6 B2a: browser-free checks for Survey Overview rows.
 * Synthetic fixtures only; no database, no network.
 *
 *   npm run verify:ui6
 */
import type { CachedAddress } from "../lib/field/db";
import type { LocalOutcome, LocalOutcomes } from "../lib/field/local-outcomes";
import type { SequenceDoor } from "../lib/field/sequence";
import type { KnockOutcome } from "../lib/sync/ops";
import {
  surveyAddress,
  surveyCode,
  surveyRows,
  surveyStreet,
  surveySummary,
  type SurveyDoorRow,
} from "../lib/field/survey-rows";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const coronation: CachedAddress = {
  uprn: 1,
  house_number: "12",
  building_name: null,
  street_name: "Coronation Road",
};

const buildingOnly: CachedAddress = {
  uprn: 2,
  house_number: null,
  building_name: "Rosebank House",
  street_name: "Coronation Road",
};

const nothing: CachedAddress = {
  uprn: 3,
  house_number: null,
  building_name: null,
  street_name: "Coronation Road",
};

const addressStreet: CachedAddress = {
  uprn: 4,
  house_number: null,
  building_name: null,
  street_name: "Address Street",
};

const noStreet: CachedAddress = {
  uprn: 5,
  house_number: null,
  building_name: null,
  street_name: null,
};

console.log("\n== surveyCode ==");

const codes: ReadonlyArray<readonly [KnockOutcome, string]> = [
  ["lead", "L"],
  ["answered", "C"],
  ["no_opportunity", "R"],
  ["no_answer", "NI"],
  ["refused", "O"],
  ["do_not_call", "O"],
  ["inaccessible", "O"],
  ["callback", "O"],
  ["not_interested", "O"],
];

for (const [outcome, code] of codes) {
  check(`surveyCode ${outcome} -> ${code}`, surveyCode(outcome) === code, surveyCode(outcome));
}

console.log("\n== address and street ==");

const numbered = surveyAddress(coronation, "Coronation Road", 0);
check(
  'house number + street -> "12 Coronation Road", fallback false',
  numbered.address === "12 Coronation Road" && numbered.fallback === false,
  `${numbered.address} fallback=${numbered.fallback}`,
);

const building = surveyAddress(buildingOnly, "Coronation Road", 0);
check(
  'building only -> "Rosebank House, Coronation Road"',
  building.address === "Rosebank House, Coronation Road" && building.fallback === false,
  `${building.address} fallback=${building.fallback}`,
);

const bare = surveyAddress(nothing, "Coronation Road", 4);
check(
  'nothing -> "Coronation Road · door 5" at index 4, fallback true',
  bare.address === "Coronation Road · door 5" && bare.fallback === true,
  `${bare.address} fallback=${bare.fallback}`,
);

check(
  "route street wins; blank route street uses the address street; both missing -> Unnamed road",
  surveyStreet("Route Street", addressStreet) === "Route Street" &&
    surveyStreet("   ", addressStreet) === "Address Street" &&
    surveyStreet("\t", addressStreet) === "Address Street" &&
    surveyStreet(null, noStreet) === "Unnamed road" &&
    surveyStreet(undefined, undefined) === "Unnamed road" &&
    surveyStreet("", noStreet) === "Unnamed road",
  `route=${surveyStreet("Route Street", addressStreet)} blank=${surveyStreet("   ", addressStreet)} none=${surveyStreet(null, noStreet)}`,
);

console.log("\n== rows ==");

function sequenceDoor(uprn: number, position: number): SequenceDoor {
  return { uprn, position, lngLat: [0, 0] };
}

function localOutcome(uprn: number, outcome: KnockOutcome): LocalOutcome {
  return {
    uprn,
    outcome,
    clientEventId: `00000000-0000-4000-8000-${String(uprn).padStart(12, "0")}`,
    occurredAt: "2026-10-04T12:00:00.000Z",
    notes: null,
    undoable: false,
    bookedFor: outcome === "lead" ? "2026-10-05T10:00:00.000Z" : null,
    isLead: outcome === "lead",
    canvasserId: "00000000-0000-4000-8000-000000000099",
  };
}

const uprns = [1000, 1001, 1002, 1003, 1004] as const;
const sequence: SequenceDoor[] = uprns.map((uprn, index) => sequenceDoor(uprn, index));
const outcomes: LocalOutcomes = new Map([
  [1000, localOutcome(1000, "lead")],
  [1003, localOutcome(1003, "no_answer")],
]);
const knockedBy = new Map<number, { firstName: string }>([
  [1000, { firstName: "Sam" }],
  [1001, { firstName: "Jo" }],
]);
const rows = surveyRows({
  sequence,
  labels: new Map(),
  outcomes,
  routeStreets: ["A", "A", "B", "B", "A"],
  knockedBy,
  currentIndex: 2,
});

const streetRows = rows.filter((row) => row.kind === "street");
const doorRows = rows.filter((row): row is SurveyDoorRow => row.kind === "door");

check(
  "5 doors over A, A, B, B, A -> 3 street headers (A, B, A) and 5 door rows, indexes 0..4",
  streetRows.length === 3 &&
    streetRows[0]?.street === "A" &&
    streetRows[1]?.street === "B" &&
    streetRows[2]?.street === "A" &&
    doorRows.length === 5 &&
    doorRows.every((door, index) => door.index === index && door.uprn === uprns[index]) &&
    rows.map((row) => row.kind).join(",") === "street,door,door,street,door,door,street,door",
  `streets=${streetRows.map((row) => row.street).join(",")} doors=${doorRows.map((door) => door.index).join(",")}`,
);

check(
  "current is true only on currentIndex",
  doorRows.length === 5 && doorRows.every((door, index) => door.current === (index === 2)),
  doorRows.map((door) => (door.current ? "Y" : "n")).join(""),
);

check(
  "local outcome sets the code and clears knockedBy; a teammate-only knock sets the name and leaves the code empty",
  doorRows[0]?.code === "L" &&
    doorRows[0]?.knockedBy === null &&
    doorRows[1]?.code === null &&
    doorRows[1]?.knockedBy === "Jo",
  `0=${doorRows[0]?.code}/${doorRows[0]?.knockedBy} 1=${doorRows[1]?.code}/${doorRows[1]?.knockedBy}`,
);

const summary = surveySummary(rows);
check(
  "surveySummary on that fixture: knocked and toGo add up to 5",
  summary.knocked === 3 && summary.toGo === 2 && summary.knocked + summary.toGo === 5,
  `knocked=${summary.knocked} toGo=${summary.toGo}`,
);

console.log(failures === 0 ? "\nOK" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
