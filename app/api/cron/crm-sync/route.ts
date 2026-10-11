import { NextResponse, type NextRequest } from "next/server";

import { CRM_DEFAULT_BASE_URL, openCrmReader, type CrmReader } from "@/lib/crm/client";
import { cronAuthorised, nextCursor, runInProgress, type CronResult, type SyncRun } from "@/lib/crm/schedule";
import { runCrmSync } from "@/lib/crm/sync";
import { createServiceClient } from "@/lib/supabase/admin";

/**
 * CRM-4 A (owner 2026-10-11, P3). The scheduled CRM sync. Supabase pg_cron
 * (migration 036) calls this every 30 minutes from about 05:00 to 21:00
 * London with `Authorization: Bearer <CRON_SECRET>`; anything else gets 401.
 *
 * Reads only the CRM leads changed since the last successful run (the
 * cursor in `crm_sync_runs`), through the read-only CRM client, and writes
 * `crm_leads` with the service-role client, exactly as the backfill does.
 * Skips when an earlier run is still going. The reply carries counts only,
 * never lead data, and nothing about a lead is logged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function reply(body: CronResult, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  if (!cronAuthorised(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return reply({ ok: false, error: "Not authorised" }, 401);
  }

  const db = createServiceClient();
  const { data: runs, error } = await db
    .from("crm_sync_runs")
    .select("started_at, finished_at, max_modified_seen, error")
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) return reply({ ok: false, error: "Could not read the sync history" }, 500);
  const history: SyncRun[] = runs ?? [];
  if (runInProgress(history, new Date())) return reply({ ok: true, skipped: "running" });

  let crm: CrmReader | null = null;
  try {
    crm = await openCrmReader({
      user: process.env.CRM_USER ?? "",
      accessKey: process.env.CRM_API_KEY ?? "",
      baseUrl: process.env.CRM_BASE_URL || CRM_DEFAULT_BASE_URL,
      minIntervalMs: 1000,
    });
    const summary = await runCrmSync(db, crm, {
      kind: "daily",
      dryRun: false,
      zone: "UTC",
      modifiedSince: nextCursor(history),
      log: () => {},
    });
    return reply({
      ok: true,
      seen: summary.rowsSeen,
      inserted: summary.rowsInserted,
      updated: summary.rowsUpdated,
      unchanged: summary.rowsUnchanged,
      skipped: summary.rowsSkipped,
    });
  } catch {
    // A failure inside the sync is written to crm_sync_runs.error; a failed CRM login
    // writes no row, and Insights shows the sync as stale after 2 hours.
    return reply({ ok: false, error: "CRM sync failed; see crm_sync_runs" }, 500);
  } finally {
    await crm?.close().catch(() => {});
  }
}
