"use client";

import { useSyncExternalStore } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * UI-7 C3b (owner H5, U7-1, U7-2, 2026-10-04). The ONLY code that sends a
 * position (rule 30-sync exception, skill geo-position).
 *
 * - `report_position` carries the partner scalar and, for admins, the raw
 *   current fix. It is never queued and never retried later: a stale
 *   position replayed would be wrong, so offline or failed sends are dropped.
 * - Sharing is ON by default per assignment (U7-1). Stop is remembered for
 *   that assignment on this phone in localStorage. That flag is the only
 *   thing stored; it holds no coordinate.
 * - Teammates' scalars come back from the same call and live in memory.
 */

export type TeammatePlace = { routeM: number | null; at: string | null };

export type ShareState = {
  assignmentId: string | null;
  stopped: boolean;
  teammates: ReadonlyMap<string, TeammatePlace>;
};

const SERVER_STATE: ShareState = { assignmentId: null, stopped: false, teammates: new Map() };
let state: ShareState = SERVER_STATE;
const listeners = new Set<() => void>();

function emit(next: ShareState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useShareState(): ShareState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
}

function stopKey(assignmentId: string): string {
  return `d2d.shareStopped:${assignmentId}`;
}

function readStopped(assignmentId: string): boolean {
  try {
    return localStorage.getItem(stopKey(assignmentId)) === "1";
  } catch {
    return false;
  }
}

function writeStopped(assignmentId: string, stopped: boolean) {
  try {
    if (stopped) localStorage.setItem(stopKey(assignmentId), "1");
    else localStorage.removeItem(stopKey(assignmentId));
  } catch {
    // Storage blocked: Stop still holds for this session in memory.
  }
}

/** Point the store at today's assignment. Teammates reset with it. */
export function bindAssignment(assignmentId: string | null) {
  if (state.assignmentId === assignmentId) return;
  emit({
    assignmentId,
    stopped: assignmentId ? readStopped(assignmentId) : false,
    teammates: new Map(),
  });
}

export function isSharing(assignmentId: string): boolean {
  return state.assignmentId === assignmentId && !state.stopped;
}

/** One send. Returns false when skipped or failed; the caller never retries it. */
export async function reportPosition(input: {
  assignmentId: string;
  lat: number;
  lng: number;
  routeM: number | null;
  accuracyM: number;
  heading: number | null;
}): Promise<boolean> {
  if (!isSharing(input.assignmentId)) return false;
  try {
    const { data, error } = await createClient().rpc("report_position", {
      p_assignment_id: input.assignmentId,
      p_lat: input.lat,
      p_lon: input.lng,
      p_route_position_m: input.routeM ?? undefined,
      p_accuracy_m: Number.isFinite(input.accuracyM) ? input.accuracyM : undefined,
      p_heading_deg: input.heading ?? undefined,
    });
    if (error || !Array.isArray(data)) return false;
    const teammates = new Map<string, TeammatePlace>();
    for (const row of data) {
      teammates.set(row.canvasser_id, {
        routeM: typeof row.route_position_m === "number" ? row.route_position_m : null,
        at: row.route_position_at ?? null,
      });
    }
    if (isSharing(input.assignmentId)) emit({ ...state, teammates });
    return true;
  } catch {
    return false;
  }
}

/** Stop or share again. Stop also nulls the server rows (best effort; repeated on the next open). */
export async function setSharing(assignmentId: string, on: boolean): Promise<void> {
  writeStopped(assignmentId, !on);
  if (state.assignmentId === assignmentId) {
    emit({ ...state, stopped: !on, teammates: on ? state.teammates : new Map() });
  }
  if (on) return;
  try {
    await createClient().rpc("stop_sharing_position", { p_assignment_id: assignmentId });
  } catch {
    // Offline: PositionSharer repeats the stop the next time the app opens online.
  }
}
