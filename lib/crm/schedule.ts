/**
 * CRM-4 A (owner 2026-10-11, P3). Pure rules for the scheduled CRM sync.
 *
 * Supabase pg_cron (migration 036) calls `/api/cron/crm-sync` every 30
 * minutes from about 05:00 to 21:00 London. Each call reads only the CRM
 * leads changed since the last successful run. Nothing here talks to the CRM
 * or the database; the route and the Insights page pass rows in.
 */

import { timingSafeEqual } from "node:crypto";

/** A run that started this recently and has not finished is still going: do not start another. */
export const RUN_OVERLAP_MS = 15 * 60 * 1000;

/** Sync hours in London (inclusive start, exclusive end): runs every 30 min inside them. */
export const SYNC_HOURS = { from: 5, to: 21.5 } as const;

/** During sync hours, no successful run for this long means the sync has stopped. */
export const STALE_IN_HOURS_MS = 2 * 60 * 60 * 1000;

export type SyncRun = {
  started_at: string;
  finished_at: string | null;
  max_modified_seen: string | null;
  error: string | null;
};

/** "Bearer <secret>" with a constant-time compare. False when no secret is configured. */
export function cronAuthorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const given = Buffer.from(header);
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** True while an earlier run is still going (started under 15 min ago, not finished). */
export function runInProgress(runs: readonly SyncRun[], now: Date): boolean {
  return runs.some((r) => r.finished_at === null && now.getTime() - Date.parse(r.started_at) < RUN_OVERLAP_MS);
}

/** The newest successful run (finished, no error, has a cursor), or null. */
export function lastSuccess(runs: readonly SyncRun[]): SyncRun | null {
  let best: SyncRun | null = null;
  for (const r of runs) {
    if (r.finished_at === null || r.error !== null || r.max_modified_seen === null) continue;
    if (!best || Date.parse(r.finished_at) > Date.parse(best.finished_at ?? "")) best = r;
  }
  return best;
}

/** Where the next run starts reading: the last successful run's newest CRM modified time. */
export function nextCursor(runs: readonly SyncRun[]): string | null {
  return lastSuccess(runs)?.max_modified_seen ?? null;
}

const HOUR_MINUTE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

function londonHours(at: Date): number {
  const [h, m] = HOUR_MINUTE.format(at).split(":").map(Number);
  return (h ?? 0) + (m ?? 0) / 60;
}

/** "14:30", "yesterday 21:00", "9 Oct 21:00" (London). */
export function whenWords(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = HOUR_MINUTE.format(at);
  const day = DAY.format(at);
  if (day === DAY.format(now)) return time;
  if (day === DAY.format(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return `yesterday ${time}`;
  return `${SHORT_DAY.format(at)} ${time}`;
}

export type Freshness = { text: string; stale: boolean };

/**
 * The line under the Insights CRM period. Stale when the newest run failed,
 * when nothing has ever synced, or when no run has succeeded for over 2 hours
 * during sync hours (overnight, the evening's last run is fine until 07:00).
 */
export function syncFreshness(runs: readonly SyncRun[], now: Date): Freshness {
  const ok = lastSuccess(runs);
  if (!ok?.finished_at) return { text: "CRM not synced yet", stale: true };
  const newest = [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
  const when = whenWords(ok.finished_at, now);
  if (newest && newest.error !== null && newest.finished_at !== null) {
    return { text: `CRM sync failed; last updated ${when}`, stale: true };
  }
  const age = now.getTime() - Date.parse(ok.finished_at);
  const hours = londonHours(now);
  const inHours = hours >= SYNC_HOURS.from + 2 && hours < SYNC_HOURS.to + 0.5;
  const limit = inHours ? STALE_IN_HOURS_MS : 12 * 60 * 60 * 1000;
  if (age > limit) return { text: `CRM not updated since ${when}`, stale: true };
  return { text: `CRM updated ${when}`, stale: false };
}

/** What the route sends back: counts only, never lead data. */
export type CronResult =
  | { ok: true; skipped: "running" }
  | { ok: true; seen: number; inserted: number; updated: number; unchanged: number; skipped: number }
  | { ok: false; error: string };
