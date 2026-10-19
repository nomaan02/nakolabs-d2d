/**
 * GPS-LOCK GL-1: browser-free checks for lib/field/geo-lock.ts.
 * Synthetic fixtures only; no database, no network, no browser.
 *
 *   npm run verify:gl
 */
import { buildRouteIndex, nearDoorIndexes, routePasses, type LngLat } from "../lib/field/geo";
import {
  AGREE_SPREAD_M,
  FRESH_FIX_SLACK_MS,
  JUMP_ACCURACY_M,
  MAX_COLD_JUMP_DOORS,
  MAX_JUMP_DOORS,
  REOPEN_HIDDEN_MS,
  correctionSkipsFill,
  furthestOwnLogIndex,
  isFreshSample,
  isJumpReopen,
  nearestOpenIndex,
  planJump,
  type JumpPlan,
  type PlaceSample,
} from "../lib/field/geo-lock";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const show = (plan: JumpPlan) => JSON.stringify(plan);

// 60 doors, 6 m apart, starting at 10 m along the route.
const DOORS = Array.from({ length: 60 }, (_, i) => 10 + i * 6);
const allOpen = () => true;
let clock = 1_000;
const sample = (alongM: number | null, accuracyM = 8, at = (clock += 1_000)): PlaceSample => ({ alongM, accuracyM, at });
const base = {
  doorAlongsM: DOORS,
  cursorIndex: 10,
  anchorIndex: 9,
  hiddenMs: 60_000,
  placeBeforeM: DOORS[10]!,
  isOpen: allOpen,
};

// --- reopen gates ---
check("reopen: hidden 19.9 s does not jump", !isJumpReopen({ hiddenMs: REOPEN_HIDDEN_MS - 100 }));
check("reopen: hidden 20 s may jump", isJumpReopen({ hiddenMs: REOPEN_HIDDEN_MS }));
check("reopen: cold start may jump", isJumpReopen({ hiddenMs: null }));
check("fresh: a fix from before the reopen is dropped", !isFreshSample({ at: 10_000 - FRESH_FIX_SLACK_MS - 1 }, 10_000));
check("fresh: a fix just after the reopen is kept", isFreshSample({ at: 10_500 }, 10_000));

// --- furthest real log ---
const seq = DOORS.map((_, i) => ({ uprn: 1000 + i }));
const logs = new Map([
  [1003, { canvasserId: "me" }],
  [1007, { canvasserId: "me", inferred: true }],
  [1005, { canvasserId: "me" }],
  [1009, { canvasserId: "partner" }],
]);
check("anchor: furthest tapped log by me", furthestOwnLogIndex(seq, logs, "me") === 5, `${furthestOwnLogIndex(seq, logs, "me")}`);
check("anchor: filled Not In and a partner's log do not count", furthestOwnLogIndex(seq, logs, "me") !== 7 && furthestOwnLogIndex(seq, logs, "me") !== 9);
check("anchor: -1 with no logs", furthestOwnLogIndex(seq, new Map(), "me") === -1);
check("anchor: -1 when signed out", furthestOwnLogIndex(seq, logs, null) === -1);

// --- waiting for agreement ---
check("wait: no fixes yet", planJump({ ...base, samples: [] }).kind === "wait");
check("wait: one good fix is not enough", planJump({ ...base, samples: [sample(DOORS[14]!)] }).kind === "wait");
check(
  "wait: fixes worse than 20 m are ignored",
  planJump({ ...base, samples: [sample(DOORS[14]!, JUMP_ACCURACY_M + 1), sample(DOORS[14]!, 25)] }).kind === "wait",
);
check(
  "wait: two fixes that disagree by more than the spread",
  planJump({ ...base, samples: [sample(DOORS[12]!), sample(DOORS[12]! + AGREE_SPREAD_M + 1)] }).kind === "wait",
);

// --- the jump ---
const jump = planJump({ ...base, samples: [sample(DOORS[14]! + 1), sample(DOORS[14]! - 1)] });
check("jump: two agreeing fixes at door 14", jump.kind === "jump" && jump.index === 14, show(jump));
const median3 = planJump({ ...base, samples: [sample(DOORS[13]!), sample(DOORS[15]!), sample(DOORS[14]!)] });
check("jump: median of the last three", median3.kind === "jump" && median3.index === 14, show(median3));
const stay = planJump({ ...base, samples: [sample(DOORS[10]!), sample(DOORS[10]! + 1)] });
check("stay: already on the nearest door", stay.kind === "stay", show(stay));

