/**
 * UI-8 D1b: browser-free checks for lib/field/inference.ts.
 * Synthetic fixtures only; no database, no network, no browser.
 *
 *   npm run verify:ui8
 */
import {
  ASK_AT_DOORS,
  crossesStreet,
  planInference,
  type InferenceDoor,
  type KnownOutcome,
} from "../lib/field/inference";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const ME = "me";
const PARTNER = "partner";
const T0 = Date.parse("2026-10-06T10:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

// Doors #1..#60 on one street: index i is door #(i+1), uprn 1000+i, position = index.
const sequence: InferenceDoor[] = Array.from({ length: 60 }, (_, i) => ({ uprn: 1000 + i, position: i }));
const oneStreet = sequence.map(() => "Ventnor Road");
const door = (n: number) => n - 1; // door number -> index
const uprn = (n: number) => 1000 + n - 1;

type Log = { n: number; minutes: number; by?: string; inferred?: boolean };
function outcomesOf(logs: Log[]): Map<number, KnownOutcome> {
  const map = new Map<number, KnownOutcome>();
  for (const log of logs) {
    map.set(uprn(log.n), { occurredAt: at(log.minutes), canvasserId: log.by ?? ME, inferred: log.inferred });
  }
  return map;
}
function plan(logs: Log[], triggerN: number, triggerMinutes: number, extra: Partial<Parameters<typeof planInference>[0]> = {}) {
  return planInference({
    sequence,
    outcomes: outcomesOf(logs),
    streets: oneStreet,
    canvasserId: ME,
    triggerIndex: door(triggerN),
    triggerAt: at(triggerMinutes),
    ...extra,
  });
}
const numbers = (p: ReturnType<typeof planInference>) => (p.kind === "none" ? [] : p.doors.map((d) => d.index + 1));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// 1. The acceptance example: log #5 then #18 -> #6..#17 fill silently.
{
  const p = plan([{ n: 5, minutes: 0 }], 18, 13);
  check("#5 then #18 fills #6..#17", p.kind === "fill" && same(numbers(p), range(6, 17)), `${p.kind} ${numbers(p).join(",")}`);
  if (p.kind === "fill") {
    check("anchor is #5", p.anchorIndex === door(5));
    const times = p.doors.map((d) => Date.parse(d.occurredAt));
    const evenlySpread = times.every((t, i) => t === T0 + ((13 * 60_000) * (i + 1)) / 13);
    check("times spread evenly between the two logs", evenlySpread, `${p.doors[0]?.occurredAt} .. ${p.doors[11]?.occurredAt}`);
    check("positions are the snapshot positions", p.doors.every((d) => d.position === d.index));
  }
}

// 2. Already-logged doors in the gap are skipped (anyone's, and inferred ones).
{
  const p = plan(
    [
      { n: 5, minutes: 0 },
      { n: 9, minutes: 1, by: PARTNER },
      { n: 12, minutes: 2, inferred: true },
    ],
    18,
    13,
  );
  check("logged doors in the gap are never overwritten", same(numbers(p), [6, 7, 8, 10, 11, 13, 14, 15, 16, 17]), numbers(p).join(","));
}

// 3. A teammate's knock is never filled.
{
  const p = plan([{ n: 5, minutes: 0 }], 10, 5, { knockedByTeam: new Set([uprn(7)]) });
  check("teammate's knocked door skipped", same(numbers(p), [6, 8, 9]), numbers(p).join(","));
}

// 4. Nothing before the first log: the very first log fills nothing.
check("first log fills nothing", plan([], 18, 0).kind === "none");

// 5. Only between two REAL logs: an inferred row and a partner's row are not anchors.
check("inferred row is not an anchor", plan([{ n: 5, minutes: 0, inferred: true }], 18, 13).kind === "none");
check("partner's row is not an anchor", plan([{ n: 5, minutes: 0, by: PARTNER }], 18, 13).kind === "none");

// 6. Any tapped outcome is an anchor (Not In included) — origin, not outcome, decides.
{
  const p = plan(
    [
      { n: 5, minutes: 0 },
      { n: 8, minutes: 3 },
    ],
    11,
    6,
  );
  check("latest real log is the anchor", same(numbers(p), [9, 10]), numbers(p).join(","));
}

// 7. Walking backwards fills nothing.
check(
  "log behind the latest log fills nothing",
  plan(
    [
      { n: 5, minutes: 0 },
      { n: 18, minutes: 13 },
    ],
    10,
    15,
  ).kind === "none",
);

// 8. Correcting a door: re-logging the trigger door itself ignores its old row.
{
  const p = plan(
    [
      { n: 5, minutes: 0 },
      { n: 6, minutes: 1, inferred: true },
      { n: 18, minutes: 13 },
    ],
    18,
    14,
  );
  check("re-logging the same door fills only empty doors behind it", same(numbers(p), range(7, 17)), numbers(p).join(","));
}

// 9. After going back to fix an earlier door, the next forward log fills only from the furthest point.
{
  const p = plan(
    [
      { n: 5, minutes: 0 },
      { n: 18, minutes: 13 },
      { n: 3, minutes: 15 }, // went back to fix #3
    ],
    20,
    20,
  );
  check("after a correction, fill from the furthest log", p.kind === "fill" && same(numbers(p), [19]), numbers(p).join(","));
  if (p.kind === "fill") {
    const t = Date.parse(p.doors[0]?.occurredAt ?? "");
    check("its time is between the correction and the new log", t > T0 + 15 * 60_000 && t < T0 + 20 * 60_000);
  }
}

// 10. Started mid-route, then went to the start: the forward walk still fills.
{
  const p = plan(
    [
      { n: 50, minutes: 0 },
      { n: 1, minutes: 5 },
    ],
    4,
    8,
  );
  check("restart from the first door fills #2..#3", p.kind === "fill" && same(numbers(p), [2, 3]), numbers(p).join(","));
}

// 11. Adjacent doors: nothing to fill.
check("next door fills nothing", plan([{ n: 5, minutes: 0 }], 6, 1).kind === "none");

// 12. 24 doors fill silently; 25 ask.
{
  const p24 = plan([{ n: 1, minutes: 0 }], 26, 30);
  check("24-door gap fills silently", p24.kind === "fill" && p24.doors.length === 24, `${p24.kind} ${numbers(p24).length}`);
  const p25 = plan([{ n: 1, minutes: 0 }], 27, 30);
  check(
    `${ASK_AT_DOORS}-door gap asks (big_gap)`,
    p25.kind === "ask" && p25.reason === "big_gap" && p25.doors.length === 25,
    `${p25.kind} ${numbers(p25).length}`,
  );
}

// 13. A street change between the two logs asks, even for a small gap.
{
  const streets = sequence.map((_, i) => (i < 10 ? "Ventnor Road" : "Speedwell Road"));
  const p = plan([{ n: 8, minutes: 0 }], 13, 5, { streets });
  check(
    "street change asks (street_change)",
    p.kind === "ask" && p.reason === "street_change" && same(numbers(p), [9, 10, 11, 12]),
    `${p.kind} ${numbers(p).join(",")}`,
  );
  const sameStreet = plan([{ n: 2, minutes: 0 }], 6, 5, { streets });
  check("small gap on one street still fills", sameStreet.kind === "fill");
}

// 14. crossesStreet: case/space-insensitive, unknown streets ignored.
check("crossesStreet ignores case and spaces", !crossesStreet(["Ventnor Road", " ventnor road ", null, "VENTNOR ROAD"], 0, 3));
check("crossesStreet sees a change", crossesStreet(["A Street", null, "B Street"], 0, 2));
check("crossesStreet: all unknown is no change", !crossesStreet([null, null, null], 0, 2));

// 15. A bad trigger index is safe.
check("out-of-range trigger fills nothing", plan([{ n: 5, minutes: 0 }], 99, 5).kind === "none");

// 16. Clock skew: a trigger time earlier than the anchor still gives valid, ordered times.
{
  const p = plan([{ n: 5, minutes: 10 }], 8, 0);
  const ok =
    p.kind === "fill" &&
    p.doors.every((d) => Number.isFinite(Date.parse(d.occurredAt)) && Date.parse(d.occurredAt) >= T0 + 10 * 60_000);
  check("clock skew keeps times valid", ok, p.kind === "none" ? "none" : p.doors.map((d) => d.occurredAt).join(","));
}

// 17. GL-C (owner C1): a fill floor after a cross-road or backwards correction.
{
  const p = plan([{ n: 5, minutes: 0 }], 18, 5, { floorIndex: door(15) });
  check("floor: fills only from the corrected door", p.kind === "fill" && same(numbers(p), [15, 16, 17]), `${p.kind} ${numbers(p).join(",")}`);
  const onFloor = plan([{ n: 5, minutes: 0 }], 15, 5, { floorIndex: door(15) });
  check("floor: logging the corrected door fills nothing", onFloor.kind === "none", onFloor.kind);
  const behind = plan([{ n: 10, minutes: 0 }], 18, 5, { floorIndex: door(3) });
  check("floor: a floor behind the last log changes nothing", behind.kind === "fill" && same(numbers(behind), range(11, 17)), numbers(behind).join(","));
  const none = plan([{ n: 5, minutes: 0 }], 18, 5, { floorIndex: null });
  check("floor: no floor fills as usual", none.kind === "fill" && same(numbers(none), range(6, 17)), numbers(none).join(","));
  const ahead = plan([{ n: 5, minutes: 0 }], 9, 5, { floorIndex: door(20) });
  check("floor: a floor ahead of the log (went back behind it) is ignored", ahead.kind === "fill" && same(numbers(ahead), [6, 7, 8]), `${ahead.kind} ${numbers(ahead).join(",")}`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
