import type { PostgrestError } from "@supabase/supabase-js";
import type { RingProblem } from "@/lib/geo/prop-polygon";

/**
 * Tokens the prop RPCs return in `hint`, plus the ones caught before the call
 * and the fallback. `assert_prop_polygon` is the only source of the server
 * ones, so both RPCs fail the same way for the same polygon.
 */
export type PropFailure =
  | RingProblem
  | "not_admin"
  | "missing_polygon"
  | "geometry_type"
  | "srid"
  | "empty_polygon"
  | "invalid_geometry"
  | "cap_out_of_range"
  | "unavailable";

const SERVER_HINTS = new Set<string>([
  "not_admin",
  "missing_polygon",
  "geometry_type",
  "srid",
  "empty_polygon",
  "invalid_geometry",
  "cap_out_of_range",
]);

export type PropFailureResult = {
  ok: false;
  code: PropFailure;
  message: string;
  detail?: string;
};

/**
 * Turns a PostgREST error into something the rail can display. Messages for
 * known failures are written in the migration, in British English, and are
 * passed through rather than restated here — one wording, one place.
 */
export function mapPropRpcError(error: PostgrestError): PropFailureResult {
  const hint = error.hint ?? "";

  if (SERVER_HINTS.has(hint)) {
    return {
      ok: false,
      code: hint as PropFailure,
      message: error.message,
      detail: error.details ?? undefined,
    };
  }

  if (error.code === "42501") {
    return {
      ok: false,
      code: "not_admin",
      message: "Only an admin can work with props.",
      detail: error.message,
    };
  }

  return {
    ok: false,
    code: "unavailable",
    message: "The door count is unavailable. Check your connection and try again.",
    detail: error.message,
  };
}
