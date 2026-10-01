"use client";

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  useFieldData,
  type FieldPhase,
  type LeadDraft,
} from "@/components/field/field-data-provider";
import { TurnIcon } from "@/components/field/icons";
import { HouseNumberSheet, NotesSheet, OtherOutcomeSheet } from "@/components/field/door-sheets";
import { LeadSheet } from "@/components/field/lead-sheet";
import { MiniMap } from "@/components/field/mini-map";
import { OutcomeColumn } from "@/components/field/outcome-column";
import { Sheet } from "@/components/field/sheet";
import { useSharedDoors } from "@/components/field/shared-knock-notice";
import { formatSyncLine, rowLabel, SyncStatus } from "@/components/field/sync-status";
import { Button } from "@/components/field/ui/button";
import { DoorScroll, type DoorScrollItem } from "@/components/field/ui/door-scroll";
import { IdChip, type IdChipSync } from "@/components/field/ui/id-chip";
import { NoteBar } from "@/components/field/ui/note-bar";
import { StatRow } from "@/components/field/ui/stat-row";
import { UndoButton } from "@/components/field/ui/undo-button";
import { StatusBanner, type StatusBannerKind } from "@/components/field/ui/status-banner";
import { TeamStrip } from "@/components/field/ui/team-strip";
import { nextOpenIndex } from "@/lib/field/cursor";
import type { OutboxRow } from "@/lib/field/db";
import { formatTeammateLine } from "@/lib/field/door-signals";
import { scrollPlate } from "@/lib/field/door-window";
import { pulse, useInputLock } from "@/lib/field/feedback";
import { doorPlate } from "@/lib/field/labels";
import { logHouseNumber, logOutcome } from "@/lib/field/log-outcome";
import { outcomeSpec, type OtherOutcome, type PrimaryOutcome } from "@/lib/field/outcomes";
import {
  fieldHeaderParts,
  formatLoggerAreaLine,
  type InstructionCard,
} from "@/lib/field/route-display";
import { getCurrentStreetLabel, sequenceIsRouteDerived } from "@/lib/field/sequence";
import { sharedKnockMessage } from "@/lib/field/shared-knock";
import { countBookableContacts, countDoorsLogged, countLeads } from "@/lib/field/today-stats";
import { offerUndo } from "@/lib/field/undo";
import { newClientEventId } from "@/lib/sync/ops";
import { retryFailed } from "@/lib/sync/queue";
import { useSyncStatus, type SyncStatus as SyncStatusValue } from "@/lib/sync/use-sync-status";

/**
 * The Logger — Figma node 8:2 ("Logger / Default") and its 12 states,
 * assembled from the Session A (team/claims/stats logic) and Session B
 * (tokens, primitives, DoorScroll, OutcomePill/OtherButton) building blocks.
 * Nothing here is a new write path: `commit` below is the same
 * `logOutcome` → `lib/sync/queue.ts` call the interim Session A composer
 * used, now feeding the new `DoorScroll`/`OutcomeColumn` visual system.
 *
 * A1 (forward-wrap next open door), B1 (a teammate-knocked door greyed with
 * a "✓ <name>" tag) and C1 (the TeamStrip line, "stale beats door info")
 * are Session A's; this session only renders them through the new
 * components.
 */

type SheetState =
  | { kind: "none" }
  | { kind: "other" }
  | { kind: "notes" }
  | { kind: "house_number" }
  | { kind: "lead"; uprn: number }
  | { kind: "sync" };

const LOGGED_TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

function isPrimaryOutcome(outcome: PrimaryOutcome | OtherOutcome): outcome is PrimaryOutcome {
  return (
    outcome === "lead" ||
    outcome === "answered" ||
    outcome === "no_opportunity" ||
    outcome === "no_answer"
  );
}

function truncateNote(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}

function idChipSync(status: SyncStatusValue): IdChipSync {
  if (status.failedRows.length > 0) return "failed";
  if (status.state === "offline") return "offline";
  if (status.pending > 0 || status.state === "syncing" || status.state === "backoff" || status.state === "auth_required") {
    return "pending";
  }
  return "sent";
}

function instructionGlyph(kind: InstructionCard["kind"]): string {
  if (kind === "transfer") return "\u2194";
  if (kind === "spur") return "\u21a9";
  if (kind === "stranded") return "\u26a0";
  return "\u21b0";
}

