/**
 * PP-2 (owner 2026-10-21). "Pending a result" on the Leads tab's Today view:
 * the canvasser's OWN CRM leads (AGENTS.md P4b / CRM-7 exception, read
 * through `my_crm_week`) that are still waiting for the sit.
 *
 * Owner rules, 2026-10-21:
 * - Leads put on in the last 14 days.
 * - No result yet, Uncontacted, UTC, Re-App and Booked are pending until the
 *   appointment time; after it they belong to Call-backs.
 * - A blowout stays in Pending, whatever the time, until the canvasser taps
 *   "Seen it"; then it belongs to Call-backs.
 * - "Seen it" is kept on this phone only (tonight's scope).
 * - Sale and P&M never show here. A lead with no appointment time is a
 *   call-back, as before.
 *
 * Pure: no React, no network, no storage. `lib/field/pending-data.ts` reads
 * and remembers.
 */

export const PENDING_DAYS = 14;

/** Statuses that wait for the appointment time. `null` = no result in the CRM yet. */
const WAITING = new Set<string | null>([null, "pending", "utc", "re_app", "confirmed"]);

export type PendingCandidate = {
  crm_id: string;
  status: string | null;
  crm_created_at: string;
  appointment_at: string | null;
};

/** The read window: the last `days` days (Pending: 14) up to a minute from now. */
export function pendingSpan(now: Date, days: number = PENDING_DAYS): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - days * 86_400_000).toISOString(),
    to: new Date(now.getTime() + 60_000).toISOString(),
  };
}

function recent(lead: PendingCandidate, now: Date): boolean {
  const at = Date.parse(lead.crm_created_at);
  return Number.isFinite(at) && at >= now.getTime() - PENDING_DAYS * 86_400_000;
}

/** Whether the lead is pending right now (and so not a call-back yet). */
export function isPending(lead: PendingCandidate, seen: ReadonlySet<string>, now: Date): boolean {
  if (!recent(lead, now)) return false;
  if (lead.status === "blowout") return !seen.has(lead.crm_id);
  if (!WAITING.has(lead.status)) return false;
  if (!lead.appointment_at) return false;
  const at = Date.parse(lead.appointment_at);
  return Number.isFinite(at) && at > now.getTime();
}

/** Pending leads, blowouts to acknowledge first, then soonest appointment first. */
export function pendingLeads<T extends PendingCandidate>(leads: readonly T[], seen: ReadonlySet<string>, now: Date): T[] {
  const rank = (lead: T) => (lead.status === "blowout" ? 0 : 1);
  return leads
    .filter((lead) => isPending(lead, seen, now))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.appointment_at ?? "").localeCompare(b.appointment_at ?? "") ||
        a.crm_created_at.localeCompare(b.crm_created_at),
    );
}

/** Blowouts seen on this phone that the call-back list does not already hold (any age: the caller reads the window). */
export function seenBlowouts<T extends PendingCandidate>(leads: readonly T[], seen: ReadonlySet<string>, alreadyListed: ReadonlySet<string>): T[] {
  return leads.filter((lead) => lead.status === "blowout" && seen.has(lead.crm_id) && !alreadyListed.has(lead.crm_id));
}

/** "Today · 4 pending · 1 lead" — the Leads header on the Today view. */
export function todaySubtitle(pending: number | null, logged: number | null): string | undefined {
  // Still loading the day's own leads: say nothing yet rather than "no leads".
  if (logged === null) return pending !== null && pending > 0 ? `Today · ${pending} pending` : undefined;
  const parts: string[] = [];
  if (pending !== null && pending > 0) parts.push(`${pending} pending`);
  if (logged !== null && logged > 0) parts.push(logged === 1 ? "1 lead" : `${logged} leads`);
  return parts.length === 0 ? "Today · no leads yet" : `Today · ${parts.join(" · ")}`;
}

/** "Was due Tue 20 Oct, 18:00" for a blowout, "Appointment Thu 22 Oct, 18:00" otherwise. */
export function pendingWhenLine(lead: PendingCandidate, dayAndTime: (iso: string) => string, now: Date): string {
  if (!lead.appointment_at) return "No appointment time";
  const past = Date.parse(lead.appointment_at) <= now.getTime();
  return `${past ? "Was due" : "Appointment"} ${dayAndTime(lead.appointment_at)}`;
}

// ---- "Seen it" on this phone -------------------------------------------------

/** Seen blowouts, by CRM id → when tapped. Kept 90 days (the longest Call-backs window), then dropped. */
export type SeenStore = Record<string, string>;

export const SEEN_KEEP_DAYS = 90;

export function parseSeen(raw: string | null, now: Date): SeenStore {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const cutoff = now.getTime() - SEEN_KEEP_DAYS * 86_400_000;
    const out: SeenStore = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "string" && Date.parse(at) >= cutoff) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}
