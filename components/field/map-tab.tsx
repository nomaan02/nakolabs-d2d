"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OtherOutcomeSheet } from "@/components/field/door-sheets";
import { FieldMap } from "@/components/field/field-map";
import { useFieldData } from "@/components/field/field-data-provider";
import { OutcomeButtons } from "@/components/field/outcome-buttons";
import { pulse } from "@/lib/field/feedback";
import { doorPlate, mapLabel } from "@/lib/field/labels";
import { logOutcome } from "@/lib/field/log-outcome";
import { outcomeSpec, type OtherOutcome, type PrimaryOutcome } from "@/lib/field/outcomes";
import { offerUndo } from "@/lib/field/undo";
import { formatAssignmentHeader } from "@/lib/geo/todays-assignment";

/**
 * The map is the SECONDARY logging path and the recovery route: when the
 * sequence and the street disagree, tap the door you are actually at. It
 * routes through the same `logOutcome` as the Logger — there is one write
 * function, and under it one queue.
 *
 * Selecting a dot also moves the Logger's cursor to it, so the two surfaces
 * never disagree about which door is current.
 */
export function MapTab() {
  const { phase, canvasserId, labels, outcomes, cursor, labelFor } = useFieldData();
  const router = useRouter();
  const [selectedUprn, setSelectedUprn] = useState<number | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);

  if (phase.kind === "loading") {
    return <p className="px-4 pt-8 text-sm text-ink-soft">Loading today&apos;s prop…</p>;
  }

  if (phase.kind === "empty") {
    return (
      <div className="px-4 pt-8" data-testid="field-empty">
        <p className="font-display text-xl tracking-tight">No prop allocated for today.</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          Nothing is assigned to you for today. If you should be out, speak to the person who
          allocates the props.
        </p>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <p className="px-4 pt-8 text-sm text-ink-soft" role="alert">
        {phase.message}
      </p>
    );
  }

  const assignment = phase.assignment;
  const selectedLabel = selectedUprn !== null ? labelFor(selectedUprn) : undefined;
  const selectedLogged = selectedUprn !== null ? outcomes.get(selectedUprn) : undefined;

  const commit = async (outcome: PrimaryOutcome | OtherOutcome) => {
    if (selectedUprn === null || !canvasserId) return;
    const door = cursor.door?.uprn === selectedUprn ? cursor.door : undefined;
    const result = await logOutcome({
      assignmentId: assignment.assignment_id,
      canvasserId,
      uprn: selectedUprn,
      sequencePosition: door?.position ?? null,
      outcome,
    });
    pulse(40);
    offerUndo(
      result.clientEventId,
      `${outcomeSpec(outcome).logged} · ${mapLabel(selectedLabel) ?? doorPlate(selectedLabel)}`,
    );
    setOtherOpen(false);
    setSelectedUprn(null);
  };

  return (
    <div className="relative flex h-full flex-col" data-testid="map-tab">
      <header className="z-10 border-b border-ink/15 bg-paper px-4 pb-2 pt-3">
        <h1 className="font-display text-lg leading-snug tracking-tight">
          {assignment.territory_name}
        </h1>
        <p className="font-data text-xs leading-relaxed text-ink-soft">
          {formatAssignmentHeader(assignment)}
        </p>
        {phase.fromCache ? (
          <p className="mt-1 text-xs text-ink-soft" role="status">
            Showing the copy saved on this phone.
          </p>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1">
        <FieldMap
          doors={assignment.doors}
          labels={labels}
          outcomes={outcomes}
          selectedUprn={selectedUprn}
          onSelectUprn={(uprn) => {
            setSelectedUprn(uprn);
            cursor.goToUprn(uprn);
          }}
          active
        />
        <Legend />
      </div>

      {selectedUprn !== null ? (
        <section
          className="z-10 border-t-2 border-ink bg-paper pb-[env(safe-area-inset-bottom)]"
          data-testid="map-door-panel"
        >
          <div className="flex items-start justify-between gap-3 px-4 pt-3">
            <div className="min-w-0">
              <p className="truncate font-display text-lg tracking-tight">
                {mapLabel(selectedLabel) ?? doorPlate(selectedLabel)}
              </p>
              {selectedLogged ? (
                <p className="text-sm text-ink-soft">
                  {outcomeSpec(selectedLogged.outcome).glyph} Logged this visit ·{" "}
                  {outcomeSpec(selectedLogged.outcome).logged}
                </p>
              ) : (
                <p className="text-sm text-ink-soft">Not logged on this visit.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedUprn(null)}
              className="min-h-11 shrink-0 rounded-md border border-ink/25 px-4 text-sm font-medium"
            >
              Close
            </button>
          </div>
          <OutcomeButtons
            onPrimary={(outcome) => {
              if (outcome === "lead") {
                // A lead needs the appointment sheet, which lives on the
                // Logger. Move the cursor there rather than duplicating it.
                cursor.goToUprn(selectedUprn);
                setSelectedUprn(null);
                router.push("/field/logger");
                return;
              }
              void commit(outcome);
            }}
            onOther={() => setOtherOpen(true)}
          />
        </section>
      ) : null}

      {otherOpen ? (
        <OtherOutcomeSheet
          onPick={(outcome) => void commit(outcome)}
          onDismiss={() => setOtherOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Colour is never alone: the legend names every state in words, and each
 * state also differs by size or by having a pale core, so the map survives
 * glare, greyscale and colour blindness.
 *
 * Outcomes shown are this assignment's only. Nothing here is a count, a rate
 * or a ranking.
 */
function Legend() {
  const items = [
    { label: "Not yet logged", className: "h-3 w-3 bg-ink-soft" },
    { label: "No answer", className: "h-3 w-3 bg-worksheet-deep ring-1 ring-ink" },
    { label: "Contact", className: "h-3.5 w-3.5 bg-prop ring-2 ring-inset ring-paper" },
    { label: "Rented/Council", className: "h-2 w-2 bg-oxide" },
    { label: "Lead", className: "h-5 w-5 bg-lead ring-2 ring-inset ring-paper" },
  ];

  return (
    <ul
      className="pointer-events-none absolute right-2 top-2 rounded-md border border-ink/20 bg-paper/95 px-2 py-1.5"
      data-testid="map-legend"
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 py-0.5 text-[11px] leading-none">
          <span className={`inline-block shrink-0 rounded-full ${item.className}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
