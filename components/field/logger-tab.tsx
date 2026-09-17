"use client";

import { useState } from "react";

import {
  useFieldData,
  type FieldPhase,
  type LeadDraft,
} from "@/components/field/field-data-provider";
import { HouseNumberSheet, NotesSheet, OtherOutcomeSheet } from "@/components/field/door-sheets";
import { LeadSheet } from "@/components/field/lead-sheet";
import { MiniMap } from "@/components/field/mini-map";
import { OutcomeButtons } from "@/components/field/outcome-buttons";
import { pulse } from "@/lib/field/feedback";
import { doorPlate } from "@/lib/field/labels";
import { logHouseNumber, logOutcome } from "@/lib/field/log-outcome";
import { outcomeSpec, type OtherOutcome, type PrimaryOutcome } from "@/lib/field/outcomes";
import { autoAdvanceEnabled } from "@/lib/field/position";
import { getCurrentStreetLabel, SEQUENCE_IS_ROUTE_DERIVED } from "@/lib/field/sequence";
import { offerUndo } from "@/lib/field/undo";
import { newClientEventId } from "@/lib/sync/ops";

/**
 * The sequence cursor: one door at a time, five outcome buttons, one tap
 * logs and advances. No confirmation step.
 *
 * The cursor is MANUAL. It moves on by exactly one place after a log, and it
 * never jumps to "the next unlogged door" — that needs Stage 10's claims, and
 * without them every member of a duo would be sent to the same doorstep.
 * Free scroll and Skip let the canvasser go anywhere in the sequence without
 * logging, and Back returns to the previous door so a correction is possible.
 *
 * A correction is a NEW knock event with a NEW client_event_id.
 * `v_latest_knock` resolves which one counts. Nothing is ever updated or
 * deleted server-side; canvassers hold no such grant.
 */

type Sheet =
  | { kind: "none" }
  | { kind: "other" }
  | { kind: "notes" }
  | { kind: "house_number" }
  | { kind: "lead"; uprn: number };

