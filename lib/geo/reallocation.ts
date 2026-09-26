import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Reads `app_settings` key `rotation`, field `visit_threshold_pct`, the same
 * way `assignment_close_early` does. A JSON number from 0 to 100 is used.
 * Anything else — missing, a string, null, out of range — is 50.
 */
export function parseVisitThreshold(value: unknown): {
  pct: number;
  source: "setting" | "default";
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { pct: 50, source: "default" };
  }
  const raw = (value as { visit_threshold_pct?: unknown }).visit_threshold_pct;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100) {
    return { pct: 50, source: "default" };
  }
  return { pct: raw, source: "setting" };
}

/** Distinct snapshot doors among the knocked UPRNs. Mirrors assignment_close_early. */
export function workedDoors(snapshot: readonly number[], knockedUprns: readonly number[]): number {
  const doors = new Set(snapshot);
  const hit = new Set<number>();
  for (const uprn of knockedUprns) {
    if (doors.has(uprn)) hit.add(uprn);
  }
  return hit.size;
}

/** `(worked * 100) / total`, or 0 when the snapshot is empty. Same as the RPC. */
export function sharePercent(worked: number, total: number): number {
  if (total <= 0) return 0;
  return (worked * 100) / total;
}

/** Strictly above the threshold. Exactly the threshold does not count. */
export function shareCounts(percent: number, thresholdPct: number): boolean {
  return percent > thresholdPct;
}

export function formatShare(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatThreshold(pct: number): string {
  return formatShare(pct);
}

/** What the settings screen says about the value currently stored. */
export function describeVisitThreshold(value: unknown): {
  pct: number;
  source: "setting" | "default";
  detail: string;
} {
  const parsed = parseVisitThreshold(value);
  if (parsed.source === "setting") {
    return { ...parsed, detail: `Removals use ${formatThreshold(parsed.pct)}%.` };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...parsed, detail: "No rotation setting is stored. Removals use 50%." };
  }
  const raw = (value as { visit_threshold_pct?: unknown }).visit_threshold_pct;
  if (raw === undefined) {
    return { ...parsed, detail: "No visit threshold is stored. Removals use 50%." };
  }
  const shown = typeof raw === "string" ? `"${raw}"` : JSON.stringify(raw);
  return {
    ...parsed,
    detail: `The stored threshold is ${shown}, which is not a percentage from 0 to 100. Removals use 50%.`,
  };
}

/** The sentence shown before the admin confirms a worked removal. */
export function closePreviewSentence(input: {
  worked: number;
  total: number;
  percent: number;
  counts: boolean;
}): string {
  const decision = input.counts ? "will" : "will not";
  return (
    `This will end this visit early. ${input.worked} of ${input.total} doors worked ` +
    `(${formatShare(input.percent)}%) — this ${decision} count toward rotation.`
  );
}

export const DELETE_PREVIEW_SENTENCE = "This will delete this allocation.";

export type ReallocationFailureCode =
  | "not_admin"
  | "missing_assignment"
  | "already_closed"
  | "not_canvasser"
  | "canvasser_double_booked"
  | "team_too_large"
  | "already_member"
  | "not_member"
  | "already_left"
  | "unavailable";

const HINTS = new Set<ReallocationFailureCode>([
  "not_admin",
  "missing_assignment",
  "already_closed",
  "not_canvasser",
  "canvasser_double_booked",
  "team_too_large",
  "already_member",
  "not_member",
  "already_left",
]);

function isHint(value: string): value is ReallocationFailureCode {
  return HINTS.has(value as ReallocationFailureCode);
}

/**
 * Known failures keep the British English message written in the migration.
 * Same shape as `mapAllocateRpcError`.
 */
export function mapReallocationRpcError(
  error: PostgrestError,
): { ok: false; code: ReallocationFailureCode; message: string; detail?: string } {
  const hint = error.hint ?? "";
  if (isHint(hint)) {
    return {
      ok: false,
      code: hint,
      message: error.message,
      detail: error.details ?? undefined,
    };
  }

  if (error.code === "42501") {
    return {
      ok: false,
      code: "not_admin",
      message: "Only an admin can change an allocation.",
      detail: error.message,
    };
  }

  return {
    ok: false,
    code: "unavailable",
    message: "That change could not be saved. Try again.",
    detail: [error.code, error.hint, error.message, error.details].filter(Boolean).join(" | "),
  };
}
