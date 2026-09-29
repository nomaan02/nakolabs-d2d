import { isSameLondonDay } from "@/lib/field/london-date";
import type { LocalOutcome, LocalOutcomes } from "@/lib/field/local-outcomes";

/**
 * Today's stats for the Logger's stat row (invariant 2, Section 3): own
 * counts only, this assignment, today. No rate, no rank, nothing about
 * another canvasser. "Confirmed" has no helper here — it stays "—" until
 * the CRM is linked.
 *
 * `outcomes` is already latest-wins per door (one entry per UPRN — see
 * `foldOutcomes`), so every count below is automatically one-per-door.
 */

function mine(outcomes: LocalOutcomes, canvasserId: string, now: number): LocalOutcome[] {
  const today = new Date(now);
  return Array.from(outcomes.values()).filter(
    (entry) => entry.canvasserId === canvasserId && isSameLondonDay(new Date(entry.occurredAt), today),
  );
}

/**
 * Owner definition, 2026-09-28: in this business a "Contact" is a BOOKABLE
 * ANSWER. Contacts = count of `outcome = 'answered'` (the Contact button)
 * ONLY. Every other outcome is counted separately and never folded in:
 * `lead` is its own stat (`countLeads`), `no_opportunity` is not a contact
 * even though someone answered, `no_answer` is not a contact, and
 * `refused` / `do_not_call` / `inaccessible` / `callback` are not contacts.
 *
 * This is deliberately NOT the outcome-mapping skill's "answered" rule
 * (`outcome NOT IN ('no_answer','inaccessible')`), which stays unchanged for
 * every admin surface. Do not reuse this helper's name or logic there — see
 * the dated brief note flagging the two figures for reconciliation.
 */
export function countBookableContacts(
  outcomes: LocalOutcomes,
  canvasserId: string,
  now: number = Date.now(),
): number {
  return mine(outcomes, canvasserId, now).filter((entry) => entry.outcome === "answered").length;
}

/** `lead` is its own stat, never folded into Contacts. */
export function countLeads(outcomes: LocalOutcomes, canvasserId: string, now: number = Date.now()): number {
  return mine(outcomes, canvasserId, now).filter((entry) => entry.isLead).length;
}

/** Distinct doors logged today by this canvasser, whatever the outcome. */
export function countDoorsLogged(
  outcomes: LocalOutcomes,
  canvasserId: string,
  now: number = Date.now(),
): number {
  return new Set(mine(outcomes, canvasserId, now).map((entry) => entry.uprn)).size;
}
