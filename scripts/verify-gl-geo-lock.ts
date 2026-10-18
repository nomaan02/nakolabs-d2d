/**
 * GPS-LOCK GL-1: browser-free checks for lib/field/geo-lock.ts.
 * Synthetic fixtures only; no database, no network, no browser.
 *
 *   npm run verify:gl
 */
import {
  AGREE_SPREAD_M,
  FRESH_FIX_SLACK_MS,
  JUMP_ACCURACY_M,
  MAX_COLD_JUMP_DOORS,
  MAX_JUMP_DOORS,
  REOPEN_HIDDEN_MS,
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

if (failures > 0) {
  console.error(`\n${failures} GL check(s) failed.`);
  process.exit(1);
}
console.log("\nAll GL geo-lock checks passed.");
