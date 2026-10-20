"use client";

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  useFieldData,
  type FieldPhase,
  type LeadDraft,
} from "@/components/field/field-data-provider";
import { RouteIcon, TurnIcon } from "@/components/field/icons";
import { HouseNumberSheet, NotesSheet, OtherOutcomeSheet } from "@/components/field/door-sheets";
import { InferSheet } from "@/components/field/infer-sheet";
import { LeadSheet } from "@/components/field/lead-sheet";
import { MiniMap } from "@/components/field/mini-map";
import { useJumpOnReopen } from "@/components/field/jump-on-reopen";
import {
  FindingYouChip,
  JumpAnnouncer,
  MovedChip,
  NearYouChip,
  NearYouSidesChip,
  useNearYouDoors,
} from "@/components/field/near-you-chip";
import { useGeo } from "@/components/field/geo-provider";
import { RouteChangeSheet, RouteStrip, useVisitRoute } from "@/components/field/route-change";
import { SharingPill } from "@/components/field/sharing-pill";
import { FieldHeader, FieldPage } from "@/components/field/shell/field-header";
import { OutcomeColumn } from "@/components/field/outcome-column";
import { Sheet } from "@/components/field/sheet";
import { useSharedDoors } from "@/components/field/shared-knock-notice";
import { formatSyncLine, rowLabel, SyncStatus } from "@/components/field/sync-status";
import { Button } from "@/components/field/ui/button";
import { DoorCard } from "@/components/field/ui/door-card";
import { DoorScroll, type DoorScrollItem } from "@/components/field/ui/door-scroll";
import { IdChip, type IdChipSync } from "@/components/field/ui/id-chip";
import { StatusBanner, type StatusBannerKind } from "@/components/field/ui/status-banner";
import { TeamStrip } from "@/components/field/ui/team-strip";
import { TodayStats } from "@/components/field/ui/today-stats";
import { ViewTabs, type ViewTab } from "@/components/field/ui/view-tabs";
import { SurveyOverview } from "@/components/field/survey-overview";
import { nextOpenIndex } from "@/lib/field/cursor";
import type { OutboxRow } from "@/lib/field/db";
import { formatTeammateLine } from "@/lib/field/door-signals";
import { scrollPlate } from "@/lib/field/door-window";
import { pulse, useInputLock } from "@/lib/field/feedback";
import { doorPlate } from "@/lib/field/labels";
import { MOVED_SHOW_MS, furthestOwnLogIndex } from "@/lib/field/geo-lock";
import { useCorrectTo } from "@/components/field/use-correct-to";
import { planInference, type InferencePlan, type InferredDoor } from "@/lib/field/inference";
import { useJumpSetting } from "@/lib/field/jump-setting";
import { localOutcomesLoaded } from "@/lib/field/local-outcomes";
import { logHouseNumber, logInferredNotIn, logOutcome } from "@/lib/field/log-outcome";
import { isTeamProp, useLoggingMode } from "@/lib/field/logging-mode";
import { outcomeSpec, type OtherOutcome, type PrimaryOutcome } from "@/lib/field/outcomes";
import { useResolvedTheme } from "@/lib/field/theme";
import {
  fieldHeaderParts,
  formatLoggerAreaLine,
  type InstructionCard,
} from "@/lib/field/route-display";
import { getCurrentStreetLabel, sequenceIsRouteDerived } from "@/lib/field/sequence";
import { surveyAddress, surveyRows, surveyStreet } from "@/lib/field/survey-rows";
import { partnerGapLabel } from "@/lib/field/geo";
import { setSharing, useShareState } from "@/lib/field/position-share";
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

type LoggerView = "logging" | "survey";

/** UI-6 B2b (owner B2-1). Add an entry here to add a Logger view. */
const LOGGER_VIEWS: ReadonlyArray<ViewTab<LoggerView>> = [
  { id: "logging", label: "Logging" },
  { id: "survey", label: "Survey" },
];

const VIEW_KEY = "d2d.loggerView";

function readLoggerView(): LoggerView {
  try {
    return sessionStorage.getItem(VIEW_KEY) === "survey" ? "survey" : "logging";
  } catch {
    return "logging";
  }
}

