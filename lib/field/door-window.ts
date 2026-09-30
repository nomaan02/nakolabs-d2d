/**
 * Pure maths behind `DoorScroll` (UI item 1, Session B2, P13). The
 * component owns the DOM; everything that decides which doors exist in the
 * DOM, where the track scrolls to and when the cursor moves is here, so it
 * is testable without a browser (`scripts/verify-ui-1-logger.ts`).
 *
 * The scroll never wraps. Door 0 and the last door are hard ends; A1's
 * forward-wrap after a log is the cursor's job, arriving here as an
 * ordinary external index change.
 */

/** Doors rendered either side of the centre. At most 2 × 8 + 1 = 17 nodes for any N. */
export const WINDOW_RADIUS = 8;

/** An external index change scrolls smoothly for up to this many doors, instantly beyond. */
export const SMOOTH_MAX_DOORS = 3;

export const SETTLE_DEBOUNCE_MS = 120;
export const SETTLE_PULSE_MS = 10;

export function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.round(index)));
}

/** The indices to render around `centre`, clamped to the ends. Never wraps. */
export function windowIndices(centre: number, total: number, radius: number = WINDOW_RADIUS): number[] {
  if (total <= 0) return [];
  const c = clampIndex(centre, total);
  const from = Math.max(0, c - radius);
  const to = Math.min(total - 1, c + radius);
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/** ‹ is -1, › is +1. Exactly one door, clamped at the ends. */
export function stepIndex(index: number, direction: -1 | 1, total: number): number {
  return clampIndex(index + direction, total);
}

export function atStart(index: number): boolean {
  return index <= 0;
}

export function atEnd(index: number, total: number): boolean {
  return index >= total - 1;
}

export type TrackMetrics = {
  /** One door's slot width. */
  slot: number;
  /** Padding either side of the track, so door i is centred at scrollLeft = i × slot. */
  pad: number;
  trackWidth: number;
};

export function trackMetrics(viewport: number, total: number): TrackMetrics {
  const slot = Math.max(1, Math.round(0.4 * viewport));
  const pad = Math.max(0, (viewport - slot) / 2);
  return { slot, pad, trackWidth: pad * 2 + Math.max(0, total) * slot };
}

export function scrollLeftFor(index: number, slot: number): number {
  return index * slot;
}

/** The door nearest the viewport centre for a scroll offset. */
export function indexAt(scrollLeft: number, slot: number, total: number): number {
  return clampIndex(scrollLeft / slot, total);
}

/**
 * What a settled scroll means for the cursor. `changed` is false whenever
 * the scroller rests where the current index already is — which is always
 * the case after an external (programmatic) scroll — so the scroll can only
 * move the cursor when a person moved the scroll.
 */
export function settle(
  scrollLeft: number,
  slot: number,
  total: number,
  current: number,
): { index: number; changed: boolean } {
  const index = indexAt(scrollLeft, slot, total);
  return { index, changed: index !== current };
}

export function scrollBehaviourFor(from: number, to: number): "smooth" | "instant" {
  return Math.abs(to - from) <= SMOOTH_MAX_DOORS ? "smooth" : "instant";
}

/** 0 at the centre, 1 at one slot away or further. Drives scale and fade. */
export function distanceFromCentre(index: number, scrollLeft: number, slot: number): number {
  return Math.min(1, Math.abs(index - scrollLeft / slot));
}

export type PlateSize = "xl" | "lg" | "md" | "sm";

/**
 * The plate ladder: 88/32 for 2 characters or fewer, 72/26 for 3,
 * 58/22 for 4, 44/18 with an ellipsis for 5 or more (current/neighbour px).
 */
export function plateSize(plate: string): PlateSize {
  const n = [...plate].length;
  if (n <= 2) return "xl";
  if (n === 3) return "lg";
  if (n === 4) return "md";
  return "sm";
}

export const PLATE_PX: Record<PlateSize, { current: number; neighbour: number }> = {
  xl: { current: 88, neighbour: 32 },
  lg: { current: 72, neighbour: 26 },
  md: { current: 58, neighbour: 22 },
  sm: { current: 44, neighbour: 18 },
};

/** The displayed plate. `doorPlate`'s "—" placeholder becomes the route position. */
export function scrollPlate(plate: string, position: number): { text: string; placeholder: boolean } {
  if (plate === "—") return { text: `#${position + 1}`, placeholder: true };
  return { text: plate, placeholder: false };
}