// --- chip instead ---
const off = planJump({ ...base, samples: [sample(DOORS[14]!), sample(null), sample(null)] });
check("chip: the latest two good fixes are off route", off.kind === "chip" && off.reason === "off_route", show(off));
const stray = planJump({ ...base, samples: [sample(null), sample(DOORS[14]!)] });
check("wait: one stray off-route fix does not end it", stray.kind === "wait", show(stray));
const between = planJump({ ...base, samples: [sample(DOORS[14]!), sample(null), sample(DOORS[14]! + 1)] });
check("jump: a stray off-route fix between two that agree", between.kind === "jump" && between.index === 14, show(between));
const once = sample(DOORS[14]!);
const twice = planJump({ ...base, samples: [once, once, once] });
check("wait: the same fix passed three times counts once", twice.kind === "wait", show(twice));
const lastTwo = planJump({ ...base, samples: [sample(DOORS[14]! + 20), sample(DOORS[12]!), sample(DOORS[12]! + 1)] });
check("jump: an early outlier, then two that agree", lastTwo.kind === "jump" && lastTwo.index === 12, show(lastTwo));
const behind = planJump({ ...base, anchorIndex: 20, cursorIndex: 21, samples: [sample(DOORS[14]!), sample(DOORS[14]!)] });
check("chip: never behind the furthest real log", behind.kind === "chip" && behind.reason === "behind", show(behind));
const atAnchor = planJump({ ...base, anchorIndex: 14, cursorIndex: 15, samples: [sample(DOORS[14]!), sample(DOORS[14]!)] });
check("chip: standing at the last logged door does not jump", atAnchor.kind === "chip" && atAnchor.reason === "behind", show(atAnchor));
const far = planJump({ ...base, hiddenMs: 3_600_000, samples: [sample(DOORS[10 + MAX_JUMP_DOORS + 1]!), sample(DOORS[10 + MAX_JUMP_DOORS + 1]!)] });
check("chip: more than 24 doors from the cursor", far.kind === "chip" && far.reason === "too_far", show(far));
const edge = planJump({ ...base, hiddenMs: 3_600_000, samples: [sample(DOORS[10 + MAX_JUMP_DOORS]!), sample(DOORS[10 + MAX_JUMP_DOORS]!)] });
check("jump: exactly 24 doors is allowed", edge.kind === "jump" && edge.index === 10 + MAX_JUMP_DOORS, show(edge));
// 20 s hidden = 30 m of walking + 8 m accuracy = 38 m reach. Door 20 is 60 m on.
const fast = planJump({ ...base, hiddenMs: 20_000, samples: [sample(DOORS[20]!), sample(DOORS[20]!)] });
check("chip: further than walking reach (wrong pass or junction)", fast.kind === "chip" && fast.reason === "too_fast", show(fast));
const reach = planJump({ ...base, hiddenMs: 20_000, samples: [sample(DOORS[15]!), sample(DOORS[15]!)] });
check("jump: within walking reach", reach.kind === "jump" && reach.index === 15, show(reach));
const noBefore = planJump({ ...base, hiddenMs: 20_000, placeBeforeM: null, samples: [sample(DOORS[20]!), sample(DOORS[20]!)] });
check("chip: reach falls back to the cursor door", noBefore.kind === "chip" && noBefore.reason === "too_fast", show(noBefore));
const empty = planJump({ ...base, doorAlongsM: [], samples: [sample(10), sample(10)] });
check("chip: unrouted (no door places)", empty.kind === "chip" && empty.reason === "no_doors", show(empty));

// --- cold start (page reloaded: cursor back on door 1) ---
const cold = planJump({ ...base, hiddenMs: null, placeBeforeM: null, cursorIndex: 0, anchorIndex: 40, samples: [sample(DOORS[43]!), sample(DOORS[43]!)] });
check("cold start: jumps from door 1 to just past the furthest log", cold.kind === "jump" && cold.index === 43, show(cold));
const coldFar = planJump({ ...base, hiddenMs: null, placeBeforeM: null, cursorIndex: 0, anchorIndex: 10, samples: [sample(DOORS[10 + MAX_COLD_JUMP_DOORS + 1]!), sample(DOORS[10 + MAX_COLD_JUMP_DOORS + 1]!)] });
check("cold start: capped at 12 doors past the furthest log", coldFar.kind === "chip" && coldFar.reason === "too_far", show(coldFar));
const coldEdge = planJump({ ...base, hiddenMs: null, placeBeforeM: null, cursorIndex: 0, anchorIndex: 10, samples: [sample(DOORS[10 + MAX_COLD_JUMP_DOORS]!), sample(DOORS[10 + MAX_COLD_JUMP_DOORS]!)] });
check("cold start: exactly 12 doors is allowed", coldEdge.kind === "jump" && coldEdge.index === 10 + MAX_COLD_JUMP_DOORS, show(coldEdge));