/** Mirrors the wording `SyncStatus`'s own per-row label already uses (P3/amendment 4). */
function failedDoorText(row: OutboxRow): string {
  const raw = rowLabel(row).replace(/^Knock at /, "");
  return raw.startsWith("Door ") ? `door ${raw.slice(5)}` : raw;
}

type BannerView = {
  kind: StatusBannerKind;
  glyph: ReactNode;
  message: string;
  action?: { label: string; onPress: () => void };
};

/**
 * The Logger's ONE banner slot (P3). Priority: Failed > Instruction >
 * Offline/Pending > Info. Only the highest-priority truth showing at any
 * moment is rendered — never stacked, never hidden behind a different one.
 */
function computeBanner(input: {
  status: SyncStatusValue;
  cards: InstructionCard[];
  shared: { count: number; example: string | null };
  dismissedShared: number;
  onDismissShared: () => void;
  onRetryAll: () => void;
}): BannerView | null {
  const { status, cards, shared, dismissedShared, onDismissShared, onRetryAll } = input;

  if (status.failedRows.length > 0) {
    const n = status.failedRows.length;
    return {
      kind: "error",
      glyph: "!",
      message: `${n} knock${n === 1 ? "" : "s"} couldn't be sent \u00b7 ${failedDoorText(status.failedRows[0]!)}`,
      action: { label: "Retry", onPress: onRetryAll },
    };
  }
  if (cards.length > 0) {
    const first = cards[0]!;
    return {
      kind: "instruction",
      glyph: first.kind === "step" ? <TurnIcon className="size-4" /> : instructionGlyph(first.kind),
      message: cards.map((card) => card.text).join(" \u00b7 "),
    };
  }
  if (status.state === "offline" || status.state === "backoff" || status.state === "auth_required") {
    return { kind: "offline", glyph: "\u25cb", message: formatSyncLine(status) };
  }
  if (shared.count > dismissedShared) {
    return {
      kind: "info",
      glyph: "!",
      message: sharedKnockMessage(shared.count, shared.example),
      action: { label: "OK", onPress: onDismissShared },
    };
  }
  return null;
}

/**
 * Both children re-render on every `useTeam` 1 s heartbeat tick otherwise
 * (Session A review, carried to Session C): `team`'s own memo depends on
 * `now`, so the context value — and every `useFieldData()` consumer,
 * including this component — changes reference every second even though
 * `team.knockedBy` and the map/route data underneath it do not. Wrapping
 * the two expensive children in `memo` means THEIR OWN shallow prop
 * comparison (not the parent's re-render) decides whether they commit
 * again, and every prop below is itself reference-stable across the tick.
 */
const MemoDoorScroll = memo(DoorScroll);
const MemoMiniMap = memo(MiniMap);

