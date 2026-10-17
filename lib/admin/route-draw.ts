/**
 * RT-3 (owner 2026-10-13; Figma "Admin / RT — Manual routes", frames R2–R5,
 * D1). The manual route being drawn: the chain of doors in walking order,
 * with Undo and Redo, and the hit test that turns a finger's stroke into the
 * doors it passed over, in order.
 *
 * Pure: no React, no map, no network. Checked by `npm run verify:rt`.
 *
 * One stroke is one history step (owner 2026-10-17, replacing O2's one door
 * per step): a stroke along a row of twenty doors is undone with one tap.
 * `strokeEdit` grows the open step while the finger is down.
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

/**
 * One stroke, as one history step. The first change of a stroke (`stepOpen`
 * false) opens a step; later changes of the same stroke replace its result.
 * Linking appends doors not yet on the route, in order; erasing takes doors
 * off (their neighbours then follow each other). No change, no step.
 */
export function strokeEdit(history: RouteDrawHistory, kind: "link" | "erase", uprns: readonly number[], stepOpen: boolean): RouteDrawHistory {
  let next: number[];
  if (kind === "link") {
    const on = new Set(history.present);
    next = [...history.present];
    for (const uprn of uprns) {
      if (on.has(uprn)) continue;
      on.add(uprn);
      next.push(uprn);
    }
  } else {
    const off = new Set(uprns);
    next = history.present.filter((u) => !off.has(u));
  }
  if (next.length === history.present.length && next.every((u, i) => u === history.present[i])) return history;
  if (stepOpen) return { past: history.past, present: next, future: [] };
  return commit(history, next);
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
  if (state.erasing) return "Tap or drag over doors to remove";
  if (state.zoomedOut) return "A stroke follows the nearest pavement";
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
