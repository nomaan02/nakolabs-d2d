/**
 * CRM-7 A (owner 2026-10-15). Pure rules for the canvasser's own "Refresh
 * from CRM" button. Nothing here talks to the CRM or the database; the route
 * passes the refresh log in.
 *
 * The button re-reads only the signed-in canvasser's leads for this week
 * through the same read-only CRM client as the scheduled sync. To stay gentle
 * on the company's server:
 *   - one refresh per canvasser per 30 seconds;
 *   - one refresh at a time across everyone (a second press waits).
 */

/** Gap between one canvasser's refreshes. */
export const REFRESH_GAP_MS = 30_000;

/** A refresh that started this long ago and never finished is treated as dead. */
export const REFRESH_STALE_MS = 2 * 60 * 1000;

export type RefreshLogRow = {
  canvasser_id: string;
  requested_at: string;
  finished_at: string | null;
};

export type RefreshGate =
  | { ok: true }
  | { ok: false; reason: "too_soon" | "busy"; retryAfterSec: number };

/**
 * May this canvasser start a refresh now? `busy` when anyone's refresh is
 * still running (started under 2 minutes ago, not finished); `too_soon` when
 * this canvasser's last refresh started under 30 seconds ago.
 */
export function refreshGate(log: readonly RefreshLogRow[], canvasserId: string, now: Date): RefreshGate {
  const at = now.getTime();
  for (const row of log) {
    if (row.finished_at === null && at - Date.parse(row.requested_at) < REFRESH_STALE_MS) {
      const wait = REFRESH_STALE_MS - (at - Date.parse(row.requested_at));
      return { ok: false, reason: "busy", retryAfterSec: Math.max(5, Math.min(15, Math.ceil(wait / 1000))) };
    }
  }
  for (const row of log) {
    if (row.canvasser_id !== canvasserId) continue;
    const since = at - Date.parse(row.requested_at);
    if (since < REFRESH_GAP_MS) return { ok: false, reason: "too_soon", retryAfterSec: Math.ceil((REFRESH_GAP_MS - since) / 1000) };
  }
  return { ok: true };
}

/** What the route sends back: counts only, never lead data. */
export type RefreshResult =
  | { ok: true; seen: number; changed: number; at: string }
  | { ok: false; error: "not_signed_in" | "not_linked" | "too_soon" | "busy" | "failed"; retryAfterSec?: number };