export function LoggerTab() {
  const {
    phase,
    canvasserId,
    sequence,
    cursor,
    outcomes,
    labelFor,
    refreshLabels,
    leadDrafts,
    setLeadDraft,
    noteDrafts,
    setNoteDraft,
  } = useFieldData();

  const [sheet, setSheet] = useState<Sheet>({ kind: "none" });
  const [mapOpen, setMapOpen] = useState(true);

  if (phase.kind !== "ready") return <PhaseNotice phase={phase} />;

  const assignmentId = phase.assignment.assignment_id;
  const door = cursor.door;

  if (!door || !canvasserId) {
    return (
      <p className="px-4 pt-8 text-sm text-ink-soft">
        {door ? "Signing in…" : "This prop has no doors."}
      </p>
    );
  }

  const label = labelFor(door.uprn);
  const plate = doorPlate(label);
  const street = getCurrentStreetLabel(label);
  const logged = outcomes.get(door.uprn);
  const noteDraft = noteDrafts.get(door.uprn) ?? "";

  const commit = async (
    outcome: PrimaryOutcome | OtherOutcome,
    extras: { lead?: LeadDraft } = {},
  ) => {
    const result = await logOutcome({
      assignmentId,
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
    offerUndo(result.clientEventId, `${outcomeSpec(outcome).logged} · ${plate}${street ? ` ${street}` : ""}`);
    setNoteDraft(door.uprn, "");
    setLeadDraft(door.uprn, null);
    setSheet({ kind: "none" });
    cursor.next();
  };

  const startLead = () => {
    // The id is generated HERE, at the Lead tap, and reused on submit however
    // many times the sheet is dismissed and reopened. The knock and the lead
    // must share exactly one client_event_id.
    const existing = leadDrafts.get(door.uprn);
    if (!existing) {
      setLeadDraft(door.uprn, {
        clientEventId: newClientEventId(),
        bookedFor: null,
        notes: "",
      });
    }
    setSheet({ kind: "lead", uprn: door.uprn });
  };

  const leadDraft = leadDrafts.get(door.uprn);

  return (
    <div className="flex h-full flex-col" data-testid="logger-tab">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <header className="border-b border-ink/15 bg-paper px-4 pb-3 pt-3">
          <p className="font-data text-xs uppercase tracking-wide text-ink-soft" data-testid="logger-position">
            Door {cursor.humanPosition} of {cursor.total}
          </p>

          {/* SEAM (Stage 5b): spur and crossing instructions land here. */}
          <HeaderInstruction />
          {/* SEAM (Stage 10): the teammate line lands here. */}
          <TeammateLine />

          <div className="mt-3 flex items-center justify-center gap-3">
            <p
              className="rounded-md border-2 border-ink bg-worksheet px-5 py-2 font-data text-4xl leading-none"
              data-testid="door-plate"
            >
              {plate}
            </p>
            <button
              type="button"
              onClick={() => setSheet({ kind: "house_number" })}
              aria-label="Type the number on this door"
              className="flex h-11 w-11 items-center justify-center rounded-md border-2 border-ink text-xl"
              data-testid="edit-house-number"
            >
              ✎
            </button>
          </div>
          <p className="mt-1 text-center text-base text-ink-soft" data-testid="door-street">
            {street ?? "\u00a0"}
          </p>

          {logged ? (
            <p
              className="mt-2 rounded-md border-2 border-ink/25 bg-worksheet px-3 py-1.5 text-center text-sm font-medium"
              data-testid="already-logged"
            >
              {outcomeSpec(logged.outcome).glyph} Logged this visit ·{" "}
              {outcomeSpec(logged.outcome).logged}
              {logged.undoable ? " · still undoable" : ""}
            </p>
          ) : null}

          {!SEQUENCE_IS_ROUTE_DERIVED ? (
            <p
              className="mt-2 rounded-md border-2 border-ink/25 px-3 py-1.5 text-xs leading-relaxed text-ink-soft"
              data-testid="out-of-order-banner"
            >
              Door order follows the interim sweep, not the street. Numbers will look out of
              sequence.
            </p>
          ) : null}
        </header>

        <div className="border-b border-ink/15 bg-paper">
          <button
            type="button"
            onClick={() => setMapOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between px-4 text-sm font-medium"
            aria-expanded={mapOpen}
            data-testid="mini-map-toggle"
          >
            <span>Mini map</span>
            <span aria-hidden>{mapOpen ? "▾ Hide" : "▸ Show"}</span>
          </button>
          {mapOpen ? (
            <div style={{ height: 120 }} className="w-full">
              <MiniMap sequence={sequence} index={cursor.index} />
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-2 px-3 py-3">
          <button
            type="button"
            onClick={cursor.previous}
            disabled={cursor.atStart}
            className="min-h-11 rounded-md border-2 border-ink/25 bg-paper text-sm font-medium disabled:opacity-40"
            data-testid="cursor-back"
          >
            ‹ Back
          </button>
          <button
            type="button"
            onClick={() => setSheet({ kind: "notes" })}
            className="min-h-11 rounded-md border-2 border-ink/25 bg-paper text-sm font-medium"
            data-testid="open-notes"
          >
            Notes{noteDraft ? " •" : ""}
          </button>
          <button
            type="button"
            onClick={cursor.next}
            disabled={cursor.atEnd}
            className="min-h-11 rounded-md border-2 border-ink/25 bg-paper text-sm font-medium disabled:opacity-40"
            data-testid="cursor-skip"
          >
            Skip ›
          </button>
        </div>

        {/* SEAM (Stage 16). Auto-advance is off because `getRoutePosition()`
            is null, not because of a separate switch someone could flip.
            Stage 16 turns the opt-in on and this control appears. */}
        {autoAdvanceEnabled() ? (
          <p className="px-4 pb-2 text-xs text-ink-soft" data-testid="auto-advance">
            Advancing from your position along the route.
          </p>
        ) : null}

        <SequenceStrip />
      </div>

      <OutcomeButtons
        onPrimary={(outcome) => {
          if (outcome === "lead") {
            startLead();
            return;
          }
          void commit(outcome);
        }}
        onOther={() => setSheet({ kind: "other" })}
      />

      {sheet.kind === "other" ? (
        <OtherOutcomeSheet
          onPick={(outcome) => void commit(outcome)}
          onDismiss={() => setSheet({ kind: "none" })}
        />
      ) : null}

      {sheet.kind === "notes" ? (
        <NotesSheet
          initial={noteDraft}
          saveLabel={logged ? "Save note to this door" : "Keep note for the next log"}
          onDismiss={() => setSheet({ kind: "none" })}
          onSave={(notes) => {
            setNoteDraft(door.uprn, notes);
            setSheet({ kind: "none" });
            // Already logged? A note is a correction, which means a new knock
            // row carrying the same outcome — never an update.
            if (logged && notes !== (logged.notes ?? "")) {
              void logOutcome({
                assignmentId,
                canvasserId,
                uprn: door.uprn,
                sequencePosition: door.position,
                outcome: logged.outcome,
                notes,
              }).then((result) => {
                pulse(25);
                setNoteDraft(door.uprn, "");
                offerUndo(result.clientEventId, `Note added · ${plate}`);
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
              assignmentId,
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
          // Dismiss keeps the draft, including its client_event_id.
          onDismiss={() => setSheet({ kind: "none" })}
          onSubmit={(draft) => void commit("lead", { lead: draft })}
        />
      ) : null}
    </div>
  );
}

/**
 * SEAM (Stage 5b). Renders nothing in Stage 8. Becomes the spur and crossing
 * instruction for the current route step.
 */
function HeaderInstruction() {
  return null;
}

/**
 * SEAM (Stage 10). Renders nothing in Stage 8. Becomes the teammate's
 * position on the shared route, broadcast over Realtime and never stored.
 */
function TeammateLine() {
  return null;
}

function PhaseNotice({ phase }: { phase: FieldPhase }) {
  if (phase.kind === "loading") {
    return <p className="px-4 pt-8 text-sm text-ink-soft">Loading today&apos;s prop…</p>;
  }
  if (phase.kind === "empty") {
    return (
      <p className="px-4 pt-8 text-sm text-ink-soft">
        Nothing is assigned to you today, so there is no sequence to work through.
      </p>
    );
  }
  if (phase.kind === "error") {
    return (
      <p className="px-4 pt-8 text-sm text-ink-soft" role="alert">
        {phase.message}
      </p>
    );
  }
  return null;
}

/**
 * Free scroll: the whole sequence, tappable, with each door's logged outcome
 * shown inline so the walk is self-correcting on sight. Current assignment
 * only, and nothing here is counted, ranked or grouped by street.
 */
function SequenceStrip() {
  const { sequence, cursor, outcomes, labelFor } = useFieldData();

  return (
    <ol className="border-t border-ink/15 bg-paper" data-testid="sequence-strip">
      {sequence.map((door, index) => {
        const logged = outcomes.get(door.uprn);
        const label = labelFor(door.uprn);
        const current = index === cursor.index;
        return (
          <li key={door.uprn}>
            <button
              type="button"
              onClick={() => cursor.goTo(index)}
              className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left ${
                current ? "bg-ink text-paper" : ""
              }`}
            >
              <span className="font-data text-xs opacity-70">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-base">
                {doorPlate(label)}
                {label?.street_name ? ` ${label.street_name}` : ""}
              </span>
              <span className="shrink-0 text-sm">
                {logged ? `${outcomeSpec(logged.outcome).glyph} ${outcomeSpec(logged.outcome).logged}` : "—"}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
