/**
 * SEAM (Stage 16). Where the canvasser is along the route.
 *
 * Stage 8 has no position source at all. There is no `navigator.geolocation`
 * call anywhere in this repo yet and the first one belongs to Stage 16, which
 * carries the whole of Section 8's compliance argument: the raw fix is
 * snapped to the route line on the device and discarded there, and only the
 * distance along the route is ever transmitted. Invariant 7.
 *
 * Until then `getRoutePosition()` returns null, `positionEnabled` is false,
 * and the Logger's auto-advance is off because of it rather than because of
 * a separate switch someone could flip by accident.
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