type SheetState =
  | { kind: "none" }
  | { kind: "other" }
  | { kind: "notes" }
  | { kind: "house_number" }
  | { kind: "lead"; uprn: number }
  | { kind: "sync" }
  | { kind: "route" }
  | { kind: "infer"; doors: InferredDoor[]; reason: "big_gap" | "street_change" };

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
 * Offline/Pending > Info > the interim-sweep notice (FUI-2a, the lowest: a
 * standing fact, not news). Only the highest-priority truth showing at any
 * moment is rendered — never stacked, never hidden behind a different one.
 */
function computeBanner(input: {
  status: SyncStatusValue;
  cards: InstructionCard[];
  shared: { count: number; example: string | null };
  dismissedShared: number;
  onDismissShared: () => void;
  onRetryAll: () => void;
  /** UI-7 C3b (owner U7-1): shown on a prop until the canvasser's first log. */
  sharingNotice: { onStop: () => void } | null;
  /** FUI-2a: the door order is the interim sweep, not a route (was a paragraph under the stats). */
  interimOrder: boolean;
  /** RT-START (Figma F4): a teammate changed the visit's route. Until OK. */
  routeNotice: { text: string; onDismiss: () => void } | null;
}): BannerView | null {
  const { status, cards, shared, dismissedShared, onDismissShared, onRetryAll, sharingNotice, interimOrder, routeNotice } = input;

  if (status.failedRows.length > 0) {
    const n = status.failedRows.length;
    return {
      kind: "error",
      glyph: "!",
      message: `${n} knock${n === 1 ? "" : "s"} couldn't be sent \u00b7 ${failedDoorText(status.failedRows[0]!)}`,
      action: { label: "Retry", onPress: onRetryAll },
    };
  }
  if (routeNotice) {
    return { kind: "info", glyph: <RouteIcon className="size-4" />, message: routeNotice.text, action: { label: "OK", onPress: routeNotice.onDismiss } };
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
  if (sharingNotice) {
    return {
      kind: "info",
      glyph: <span className="inline-block size-2 rounded-full bg-you" />,
      message: "Sharing your location with partner + admins",
      action: { label: "Stop", onPress: sharingNotice.onStop },
    };
  }
  if (shared.count > dismissedShared) {
    return {
      kind: "info",
      glyph: "!",
      message: sharedKnockMessage(shared.count, shared.example),
      action: { label: "OK", onPress: onDismissShared },
    };
  }
  if (interimOrder) {
    return {
      kind: "instruction",
      glyph: "\u21c4",
      message: "Door order follows the interim sweep, so numbers can look out of order",
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
    routeEpoch,
  } = useFieldData();

  const router = useRouter();
  const lock = useInputLock();
  const mode = useResolvedTheme();

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
  const [view, setViewState] = useState<LoggerView>(readLoggerView);
  const setView = useCallback((next: LoggerView) => {
    setViewState(next);
    try {
      sessionStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private mode or storage blocked: the view just is not remembered.
    }
  }, []);

  const assignmentId = phase.kind === "ready" ? phase.assignment.assignment_id : null;
  // RT-START P1 (owner 2026-10-19): change the visit's route before the first knock.
  const visitRoute = useVisitRoute();
  const status = useSyncStatus();
  const shared = useSharedDoors(assignmentId);
  const geo = useGeo();
  const shareState = useShareState();
  // UI-8 (owner U8-4): exceptions-only logging, never on a team prop.
  const logging = useLoggingMode(canvasserId);
  const exceptionsOnly = logging.mode === "exceptions" && !isTeamProp(team);
  const showSharingNotice =
    assignmentId !== null &&
    canvasserId !== null &&
    geo.status === "active" &&
    shareState.assignmentId === assignmentId &&
    !shareState.stopped &&
    countDoorsLogged(outcomes, canvasserId) === 0;

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

  const survey = useMemo(
    () =>
      view === "survey"
        ? surveyRows({
            sequence,
            labels,
            outcomes,
            routeStreets: routeProgress.doors.map((door) => door.routeStreet),
            knockedBy: team.knockedBy,
            currentIndex: cursor.index,
          })
        : [],
    [view, sequence, labels, outcomes, routeProgress.doors, team.knockedBy, cursor.index],
  );

  // GL-C (owner C1, C6). Manual moves of the Logger's door (chip, mini-map
  // tap, Survey pick): to the other side of the road, or backwards, the next
  // Exceptions-only fill starts at the door moved to (the fill floor).
  const { correctTo, ...fillFloor } = useCorrectTo();

  const pickFromSurvey = useCallback(
    (index: number) => {
      if (!correctTo(index)) cursor.goTo(index);
      setView("logging");
    },
    [correctTo, cursor, setView],
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

  const routeDoor = routeProgress.doors[cursor.index];
  const interimOrder = routeProgress.ready && !sequenceIsRouteDerived(routeProgress.hasRoute);

  const banner = useMemo(
    () =>
      computeBanner({
        status,
        cards: routeDoor?.cards ?? [],
        shared,
        dismissedShared,
        onDismissShared: () => setDismissedShared(shared.count),
        onRetryAll: retryAllFailed,
        sharingNotice:
          showSharingNotice && assignmentId
            ? { onStop: () => void setSharing(assignmentId, false) }
            : null,
        interimOrder,
        routeNotice: visitRoute.notice ? { text: visitRoute.notice, onDismiss: visitRoute.dismissNotice } : null,
      }),
    [
      status,
      routeDoor,
      shared,
      dismissedShared,
      retryAllFailed,
      showSharingNotice,
      assignmentId,
      interimOrder,
      visitRoute.notice,
      visitRoute.dismissNotice,
    ],
  );

  // GPS-LOCK GL-2 (owner G2, G5, G6, G7). On a reopen the Logger may jump
  // once to the door nearest the canvasser; any touch first cancels it.
  const jumpSetting = useJumpSetting(canvasserId);
  const anchorIndex = useMemo(
    () => furthestOwnLogIndex(sequence, outcomes, canvasserId),
    [sequence, outcomes, canvasserId],
  );
  const isOpenIndex = useCallback(
    (index: number) => {
      const entry = sequence[index];
      return entry !== undefined && !team.knockedUprns.has(entry.uprn);
    },
    [sequence, team.knockedUprns],
  );
  // GL-C (Figma 231:2086): a reopen jumps only when a log on this street has
  // settled which pavement the canvasser is on; otherwise the chip offers both.
  const streetAt = useCallback(
    (index: number) => {
      const entry = sequence[index];
      if (!entry) return null;
      const street = routeProgress.doors[index]?.routeStreet ?? labelFor(entry.uprn)?.street_name ?? null;
      return street?.trim().toLowerCase() || null;
    },
    [sequence, routeProgress.doors, labelFor],
  );
  const sameStreetAsLog = useCallback(
    (index: number) => {
      if (anchorIndex < 0) return false;
      const logged = streetAt(anchorIndex);
      return logged !== null && logged === streetAt(index);
    },
    [anchorIndex, streetAt],
  );
  const reopenJump = useJumpOnReopen({
    // The outbox must have been read, or the furthest log is not known yet.
    ready:
      phase.kind === "ready" &&
      cursor.door !== undefined &&
      canvasserId !== null &&
      localOutcomesLoaded(assignmentId) &&
      !allDone,
    allowed:
      jumpSetting.setting === "on" && view === "logging" && sheet.kind === "none" && !otherOpen,
    cursorIndex: cursor.index,
    anchorIndex,
    isOpen: isOpenIndex,
    sameStreetAsLog,
    goTo: cursor.goTo,
  });

  const addressAt = useCallback(
    (index: number) => {
      const entry = sequence[index];
      if (!entry) return null;
      const entryLabel = labelFor(entry.uprn);
      const entryStreet = surveyStreet(routeProgress.doors[index]?.routeStreet, entryLabel);
      return surveyAddress(entryLabel, entryStreet, index).address;
    },
    [sequence, labelFor, routeProgress.doors],
  );

  // GL-C (owner C2): after a manual move (chip or mini-map tap), "Moved to …
  // · Undo" for MOVED_SHOW_MS. Undo puts the Logger and the fill floor back.
  const [manualMove, setManualMove] = useState<{
    id: number;
    to: number;
    fromIndex: number;
    previousFloor: number | null;
  } | null>(null);
  const moveTo = useCallback(
    (toIndex: number) => {
      const undo = correctTo(toIndex);
      if (undo) setManualMove({ id: Date.now(), to: toIndex, ...undo });
    },
    [correctTo],
  );
  useEffect(() => {
    if (!manualMove) return;
    const id = window.setTimeout(() => setManualMove(null), MOVED_SHOW_MS);
    return () => window.clearTimeout(id);
  }, [manualMove]);
  // Anything else that moves the cursor retires it.
  useEffect(() => {
    if (manualMove && cursor.index !== manualMove.to) setManualMove(null);
  }, [cursor.index, manualMove]);
  // RT-START: a reloaded route is a new door order, so an Undo to an old index would land on the wrong door.
  useEffect(() => {
    setManualMove(null);
  }, [routeEpoch]);
  const undoManualMove = useCallback(() => {
    if (!manualMove) return;
    setManualMove(null);
    fillFloor.setFloorUprn(manualMove.previousFloor);
    cursor.goTo(manualMove.fromIndex);
  }, [manualMove, fillFloor, cursor]);
  const pickDoorOnMiniMap = useCallback(
    (uprn: number) => {
      const index = sequence.findIndex((entry) => entry.uprn === uprn);
      if (index >= 0) moveTo(index);
    },
    [sequence, moveTo],
  );

  // UI-7 C2 (owner H3), amended GL-C (owner C2, C3, C4). Suggests the doors
  // near the canvasser: one, or one per pavement where the route passes twice.
  // Hidden when the Logger is already on one of them. Tap = move there.
  // GL-2: the same slot shows "Finding you…" and "Moved to … · Undo" first.
  const nearDoors = useNearYouDoors(anchorIndex, isOpenIndex);
  const nearOverlay = useMemo(() => {
    if (manualMove) {
      const address = addressAt(manualMove.to);
      if (address) return <MovedChip label={address} onUndo={undoManualMove} />;
    }
    if (reopenJump.state.kind === "finding") return <FindingYouChip />;
    if (reopenJump.state.kind === "moved") {
      const address = addressAt(reopenJump.state.to);
      if (address) return <MovedChip label={address} onUndo={reopenJump.undo} />;
    }
    if (nearDoors.length === 0 || nearDoors.includes(cursor.index)) return undefined;
    if (nearDoors.length === 1) {
      const only = nearDoors[0]!;
      const address = addressAt(only);
      if (!address) return undefined;
      return <NearYouChip label={address} onJump={() => moveTo(only)} />;
    }
    const doors = nearDoors.flatMap((index) => {
      const entry = sequence[index];
      const address = addressAt(index);
      if (!entry || !address) return [];
      return [{ index, address, plate: scrollPlate(doorPlate(labelFor(entry.uprn)), entry.position).text }];
    });
    if (doors.length === 1) return <NearYouChip label={doors[0]!.address} onJump={() => moveTo(doors[0]!.index)} />;
    if (doors.length === 0) return undefined;
    return <NearYouSidesChip doors={doors} onPick={moveTo} />;
  }, [manualMove, undoManualMove, reopenJump.state, reopenJump.undo, nearDoors, cursor.index, addressAt, moveTo, sequence, labelFor]);
  const jumpAnnouncement = manualMove
    ? `Moved to ${addressAt(manualMove.to) ?? "that door"}. Undo is in the top left of the map.`
    : reopenJump.state.kind === "finding"
      ? "Finding you\u2026"
      : reopenJump.state.kind === "moved"
        ? `Moved to ${addressAt(reopenJump.state.to) ?? "the door nearest you"}. Undo is in the top left of the map.`
        : "";

  if (phase.kind !== "ready") return <PhaseNotice phase={phase} />;

  const assignment = phase.assignment;
  const door = cursor.door;

  if (!door || !canvasserId) {
    return (
      <FieldPage testId="logger-tab" header={<FieldHeader title={assignment.territory_name} undo={false} />}>
        <p className="px-4 pt-8 text-field-body text-ink-soft">
          {door ? "Signing in\u2026" : "This prop has no doors."}
        </p>
      </FieldPage>
    );
  }

  const label = labelFor(door.uprn);
  const plate = doorPlate(label);
  const routed = sequenceIsRouteDerived(routeProgress.hasRoute);
  const street = getCurrentStreetLabel(label, routeDoor?.routeStreet, routed);
  const logged = outcomes.get(door.uprn);
  const noteDraft = noteDrafts.get(door.uprn) ?? "";
  const leadDraft = leadDrafts.get(door.uprn);

  const teamRows = team.teammates.map((row) => {
    // UI-7 C3b: the partner's distance along the route (a scalar, never a map pin).
    const place = shareState.teammates.get(row.canvasserId);
    const gap = partnerGapLabel(geo.routePlace?.alongM ?? null, place?.routeM ?? null, place?.at ?? null, now);
    const line = formatTeammateLine(row, row.uprn !== null ? labelFor(row.uprn) : undefined, now);
    return {
      id: row.canvasserId,
      initial: row.name.charAt(0).toUpperCase() || "?",
      label: gap ? `${line} · ${gap}` : line,
      stale: row.stale,
    };
  });

  const commit = async (
    outcome: PrimaryOutcome | OtherOutcome,
    extras: { lead?: LeadDraft } = {},
  ) => {
    // UI-8 D2c (owner H4, U8-1..U8-3). Planned from what this phone knew
    // BEFORE this log; `outcomes` here is that render's map.
    const occurredAt = new Date().toISOString();
    const triggerIndex = sequence.findIndex((entry) => entry.uprn === door.uprn);
    // GL-C (owner C1): after a cross-road or backwards correction, fill only from that door.
    const floorUprnAtLog = fillFloor.floorUprn;
    const floorIndex =
      floorUprnAtLog === null ? null : sequence.findIndex((entry) => entry.uprn === floorUprnAtLog);
    const plan: InferencePlan = exceptionsOnly
      ? planInference({
          sequence,
          outcomes,
          knockedByTeam: team.knockedBy,
          streets: sequence.map(
            (entry, i) => routeProgress.doors[i]?.routeStreet ?? labelFor(entry.uprn)?.street_name ?? null,
          ),
          canvasserId,
          triggerIndex,
          triggerAt: occurredAt,
          floorIndex: floorIndex !== null && floorIndex >= 0 ? floorIndex : null,
        })
      : { kind: "none" };

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
      occurredAt,
    });

    const filled =
      result.queued && plan.kind === "fill"
        ? await logInferredNotIn({ assignmentId: assignment.assignment_id, canvasserId, doors: plan.doors })
        : [];

    pulse(40);
    if (result.queued) team.markKnocked(door, result.clientEventId);
    // A floor ahead of this log is stale (the canvasser went back behind it): drop it.
    // One at or behind it is kept, so undoing this log still protects the stretch cut across.
    // Only if no newer correction was made while this log was being written.
    if (result.queued && floorUprnAtLog !== null && floorIndex !== null && triggerIndex < floorIndex) {
      fillFloor.clearFloorIf(floorUprnAtLog);
    }
    // Only the pill actually pressed slides — bumping every key here would
    // animate all four at once (see OutcomeColumn's own doc comment).
    if (isPrimaryOutcome(outcome)) {
      setConfirmKeys((current) => ({ ...current, [outcome]: current[outcome] + 1 }));
    }
    const doorText = `${outcomeSpec(outcome).logged} \u00b7 ${scrollPlate(plate, door.position).text}${street ? ` ${street}` : ""}`;
    offerUndo(
      result.clientEventId,
      filled.length > 0 ? `${doorText} + ${filled.length} Not In` : doorText,
      filled,
    );
    setNoteDraft(door.uprn, "");
    setLeadDraft(door.uprn, null);
    setSheet(
      result.queued && plan.kind === "ask"
        ? { kind: "infer", doors: plan.doors, reason: plan.reason }
        : { kind: "none" },
    );
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

  const sheetStreet = (entry: InferredDoor) =>
    surveyStreet(routeProgress.doors[entry.index]?.routeStreet, labelFor(entry.uprn));

  // UI-8 D2c (owner U8-2): the sheet's Confirm. Its own Undo removes only this batch.
  const confirmInferred = async (doors: InferredDoor[]) => {
    setSheet({ kind: "none" });
    const open = doors.filter((entry) => !outcomes.has(entry.uprn));
    if (open.length === 0) return;
    const ids = await logInferredNotIn({ assignmentId: assignment.assignment_id, canvasserId, doors: open });
    const first = ids[0];
    if (!first) return;
    pulse(25);
    const streets = [...new Set(open.map(sheetStreet))];
    offerUndo(
      first,
      `${ids.length} Not In \u00b7 ${streets.length === 1 ? streets[0] : `${streets.length} streets`}`,
      ids.slice(1),
    );
  };

  // FUI-2b (owner Q1): the note opens from the door card. A draft shows its start.
  // At the end of the prop the scroll is gone, so the label names the door.
  const doorText = scrollPlate(plate, door.position).text;
  const noteLabel = noteDraft
    ? `Note: ${truncateNote(noteDraft, 24)}`
    : allDone
      ? `Add note for door ${doorText}`
      : "Add note";

  return (
    <div className="flex h-full flex-col bg-field-bg" data-testid="logger-tab">
      {/* FUI-2a (owner 2026-10-14, O3; Figma frame 01): the shared fixed header.
          Bar: menu, prop name, visit line (UI-8 D2b: the mode badge leads it),
          ID chip. Then the view pills with the Sharing pill (UI-7 C4), then the
          team strip. The undo ring stays on the door panel, so `undo={false}`. */}
      <FieldHeader
        testId="logger-header"
        undo={false}
        title={<span data-testid="logger-territory">{assignment.territory_name}</span>}
        subtitle={
          <span className="flex min-w-0 items-center gap-2">
            {exceptionsOnly ? (
              <span
                className="inline-flex h-5 shrink-0 items-center rounded-full bg-prop-soft px-2 text-admin-pill text-prop"
                data-testid="logging-mode-badge"
              >
                Exceptions only
              </span>
            ) : null}
            <span className="min-w-0 truncate" data-testid="logger-area-line">
              {formatLoggerAreaLine(fieldHeaderParts(assignment, routeProgress))}
            </span>
          </span>
        }
        right={
          <IdChip
            username={signedInAs}
            sync={idChipSync(status)}
            onOpen={() => setSheet({ kind: "sync" })}
          />
        }
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-1 pb-2">
          <div className="min-w-0 flex-1">
            <ViewTabs views={LOGGER_VIEWS} active={view} onChange={setView} />
          </div>
          <SharingPill assignmentId={assignment.assignment_id} />
        </div>
        <TeamStrip rows={teamRows} />
        <RouteStrip route={visitRoute} onOpen={() => setSheet({ kind: "route" })} />
      </FieldHeader>

      {view === "logging" ? (
        <>
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain" data-testid="logger-body">
        {/* FUI-2a (Figma Field/MiniMapCard): an inset card that takes the height
            left over. The banner sits over its bottom edge, so no line is
            reserved for it and nothing below moves when one appears. */}
        <div
          className="logger-map-band relative mx-4 mt-3 min-h-24 flex-1 overflow-hidden rounded-field-lg border border-line"
          data-testid="logger-map-band"
        >
          <JumpAnnouncer text={jumpAnnouncement} />
          <div className="absolute inset-0">
            <MemoMiniMap
              mode={mode}
              doors={anchoredDoors}
              labels={labels}
              outcomes={outcomes}
              routeModel={routeModel}
              routeTiers={routeTiers}
              footprints={footprints}
              currentUprn={door.uprn}
              onOpenMap={handleOpenMap}
              overlay={nearOverlay}
              onPickDoor={pickDoorOnMiniMap}
            />
          </div>
          {banner ? (
            <div
              className={`absolute right-10 bottom-2 left-2 z-[3] rounded-field-sm bg-surface shadow-admin-float ${
                banner.kind === "instruction" ? "px-3" : ""
              }`}
              data-testid="logger-status-line"
            >
              <StatusBanner kind={banner.kind} glyph={banner.glyph} message={banner.message} action={banner.action} />
            </div>
          ) : null}
        </div>
        {/* FUI-2b (Figma frame 01): the door card, then today's numbers, beside the
            outcome column. The numbers keep clear of Other, which sits left of
            Not In, so nothing overlaps (audit item 6). */}
        <div className="flex shrink-0 items-start gap-2 px-4 pt-3 pb-3" data-testid="logger-panel">
          <div className="relative flex min-w-0 flex-1 flex-col gap-3" data-testid="logger-door-column">
            {/* End of prop: the card stays, so the last knock keeps its undo
                ring and can still take a note (both lived outside the old
                end-of-prop block). */}
            <DoorCard
              logged={
                logged
                  ? `${allDone ? `${doorText} \u00b7 ` : ""}${outcomeSpec(logged.outcome).logged} \u00b7 ${LOGGED_TIME.format(new Date(logged.occurredAt))}`
                  : null
              }
              noteLabel={noteLabel}
              onNote={() => setSheet({ kind: "notes" })}
              onHouseNumber={
                !allDone && scrollPlate(plate, door.position).placeholder ? openHouseNumberSheet : undefined
              }
            >
              {allDone ? (
                <EndOfProp doorCount={assignment.door_count} />
              ) : (
                <div className="w-full" inert={otherOpen || undefined}>
                  <MemoDoorScroll
                    // RT-START: a changed route is a new door order; start the scroll again at its first door.
                    key={routeEpoch}
                    doors={doorItems}
                    index={cursor.index}
                    street={street}
                    onSettle={handleSettle}
                  />
                </div>
              )}
            </DoorCard>

            <TodayStats
              className="pr-16 pl-1"
              doors={countDoorsLogged(outcomes, canvasserId)}
              contacts={countBookableContacts(outcomes, canvasserId)}
              leads={countLeads(outcomes, canvasserId)}
              confirmed={null}
            />
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

        </>
      ) : (
        <SurveyOverview rows={survey} onPick={pickFromSurvey} />
      )}

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

      {sheet.kind === "infer" ? (
        <InferSheet
          reason={sheet.reason}
          rows={sheet.doors.map((entry) => {
            const rowStreet = sheetStreet(entry);
            return {
              door: entry,
              street: rowStreet,
              address: surveyAddress(labelFor(entry.uprn), rowStreet, entry.index).address,
            };
          })}
          onConfirm={(doors) => void confirmInferred(doors)}
          onDismiss={() => setSheet({ kind: "none" })}
        />
      ) : null}

      {sheet.kind === "route" ? (
        <RouteChangeSheet
          route={visitRoute}
          teamLine={`${assignment.territory_name} \u00b7 visit ${assignment.visit_number} \u00b7 ${
            team.teammates.length > 0 ? `you and ${team.teammates.map((row) => row.name).join(" and ")}` : "just you"
          }`}
          onDone={() => setSheet({ kind: "none" })}
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
    <div className="flex flex-col items-start gap-1 px-3 pt-2 pb-5" data-testid="end-of-prop">
      <p aria-hidden className="text-2xl text-outcome-lead-ink">
        {"\u2713"}
      </p>
      <p className="text-field-body-strong text-ink">This prop is done.</p>
      <p className="text-field-body text-ink-soft">{doorCount.toLocaleString("en-GB")} doors on this prop.</p>
    </div>
  );
}

/** FUI-2a: the loading, empty and error states keep the fixed header, so the menu is always there. */
function PhaseNotice({ phase }: { phase: FieldPhase }) {
  let body: ReactNode = null;
  if (phase.kind === "loading") {
    body = <p className="px-4 pt-8 text-field-body text-ink-soft">Loading today&apos;s prop{"\u2026"}</p>;
  } else if (phase.kind === "empty") {
    body = (
      <p className="px-4 pt-8 text-field-body text-ink-soft">
        Nothing is assigned to you today, so there is no sequence to work through.
      </p>
    );
  } else if (phase.kind === "error") {
    body = (
      <p className="px-4 pt-8 text-field-body text-ink-soft" role="alert">
        {phase.message}
      </p>
    );
  }
  return (
    <FieldPage testId="logger-tab" header={<FieldHeader title="Logger" undo={false} />}>
      {body}
    </FieldPage>
  );
}
