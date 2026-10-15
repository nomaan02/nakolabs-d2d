"use client";

/**
 * CRM-5 C. The field app's only reads of CRM data, and its only CRM write.
 *
 * Reads go through the 037 RPCs, which return the signed-in canvasser's OWN
 * leads (my_crm_leads, my_crm_callbacks) or totals only (crm_leaderboard).
 * Nothing here reads crm_leads directly.
 *
 * The one write, a call result, goes through the offline queue
 * (`lib/sync/queue.ts`, op `crm_callback`). It is never sent to the CRM.
 * Call results logged on this phone are read back from the outbox so the
 * list moves the moment you tap, before any sync.
 */

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import type { CallbackLead, LeaderRow, LocalCall, MyCrmLead } from "@/lib/field/crm";
import { fieldDb } from "@/lib/field/db";
import { createClient } from "@/lib/supabase/client";
import { CRM_CALLBACK_GROUP, newClientEventId, type CallResult, type CrmCallbackOp } from "@/lib/sync/ops";
import { enqueue } from "@/lib/sync/queue";

export type Load<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "offline" }
  | { kind: "error" };

export type CrmMe = { name: string | null; branch: string | null };

function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

const ME_KEY = "d2d.crm.me";

/** The CRM name this account is linked to (null = not linked yet). */
export async function fetchCrmMe(userId: string): Promise<CrmMe> {
  const { data, error } = await createClient().from("profiles").select("crm_name, crm_branch").eq("id", userId).maybeSingle();
  if (error) throw error;
  const me = { name: data?.crm_name ?? null, branch: data?.crm_branch ?? null };
  try {
    window.localStorage.setItem(ME_KEY, JSON.stringify({ userId, ...me }));
  } catch {
    // Private mode: the drawer just does not show the CRM items.
  }
  return me;
}

/**
 * FUI-1a: the last CRM link this phone loaded for this account (by Leads or
 * You), read without a request. The field drawer uses it to decide whether
 * to show My results and Leaderboard, so opening it never calls Supabase.
 */
export function knownCrmMe(userId: string | null): CrmMe | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(ME_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as { userId?: unknown; name?: unknown; branch?: unknown };
    if (row.userId !== userId) return null;
    return {
      name: typeof row.name === "string" ? row.name : null,
      branch: typeof row.branch === "string" ? row.branch : null,
    };
  } catch {
    return null;
  }
}

export async function fetchCallbacks(days: number): Promise<CallbackLead[]> {
  const { data, error } = await createClient().rpc("my_crm_callbacks", { p_days: days });
  if (error) throw error;
  return (data ?? []) as CallbackLead[];
}

export async function fetchMyLeads(from: string, to: string): Promise<MyCrmLead[]> {
  const { data, error } = await createClient().rpc("my_crm_leads", { p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, sale_amount: r.sale_amount === null ? null : Number(r.sale_amount) })) as MyCrmLead[];
}

export async function fetchLeaderboard(from: string, to: string): Promise<LeaderRow[]> {
  const { data, error } = await createClient().rpc("crm_leaderboard", { p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    canvasser: r.canvasser,
    branch: r.branch,
    leads: Number(r.leads),
    sold: Number(r.sold),
    pitched: Number(r.pitched),
    revenue: Number(r.revenue),
    sales_with_amount: Number(r.sales_with_amount),
  }));
}

/**
 * Runs `load` when `key` changes (and when the phone comes back online).
 * Offline with nothing loaded yet → "offline"; the screens say so plainly.
 */
export function useLoad<T>(key: string | null, load: () => Promise<T>): Load<T> & { reload: () => void } {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === null) return;
    let live = true;
    if (offline()) {
      setState((s) => (s.kind === "ready" ? s : { kind: "offline" }));
    } else {
      setState((s) => (s.kind === "ready" ? s : { kind: "loading" }));
      load().then(
        (data) => live && setState({ kind: "ready", data }),
        () => live && setState((s) => (s.kind === "ready" ? s : offline() ? { kind: "offline" } : { kind: "error" })),
      );
    }
    const again = () => setTick((t) => t + 1);
    window.addEventListener("online", again);
    return () => {
      live = false;
      window.removeEventListener("online", again);
    };
    // `load` is rebuilt every render; `key` says when the request changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** Call results logged on this phone in the last two days (synced or not). */
export function useLocalCalls(canvasserId: string | null): LocalCall[] {
  const [calls, setCalls] = useState<LocalCall[]>([]);
  useEffect(() => {
    if (!canvasserId) return;
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const sub = liveQuery(() =>
      fieldDb().outbox.where("[assignment_id+seq]").between([CRM_CALLBACK_GROUP, 0], [CRM_CALLBACK_GROUP, Infinity]).toArray(),
    ).subscribe({
      next: (rows) =>
        setCalls(
          rows
            .filter((r) => r.kind === "crm_callback" && r.canvasser_id === canvasserId && r.created_at >= since)
            .map((r) => {
              const cb = (r.payload as CrmCallbackOp["payload"]).callback;
              return { crm_id: cb.crm_id, result: cb.result, called_at: cb.called_at, call_back_on: cb.call_back_on, synced: r.status === "synced" };
            }),
        ),
      error: () => setCalls([]),
    });
    return () => sub.unsubscribe();
  }, [canvasserId]);
  return calls;
}

/** Log a call result. Queued on the phone; syncs when there is signal. */
export async function logCallResult(input: { canvasserId: string; crmId: string; result: CallResult; callBackOn: string | null }): Promise<boolean> {
  const clientEventId = newClientEventId();
  const op: CrmCallbackOp = {
    kind: "crm_callback",
    client_event_id: clientEventId,
    assignment_id: CRM_CALLBACK_GROUP,
    canvasser_id: input.canvasserId,
    payload: {
      callback: {
        client_event_id: clientEventId,
        crm_id: input.crmId,
        canvasser_id: input.canvasserId,
        result: input.result,
        call_back_on: input.result === "later" ? input.callBackOn : null,
        called_at: new Date().toISOString(),
      },
    },
  };
  const outcome = await enqueue(op);
  return outcome.queued;
}

/** The signed-in account's CRM link. Loading until known. */
export function useCrmMe(canvasserId: string | null): Load<CrmMe> {
  const load = useLoad(canvasserId ? `me:${canvasserId}` : null, () => fetchCrmMe(canvasserId ?? ""));
  return load;
}
