/**
 * UI item 1, Session B2: browser-free checks for the Other gesture and the
 * door-scroll windowing. Synthetic events only; no database, no network.
 *
 *   npm run verify:ui1
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HOLD_MS,
  MOVE_CANCEL_PX,
  OTHER_IDLE,
  OTHER_MENU_OPTIONS,
  otherGesture,
  type OtherGestureEvent,
  type OtherGestureState,
} from "../lib/field/other-gesture";
import { OTHER_OUTCOMES, type OtherOutcome } from "../lib/field/outcomes";
import {
  WINDOW_RADIUS,
  atEnd,
  atStart,
  plateSize,
  scrollBehaviourFor,
  scrollLeftFor,
  scrollPlate,
  settle,
  stepIndex,
  trackMetrics,
  windowIndices,
} from "../lib/field/door-window";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// Other gesture
// ---------------------------------------------------------------------------

type Run = { state: OtherGestureState; logs: OtherOutcome[] };

function play(events: OtherGestureEvent[]): Run {
  let state = OTHER_IDLE;
  const logs: OtherOutcome[] = [];
  for (const event of events) {
    const step = otherGesture(state, event);
    state = step.state;
    for (const effect of step.effects) if (effect.kind === "commit") logs.push(effect.outcome);
  }
  return { state, logs };
}

const P = 1;
const down: OtherGestureEvent = { type: "down", pointerId: P, primary: true, x: 300, y: 500, t: 0 };
const timer: OtherGestureEvent = { type: "timer", t: HOLD_MS };
const over = (option: OtherOutcome | null, x = 200): OtherGestureEvent => ({
  type: "move",
  pointerId: P,
  x,
  y: 520,
  option,
});
const up = (option: OtherOutcome | null, t = HOLD_MS + 400): OtherGestureEvent => ({
  type: "up",
  pointerId: P,
  t,
  option,
});

console.log("\n== Other gesture ==");

for (const option of OTHER_MENU_OPTIONS) {
  const run = play([down, timer, over(option), up(option)]);
  check(
    `hold ${HOLD_MS} ms, slide to "${option}", release on it -> exactly 1 log`,
    run.logs.length === 1 && run.logs[0] === option && run.state.mode === "idle",
    `logs=${JSON.stringify(run.logs)}`,
  );
}

{
  const run = play([down, { type: "timer", t: HOLD_MS + 250 }, over("refused"), up("refused", HOLD_MS + 900)]);
  check("hold longer than 350 ms still logs exactly 1", run.logs.length === 1, `logs=${run.logs.length}`);
}

{
  const sweep = OTHER_MENU_OPTIONS.map((o) => over(o));
  const run = play([down, timer, ...sweep, over(null, 40), up(null)]);
  check("hold, slide across every option, release off the menu -> 0 logs", run.logs.length === 0);
  let offEach = true;
  for (const option of OTHER_MENU_OPTIONS) {
    const r = play([down, timer, over(option), over(null, 40), up(null)]);
    if (r.logs.length !== 0 || r.state.mode !== "idle") offEach = false;
  }
  check("release off after each single option -> 0 logs (x4)", offEach);
  const still = play([down, timer, up(null)]);
  check("hold, no slide, release on the button -> 0 logs", still.logs.length === 0 && still.state.mode === "idle");
}

{
  const quick = play([down, up(null, HOLD_MS - 1)]);
  check(
    `quick tap (${HOLD_MS - 1} ms, no slide) -> tap mode opens, 0 logs`,
    quick.state.mode === "tap" && quick.logs.length === 0,
    `mode=${quick.state.mode}`,
  );
  const afterTap = play([
    down,
    up(null, 80),
    { type: "cancel", reason: "lostpointercapture", pointerId: P },
  ]);
  check("the lostpointercapture after a tap does not close tap mode", afterTap.state.mode === "tap");
  const pick = play([down, up(null, 80), { type: "pick", option: "do_not_call" }]);
  check("tap mode, pick a row -> exactly 1 log", pick.logs.length === 1 && pick.logs[0] === "do_not_call");
  const outside = play([down, up(null, 80), { type: "cancel", reason: "outside" }]);
  check("tap mode, tap outside -> closed, 0 logs", outside.state.mode === "idle" && outside.logs.length === 0);
  const esc = play([down, up(null, 80), { type: "key", key: "Escape" }]);
  check("tap mode, Esc -> closed, 0 logs", esc.state.mode === "idle" && esc.logs.length === 0);
}

{
  const moved = play([
    down,
    { type: "move", pointerId: P, x: 300 - (MOVE_CANCEL_PX + 1), y: 500, option: null },
    timer,
    over("refused"),
    up("refused"),
  ]);
  check(`moving > ${MOVE_CANCEL_PX} px before the hold cancels -> 0 logs`, moved.logs.length === 0);
  const early = play([down, { type: "timer", t: HOLD_MS - 1 }, over("refused"), up("refused", HOLD_MS - 1)]);
  check("an early timer does not open the menu -> 0 logs", early.logs.length === 0);
}

{
  const reasons = ["pointercancel", "lostpointercapture"] as const;
  let allZero = true;
  const points: { name: string; events: OtherGestureEvent[] }[] = [
    { name: "after down", events: [down] },
    { name: "after hold opens", events: [down, timer] },
    ...OTHER_MENU_OPTIONS.map((o) => ({ name: `on "${o}"`, events: [down, timer, over(o)] })),
  ];
  const detail: string[] = [];
  for (const reason of reasons) {
    for (const point of points) {
      const run = play([
        ...point.events,
        { type: "cancel", reason, pointerId: P },
        // A stray release after the cancel must not log either.
        up(OTHER_MENU_OPTIONS[1]),
      ]);
      if (run.logs.length !== 0 || run.state.mode !== "idle") {
        allZero = false;
        detail.push(`${reason} ${point.name}`);
      }
    }
  }
  check(
    `pointercancel / lostpointercapture at every point (${points.length * reasons.length} cases) -> 0 logs`,
    allZero,
    detail.join(", "),
  );
  let others = true;
  for (const reason of ["hidden", "blur", "escape", "disabled"] as const) {
    const r = play([down, timer, over("do_not_call"), { type: "cancel", reason }, up("do_not_call")]);
    if (r.logs.length !== 0) others = false;
  }
  check("hidden / blur / Esc / disabled while holding -> 0 logs", others);
  const second = play([
    down,
    timer,
    over("refused"),
    { type: "cancel", reason: "pointercancel", pointerId: P + 1 },
    up("refused"),
  ]);
  check("a different pointer's cancel is ignored -> still 1 log", second.logs.length === 1);
}

{
  const flat = OTHER_MENU_OPTIONS.every((o) => typeof o === "string");
  const entries = OTHER_OUTCOMES as readonly Record<string, unknown>[];
  const noChildren = entries.every((o) => !("children" in o) && !("options" in o) && !("submenu" in o));
  const oneSlide = play([down, timer, over("do_not_call"), up("do_not_call")]);
  check(
    `"Do not call again" is a top-level option, never nested`,
    flat && noChildren && OTHER_MENU_OPTIONS.includes("do_not_call") && OTHER_MENU_OPTIONS.length === 4,
    `options=${JSON.stringify(OTHER_MENU_OPTIONS)}`,
  );
  check(
    `"Do not call again" is one slide: down, hold, slide, release -> do_not_call`,
    oneSlide.logs.length === 1 && oneSlide.logs[0] === "do_not_call",
  );
}

// ---------------------------------------------------------------------------
// Door scroll windowing
// ---------------------------------------------------------------------------

console.log("\n== Door scroll windowing ==");

const TOTAL = 2000;
const MAX_NODES = WINDOW_RADIUS * 2 + 1;

function contiguousInRange(ids: number[], total: number): boolean {
  if (ids.length === 0) return false;
  for (let k = 0; k < ids.length; k++) {
    if (ids[k] < 0 || ids[k] >= total) return false;
    if (k > 0 && ids[k] !== ids[k - 1] + 1) return false;
  }
  return true;
}

for (const [i, first, last] of [
  [0, 0, 8],
  [1000, 992, 1008],
  [1999, 1991, 1999],
] as const) {
  const ids = windowIndices(i, TOTAL);
  check(
    `total ${TOTAL}, index ${i}: ${ids.length} rendered (<= ${MAX_NODES}), ${ids[0]}..${ids[ids.length - 1]}`,
    ids.length <= MAX_NODES &&
      ids[0] === first &&
      ids[ids.length - 1] === last &&
      ids.includes(i) &&
      contiguousInRange(ids, TOTAL),
  );
}

{
  let worst = 0;
  let ok = true;
  for (let i = 0; i < TOTAL; i++) {
    const ids = windowIndices(i, TOTAL);
    worst = Math.max(worst, ids.length);
    if (!contiguousInRange(ids, TOTAL) || !ids.includes(i)) ok = false;
  }
  check(`every index 0..${TOTAL - 1}: at most ${MAX_NODES} rendered, never outside 0..${TOTAL - 1}`, ok && worst <= MAX_NODES, `worst=${worst}`);
  const tiny = windowIndices(0, 1);
  check("total 1 renders exactly [0]; total 0 renders nothing", tiny.length === 1 && windowIndices(0, 0).length === 0);
}

{
  const endsHold =
    stepIndex(0, -1, TOTAL) === 0 &&
    stepIndex(TOTAL - 1, 1, TOTAL) === TOTAL - 1 &&
    atStart(0) &&
    !atStart(1) &&
    atEnd(TOTAL - 1, TOTAL) &&
    !atEnd(TOTAL - 2, TOTAL);
  check("no wrap: ‹ at door 0 and › at the last door stay put; ends are flagged", endsHold);
  let exact = true;
  for (let i = 0; i < TOTAL; i++) {
    const n = stepIndex(i, 1, TOTAL);
    const p = stepIndex(i, -1, TOTAL);
    if (i < TOTAL - 1 && n !== i + 1) exact = false;
    if (i > 0 && p !== i - 1) exact = false;
  }
  check("‹ and › step exactly one door at every index", exact);
}

{
  let noDrift = true;
  let snapsHome = true;
  for (const viewport of [320, 375, 390, 430]) {
    const { slot } = trackMetrics(viewport, TOTAL);
    for (let i = 0; i < TOTAL; i++) {
      if (settle(scrollLeftFor(i, slot), slot, TOTAL, i).changed) noDrift = false;
      const nudge = slot * 0.49;
      if (settle(scrollLeftFor(i, slot) + (i < TOTAL - 1 ? nudge : 0), slot, TOTAL, i).changed) snapsHome = false;
    }
  }
  check("the scroll never changes the index on its own: resting at door i settles to i (4 widths x 2,000)", noDrift);
  check("under half a slot of drift settles back to the same door", snapsHome);
  const { slot } = trackMetrics(390, TOTAL);
  const ext = settle(scrollLeftFor(1500, slot), slot, TOTAL, 1500);
  check("an external jump to 1,500 settles to 1,500 with no onSettle", ext.index === 1500 && !ext.changed);
  const moved = settle(scrollLeftFor(1003, slot), slot, TOTAL, 1000);
  check("a person moving the scroll 3 doors does report the change", moved.changed && moved.index === 1003);
  const src = readFileSync(join(process.cwd(), "components/field/ui/door-scroll.tsx"), "utf8");
  const calls = src.match(/onSettleRef\.current\(/g)?.length ?? 0;
  check(
    "door-scroll.tsx has no setInterval and calls onSettle from exactly 2 places (settle, ‹ ›/arrow step)",
    !/setInterval/.test(src) && calls === 2,
    `onSettle call sites=${calls}`,
  );
}

{
  check(
    "external change: up to 3 doors smooth, 4+ instant (a jump of 500 is instant)",
    scrollBehaviourFor(10, 13) === "smooth" &&
      scrollBehaviourFor(13, 10) === "smooth" &&
      scrollBehaviourFor(10, 14) === "instant" &&
      scrollBehaviourFor(0, 500) === "instant",
  );
  const m = trackMetrics(390, TOTAL);
  check(
    "track: slot = 0.4 x viewport, last door centred at the maximum scroll",
    m.slot === 156 && Math.abs(scrollLeftFor(TOTAL - 1, m.slot) - (m.trackWidth - 390)) < 1e-6,
    `slot=${m.slot} pad=${m.pad} width=${m.trackWidth}`,
  );
  check(
    "plate ladder: 2 -> xl, 3 -> lg, 4 -> md, 5+ -> sm",
    plateSize("76") === "xl" && plateSize("12A") === "lg" && plateSize("112B") === "md" && plateSize("Flat 3") === "sm",
  );
  const ph = scrollPlate("—", 23);
  check('placeholder "—" at position 23 becomes "#24"', ph.text === "#24" && ph.placeholder);
}

console.log(failures === 0 ? "\nOK" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