// --- team props: nearest OPEN door (owner G5) ---
const knocked = new Set([14]);
const team = planJump({ ...base, isOpen: (i) => !knocked.has(i), samples: [sample(DOORS[14]!), sample(DOORS[14]!)] });
check("team: skips a knocked door, forward first on a tie", team.kind === "jump" && team.index === 15, show(team));
const knockedBack = new Set([14, 15, 16, 17]);
const teamBack = planJump({ ...base, isOpen: (i) => !knockedBack.has(i), samples: [sample(DOORS[14]!), sample(DOORS[14]!)] });
check("team: takes the nearer open door behind", teamBack.kind === "jump" && teamBack.index === 13, show(teamBack));
check("open: never at or behind the anchor", nearestOpenIndex(5, 60, 5, (i) => i !== 6 && i !== 7) === 8);
check("open: -1 when nothing is open", nearestOpenIndex(5, 10, -1, () => false) === -1);
const none = planJump({ ...base, isOpen: () => false, samples: [sample(DOORS[14]!), sample(DOORS[14]!)] });
check("chip: no open door near", none.kind === "chip" && none.reason === "no_open_door", show(none));

// --- GL-C: both sides of the road (owner C2, C3, C4) ---
// A 200 m street walked east on the north pavement, then back west on the
// south one, on ONE centre line (as route_geom is). Doors 10 m apart, 8 m
// either side of the centre line: indexes 0..18 north (x = 10..190), 19..37
// south (x = 190..10).
const ORIGIN: LngLat = [-2.55, 51.46];
const M_LNG = 1 / (111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180));
const M_LAT = 1 / 110_540;
const ll = (x: number, y: number): LngLat => [ORIGIN[0] + x * M_LNG, ORIGIN[1] + y * M_LAT];
const street = buildRouteIndex([ll(0, 0), ll(200, 0), ll(0, 0)])!;
const northX = Array.from({ length: 19 }, (_, i) => 10 + i * 10);
const southX = [...northX].reverse();
const sideAlongs = [...northX, ...southX.map((x) => 400 - x)];
const sideLngLats = [...northX.map((x) => ll(x, 8)), ...southX.map((x) => ll(x, -8))];
const at49 = ll(100, 6);

const passes = routePasses(street, at49);
check(
  "passes: a street walked twice gives both passes",
  passes.length === 2 && passes.some((m) => Math.abs(m - 100) < 1) && passes.some((m) => Math.abs(m - 300) < 1),
  passes.map((m) => m.toFixed(1)).join(","),
);
check("passes: off the route gives none", routePasses(street, ll(100, 150)).length === 0);
const turn = routePasses(street, ll(198, 2));
check("passes: the end of the street (both passes meet) counts once", turn.length === 1, turn.map((m) => m.toFixed(1)).join(","));
const oneWay = routePasses(buildRouteIndex([ll(0, 0), ll(200, 0)])!, at49);
check("passes: a street walked once gives one pass, not every segment", oneWay.length === 1, `${oneWay.length}`);

const both = nearDoorIndexes({ passesM: passes, doorAlongsM: sideAlongs, anchorIndex: -1, isOpen: allOpen });
check("near doors: one per pavement, in walk order", both.length === 2 && both[0] === 9 && both[1] === 28, both.join(","));
const forward = nearDoorIndexes({ passesM: passes, doorAlongsM: sideAlongs, anchorIndex: 9, isOpen: allOpen });
check("near doors: after a log at 9, the next open door on that pavement (10) and the one opposite", forward.length === 2 && forward[0] === 10 && forward[1] === 28, forward.join(","));
const openOnly = nearDoorIndexes({ passesM: passes, doorAlongsM: sideAlongs, anchorIndex: -1, isOpen: (i) => i !== 28 });
check("near doors: a knocked door gives way to the next open one on its pavement", openOnly.length === 2 && openOnly[0] === 9 && openOnly[1] === 29, openOnly.join(","));
const farAhead = nearDoorIndexes({ passesM: passes, doorAlongsM: sideAlongs, anchorIndex: 14, isOpen: allOpen });
check("near doors: never at or behind the furthest log", farAhead.length === 1 && farAhead[0] === 28, farAhead.join(","));
const northOnly = nearDoorIndexes({ passesM: passes, doorAlongsM: northX, anchorIndex: -1, isOpen: allOpen });
check("near doors: a pass with no door within 40 m offers none", northOnly.length === 1 && northOnly[0] === 9, northOnly.join(","));

