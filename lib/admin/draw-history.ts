/**
 * UI-10 F2a (owner A19-A21, 2026-10-06). The shape being drawn or edited on
 * the Props map, with Undo and Redo.
 *
 * Pure: no React, no map, no network. Checked by `npm run verify:ui10`.
 *
 * Every change that the admin would call "one step" is one history entry:
 * dropping a corner, closing the shape, finishing a drag, adding a corner
 * from a midpoint. The live position of a corner while it is being dragged
 * is NOT in here; the map draws it from the pointer and commits it once, on
 * release, with `movePoint`.
 */
import type { Position, Ring } from "@/lib/geo/prop-polygon";

export type DrawShape = {
  /** Corners in drawing order. Never repeats the first corner at the end. */
  points: Position[];
  /** True once the shape has been closed. A closed shape always has 3+ corners. */
  closed: boolean;
};

export type DrawHistory = {
  past: DrawShape[];
  present: DrawShape;
  future: DrawShape[];
};

/** Enough for any real prop; stops a long edit growing without bound. */
export const HISTORY_LIMIT = 100;

/** Fewest corners a prop can have (`ringProblem` agrees). */
export const MIN_CORNERS = 3;

export const EMPTY_SHAPE: DrawShape = { points: [], closed: false };

export function startHistory(shape: DrawShape = EMPTY_SHAPE): DrawHistory {
  return { past: [], present: shape, future: [] };
}

/** An existing prop's ring as a closed, editable shape (Edit shape, A21). */
export function shapeFromRing(ring: Ring): DrawShape {
  const points = ring.map(([lon, lat]) => [lon, lat] as Position);
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  return { points, closed: points.length >= MIN_CORNERS };
}

function commit(history: DrawHistory, next: DrawShape): DrawHistory {
  const past = [...history.past, history.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present: next, future: [] };
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Drops a corner at the end of an open shape. Ignored once closed. */
export function addPoint(history: DrawHistory, point: Position): DrawHistory {
  const { points, closed } = history.present;
  if (closed) return history;
  const last = points[points.length - 1];
  if (last && samePosition(last, point)) return history;
  return commit(history, { points: [...points, point], closed: false });
}

export function canClose(shape: DrawShape): boolean {
  return !shape.closed && shape.points.length >= MIN_CORNERS;
}

export function closeShape(history: DrawHistory): DrawHistory {
  if (!canClose(history.present)) return history;
  return commit(history, { points: history.present.points, closed: true });
}

/** Commits a dragged corner's new position. */
export function movePoint(history: DrawHistory, index: number, point: Position): DrawHistory {
  const { points, closed } = history.present;
  const current = points[index];
  if (!current || samePosition(current, point)) return history;
  const next = points.slice();
  next[index] = point;
  return commit(history, { points: next, closed });
}

/**
 * Adds a corner after `afterIndex` (dragging a midpoint, A21). On a closed
 * shape the last edge wraps back to corner 0, so `afterIndex` may be the last
 * corner.
 */
export function insertPoint(history: DrawHistory, afterIndex: number, point: Position): DrawHistory {
  const { points, closed } = history.present;
  if (afterIndex < 0 || afterIndex >= points.length) return history;
  if (!closed && afterIndex === points.length - 1) return history;
  const next = [...points.slice(0, afterIndex + 1), point, ...points.slice(afterIndex + 1)];
  return commit(history, { points: next, closed });
}

export function canUndo(history: DrawHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: DrawHistory): boolean {
  return history.future.length > 0;
}

export function undo(history: DrawHistory): DrawHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: DrawHistory): DrawHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

/** The ring to count and save: only a closed shape has one. Not repeated at the end. */
export function ringOfShape(shape: DrawShape): Ring | null {
  if (!shape.closed || shape.points.length < MIN_CORNERS) return null;
  return shape.points.map(([lon, lat]) => [lon, lat] as Position);
}

/** Midpoint of each edge a new corner can be pulled from. Closed shapes only. */
export function edgeMidpoints(shape: DrawShape): { afterIndex: number; point: Position }[] {
  if (!shape.closed) return [];
  return shape.points.map((point, index) => {
    const next = shape.points[(index + 1) % shape.points.length]!;
    return {
      afterIndex: index,
      point: [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2] as Position,
    };
  });
}

/** A stable key for a ring, so a count is never repeated for the same shape. */
export function ringKey(ring: Ring | null): string {
  if (!ring) return "";
  return ring.map(([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`).join(";");
}

/** The line under the hint and toolbar (frames 08-10, D3). */
export function cornerLabel(count: number): string {
  if (count === 0) return "No corners yet";
  return count === 1 ? "1 corner" : `${count.toLocaleString("en-GB")} corners`;
}

/** The floating hint at the top of the map. Null once the first corner is down. */
export function topHint(shape: DrawShape): string | null {
  if (shape.closed || shape.points.length > 0) return null;
  return "Tap the map to drop the first corner";
}

/** The small line under the corner count in the toolbar, while the shape is open. */
export function toolbarHint(shape: DrawShape): string {
  if (shape.closed) return "Drag a corner to move it";
  if (shape.points.length < MIN_CORNERS) return `At least ${MIN_CORNERS} to close`;
  return "Or tap corner 1";
}
