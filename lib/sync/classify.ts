/**
 * Pure classification of a failed send. No imports, no I/O, so the Stage 7
 * harness can unit-check it in Node.
 *
 *   duplicate  — the row is already there. Success, not an error.
 *   retryable  — connectivity or server trouble. Retry with backoff, forever.
 *   auth       — the session is gone. Pause everything, rows stay pending.
 *   permanent  — the server has said no and will keep saying no. Park the
 *                row, surface it, do not retry.
 */
export type SendClass = "duplicate" | "retryable" | "auth" | "permanent";

export type SendFailure = {
  /** HTTP status. 0 when the request never got a response. */
  status?: number;
  /** PostgREST / Postgres SQLSTATE, e.g. "23505", or "PGRST301". Empty on network failure. */
  code?: string;
  message: string;
  name?: string;
};

/**
 * PostgREST maps both 23505 (unique) and 23503 (foreign key) to HTTP 409, so
 * the status alone can never mean "duplicate" — only the SQLSTATE can.
 */
export function classify(failure: SendFailure): SendClass {
  const code = failure.code ?? "";
  const status = failure.status ?? 0;
  const message = failure.message ?? "";
  const name = failure.name ?? "";

  if (code === "23505") return "duplicate";

  // Session problems, however they surface.
  if (status === 401) return "auth";
  if (code === "PGRST301" || code === "PGRST302" || code === "PGRST303") return "auth";

  // Nothing came back: offline, DNS, blocked, aborted by our own timeout.
  if (status === 0 || status === undefined) return "retryable";
  if (name === "AbortError" || /AbortError|aborted/i.test(message)) return "retryable";
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message)) return "retryable";

  if (status >= 500) return "retryable";
  if (status === 408 || status === 429) return "retryable";

  // Every other 4xx: RLS (42501), FK (23503), check (23514), bad request.
  if (status >= 400 && status < 500) return "permanent";

  // Unknown shape with a non-error status — treat as connectivity.
  return "retryable";
}
