/** Calendar date in Europe/London as YYYY-MM-DD. Matches the RPC. */
export function londonDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
