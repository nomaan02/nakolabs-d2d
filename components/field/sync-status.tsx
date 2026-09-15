"use client";

import type { OutboxRow } from "@/lib/field/db";
import { discardFailed, retryFailed } from "@/lib/sync/queue";
import { useSyncStatus, type SyncStatus as Status } from "@/lib/sync/use-sync-status";

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatSyncLine(status: Status): string {
  const parts: string[] = [];
  const { pending, held, state, lastSyncAt } = status;

  if (state === "auth_required" && pending > 0) {
    parts.push(`Sign in again to send ${plural(pending, "knock", "knocks")}`);
  } else if (pending === 0) {
    parts.push(lastSyncAt ? "Everything sent" : "Nothing to send");
  } else if (state === "syncing") {
    parts.push(`Sending ${pending}…`);
  } else if (state === "offline") {
    parts.push(`${pending} to send · waiting for signal`);
  } else if (state === "backoff") {
    parts.push(`${pending} to send · retrying shortly`);
  } else {
    parts.push(`${pending} to send`);
  }

  if (held > 0) parts.push(`${held} for another canvasser`);
  if (lastSyncAt) parts.push(`last sent ${TIME.format(new Date(lastSyncAt))}`);

  return parts.join(" · ");
}

function rowLabel(row: OutboxRow): string {
  if (row.kind === "knock_event") {
    const payload = row.payload as { knock: { uprn: number; sequence_position: number | null } };
    const door =
      payload.knock.sequence_position !== null
        ? `Door ${payload.knock.sequence_position + 1}`
        : `UPRN ${payload.knock.uprn}`;
    return `Knock at ${door}`;
  }
  const payload = row.payload as { observation: { uprn: number } };
  return `Observation at UPRN ${payload.observation.uprn}`;
}

/**
 * Header line ("3 to send · last sent 14:02") plus a banner for rows the
 * server has permanently rejected, each with Retry and Discard. No colour
 * carries meaning here — the banner is a border and text.
 */
export function SyncStatus() {
  const status = useSyncStatus();
  if (!status.ready) return null;

  return (
    <div className="mt-2" data-testid="sync-status">
      <p className="font-data text-xs text-ink-soft" role="status" data-testid="sync-line">
        {formatSyncLine(status)}
      </p>

      {status.failedRows.length > 0 ? (
        <div
          className="mt-2 rounded-md border border-ink/30 bg-worksheet px-3 py-2"
          role="alert"
          data-testid="sync-failed"
        >
          <p className="text-sm font-medium">
            {plural(status.failedRows.length, "knock was", "knocks were")} rejected by the server.
          </p>
          <ul className="mt-1 space-y-2">
            {status.failedRows.map((row) => (
              <li key={row.client_event_id} className="text-sm">
                <p className="leading-snug">
                  {rowLabel(row)}
                  {row.last_error ? (
                    <span className="block text-xs text-ink-soft">
                      {row.last_error.code ? `${row.last_error.code} · ` : ""}
                      {row.last_error.message}
                    </span>
                  ) : null}
                </p>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void retryFailed(row.client_event_id)}
                    className="min-h-11 rounded-md bg-ink px-3 text-sm font-medium text-paper"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => void discardFailed(row.client_event_id)}
                    className="min-h-11 rounded-md border border-ink/30 bg-paper px-3 text-sm font-medium text-ink"
                  >
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
