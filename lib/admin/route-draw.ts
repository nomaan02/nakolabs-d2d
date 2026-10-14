/**
 * RT-3 (owner 2026-10-13; Figma "Admin / RT — Manual routes", frames R2–R5,
 * D1). The manual route being drawn: the chain of doors in walking order,
 * with Undo and Redo, and the hit test that turns a finger's stroke into the
 * doors it passed over, in order.
 *
 * Pure: no React, no map, no network. Checked by `npm run verify:rt`.
 *
 * One door linked or taken off is one history step (owner O2: undo and redo
 * step one link at a time), so a stroke through ten doors is ten steps.
 */

export type RouteDrawHistory = {
  past: number[][];
  present: number[];
  future: number[][];
};

/** Plenty for one prop (a long drawing is a few hundred doors); stops runaway growth. */
export const ROUTE_HISTORY_LIMIT = 2000;

/** Fewest doors a drawn route can have: one door has no length and could never be put on a visit. */
export const MIN_ROUTE_DOORS = 2;

/** Drawing below this zoom would catch doors on both sides of the street at once. */
export const MIN_DRAW_ZOOM = 17;

export function startRouteDraw(chain: readonly number[] = []): RouteDrawHistory {
  return { past: [], present: [...chain], future: [] };
}

function commit(history: RouteDrawHistory, next: number[]): RouteDrawHistory {
  const past = [...history.past, history.present];
  if (past.length > ROUTE_HISTORY_LIMIT) past.shift();
  return { past, present: next, future: [] };
}

/** Appends each door not yet on the route, in order; one history step per door. Doors already linked are skipped. */
export function linkDoors(history: RouteDrawHistory, uprns: readonly number[]): RouteDrawHistory {
  let next = history;
  for (const uprn of uprns) {
    if (next.present.includes(uprn)) continue;
    next = commit(next, [...next.present, uprn]);
  }
  return next;
}

/** Takes a door off the route; its neighbours now follow each other. One history step. */
export function eraseDoor(history: RouteDrawHistory, uprn: number): RouteDrawHistory {
  if (!history.present.includes(uprn)) return history;
  return commit(
    history,
    history.present.filter((u) => u !== uprn),
  );
}

export function eraseDoors(history: RouteDrawHistory, uprns: readonly number[]): RouteDrawHistory {
  let next = history;
  for (const uprn of uprns) next = eraseDoor(next, uprn);
  return next;
}

export function canUndoRoute(history: RouteDrawHistory): boolean {
  return history.past.length > 0;
}

export function canRedoRoute(history: RouteDrawHistory): boolean {
  return history.future.length > 0;
}

export function undoRoute(history: RouteDrawHistory): RouteDrawHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoRoute(history: RouteDrawHistory): RouteDrawHistory {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

/** Every door not on the route, ascending UPRN: the doors left out on purpose (owner O6). */
export function leftOutDoors(chain: readonly number[], all: readonly number[]): number[] {
  const on = new Set(chain);
  return all.filter((u) => !on.has(u)).sort((a, b) => a - b);
}

/** A saved drawing against the prop's doors now: removed doors drop out, new doors are neither linked nor left out. */
export function reconcileDrawing(
  saved: { chain: readonly number[]; leftOut: readonly number[] },
  current: readonly number[],
): { chain: number[]; leftOut: number[]; newDoors: number[]; removed: number } {
  const now = new Set(current);
  const chain = saved.chain.filter((u) => now.has(u));
  const leftOut = saved.leftOut.filter((u) => now.has(u));
  const known = new Set([...chain, ...leftOut]);
  const newDoors = current.filter((u) => !known.has(u)).sort((a, b) => a - b);
  const removed = saved.chain.length + saved.leftOut.length - chain.length - leftOut.length;
  return { chain, leftOut, newDoors, removed };
}

// ---------------------------------------------------------------------------
// Words (British English)
// ---------------------------------------------------------------------------

function doorsWord(n: number): string {
  return n === 1 ? "1 door" : `${n.toLocaleString("en-GB")} doors`;
}

/** Toolbar figure: "30 of 72 doors". */
export function routeCountLine(linked: number, total: number): string {
  return `${linked.toLocaleString("en-GB")} of ${doorsWord(total)}`;
}

/** Toolbar sub-line. */
export function routeToolbarHint(state: { linked: number; erasing: boolean; zoomedOut: boolean }): string {
  if (state.zoomedOut) return "Zoom in to draw";
  if (state.erasing) return "Tap a door to remove";
  if (state.linked === 0) return "Start at any door";
  return "Lift to pause";
}

/** R5: the save sheet's lines. Null `leftOut` line when every door is on the route. */
export function routeSaveLines(linked: number, total: number): { summary: string; leftOut: string | null } {
  const missing = total - linked;
  return {
    summary: `${linked.toLocaleString("en-GB")} of ${doorsWord(total)} are on the route.`,
    leftOut:
      missing <= 0
        ? null
        : `${doorsWord(missing)} ${missing === 1 ? "is" : "are"} left out. ${missing === 1 ? "It won't" : "They won't"} be knocked on this prop's visits.`,
  };
}

/** R6 card: "61 doors · 11 left out". */
export function drawnRouteLine(linked: number, leftOut: number): string {
  return leftOut > 0 ? `${doorsWord(linked)} · ${leftOut.toLocaleString("en-GB")} left out` : doorsWord(linked);
}

// ---------------------------------------------------------------------------
// Hit test: the doors a stroke passes over, in the order it meets them
// ---------------------------------------------------------------------------

export type ScreenDoor = { uprn: number; x: number; y: number };

/** Finger-sized on touch, pointer-sized with a mouse (px). */
export const ROUTE_HIT_TOUCH = 16;
export const ROUTE_HIT_MOUSE = 10;

/** Stroke sampling step (px): a fast stroke between two pointer samples is checked every few pixels. */
const SAMPLE_PX = 3;

/**
 * The doors a stroke from `a` to `b` passes over, in order. Along the stroke,
 * every few pixels, the nearest door within `radius` px is under the finger;
 * each new one is added once. So a fast stroke that skips pointer samples
 * still links every door it crossed, in order, and a finger running along a
 * row picks that row, not the houses across the street. A press (`a` = `b`)
 * returns at most the nearest door.
 */
export function doorsAlongStroke(doors: readonly ScreenDoor[], a: { x: number; y: number }, b: { x: number; y: number }, radius: number): number[] {
  const minX = Math.min(a.x, b.x) - radius;
  const maxX = Math.max(a.x, b.x) + radius;
  const minY = Math.min(a.y, b.y) - radius;
  const maxY = Math.max(a.y, b.y) + radius;
  const near = doors.filter((d) => d.x >= minX && d.x <= maxX && d.y >= minY && d.y <= maxY);
  if (near.length === 0) return [];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const samples = Math.max(1, Math.ceil(length / SAMPLE_PX));
  const out: number[] = [];
  for (let k = 0; k <= samples; k += 1) {
    const t = k / samples;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    let best: ScreenDoor | null = null;
    let bestD = radius;
    for (const d of near) {
      const dist = Math.hypot(d.x - px, d.y - py);
      if (dist < bestD || (dist === bestD && best !== null && d.uprn < best.uprn)) {
        best = d;
        bestD = dist;
      }
    }
    if (best && out[out.length - 1] !== best.uprn) out.push(best.uprn);
  }
  return out;
}
