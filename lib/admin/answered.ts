/**
 * Canonical "answered" rule. One expression, used by the dashboard SQL
 * (`admin_dashboard`) and by any client-side labelling of a single door.
 *
 * Contact, Lead and Rented/Council all mean somebody came to the door.
 * Counting only `outcome = 'answered'` understates the answer rate.
 *
 * SQL (Stage 14b):
 *   outcome not in ('no_answer','inaccessible')
 */
export const ANSWERED_SQL = "outcome not in ('no_answer','inaccessible')" as const;

export function isAnsweredOutcome(outcome: string): boolean {
  return outcome !== "no_answer" && outcome !== "inaccessible";
}
