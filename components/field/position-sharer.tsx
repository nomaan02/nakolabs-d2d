"use client";

import { useCallback, useEffect, useRef } from "react";

import { useFieldData } from "@/components/field/field-data-provider";
import { useGeo } from "@/components/field/geo-provider";
import { shouldSend, type SentMark } from "@/lib/field/geo";
import { bindAssignment, reportPosition, setSharing, useShareState } from "@/lib/field/position-share";

/**
 * UI-7 C3b (owner H5, U7-1, U7-2, 2026-10-04). Renders nothing. Sends the
 * current position for today's assignment through `lib/field/position-share.ts`:
 * at most every 30 s, skipped when moved under 10 m, a 2-minute heartbeat,
 * only while the page is visible and online, never a stale fix. A failed
 * send is dropped, never queued.
 */
const HEARTBEAT_CHECK_MS = 15_000;

export function PositionSharer() {
  const geo = useGeo();
  const { phase, canvasserId } = useFieldData();
  const share = useShareState();
  const assignmentId = phase.kind === "ready" ? phase.assignment.assignment_id : null;
  const lastSent = useRef<SentMark | null>(null);
  const inFlight = useRef(false);
  const latest = useRef({ fix: geo.fix, alongM: geo.routePlace?.alongM ?? null, heading: geo.heading });
  latest.current = { fix: geo.fix, alongM: geo.routePlace?.alongM ?? null, heading: geo.heading };

  useEffect(() => {
    bindAssignment(assignmentId);
    lastSent.current = null;
  }, [assignmentId]);

  // Stopped on this phone: make sure the server rows are null too (an
  // offline Stop is repeated here the next time the app opens).
  useEffect(() => {
    if (!assignmentId || share.assignmentId !== assignmentId || !share.stopped) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    void setSharing(assignmentId, false);
  }, [assignmentId, share.assignmentId, share.stopped]);

  const trySend = useCallback(() => {
    const { fix, alongM, heading } = latest.current;
    if (!assignmentId || !canvasserId || !fix || inFlight.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const now = Date.now();
    if (!shouldSend(lastSent.current, fix, now)) return;
    // Marked before the call, so a failing server is tried at most every 30 s.
    lastSent.current = { at: now, lng: fix.lng, lat: fix.lat };
    inFlight.current = true;
    void reportPosition({
      assignmentId,
      lat: fix.lat,
      lng: fix.lng,
      routeM: alongM,
      accuracyM: fix.accuracyM,
      heading,
    }).finally(() => {
      inFlight.current = false;
    });
  }, [assignmentId, canvasserId]);

  useEffect(() => {
    trySend();
  }, [geo.fix, trySend]);

  // Standing still produces no new fixes; this keeps the heartbeat going.
  useEffect(() => {
    const id = window.setInterval(trySend, HEARTBEAT_CHECK_MS);
    return () => window.clearInterval(id);
  }, [trySend]);

  return null;
}