// --- GL-C: which corrections skip the fill (owner C1, C6) ---
const skip = (fromIndex: number, toIndex: number, alongs = sideAlongs) =>
  correctionSkipsFill({ fromIndex, toIndex, doorAlongsM: alongs, doorLngLats: sideLngLats });
check("correction: across the road (forward in walk order) skips the fill", skip(9, 28));
check("correction: backwards skips the fill", skip(12, 9));
check("correction: same side, forward, keeps the fill", !skip(9, 14));
check("correction: the distance test alone misses a crossing near the street end (the side signal below catches it)", !skip(17, 19));
check("correction: no move changes nothing", !skip(9, 9));
check("correction: no route, forward keeps the fill", !skip(9, 28, []));
check("correction: no route, backwards skips", skip(28, 9, []));
// Both passes walk with the houses on the same hand; the pavement is the work step.
const pavement = (i: number) => ({ street: "segment:1", side: i < 19 ? "step:0" : "step:1" });
const skipSide = (fromIndex: number, toIndex: number, pavementOf: (i: number) => { street: string; side: string } | null = pavement) =>
  correctionSkipsFill({ fromIndex, toIndex, doorAlongsM: sideAlongs, doorLngLats: sideLngLats, pavementOf });
check("correction: the side signal sees a crossing near the street end", skipSide(17, 19));
check("correction: the side signal keeps a same-side forward move", !skipSide(3, 15));
check("correction: different streets fall back to the distance test", !skipSide(9, 14, (i) => ({ street: `segment:${i}`, side: "left" })));
check("correction: no side known falls back to the distance test", skipSide(9, 28, () => null));
// A side street joins the far pavement at x = 100: its mouth must not take a chip slot.
const junction = buildRouteIndex([ll(0, 0), ll(100, 0), ll(100, -80), ll(100, 0), ll(200, 0), ll(0, 0)])!;
const atMouth = routePasses(junction, ll(90, 6));
check("passes: a side street's mouth ranks after both pavements", atMouth.length >= 2 && Math.abs(atMouth[0]! - 90) < 2 && Math.abs(atMouth[1]! - 470) < 2, atMouth.map((m) => m.toFixed(1)).join(","));

// --- GL-C: a reopen with both pavements near (Figma 231:2086) ---
{
  const both = (sameStreetAsLog?: (index: number) => boolean, cursorIndex = 0, anchorIndex = -1) =>
    planJump({
      samples: [
        { alongM: 100, accuracyM: 8, at: (clock += 1_000), passesM: [100, 300] },
        { alongM: 101, accuracyM: 8, at: (clock += 1_000), passesM: [101, 299] },
      ],
      doorAlongsM: sideAlongs,
      cursorIndex,
      anchorIndex,
      hiddenMs: null,
      placeBeforeM: null,
      isOpen: allOpen,
      sameStreetAsLog,
    });
  const noLog = both();
  check("reopen: both sides and no log on the street: no jump, the chip offers both", noLog.kind === "chip" && noLog.reason === "both_sides", show(noLog));
  const onOne = both(undefined, 9);
  check("reopen: both sides and already on one of them: stay", onOne.kind === "stay", show(onOne));
  const settled = both(() => true, 5, 4);
  check("reopen: a log on this street settles the pass: jumps as before", settled.kind === "jump" && settled.index === 9, show(settled));
  const onePass = planJump({ ...base, samples: [sample(DOORS[14]!), sample(DOORS[14]!)].map((x) => ({ ...x, passesM: [DOORS[14]!] })) });
  check("reopen: one pass only: jumps as before", onePass.kind === "jump" && onePass.index === 14, show(onePass));
}

if (failures > 0) {
  console.error(`\n${failures} GL check(s) failed.`);
  process.exit(1);
}
console.log("\nAll GL geo-lock checks passed.");
