"use client";

import { StatusDot } from "@/components/field/icons";

/**
 * IdChip — Figma node 12:197 (and its Sync=Sent/Pending/Offline/Failed
 * variants).
 *
 * "Canvasser username + sync dot. Sent = green, Pending = amber,
 * Offline = grey, Failed = oxide. Tap opens the existing sync detail. Dot
 * is paired with a banner whenever state is not Sent."
 *
 * Display only — the pencil is removed (owner decision 8); this shows the
 * signed-in username, never lets it be edited. `onOpen` is provided by the
 * caller; this primitive does not know about `<SyncStatus/>` or any sheet.
 *
 * The dot colour reuses existing outcome/ink tokens rather than adding new
 * `--color-sync-*` tokens, because each state already has a close token:
 * green -> outcome-lead, amber -> outcome-rented-ink, grey -> ink-faint,
 * oxide -> oxide.
 */
export type IdChipSync = "sent" | "pending" | "offline" | "failed";

const DOT_COLOUR: Record<IdChipSync, string> = {
  sent: "text-outcome-lead",
  pending: "text-outcome-rented-ink",
  offline: "text-ink-faint",
  failed: "text-oxide",
};

export function IdChip({
  username,
  sync,
  onOpen,
}: {
  username: string;
  sync: IdChipSync;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface pr-3 pl-2.5"
      data-testid="id-chip"
      data-sync={sync}
    >
      <StatusDot className={`size-2 shrink-0 ${DOT_COLOUR[sync]}`} />
      <span className="whitespace-nowrap text-field-body-strong text-ink-muted">{username}</span>
    </button>
  );
}
