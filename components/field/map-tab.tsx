"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CrmLayerPill, CrmLeadCard, useCrmMapLayer } from "@/components/field/crm/crm-map-layer";
import { OtherOutcomeSheet } from "@/components/field/door-sheets";
import { FieldMap } from "@/components/field/field-map";
import { useFieldData } from "@/components/field/field-data-provider";
import { useGeo } from "@/components/field/geo-provider";
import { CloseIcon, InfoIcon, LocateIcon } from "@/components/field/icons";
import { LocationOffNotice } from "@/components/field/location-off-notice";
import { SharingPill } from "@/components/field/sharing-pill";
import { FieldHeader, FieldPage } from "@/components/field/shell/field-header";
import { mapPositionOf } from "@/lib/field/geo";
import { OtherOutcomeButton, OutcomeButtons } from "@/components/field/outcome-buttons";
import { TeammateLines } from "@/components/field/teammate-lines";
import { pulse } from "@/lib/field/feedback";
import { doorPlate, mapLabel } from "@/lib/field/labels";
import { logOutcome } from "@/lib/field/log-outcome";
import { outcomeSpec, type OtherOutcome, type PrimaryOutcome } from "@/lib/field/outcomes";
import { toggleMapView, useMapView } from "@/lib/field/map-view";
import { offerUndo } from "@/lib/field/undo";
import { formatFieldHeader } from "@/lib/field/route-display";
import { useResolvedTheme } from "@/lib/field/theme";
import { mapColours, type MapMode } from "@/lib/map/map-palette";
import { routeColours } from "@/lib/map/route-layers";

/**
 * The map is the SECONDARY logging path and the recovery route: when the
 * sequence and the street disagree, tap the door you are actually at. It
 * routes through the same `logOutcome` as the Logger — there is one write
 * function, and under it one queue.
 *
 * Selecting a dot also moves the Logger's cursor to it, so the two surfaces
 * never disagree about which door is current.
 *
 * Amended 2026-09-28 (owner, UI item 1). Claims, Take and the old next-door
 * card are removed. Tapping a door just selects it and moves the cursor
 * there — there is nothing left to claim.
 */
