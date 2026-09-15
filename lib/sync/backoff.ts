/**
 * Full-jitter exponential backoff. Pure; the queue owns the attempt counter.
 *
 *   delay = random(0.5, 1) × min(cap, base × 2^attempt)
 *
 * The counter lives in memory only. A restart or an external trigger (online,
 * focus) resets it, because those are signals that conditions have changed.
 */
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_CAP_MS = 5 * 60_000;

export function delayMs(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(0, Math.floor(attempt));
  const exponential = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** n);
  const factor = 0.5 + 0.5 * Math.min(1, Math.max(0, random()));
  return Math.round(exponential * factor);
}
