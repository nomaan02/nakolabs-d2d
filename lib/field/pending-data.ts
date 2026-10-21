"use client";

/**
 * PP-2 (owner 2026-10-21). Reads for "Pending a result", and the "Seen it"
 * memory for blowouts. Own leads only: `my_crm_week` (RLS and the RPC decide)
 * and the canvasser's own call results (`crm_callbacks_select_own`).
 *
 * "Seen it" is kept in this phone's storage only (owner 2026-10-21): no
 * database write, no offline-queue op. Another phone shows the blowout again.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CallbackLead, WeekLead } from "@/lib/field/crm";
import { fetchWeek } from "@/lib/field/crm-data";
import { parseSeen, pendingSpan, type SeenStore } from "@/lib/field/pending";
import { createClient } from "@/lib/supabase/client";

const SEEN_KEY = "d2d.crm.seenBlowouts";
const SEEN_EVENT = "d2d:seen-blowouts";

/** My CRM leads put on in the last `days` days (Pending: 14; same rows and details as This week). */
export async function fetchPendingWindow(days?: number): Promise<WeekLead[]> {
  const span = pendingSpan(new Date(), days);
  return fetchWeek(span.from, span.to);
}

/**
 * The time, ticking once a minute and on returning to the app, so a lead
 * whose appointment passes while the screen is open moves to Call-backs.
 * `onWake` runs when the app comes back to the front (reload the CRM rows).
 */
export function useMinuteClock(onWake?: () => void): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      tick();
      onWake?.();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onWake]);
  return now;
}

function keyFor(canvasserId: string): string {
  return `${SEEN_KEY}:${canvasserId}`;
}

function readSeen(canvasserId: string): SeenStore {
  try {
    return parseSeen(window.localStorage.getItem(keyFor(canvasserId)), new Date());
  } catch {
    return {};
  }
}

/** Blowouts this canvasser has marked "Seen it" on this phone, and the way to mark one. */
export function useSeenBlowouts(canvasserId: string | null): { seen: ReadonlySet<string>; markSeen: (crmId: string) => void } {
  const [store, setStore] = useState<SeenStore>({});

  useEffect(() => {
    if (!canvasserId) return;
    setStore(readSeen(canvasserId));
    // Entries are only ever added, so merge: a tap this screen holds is never wiped by a failed storage read.
    const again = () => setStore((current) => ({ ...current, ...readSeen(canvasserId) }));
    window.addEventListener(SEEN_EVENT, again);
    window.addEventListener("storage", again);
    return () => {
      window.removeEventListener(SEEN_EVENT, again);
      window.removeEventListener("storage", again);
    };
  }, [canvasserId]);

  const markSeen = useCallback(
    (crmId: string) => {
      if (!canvasserId) return;
      const next = { ...readSeen(canvasserId), [crmId]: new Date().toISOString() };
      // Merged with what this screen holds, so private mode (no storage) still remembers every tap.
      setStore((current) => ({ ...current, ...next }));
      try {
        window.localStorage.setItem(keyFor(canvasserId), JSON.stringify(next));
        window.dispatchEvent(new Event(SEEN_EVENT));
      } catch {
        // Private mode: it stays seen on this screen until the tab is closed.
      }
    },
    [canvasserId],
  );

  const seen = useMemo(() => new Set(Object.keys(store)), [store]);
  return { seen, markSeen };
}

/**
 * Seen blowouts as call-back rows, with this canvasser's latest call result
 * on each (so a "not interested" logged yesterday keeps it off the list).
 */
export async function asCallbackRows(leads: readonly WeekLead[], canvasserId: string): Promise<CallbackLead[]> {
  if (leads.length === 0) return [];
  const { data, error } = await createClient()
    .from("crm_callbacks")
    .select("crm_id, result, called_at, call_back_on, created_at")
    .eq("canvasser_id", canvasserId)
    .in(
      "crm_id",
      leads.map((lead) => lead.crm_id),
    );
  if (error) throw error;
  const latest = new Map<string, { result: string; called_at: string; call_back_on: string | null; created_at: string }>();
  for (const row of data ?? []) {
    const seen = latest.get(row.crm_id);
    if (!seen || row.called_at > seen.called_at || (row.called_at === seen.called_at && row.created_at > seen.created_at)) latest.set(row.crm_id, row);
  }
  return leads.map((lead) => {
    const call = latest.get(lead.crm_id);
    return {
      crm_id: lead.crm_id,
      status: lead.status,
      callback_reason: lead.callback_reason,
      crm_created_at: lead.crm_created_at,
      appointment_at: lead.appointment_at,
      title: lead.title,
      surname: lead.surname,
      phone: lead.phone,
      alt_phone: lead.alt_phone,
      uprn: lead.uprn,
      house_number: lead.house_number,
      building_name: lead.building_name,
      street_name: lead.street_name,
      postcode_sector: lead.postcode_sector,
      last_result: call?.result ?? null,
      last_called_at: call?.called_at ?? null,
      call_back_on: call?.call_back_on ?? null,
      postcode: lead.postcode,
      address_line: lead.address_line,
      result_note: lead.result_note,
      product_interest: lead.product_interest,
      best_time: lead.best_time,
      description: lead.description,
    };
  });
}