/** One map control: solid, 44px, round, a hairline edge (Figma M1). */
const CONTROL =
  "flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop";

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
    anchoredDoors,
    footprints,
    mapSelectedUprn,
    mapCameraNonce,
    selectDoorOnMap,
    sequence,
    team,
  } = useFieldData();
  const router = useRouter();
  const [otherOpen, setOtherOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const mapView = useMapView();
  const mode = useResolvedTheme();
  // UI-7 C1b (owner H3). The canvasser's own marker, memory only.
  const geo = useGeo();
  const [locateNonce, setLocateNonce] = useState(0);
  const position = useMemo(
    () => mapPositionOf(geo.fix, geo.heading, geo.weak),
    [geo.fix, geo.heading, geo.weak],
  );
  const locationOff = geo.status === "denied" || geo.status === "unavailable";
  // CRM-5 C2 (owner 2026-10-12): own CRM leads layer, off by default.
  const crm = useCrmMapLayer(canvasserId);

  // FUI-1b: the loading, empty and error states keep the fixed header, so
  // the menu is always there.
  if (phase.kind === "loading") {
    return (
      <FieldPage header={<FieldHeader title="Map" />}>
        <p className="px-4 pt-8 text-sm text-ink-soft">Loading today&apos;s prop…</p>
      </FieldPage>
    );
  }

  if (phase.kind === "empty") {
    return (
      <FieldPage header={<FieldHeader title="Map" />}>
        <div className="px-4 pt-8" data-testid="field-empty">
          <p className="font-display text-xl tracking-tight">No prop allocated for today.</p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
            Nothing is assigned to you for today. If you should be out, speak to the person who
            allocates the props.
          </p>
        </div>
      </FieldPage>
    );
  }

  if (phase.kind === "error") {
    return (
      <FieldPage header={<FieldHeader title="Map" />}>
        <p className="px-4 pt-8 text-sm text-ink-soft" role="alert">
          {phase.message}
        </p>
      </FieldPage>
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

  return (
    <div className="relative flex h-full flex-col" data-testid="map-tab">
      {/* FUI-1b (owner 2026-10-14, O3): the same fixed header as every tab. The
          undo ring now lives in it, so the old right padding for it is gone. */}
      <FieldHeader
        title={assignment.territory_name}
        subtitle={formatFieldHeader(assignment, routeProgress)}
        right={<SharingPill assignmentId={assignment.assignment_id} />}
      >
        {phase.fromCache ? (
          <p className="px-4 pb-2 text-admin-caption text-ink-soft" role="status">
            Showing the copy saved on this phone.
          </p>
        ) : null}
        <div className="-mt-1 px-4 pb-2 empty:hidden">
          <TeammateLines rows={team.teammates} labelFor={labelFor} />
        </div>
      </FieldHeader>

      <div className="relative min-h-0 flex-1">
        <FieldMap
          key={mode}
          mode={mode}
          doors={anchoredDoors}
          labels={labels}
          outcomes={outcomes}
          routeModel={routeModel}
          routeTiers={routeTiers}
          footprints={footprints}
          selectedUprn={selectedUprn}
          cameraNonce={mapCameraNonce}
          onSelectUprn={(uprn) => {
            crm.select(null);
            selectDoorOnMap(uprn);
            cursor.goToUprn(uprn);
          }}
          crmLeads={crm.points}
          selectedCrmId={crm.selected}
          onSelectCrm={(id) => {
            selectDoorOnMap(null);
            crm.select(id);
          }}
          active
          position={position}
          recenterTarget="position"
          recenterNonce={locateNonce}
        />
        {/* FUI-3 (Figma M1): one control stack, top right. 3D, centre on me and
            the Key, each a solid 44px round button. */}
        <div className="absolute right-2 top-2 z-[2] flex flex-col gap-2">
          <button
            type="button"
            aria-pressed={mapView === "3d"}
            aria-label={mapView === "3d" ? "Switch to the flat map" : "Switch to the 3D map"}
            onClick={() => toggleMapView()}
            className={`${CONTROL} text-admin-pill`}
            data-testid="map-view-toggle"
          >
            {mapView === "3d" ? "2D" : "3D"}
          </button>
          {position ? (
            <button
              type="button"
              onClick={() => {
                geo.requestCompass();
                setLocateNonce((n) => n + 1);
              }}
              aria-label="Centre the map on you"
              className={`${CONTROL} text-prop`}
              data-testid="map-locate"
            >
              <LocateIcon className="size-5" />
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={keyOpen}
            aria-expanded={keyOpen}
            aria-controls="map-key"
            aria-label="Key"
            onClick={() => setKeyOpen((open) => !open)}
            className={CONTROL}
            data-testid="map-key-toggle"
          >
            <InfoIcon className="size-5" />
          </button>
        </div>
        {!position && locationOff ? (
          <LocationOffNotice className={crm.linked ? "left-2 top-16" : "left-2 top-2"} />
        ) : null}
        {crm.linked ? <CrmLayerPill days={crm.days} onChange={crm.setDays} className="left-2 top-2" /> : null}
        {keyOpen ? <Legend mode={mode} /> : null}
      </div>

      {crm.on && selectedUprn === null ? (
        <CrmLeadCard lead={crm.lead} leads={crm.leads} state={crm.state} onClose={() => crm.select(null)} />
      ) : null}

      {selectedUprn !== null ? (
        <section
          className="z-10 rounded-t-2xl border-t border-line bg-surface"
          data-testid="map-door-panel"
        >
          <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-3">
            <div className="min-w-0">
              <p className="truncate text-admin-headline text-ink">
                {mapLabel(selectedLabel) ?? doorPlate(selectedLabel)}
              </p>
              {selectedLogged ? (
                <p className="text-admin-subhead text-ink-soft">
                  {outcomeSpec(selectedLogged.outcome).glyph} Logged this visit ·{" "}
                  {outcomeSpec(selectedLogged.outcome).logged}
                </p>
              ) : (
                <p className="text-admin-subhead text-ink-soft">Not logged on this visit.</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <OtherOutcomeButton onOther={() => setOtherOpen(true)} />
              <button
                type="button"
                onClick={() => selectDoorOnMap(null)}
                aria-label="Close"
                className="flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
                data-testid="map-door-close"
              >
                <CloseIcon className="size-5" />
              </button>
            </div>
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
function Legend({ mode }: { mode: MapMode }) {
  const { routeModel } = useFieldData();
  const dot = mapColours(mode).dot;
  const route = routeColours(mode);
  const hasEnds =
    routeModel.points.some((point) => point.role === "start") &&
    routeModel.points.some((point) => point.role === "end");
  const hasRoute = routeModel.steps.length > 0;
  // P10: labels read from outcomeSpec, so "No Answer" → "Not In" (and any
  // future wording change) never has to be edited in two places.
  const items = [
    {
      label: "Not yet logged",
      className: "rounded-full h-3 w-3",
      backgroundColor: dot.open,
      boxShadow: `0 0 0 1px ${dot.openRing}`,
    },
    {
      label: outcomeSpec("no_answer").label,
      className: "rounded-full h-3 w-3",
      backgroundColor: dot.no_answer,
      boxShadow: `0 0 0 1px ${dot.ring}`,
    },
    {
      label: outcomeSpec("answered").label,
      className: "rounded-full h-3.5 w-3.5",
      backgroundColor: dot.answered,
      boxShadow: `inset 0 0 0 2px ${dot.ring}`,
    },
    {
      label: outcomeSpec("no_opportunity").label,
      className: "rounded-full h-2 w-2",
      backgroundColor: dot.no_opportunity,
      boxShadow: "none",
    },
    {
      label: outcomeSpec("lead").label,
      className: "rounded-full h-5 w-5",
      backgroundColor: dot.lead,
      boxShadow: `inset 0 0 0 2px ${dot.ring}`,
    },
  ];
  const routeRows = hasRoute
    ? [
        { label: "Now & next", className: "h-1.5 w-6", colour: route.focus },
        { label: "Later", className: "h-1 w-6", colour: route.far },
        { label: "Done", className: "h-0.5 w-6", colour: route.done },
      ]
    : [];

  return (
    <ul
      id="map-key"
      className="pointer-events-none absolute right-2 top-40 z-[2] rounded-field-md border border-line bg-surface px-3 py-2"
      data-testid="map-legend"
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 py-1 text-admin-caption text-ink">
          <span
            className={`inline-block shrink-0 ${item.className}`}
            style={{ backgroundColor: item.backgroundColor, boxShadow: item.boxShadow }}
          />
          {item.label}
        </li>
      ))}
      {hasEnds ? (
        <>
          <li className="flex items-center gap-2 py-1 text-admin-caption text-ink">
            <span className="inline-flex shrink-0 items-center rounded-full bg-lead px-1 text-[9px] font-bold text-paper ring-1 ring-paper">
              START
            </span>
            First door
          </li>
          <li className="flex items-center gap-2 py-1 text-admin-caption text-ink">
            <span className="inline-flex shrink-0 items-center rounded-full bg-oxide px-1 text-[9px] font-bold text-paper ring-1 ring-paper">
              END
            </span>
            Last door
          </li>
        </>
      ) : null}
      {routeRows.map((row) => (
        <li key={row.label} className="flex items-center gap-2 py-1 text-admin-caption text-ink">
          <span className={`inline-block shrink-0 ${row.className}`} style={{ backgroundColor: row.colour }} />
          {row.label}
        </li>
      ))}
    </ul>
  );
}
