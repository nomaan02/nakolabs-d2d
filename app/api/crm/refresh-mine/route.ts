import { NextResponse } from "next/server";

import { CRM_DEFAULT_BASE_URL, openCrmReader, type CrmReader } from "@/lib/crm/client";
import { refreshGate, REFRESH_STALE_MS, type RefreshLogRow, type RefreshResult } from "@/lib/crm/refresh";
import { runCrmSync } from "@/lib/crm/sync";
import { londonMidnight, weekStart } from "@/lib/field/crm";
import { londonDate } from "@/lib/field/london-date";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * CRM-7 A (owner 2026-10-15). The canvasser's own "Refresh from CRM".
 *
 * POST, signed-in canvassers only. Re-reads THIS canvasser's leads created
 * this week (Monday 00:00 London onwards) through the read-only CRM client and
 * updates crm_leads and crm_contacts with the service-role client, exactly as
 * the scheduled sync does, so the "This week" screen is current right now.
 * Nothing is written to the CRM. No crm_sync_runs row is written, so the
 * scheduled sync's cursor never moves.
 *
 * Gentle on the CRM: one refresh per canvasser per 30 seconds and one at a
 * time overall (the unique index on crm_refresh_log). The reply carries counts
 * only, and nothing about a lead is logged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function reply(body: RefreshResult, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const user = await createClient();
  const { data: auth } = await user.auth.getUser();
  if (!auth.user) return reply({ ok: false, error: "not_signed_in" }, 401);

  const [{ data: name }, { data: branch }] = await Promise.all([user.rpc("my_crm_name"), user.rpc("my_crm_branch")]);
  if (!name) return reply({ ok: false, error: "not_linked" }, 409);

  const db = createServiceClient();
  const now = new Date();

  // Keep the log small: a week of history is plenty.
  await db.from("crm_refresh_log").delete().lt("requested_at", new Date(now.getTime() - 7 * 86_400_000).toISOString());

  // Retire a refresh that died without finishing, so it cannot block everyone.
  await db
    .from("crm_refresh_log")
    .update({ finished_at: now.toISOString(), ok: false })
    .is("finished_at", null)
    .lt("requested_at", new Date(now.getTime() - REFRESH_STALE_MS).toISOString());

  const { data: recent, error: logError } = await db
    .from("crm_refresh_log")
    .select("canvasser_id, requested_at, finished_at")
    .gte("requested_at", new Date(now.getTime() - REFRESH_STALE_MS).toISOString())
    .order("requested_at", { ascending: false })
    .limit(50);
  if (logError) return reply({ ok: false, error: "failed" }, 500);

  const gate = refreshGate((recent ?? []) as RefreshLogRow[], auth.user.id, now);
  if (!gate.ok) return reply({ ok: false, error: gate.reason, retryAfterSec: gate.retryAfterSec }, 429);

  const { data: started, error: startError } = await db
    .from("crm_refresh_log")
    .insert({ canvasser_id: auth.user.id })
    .select("id")
    .single();
  if (startError) {
    // The unique index allows one unfinished refresh at a time: someone else just started.
    const raced = (startError as { code?: string }).code === "23505";
    return reply({ ok: false, error: raced ? "busy" : "failed", retryAfterSec: raced ? 10 : undefined }, raced ? 429 : 500);
  }

  let crm: CrmReader | null = null;
  try {
    crm = await openCrmReader({
      user: process.env.CRM_USER ?? "",
      accessKey: process.env.CRM_API_KEY ?? "",
      baseUrl: process.env.CRM_BASE_URL || CRM_DEFAULT_BASE_URL,
      minIntervalMs: 500,
    });
    const summary = await runCrmSync(db, crm, {
      kind: "daily",
      dryRun: false,
      zone: "UTC",
      modifiedSince: null,
      createdSince: londonMidnight(weekStart(londonDate(now))),
      canvasser: { name, branch: branch ?? null },
      track: false,
      log: () => {},
    });
    await db.from("crm_refresh_log").update({ finished_at: new Date().toISOString(), ok: true, rows_seen: summary.rowsSeen }).eq("id", started.id);
    return reply({ ok: true, seen: summary.rowsSeen, changed: summary.rowsInserted + summary.rowsUpdated, at: new Date().toISOString() });
  } catch {
    await db.from("crm_refresh_log").update({ finished_at: new Date().toISOString(), ok: false }).eq("id", started.id);
    return reply({ ok: false, error: "failed" }, 502);
  } finally {
    await crm?.close();
  }
}
