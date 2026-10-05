/**
 * SEAM (Stage 16). Where the canvasser is along the route.
 *
 * Amended 2026-10-04 (UI-7 C1b; owner H3, H5, U7-1..U7-5). The live fix now
 * comes from `components/field/geo-provider.tsx` (the only geolocation call
 * in the repo) and the scalar from the route snapping in UI-7 C2. See the
 * brief's invariant 7 / Section 8 / Stage 16 amendments.
 *
 * This seam is deliberately left as it was: `positionEnabled` stays false and
 * `getRoutePosition()` stays null, so the Logger never auto-advances. The
 * near-you chip (UI-7 C2) suggests a door; the canvasser taps.
 */

/**
 * Stage 8: a client-side constant, `false`.
 * Stage 16: a per-assignment opt-in the canvasser grants.
 */
export const positionEnabled = false;

/**
 * Distance along the route, in metres. Never a coordinate — invariant 7.
 *
 * Stage 8: always null. Stage 16: the snapped scalar.
 */
export function getRoutePosition(): number | null {
  return null;
}

/**
 * SEAM (Stage 16). Whether the Logger may advance the cursor on its own.
 *
 * Disabled while there is no position to advance from. Stage 16 turns this on
 * behind the per-assignment opt-in. Note that even then the cursor stays
 * manual with respect to "next unlogged" — skipping to the next unlogged door
 * needs Stage 10's claims, or a whole team walks onto the same doorstep.
 */
export function autoAdvanceEnabled(): boolean {
  return positionEnabled && getRoutePosition() !== null;
}
