"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OtherOutcomeSheet } from "@/components/field/door-sheets";
import { FieldMap } from "@/components/field/field-map";
import { useFieldData } from "@/components/field/field-data-provider";
import { NextDoorCard } from "@/components/field/next-door-card";
import { OutcomeButtons } from "@/components/field/outcome-buttons";
import { TeammateLines } from "@/components/field/teammate-lines";
import { pulse } from "@/lib/field/feedback";
import { doorPlate, mapLabel } from "@/lib/field/labels";
import { logOutcome } from "@/lib/field/log-outcome";
import { outcomeSpec, type OtherOutcome, type PrimaryOutcome } from "@/lib/field/outcomes";
import { getCurrentStreetLabel, sequenceIsRouteDerived } from "@/lib/field/sequence";
import { offerUndo } from "@/lib/field/undo";
import { formatFieldHeader } from "@/lib/field/route-display";
import { ROUTE_TIER_COLOURS } from "@/lib/map/route-layers";

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
  const {
    phase,
    canvasserId,
    labels,
    outcomes,
    cursor,
    labelFor,
    routeProgress,
    routeModel,
    routeTiers,
    mapSelectedUprn,
    mapCameraNonce,
    selectDoorOnMap,
    sequence,
    team,
  } = useFieldData();
  const router = useRouter();
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
  const selectedUprn = mapSelectedUprn;
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
    const loggedDoor =
      door ?? sequence.find((item) => item.uprn === selectedUprn) ?? null;
    if (result.queued && loggedDoor) team.markKnocked(loggedDoor, result.clientEventId);
    offerUndo(
      result.clientEventId,
      `${outcomeSpec(outcome).logged} · ${mapLabel(selectedLabel) ?? doorPlate(selectedLabel)}`,
    );
    setOtherOpen(false);
    selectDoorOnMap(null);
  };

  const routed = sequenceIsRouteDerived(routeProgress.hasRoute);
  const nextDoor = team.nextDoor;
  const nextIndex = nextDoor ? sequence.findIndex((item) => item.uprn === nextDoor.uprn) : -1;
  const nextLabel = nextDoor ? labelFor(nextDoor.uprn) : undefined;
  const nextStreet = nextDoor
    ? getCurrentStreetLabel(
        nextLabel,
        nextIndex >= 0 ? routeProgress.doors[nextIndex]?.routeStreet : null,
        routed,
      )
    : null;

  return (
    <div className="relative flex h-full flex-col" data-testid="map-tab">
      <header className="z-10 border-b border-ink/15 bg-paper px-3 pb-3 pt-3">
        <h1 className="px-1 font-display text-lg leading-snug tracking-tight">
          {assignment.territory_name}
        </h1>
        <p className="px-1 font-data text-xs leading-relaxed text-ink-soft">
          {formatFieldHeader(assignment, routeProgress)}
        </p>
        {phase.fromCache ? (
          <p className="mt-1 px-1 text-xs text-ink-soft" role="status">
            Showing the copy saved on this phone.
          </p>
        ) : null}
        <div className="mt-2">
          <NextDoorCard
            door={nextDoor}
            plate={nextDoor ? doorPlate(nextLabel) : ""}
            street={nextStreet}
            onTake={() => {
              if (!nextDoor) return;
              team.claimDoor(nextDoor);
              cursor.goTo(nextDoor.position);
              selectDoorOnMap(nextDoor.uprn);
            }}
          />
          <TeammateLines rows={team.teammates} labelFor={labelFor} />
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <FieldMap
          doors={assignment.doors}
          labels={labels}
          outcomes={outcomes}
          routeModel={routeModel}
          routeTiers={routeTiers}
          selectedUprn={selectedUprn}
          cameraNonce={mapCameraNonce}
          onSelectUprn={(uprn) => {
            selectDoorOnMap(uprn);
            cursor.goToUprn(uprn);
            const picked = sequence.find((item) => item.uprn === uprn);
            if (picked && !outcomes.has(uprn)) team.claimDoor(picked);
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
              onClick={() => {
                if (selectedUprn !== null) team.releaseDoor(selectedUprn);
                selectDoorOnMap(null);
              }}
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
                selectDoorOnMap(null);
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
 *
 * Start and finish are START and END badges, because a green dot is Lead
 * and a burgundy dot is Rented/Council. The route rows name the street in
 * focus, the later streets and the steps already walked. They show only
 * when a route is painted.
 */
function Legend() {
  const { routeModel } = useFieldData();
  const hasEnds =
    routeModel.points.some((point) => point.role === "start") &&
    routeModel.points.some((point) => point.role === "end");
  const hasRoute = routeModel.steps.length > 0;
  const items = [
    { label: "Not yet logged", className: "rounded-full h-3 w-3 bg-ink-soft" },
    { label: "No answer", className: "rounded-full h-3 w-3 bg-worksheet-deep ring-1 ring-ink" },
    { label: "Contact", className: "rounded-full h-3.5 w-3.5 bg-prop ring-2 ring-inset ring-paper" },
    { label: "Rented/Council", className: "rounded-full h-2 w-2 bg-oxide" },
    { label: "Lead", className: "rounded-full h-5 w-5 bg-lead ring-2 ring-inset ring-paper" },
  ];
  const routeRows = hasRoute
    ? [
        { label: "Now & next", className: "h-1.5 w-6", colour: ROUTE_TIER_COLOURS.focus },
        { label: "Later", className: "h-1 w-6", colour: ROUTE_TIER_COLOURS.far },
        { label: "Done", className: "h-0.5 w-6", colour: ROUTE_TIER_COLOURS.done },
      ]
    : [];

  return (
    <ul
      className="pointer-events-none absolute right-2 top-2 rounded-md border border-ink/20 bg-paper/95 px-2 py-1.5"
      data-testid="map-legend"
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 py-0.5 text-[11px] leading-none">
          <span className={`inline-block shrink-0 ${item.className}`} />
          {item.label}
        </li>
      ))}
      {hasEnds ? (
        <>
          <li className="flex items-center gap-2 py-0.5 text-[11px] leading-none">
            <span className="inline-flex shrink-0 items-center rounded-full bg-lead px-1 text-[9px] font-bold text-white ring-1 ring-paper">
              START
            </span>
            First door
          </li>
          <li className="flex items-center gap-2 py-0.5 text-[11px] leading-none">
            <span className="inline-flex shrink-0 items-center rounded-full bg-oxide px-1 text-[9px] font-bold text-white ring-1 ring-paper">
              END
            </span>
            Last door
          </li>
        </>
      ) : null}
      {routeRows.map((row) => (
        <li key={row.label} className="flex items-center gap-2 py-0.5 text-[11px] leading-none">
          <span className={`inline-block shrink-0 ${row.className}`} style={{ backgroundColor: row.colour }} />
          {row.label}
        </li>
      ))}
    </ul>
  );
}
