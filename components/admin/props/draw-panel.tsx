"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/admin/ui/button";
import { IconButton } from "@/components/admin/ui/icon-button";
import { InfoIcon, LayersIcon, RedoIcon, UndoIcon, WarningIcon } from "@/components/field/icons";
import type { ShapeCount } from "@/components/admin/props/use-shape-count";
import { canClose, cornerLabel, toolbarHint, topHint, type DrawShape } from "@/lib/admin/draw-history";
import { doorDelta, flatsNote, ncczNote } from "@/lib/admin/draw-copy";

export type DrawPanelProps = {
  kind: "new" | "edit";
  shape: DrawShape;
  canUndo: boolean;
  canRedo: boolean;
  count: ShapeCount;
  /** Edit shape: the doors when the shape was opened, for "+32 since last save". */
  baselineDoors: number | null;
  /** Edit shape: the visit already frozen (frame 13). */
  note: string | null;
  /** New prop, closed, not "Keep editing": the name sheet is up (frame 11). */
  naming: boolean;
  dirty: boolean;
  name: string;
  saving: boolean;
  error: string | null;
  onName: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCloseShape: () => void;
  onCancel: () => void;
  onSave: () => void;
  onKeepEditing: () => void;
  onNameIt: () => void;
  onShowZones: () => void;
  zonesOn: boolean;
  onLayers: () => void;
};

function countFigure(count: ShapeCount): number | null {
  if (count.status === "counted") return count.count.knockable;
  if (count.status === "counting") return count.previous?.knockable ?? null;
  return null;
}

/**
 * UI-10 F2c (owner A19-A21; frames 08-11, 13, D3). Everything around the map
 * while a shape is being drawn or edited. Phone: a header (Cancel, title,
 * layers), one hint at the top, and a toolbar at the bottom (Undo, Redo, the
 * corner count, Close shape). Desktop: one floating toolbar at the top with
 * the keyboard shortcuts, and the hint at the bottom. Once a new shape is
 * closed the name sheet takes the toolbar's place.
 */
export function DrawPanel(props: DrawPanelProps) {
  const { kind, shape, count } = props;
  const title = kind === "new" ? "New prop" : "Edit shape";
  const hint = topHint(shape) ?? props.note;
  const doors = countFigure(count);
  const closed = shape.closed;

  let summary: string;
  let sub: string;
  if (!closed) {
    summary = cornerLabel(shape.points.length);
    sub = toolbarHint(shape);
  } else if (count.status === "failed") {
    summary = "Not counted";
    sub = count.message;
  } else {
    summary = doors === null ? "Counting…" : `${doors.toLocaleString("en-GB")} doors`;
    sub = (kind === "edit" && doors !== null ? doorDelta(doors, props.baselineDoors) : null) ?? toolbarHint(shape);
  }

  let action: { label: string; onClick: () => void; disabled: boolean };
  if (!closed) action = { label: "Close shape", onClick: props.onCloseShape, disabled: !canClose(shape) };
  else if (kind === "new") action = { label: "Name prop", onClick: props.onNameIt, disabled: false };
  else
    action = {
      label: props.saving ? "Saving…" : "Save",
      onClick: props.onSave,
      disabled: !props.dirty || props.saving || count.status !== "counted",
    };

  return (
    <>
      {/* Phone header (frames 08-13). */}
      <header className="absolute inset-x-0 top-0 z-20 flex h-13 items-center border-b border-line bg-surface px-1 lg:hidden">
        <Button kind="quiet" size="compact" onClick={props.onCancel}>
          Cancel
        </Button>
        <h1 className="flex-1 truncate text-center text-admin-headline">{title}</h1>
        <IconButton label="Map layers" onClick={props.onLayers} data-layers-button>
          <LayersIcon className="size-6" />
        </IconButton>
      </header>

      {/* Desktop toolbar (D3). */}
      <div className="absolute top-3 left-1/2 z-20 hidden -translate-x-1/2 items-center gap-1 rounded-field-lg border border-line bg-surface p-1 pl-2 text-ink shadow-admin-float lg:flex">
        <Button kind="quiet" size="compact" onClick={props.onCancel}>
          Cancel
        </Button>
        <h1 className="px-2 text-admin-body-strong">{title}</h1>
        <span aria-hidden className="mx-1 h-6 border-l border-line" />
        <IconButton label="Undo (⌘Z)" onClick={props.onUndo} disabled={!props.canUndo}>
          <UndoIcon className="size-5" />
        </IconButton>
        <IconButton label="Redo (⇧⌘Z)" onClick={props.onRedo} disabled={!props.canRedo}>
          <RedoIcon className="size-5" />
        </IconButton>
        <span aria-hidden className="mx-1 h-6 border-l border-line" />
        <p className="px-2 text-admin-body-strong tabular-nums" aria-live="polite">
          {summary}
        </p>
        {!props.naming ? (
          <Button size="compact" onClick={action.onClick} disabled={action.disabled}>
            {action.label}
            {!closed ? <span aria-hidden className="text-admin-caption opacity-70">↵</span> : null}
          </Button>
        ) : null}
        <IconButton label="Map layers" onClick={props.onLayers} data-layers-button>
          <LayersIcon className="size-5" />
        </IconButton>
      </div>

      {hint ? (
        <p className="absolute top-16 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-admin-subhead text-ink shadow-admin-float lg:top-auto lg:bottom-3">
          <InfoIcon className="size-4 shrink-0 text-ink-muted" />
          <span className="truncate">{hint}</span>
        </p>
      ) : (
        <p className="absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-admin-caption text-ink-soft shadow-admin-float lg:flex">
          <InfoIcon className="size-4 shrink-0" />
          {shape.closed
            ? "Drag a corner to move it · drag an edge dot to add one · Esc to cancel"
            : "Click to add a corner · drag a corner to move it · Esc to cancel"}
        </p>
      )}

      {/* Phone toolbar. */}
      {!props.naming ? (
        <div className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex items-center gap-1 rounded-field-lg border border-line bg-surface p-1.5 text-ink shadow-admin-float lg:hidden">
          <IconButton label="Undo" onClick={props.onUndo} disabled={!props.canUndo}>
            <UndoIcon className="size-6" />
          </IconButton>
          <IconButton label="Redo" onClick={props.onRedo} disabled={!props.canRedo}>
            <RedoIcon className="size-6" />
          </IconButton>
          <div className="min-w-0 flex-1 px-1" aria-live="polite">
            <p className="truncate text-admin-body-strong tabular-nums">{summary}</p>
            <p className={`truncate text-admin-caption ${kind === "edit" && closed && doors !== null && props.baselineDoors !== null ? "text-prop" : "text-ink-muted"}`}>
              {sub}
            </p>
          </div>
          <Button size="compact" onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </Button>
        </div>
      ) : null}

      {kind === "edit" && props.error ? (
        <p role="alert" className="absolute inset-x-3 bottom-24 z-20 rounded-field-md bg-error-bg px-3 py-2 text-admin-subhead text-oxide lg:inset-x-auto lg:right-3 lg:bottom-3 lg:w-80">
          {props.error}
        </p>
      ) : null}

      {props.naming ? <NameSheet {...props} doors={doors} /> : null}
    </>
  );
}

