/**
 * CRM-1 B. One-off backfill of every CRM lead into `crm_leads` (Brief Stage 12c).
 *
 *   npm run crm:backfill                    dry run: reads the CRM, places leads, prints counts, writes NOTHING
 *   npm run crm:backfill -- --write --tz=utc       real run (CRM times are UTC)
 *   npm run crm:backfill -- --write --tz=london    real run (CRM times are UK local time)
 *
 * Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * CRM_USER, CRM_API_KEY (and optionally CRM_BASE_URL). Server-side only.
 * The CRM is only ever read (lib/crm/client.ts). Prints counts, never customer values.
 */
import { CRM_DEFAULT_BASE_URL, openCrmReader } from "../lib/crm/client";
import type { CrmDatetimeZone } from "../lib/crm/parse";
import { runCrmSync } from "../lib/crm/sync";
import { requiredEnv } from "./lib/env";
import { createIngestClient } from "./lib/supabase";

function parseArgs(argv: readonly string[]): { write: boolean; zone: CrmDatetimeZone | null } {
  const write = argv.includes("--write");
  const tz = argv.find((a) => a.startsWith("--tz="))?.slice(5).toLowerCase();
  const zone: CrmDatetimeZone | null = tz === "utc" ? "UTC" : tz === "london" ? "Europe/London" : null;
  if (tz !== undefined && zone === null) throw new Error(`--tz must be utc or london (got "${tz}")`);
  if (write && zone === null) throw new Error("A real run needs --tz=utc or --tz=london. Do the time check first.");
  return { write, zone };
}

function table(title: string, counts: Record<string, number>): void {
  console.log(`\n${title}`);
  for (const [key, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(7)}  ${key}`);
  }
}

async function main(): Promise<void> {
  const { write, zone } = parseArgs(process.argv.slice(2));
  const db = createIngestClient();
  const crm = await openCrmReader({
    user: requiredEnv("CRM_USER"),
    accessKey: requiredEnv("CRM_API_KEY"),
    baseUrl: process.env.CRM_BASE_URL || CRM_DEFAULT_BASE_URL,
    minIntervalMs: 1000,
  });

  console.log(write ? "== CRM backfill: REAL RUN (writes to crm_leads) ==" : "== CRM backfill: DRY RUN (writes nothing) ==");
  try {
    const summary = await runCrmSync(db, crm, {
      kind: "backfill",
      dryRun: !write,
      zone: zone ?? "UTC",
      modifiedSince: null,
      log: (line) => console.log(line),
    });

    console.log(`\nLeads read: ${summary.rowsSeen}`);
    console.log(`${write ? "Inserted / updated / unchanged" : "Would insert / update / leave"}: ${summary.rowsInserted} / ${summary.rowsUpdated} / ${summary.rowsUnchanged}`);
    console.log(`Skipped (unreadable time): ${summary.rowsSkipped}`);
    table("Status (app vocabulary)", summary.statusCounts);
    table("Unknown CRM statuses (not in crm_status_map)", summary.unknownStatuses);
    table("Map placement", summary.matchCounts);
    console.log(`\nApp leads linked by door + date: ${summary.appLeadsLinked} (ambiguous, left unlinked: ${summary.appLeadsAmbiguous})`);
    if (!write) console.log("  (a dry run links against crm_leads as already stored, so this is 0 before the first real run)");
    console.log("\nTime check (compare with the CRM screen):");
    console.log(`  newest lead "Created Time" as the API sends it:  ${summary.newestCreatedRaw ?? "-"}`);
    console.log(`  newest lead "Modified Time" as the API sends it: ${summary.newestModifiedRaw ?? "-"}`);
    if (summary.runId) console.log(`\nRun recorded in crm_sync_runs: ${summary.runId}`);
    console.log(write ? "\nDone." : "\nDry run finished. Nothing was written.");
  } finally {
    await crm.close();
  }
}

main().catch((err: unknown) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
