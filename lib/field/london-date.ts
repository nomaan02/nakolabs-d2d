/** Calendar date in Europe/London as YYYY-MM-DD. Matches the RPC. */
export function londonDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Same Europe/London calendar day. Mirrors `leads_set_is_immediate`, which
 * compares `booked_for` to the knock's `occurred_at`. Display only — never
 * written onto a payload; the trigger owns `is_immediate`.
 */
export function isSameLondonDay(a: Date, b: Date): boolean {
  return londonDate(a) === londonDate(b);
}

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The instant's Europe/London wall clock, as if that wall clock were UTC. */
function londonWallClock(at: Date): number {
  const parts = PARTS.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
}

/**
 * An ISO instant for a Europe/London wall-clock time, `daysAhead` days from
 * today's London date. Used for the lead sheet's quick chips.
 *
 * Resolved against the real offset at that moment rather than assumed to be
 * GMT or BST: a "Today PM" chip tapped on the last Saturday in October must
 * not land an hour out. The loop runs twice because the offset at the guessed
 * instant can itself differ from the offset at the answer, across a
 * transition.
 *
 * The device's own timezone never enters into it.
 */
export function londonInstant(daysAhead: number, hour: number, minute = 0): string {
  const [year, month, day] = londonDate().split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day + daysAhead));
  const wanted = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
    hour,
    minute,
  );

  let instant = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    instant = wanted - (londonWallClock(new Date(instant)) - instant);
  }
  return new Date(instant).toISOString();
}