/** Frame 11: the count, what was left out, the name, Save prop. */
function NameSheet(props: DrawPanelProps & { doors: number | null }) {
  const input = useRef<HTMLInputElement | null>(null);
  const counted = props.count.status === "counted" ? props.count.count : null;
  const nccz = counted ? ncczNote(counted) : null;
  const flats = counted ? flatsNote(counted) : null;

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      aria-label="Name and save"
      className="absolute inset-x-0 bottom-0 z-20 rounded-t-admin-sheet bg-surface px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink shadow-admin-sheet motion-safe:animate-admin-sheet-in lg:inset-x-auto lg:top-auto lg:bottom-3 lg:left-3 lg:w-[360px] lg:rounded-admin-sheet lg:border lg:border-line lg:pt-4"
    >
      <div aria-hidden className="flex justify-center pb-2 lg:hidden">
        <span className="h-1.5 w-9 rounded-full bg-ink-faint" />
      </div>
      <p className="flex items-baseline gap-2" aria-live="polite">
        <span className="text-admin-large-title tabular-nums">
          {props.doors === null ? "…" : props.doors.toLocaleString("en-GB")}
        </span>
        <span className="text-admin-body text-ink-muted">
          {props.count.status === "failed" ? props.count.message : "doors to knock"}
        </span>
      </p>
      {flats ? <p className="text-admin-subhead text-ink-muted">{flats}</p> : null}
      {nccz ? (
        <div className="mt-3 flex items-center gap-3 rounded-field-md bg-warn-bg py-1 pr-1 pl-3 text-warn-ink">
          <WarningIcon className="size-5 shrink-0" />
          <p className="min-w-0 flex-1 text-admin-subhead">{nccz}</p>
          {!props.zonesOn ? (
            <Button kind="quiet" size="compact" onClick={props.onShowZones}>
              Show zones
            </Button>
          ) : null}
        </div>
      ) : null}
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave();
        }}
      >
        <label htmlFor="new-prop-name" className="text-admin-section text-ink-soft">
          Prop name
        </label>
        <input
          id="new-prop-name"
          ref={input}
          value={props.name}
          maxLength={80}
          autoComplete="off"
          onChange={(event) => props.onName(event.target.value)}
          placeholder="Fulford Road east"
          className="mt-1.5 h-12 w-full rounded-field-md border border-line bg-surface px-3 text-admin-body text-ink outline-none placeholder:text-ink-faint focus:border-prop focus:outline-1 focus:outline-prop"
        />
        {props.error ? (
          <p role="alert" className="mt-2 text-admin-subhead text-oxide">
            {props.error}
          </p>
        ) : null}
        <Button
          type="submit"
          className="mt-4 w-full"
          disabled={props.saving || props.name.trim() === "" || props.count.status !== "counted"}
        >
          {props.saving ? "Saving…" : "Save prop"}
        </Button>
        <Button kind="quiet" className="mt-1 w-full" onClick={props.onKeepEditing} disabled={props.saving}>
          Keep editing
        </Button>
      </form>
    </section>
  );
}