export function LoggerTab() {
  const {
    phase,
    canvasserId,
    signedInAs,
    cursor,
    outcomes,
    routeProgress,
    routeModel,
    routeTiers,
    anchoredDoors,
    footprints,
    labels,
    labelFor,
    refreshLabels,
    leadDrafts,
    setLeadDraft,
    noteDrafts,
    setNoteDraft,
    showDoorOnMap,
    sequence,
    team,
  } = useFieldData();

  const router = useRouter();
  const lock = useInputLock();

  const [sheet, setSheet] = useState<SheetState>({ kind: "none" });
  const [otherOpen, setOtherOpen] = useState(false);
  const [dismissedShared, setDismissedShared] = useState(0);
  const [confirmKeys, setConfirmKeys] = useState<Record<PrimaryOutcome, number>>({
    lead: 0,
    answered: 0,
    no_opportunity: 0,
    no_answer: 0,
  });
  const [now, setNow] = useState(() => Date.now());

  const assignmentId = phase.kind === "ready" ? phase.assignment.assignment_id : null;
  const status = useSyncStatus();
  const shared = useSharedDoors(assignmentId);

  // Only ticks while there is a teammate line to keep fresh — matches the
  // old TeammateLines primitive's own rule, and stops entirely when solo.
  useEffect(() => {
    if (team.teammates.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [team.teammates.length]);

  const doorItems = useMemo<DoorScrollItem[]>(
    () =>
      sequence.map((door) => ({
        uprn: door.uprn,
        label: labelFor(door.uprn),
        position: door.position,
        knockedBy: team.knockedBy.get(door.uprn)?.firstName ?? null,
      })),
    [sequence, labelFor, team.knockedBy],
  );

  // The same "blocked" test `commit` uses to decide whether to move the
  // cursor — -1 back means nothing is open anywhere in the ring.
  const allDone = useMemo(() => {
    if (sequence.length === 0) return false;
    return nextOpenIndex(sequence, team.knockedUprns, -1) === -1;
  }, [sequence, team.knockedUprns]);

  const handleSettle = useCallback((index: number) => cursor.goTo(index), [cursor]);
  const openHouseNumberSheet = useCallback(() => setSheet({ kind: "house_number" }), []);

  const handleOpenMap = useCallback(() => {
    if (!cursor.door) return;
    showDoorOnMap(cursor.door.uprn);
    router.push("/field");
  }, [cursor.door, showDoorOnMap, router]);

  const retryAllFailed = useCallback(() => {
    for (const row of status.failedRows) void retryFailed(row.client_event_id);
  }, [status.failedRows]);

  const view = routeProgress.doors[cursor.index];

  const banner = useMemo(
    () =>
      computeBanner({
        status,
        cards: view?.cards ?? [],
        shared,
        dismissedShared,
        onDismissShared: () => setDismissedShared(shared.count),
        onRetryAll: retryAllFailed,
      }),
    [status, view, shared, dismissedShared, retryAllFailed],
  );

  if (phase.kind !== "ready") return <PhaseNotice phase={phase} />;

  const assignment = phase.assignment;
  const door = cursor.door;

  if (!door || !canvasserId) {
    return (
      <p className="px-4 pt-8 text-field-body text-ink-soft">
        {door ? "Signing in\u2026" : "This prop has no doors."}
      </p>
    );
  }

  const label = labelFor(door.uprn);
  const plate = doorPlate(label);
  const routed = sequenceIsRouteDerived(routeProgress.hasRoute);
  const street = getCurrentStreetLabel(label, view?.routeStreet, routed);
  const logged = outcomes.get(door.uprn);
  const noteDraft = noteDrafts.get(door.uprn) ?? "";
  const leadDraft = leadDrafts.get(door.uprn);

  const teamRows = team.teammates.map((row) => ({
    id: row.canvasserId,
    initial: row.name.charAt(0).toUpperCase() || "?",
    label: formatTeammateLine(row, row.uprn !== null ? labelFor(row.uprn) : undefined, now),
    stale: row.stale,
  }));

  const commit = async (
    outcome: PrimaryOutcome | OtherOutcome,
    extras: { lead?: LeadDraft } = {},
  ) => {
    const result = await logOutcome({
      assignmentId: assignment.assignment_id,
      canvasserId,
      uprn: door.uprn,
      sequencePosition: door.position,
      outcome,
      notes: noteDraft || null,
      clientEventId: extras.lead?.clientEventId,
      lead: extras.lead
        ? { booked_for: extras.lead.bookedFor, notes: extras.lead.notes || null }
        : undefined,
    });

    pulse(40);
    if (result.queued) team.markKnocked(door, result.clientEventId);
    // Only the pill actually pressed slides — bumping every key here would
    // animate all four at once (see OutcomeColumn's own doc comment).
    if (isPrimaryOutcome(outcome)) {
      setConfirmKeys((current) => ({ ...current, [outcome]: current[outcome] + 1 }));
    }
    offerUndo(
      result.clientEventId,
      `${outcomeSpec(outcome).logged} \u00b7 ${scrollPlate(plate, door.position).text}${street ? ` ${street}` : ""}`,
    );
    setNoteDraft(door.uprn, "");
    setLeadDraft(door.uprn, null);
    setSheet({ kind: "none" });
    const blocked = new Set(team.knockedUprns);
    blocked.add(door.uprn);
    // A1: forward from here, wrapping to the lowest open door.
    const index = nextOpenIndex(sequence, blocked, cursor.index);
    if (index >= 0) cursor.goTo(index);
  };

  const startLead = () => {
    // The id is generated HERE, at the Lead tap, and reused on submit however
    // many times the sheet is dismissed and reopened.
    const existing = leadDrafts.get(door.uprn);
    if (!existing) {
      setLeadDraft(door.uprn, { clientEventId: newClientEventId(), bookedFor: null, notes: "" });
    }
    setSheet({ kind: "lead", uprn: door.uprn });
  };

  const notePlaceholder = `Add a note for door ${scrollPlate(plate, door.position).text}`;

  return (
    <div className="flex h-full flex-col bg-field-bg" data-testid="logger-tab">
      <header className="shrink-0 px-4 pt-2 pb-1.5" data-testid="logger-header">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-field-title-sm text-ink" data-testid="logger-territory">
              {assignment.territory_name}
            </h1>
          </div>
          <IdChip
            username={signedInAs}
            sync={idChipSync(status)}
            onOpen={() => setSheet({ kind: "sync" })}
          />
        </div>
        <p className="mt-0.5 truncate text-field-body text-ink-soft" data-testid="logger-area-line">
          {formatLoggerAreaLine(fieldHeaderParts(assignment, routeProgress))}
        </p>
      </header>

      <TeamStrip rows={teamRows} />

      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto" data-testid="logger-body">
        <div className="relative min-h-[112px] flex-1" data-testid="logger-map-band">
          <div className="absolute inset-0">
            <MemoMiniMap
              doors={anchoredDoors}
              labels={labels}
              outcomes={outcomes}
              routeModel={routeModel}
              routeTiers={routeTiers}
              footprints={footprints}
              currentUprn={door.uprn}
              onOpenMap={handleOpenMap}
            />
          </div>
        </div>
        <div className="flex h-11 shrink-0 items-center px-4" data-testid="logger-status-line">
          {banner ? (
            <div className="min-w-0 flex-1">
              <StatusBanner kind={banner.kind} glyph={banner.glyph} message={banner.message} action={banner.action} />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-end gap-2 px-4 pt-1 pb-3" data-testid="logger-panel">
          <div className="relative min-w-0 flex-1" data-testid="logger-door-column">
            <UndoButton className="absolute -top-3.5 right-2 z-10" />
            {allDone ? (
              <EndOfProp doorCount={assignment.door_count} />
            ) : (
              <>
                <p className="text-field-eyebrow uppercase text-ink-muted">Current door</p>
                <div className="flex w-full flex-col items-center">
                  <div className="w-full" inert={otherOpen || undefined}>
                    <MemoDoorScroll
                      doors={doorItems}
                      index={cursor.index}
                      street={street}
                      onSettle={handleSettle}
                    />
                  </div>
                  <div className="flex h-8 items-center justify-center gap-2" data-testid="door-info-row">
                    {logged ? (
                      <span
                        className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-prop px-2.5 text-field-button-label text-ink"
                        data-testid="already-logged"
                      >
                        {"✓"} {outcomeSpec(logged.outcome).logged} {"·"}{" "}
                        {LOGGED_TIME.format(new Date(logged.occurredAt))}
                      </span>
                    ) : null}
                    {scrollPlate(plate, door.position).placeholder ? (
                      <button
                        type="button"
                        onClick={openHouseNumberSheet}
                        className="-my-1.5 flex h-11 shrink-0 items-center whitespace-nowrap px-2 text-field-button-label text-prop underline underline-offset-2"
                        data-testid="add-house-number"
                        aria-label="Add house number"
                      >
                        {logged ? "+ Add no." : "+ Add house number"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </>
            )}

            <hr className="mt-1.5 mb-1.5 border-line" />

            <p className="text-field-eyebrow uppercase text-ink-muted">Today&apos;s stats</p>
            <div className="mt-1 flex w-fit flex-col gap-1" data-testid="today-stats">
              <StatRow label="Doors" value={countDoorsLogged(outcomes, canvasserId)} />
              <StatRow label="Contacts" value={countBookableContacts(outcomes, canvasserId)} />
              <StatRow label="Leads" value={countLeads(outcomes, canvasserId)} />
              <StatRow label="Confirmed" value={null} />
            </div>

            {routeProgress.ready && !sequenceIsRouteDerived(routeProgress.hasRoute) ? (
              <p className="mt-3 text-field-body text-ink-soft" data-testid="out-of-order-banner">
                Door order follows the interim sweep, not the street. Numbers will look out of sequence.
              </p>
            ) : null}
          </div>

          {allDone ? (
            <div className="flex w-[92px] shrink-0 flex-col items-end gap-2 pb-1" data-testid="end-of-prop-action">
              <Button kind="primary" onClick={() => lock(handleOpenMap)}>
                Open Map
              </Button>
            </div>
          ) : (
            // 2026-09-30 owner E3/E5: the slot is the pill's real 140px
            // width, so the tail no longer spills left into the door column.
            <div className="w-[140px] shrink-0" data-testid="outcome-column-slot">
              <OutcomeColumn
                onPrimary={(outcome) => {
                  if (outcome === "lead") {
                    startLead();
                    return;
                  }
                  void commit(outcome);
                }}
                onOther={(outcome) => void commit(outcome)}
                confirmKeys={confirmKeys}
                otherOpen={otherOpen}
                onOtherOpenChange={setOtherOpen}
              />
            </div>
          )}
        </div>
      </div>

      <NoteBar
        label={noteDraft ? truncateNote(noteDraft) : notePlaceholder}
        open={sheet.kind === "notes"}
        onPress={() => setSheet({ kind: "notes" })}
      />

      {sheet.kind === "other" ? (
        <OtherOutcomeSheet onPick={(outcome) => void commit(outcome)} onDismiss={() => setSheet({ kind: "none" })} />
      ) : null}

      {sheet.kind === "notes" ? (
        <NotesSheet
          initial={noteDraft}
          saveLabel={logged ? "Save note to this door" : "Keep note for the next log"}
          onDismiss={() => setSheet({ kind: "none" })}
          onSave={(notes) => {
            setNoteDraft(door.uprn, notes);
            setSheet({ kind: "none" });
            // Already logged? A note is a correction, which means a new
            // knock row carrying the same outcome — never an update.
            if (logged && notes !== (logged.notes ?? "")) {
              void logOutcome({
                assignmentId: assignment.assignment_id,
                canvasserId,
                uprn: door.uprn,
                sequencePosition: door.position,
                outcome: logged.outcome,
                notes,
              }).then((result) => {
                pulse(25);
                setNoteDraft(door.uprn, "");
                offerUndo(
                  result.clientEventId,
                  `Note added \u00b7 ${scrollPlate(plate, door.position).text}`,
                );
              });
            }
          }}
        />
      ) : null}

      {sheet.kind === "house_number" ? (
        <HouseNumberSheet
          currentLabel={plate}
          street={street}
          onDismiss={() => setSheet({ kind: "none" })}
          onSave={(houseNumber) => {
            setSheet({ kind: "none" });
            void logHouseNumber({
              assignmentId: assignment.assignment_id,
              canvasserId,
              uprn: door.uprn,
              houseNumber,
            }).then(() => {
              pulse(25);
              // The number is on the plate before it has synced. The RPC is
              // not re-run: refreshLabels re-reads the Dexie store that
              // logHouseNumber just updated.
              refreshLabels();
            });
          }}
        />
      ) : null}

      {sheet.kind === "lead" && leadDraft ? (
        <LeadSheet
          draft={leadDraft}
          doorLabel={plate}
          onChange={(draft) => setLeadDraft(door.uprn, draft)}
          onDismiss={() => setSheet({ kind: "none" })}
          onSubmit={(draft) => void commit("lead", { lead: draft })}
        />
      ) : null}

      {sheet.kind === "sync" ? (
        <Sheet title="Sync status" onDismiss={() => setSheet({ kind: "none" })}>
          <SyncStatus />
        </Sheet>
      ) : null}
    </div>
  );
}

/** Figma's "End of prop" state, textually specified but not screenshotted this session (budget). */
function EndOfProp({ doorCount }: { doorCount: number }) {
  return (
    <div className="flex flex-col items-start gap-1 py-6" data-testid="end-of-prop">
      <p aria-hidden className="text-2xl text-outcome-lead-ink">
        {"\u2713"}
      </p>
      <p className="text-field-body-strong text-ink">This prop is done.</p>
      <p className="text-field-body text-ink-soft">{doorCount.toLocaleString("en-GB")} doors on this prop.</p>
    </div>
  );
}

function PhaseNotice({ phase }: { phase: FieldPhase }) {
  if (phase.kind === "loading") {
    return <p className="px-4 pt-8 text-field-body text-ink-soft">Loading today&apos;s prop{"\u2026"}</p>;
  }
  if (phase.kind === "empty") {
    return (
      <p className="px-4 pt-8 text-field-body text-ink-soft">
        Nothing is assigned to you today, so there is no sequence to work through.
      </p>
    );
  }
  if (phase.kind === "error") {
    return (
      <p className="px-4 pt-8 text-field-body text-ink-soft" role="alert">
        {phase.message}
      </p>
    );
  }
  return null;
}
