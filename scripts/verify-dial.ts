/**
 * DIAL-1: browser-free checks for the radial dial's gesture and geometry,
 * the logger-style setting's defaults and the stats rail's number format.
 * Synthetic events only; no database, no network.
 *
 *   npm run verify:dial
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEAD_ZONE_PX,
  DIAL_IDLE,
  DIAL_OUTCOME,
  HYSTERESIS_DEG,
  PUCK_TAP_MAX_MS,
  TAP_SLOP_PX,
  angleOf,
  dialGesture,
  dialPhase,
  directionAt,
  hitAt,
  type DialDirection,
  type DialEvent,
  type DialHit,
  type DialState,
} from "../lib/field/dial-gesture";
import { formatStat } from "../components/field/ui/stats-rail";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Run = { state: DialState; commits: DialDirection[]; other: number; pulses: number[] };

function play(events: DialEvent[]): Run {
  let state = DIAL_IDLE;
  const run: Run = { state, commits: [], other: 0, pulses: [] };
  for (const event of events) {
    const step = dialGesture(state, event);
    state = step.state;
    for (const effect of step.effects) {
      if (effect.kind === "commit") run.commits.push(effect.dir);
      if (effect.kind === "openOther") run.other++;
      if (effect.kind === "pulse") run.pulses.push(effect.ms);
    }
  }
  run.state = state;
  return run;
}

const P = 1;
const C = 112;
const puck: DialHit = { kind: "puck" };
const down = (hit: DialHit = puck, x = C, y = C, t = 0, pointerId = P): DialEvent => ({
  type: "down",
  pointerId,
  primary: true,
  x,
  y,
  t,
  hit,
});
const move = (x: number, y: number, pointerId = P): DialEvent => ({ type: "move", pointerId, x, y });
const up = (x: number, y: number, t = 200, pointerId = P): DialEvent => ({ type: "up", pointerId, x, y, t });

// ---------------------------------------------------------------------------
// Mapping (owner, Figma V2 brief): Up Contact, Right Lead, Down Not in, Left Rented.
// ---------------------------------------------------------------------------
check("up = Contact (answered)", DIAL_OUTCOME.up === "answered");
check("right = Lead", DIAL_OUTCOME.right === "lead");
check("down = Not in (no_answer)", DIAL_OUTCOME.down === "no_answer");
check("left = Rented / council (no_opportunity)", DIAL_OUTCOME.left === "no_opportunity");

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
check("angle: right is 0", angleOf(1, 0) === 0);
check("angle: down is 90", angleOf(0, 1) === 90);
check("angle: up is -90", angleOf(0, -1) === -90);
check("wedge at 0 is right", directionAt(0) === "right");
check("wedge at 44 is right", directionAt(44) === "right");
check("wedge at 46 is down", directionAt(46) === "down");
check("wedge at -46 is up", directionAt(-46) === "up");
check("wedge at 179 is left", directionAt(179) === "left");
check("wedge at -179 is left", directionAt(-179) === "left");
check("hysteresis keeps right just past 45", directionAt(45 + HYSTERESIS_DEG - 1, "right") === "right");
check("hysteresis lets go past the margin", directionAt(45 + HYSTERESIS_DEG + 1, "right") === "down");
check("hysteresis wraps at 180 for left", directionAt(-170, "left") === "left");
check("hit: centre is the puck", hitAt(C, C).kind === "puck");
check("hit: 36 from centre is still the puck", hitAt(C + 36, C).kind === "puck");
const labelHit = hitAt(112, 48);
check("hit: the Contact label is the up wedge", labelHit.kind === "wedge" && labelHit.dir === "up");
const leadHit = hitAt(176, 112);
check("hit: the Lead label is the right wedge", leadHit.kind === "wedge" && leadHit.dir === "right");
check("hit: outside the ring is nothing", hitAt(0, 0).kind === "none");

// ---------------------------------------------------------------------------
// Press, drag, release
// ---------------------------------------------------------------------------
for (const [dir, dx, dy] of [
  ["up", 0, -60],
  ["right", 60, 0],
  ["down", 0, 60],
  ["left", -60, 0],
] as const) {
  const r = play([down(), move(C + dx / 2, C + dy / 2), move(C + dx, C + dy), up(C + dx, C + dy)]);
  check(`drag ${dir} and release logs ${dir}`, r.commits.length === 1 && r.commits[0] === dir, r.commits.join(","));
  check(`drag ${dir} ends idle`, r.state.mode === "idle");
}

{
  const r = play([down(), move(C + 10, C)]);
  check("inside the dead zone: pressed, no target", dialPhase(r.state).phase === "pressed");
  check("touch-down pulses once (15 ms)", r.pulses.length === 1 && r.pulses[0] === 15, r.pulses.join(","));
}
{
  const r = play([down(), move(C + DEAD_ZONE_PX + 1, C)]);
  const phase = dialPhase(r.state);
  check("leaving the dead zone chooses a target", phase.phase === "choosing" && phase.dir === "right");
  check("choosing a target pulses (8 ms)", r.pulses[r.pulses.length - 1] === 8);
}
{
  const r = play([down(), move(C + 60, C), move(C + 4, C + 2), up(C + 4, C + 2)]);
  check("drag out and back to the centre: nothing logged", r.commits.length === 0 && r.other === 0);
}
{
  const r = play([down(), move(C + 60, C), move(C, C + 60), up(C, C + 60)]);
  check("changing direction mid-drag logs the last direction", r.commits.join(",") === "down");
}
{
  const r = play([down(), move(C + 60, C), move(C + 60, C + 60 * Math.tan(((45 + HYSTERESIS_DEG / 2) * Math.PI) / 180))]);
  const phase = dialPhase(r.state);
  check("a wobble over the wedge edge keeps the target", phase.phase === "choosing" && phase.dir === "right");
}
{
  const r = play([down(), up(C + 3, C + 2, 120)]);
  check("tap the puck: opens Other", r.other === 1 && r.commits.length === 0);
}
{
  const r = play([down(), up(C + 3, C + 2, PUCK_TAP_MAX_MS + 50)]);
  check("a long still hold on the puck opens nothing", r.other === 0 && r.commits.length === 0);
}
{
  const r = play([down(), move(C + TAP_SLOP_PX + 4, C), up(C + TAP_SLOP_PX + 4, C, 120)]);
  check("a small slide inside the dead zone opens nothing", r.other === 0 && r.commits.length === 0);
}
{
  const r = play([down(), move(C + 60, C), { type: "cancel", reason: "pointercancel", pointerId: P }]);
  check("pointercancel mid-drag: idle, nothing logged", r.state.mode === "idle" && r.commits.length === 0);
}
{
  const r = play([down(), move(C + 60, C), { type: "cancel", reason: "pointercancel", pointerId: 2 }]);
  check("another finger's pointercancel is ignored", r.state.mode === "puck");
}
{
  const r = play([down(), move(C + 60, C), { type: "cancel", reason: "hidden" }, up(C + 60, C)]);
  check("page hidden mid-drag: the release logs nothing", r.commits.length === 0);
}
{
  const r = play([down(), move(C + 60, C), move(C + 70, C, 2), up(C + 70, C, 200, 2)]);
  check("a second pointer cannot steer or release", r.state.mode === "puck" && r.commits.length === 0);
}
{
  const r = play([{ type: "down", pointerId: P, primary: false, x: C, y: C, t: 0, hit: puck }]);
  check("a non-primary pointer does nothing", r.state.mode === "idle");
}
{
  const r = play([down({ kind: "none" }, 0, 0)]);
  check("a press outside the ring does nothing", r.state.mode === "idle");
}

// ---------------------------------------------------------------------------
// Tap a label (the whole wedge is the target)
// ---------------------------------------------------------------------------
{
  const r = play([down({ kind: "wedge", dir: "right" }, 176, 112), up(178, 113)]);
  check("tap the Lead label: logs Lead", r.commits.join(",") === "right");
}
{
  const s = play([down({ kind: "wedge", dir: "up" }, 112, 48)]);
  const phase = dialPhase(s.state);
  check("touch-down on a label: the Tap state for it", phase.phase === "tap" && phase.dir === "up");
}
{
  const r = play([down({ kind: "wedge", dir: "up" }, 112, 48), move(112 + TAP_SLOP_PX + 2, 48), up(112, 48)]);
  check("a label press that slides is disarmed: nothing logged", r.commits.length === 0);
  check("a disarmed label press shows rest", dialPhase(play([down({ kind: "wedge", dir: "up" }, 112, 48), move(140, 48)]).state).phase === "rest");
}

// ---------------------------------------------------------------------------
// Stats rail format (Figma "04"; null is a dash)
// ---------------------------------------------------------------------------
check("stat 0 is 00", formatStat(0) === "00");
check("stat 4 is 04", formatStat(4) === "04");
check("stat 93 is 93", formatStat(93) === "93");
check("stat 1200 is 1,200", formatStat(1200) === "1,200");
check("stat null is a dash", formatStat(null) === "—");

// ---------------------------------------------------------------------------
// Source rules
// ---------------------------------------------------------------------------
const root = process.cwd();
const code = (path: string) =>
  readFileSync(join(root, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dialSrc = code("components/field/ui/outcome-dial.tsx");
check("the dial has no write path of its own", !/logOutcome|lib\/sync|supabase/i.test(dialSrc));
check("the dial honours prefers-reduced-motion", dialSrc.includes("prefersReducedMotion"));
check("the dial is a light island in dark mode", dialSrc.includes('data-theme-island="light"'));
const loggerSrc = readFileSync(join(root, "components/field/logger-tab.tsx"), "utf8");
check("the Logger still logs through logOutcome", loggerSrc.includes("logOutcome("));
check("the Logger keeps the buttons as a fallback", loggerSrc.includes("<OutcomeColumn"));
check("the Logger renders the dial layout", loggerSrc.includes("<LoggerDialBody"));
const styleSrc = code("lib/field/logger-style.ts");
check("logger style defaults to the dial", /return "dial"/.test(styleSrc) && !/supabase/i.test(styleSrc));

console.log(failures === 0 ? "\nverify:dial  ALL PASS" : `\nverify:dial  ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
