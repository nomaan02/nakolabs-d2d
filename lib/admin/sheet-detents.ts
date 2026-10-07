/**
 * UI-10 F2a (owner A22, 2026-10-06). The Props map sheet's three heights on a
 * phone: peek (title and filters), half (the list over the map) and full.
 *
 * Pure: no React, no DOM. Checked by `npm run verify:ui10`.
 * Heights are in CSS pixels, measured from the bottom of the map area.
 */

export type Detent = "peek" | "half" | "full";

export const DETENTS: readonly Detent[] = ["peek", "half", "full"];

export type DetentHeights = Record<Detent, number>;

/** Frame 03: handle, title, counts and the filter chips. */
export const PEEK_HEIGHT = 176;
/** Frame 04: the sheet's top edge just over half way up. */
export const HALF_RATIO = 0.56;
/** Frame 05 at full: the map keeps a strip at the top so it is still there. */
export const FULL_GAP = 64;
/** px per ms. A flick faster than this goes one detent in its direction. */
export const FLING_VELOCITY = 0.45;

export function detentHeights(available: number): DetentHeights {
  const room = Math.max(available, PEEK_HEIGHT + 160);
  const full = Math.max(PEEK_HEIGHT + 120, room - FULL_GAP);
  const half = Math.min(full - 60, Math.max(PEEK_HEIGHT + 60, Math.round(room * HALF_RATIO)));
  return { peek: PEEK_HEIGHT, half, full };
}

export function clampHeight(height: number, heights: DetentHeights): number {
  return Math.min(heights.full, Math.max(heights.peek, height));
}

/**
 * Where a released drag settles. `velocity` is px/ms, positive when the
 * sheet was growing. A fling moves one step from where the drag started;
 * otherwise the nearest detent wins.
 */
export function settleDetent(
  height: number,
  velocity: number,
  heights: DetentHeights,
  from: Detent,
): Detent {
  if (Math.abs(velocity) >= FLING_VELOCITY) {
    const index = DETENTS.indexOf(from);
    const step = velocity > 0 ? 1 : -1;
    return DETENTS[Math.min(DETENTS.length - 1, Math.max(0, index + step))]!;
  }
  let best: Detent = "peek";
  let bestDistance = Infinity;
  for (const detent of DETENTS) {
    const distance = Math.abs(heights[detent] - height);
    if (distance < bestDistance) {
      best = detent;
      bestDistance = distance;
    }
  }
  return best;
}

/** Keyboard and handle taps: the handle cycles peek → half → full → half. */
export function nextDetent(current: Detent): Detent {
  if (current === "peek") return "half";
  if (current === "half") return "full";
  return "half";
}
