"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/admin/ui/button";
import { IconButton } from "@/components/admin/ui/icon-button";
import { EraseIcon, InfoIcon, RedoIcon, UndoIcon } from "@/components/field/icons";
import { routeCountLine, routeSaveLines, routeToolbarHint } from "@/lib/admin/route-draw";

export type RouteDrawPanelProps = {
  title: string;
  status: "loading" | "ready" | "failed";
  /** Shown instead of the toolbar when the doors or roads could not be read. */
  loadError: string | null;
  linked: number;
  total: number;
  canUndo: boolean;
  canRedo: boolean;
  canSave: boolean;
  erasing: boolean;
  zoomedOut: boolean;
  /** R5: the "Save this route?" sheet is up. */
  confirming: boolean;
  saving: boolean;
  error: string | null;
  /** R4: "Door taken off the route", with Undo. */
  snack: string | null;
  onCancel: () => void;
  onUndo: () => void;
  /** The snackbar's Undo: puts back the whole erase stroke. */
  onUndoErase: () => void;
  onRedo: () => void;
  onToggleErase: () => void;
  onSave: () => void;
  onConfirmSave: () => void;
  onKeepDrawing: () => void;
  onRetry: () => void;
};

/**
 * RT-3 (owner O2; Figma R2–R5, R8, D1). Everything around the map while a
 * route is drawn. Phone: a header (Cancel, title), one hint at the top until
 * the first door is linked, and a toolbar at the bottom (Undo, Redo, Erase,
 * the door count, Save). Desktop: one floating toolbar at the top with the
 * keyboard shortcuts, and the hint at the bottom. Saving with doors left out
 * asks first (R5).
 */
export function RouteDrawPanel(props: RouteDrawPanelProps) {
  const sheet = useRef<HTMLElement>(null);
  // R5: the sheet takes the focus, on its first button (Save route).
  useEffect(() => {
    if (props.confirming) sheet.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [props.confirming]);
  const ready = props.status === "ready";
  const count = ready ? routeCountLine(props.linked, props.total) : props.status === "loading" ? "Loading doors…" : "Not loaded";
  const sub = ready ? routeToolbarHint({ linked: props.linked, erasing: props.erasing, zoomedOut: props.zoomedOut }) : "";
  const showHint = ready && props.linked === 0 && !props.erasing;
  const lines = routeSaveLines(props.linked, props.total);

  return (
    <>
      {/* Phone header (R2–R5). */}
      <header className="absolute inset-x-0 top-0 z-20 flex h-13 items-center border-b border-line bg-surface px-1 lg:hidden">
        <Button kind="quiet" size="compact" onClick={props.onCancel} disabled={props.saving}>
          Cancel
        </Button>
        <h1 className="flex-1 truncate text-center text-admin-headline">{props.title}</h1>
        <span aria-hidden className="size-11 shrink-0" />
      </header>

      {/* Desktop toolbar (D1). */}
      <div data-route-draw-tools className="absolute top-3 left-1/2 z-20 hidden -translate-x-1/2 items-center gap-1 rounded-field-lg border border-line bg-surface p-1 pl-2 text-ink shadow-admin-float lg:flex">
        <Button kind="quiet" size="compact" onClick={props.onCancel} disabled={props.saving}>
          Cancel
        </Button>
        <h1 className="max-w-56 truncate px-2 text-admin-body-strong">{props.title}</h1>
        <span aria-hidden className="mx-1 h-6 border-l border-line" />
        <IconButton label="Undo (⌘Z)" onClick={props.onUndo} disabled={!props.canUndo}>
          <UndoIcon className="size-5" />
        </IconButton>
        <IconButton label="Redo (⇧⌘Z)" onClick={props.onRedo} disabled={!props.canRedo}>
          <RedoIcon className="size-5" />
        </IconButton>
        <IconButton
          label="Erase (E)"
          aria-pressed={props.erasing}
          onClick={props.onToggleErase}
          disabled={!ready}
          className={props.erasing ? "bg-prop-soft text-prop" : ""}
        >
          <EraseIcon className="size-5" />
        </IconButton>
        <span aria-hidden className="mx-1 h-6 border-l border-line" />
        <p className="px-2 text-admin-body-strong tabular-nums" aria-live="polite">
          {count}
        </p>
        <Button size="compact" onClick={props.onSave} disabled={!props.canSave || props.saving || props.confirming}>
          {props.saving ? "Saving…" : "Save route"}
        </Button>
      </div>

      {showHint ? (
        <div className="pointer-events-none absolute inset-x-3 top-16 z-10 rounded-field-lg border border-line bg-surface px-4 py-3 text-ink shadow-admin-float lg:hidden">
          <p className="text-admin-body-strong">Press a door, then drag through the doors in the order to knock them.</p>
          <p className="mt-0.5 text-admin-subhead text-ink-muted">Two fingers move the map.</p>
        </div>
      ) : null}
      <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-admin-caption text-ink-soft shadow-admin-float lg:flex">
        <InfoIcon className="size-4 shrink-0" />
        {props.zoomedOut
          ? "Zoom in to draw"
          : props.erasing
            ? "Click a door to take it off · E to stop erasing · Esc to cancel"
            : "Press a door and drag through the doors in walking order · Space + drag moves the map · Esc to cancel"}
      </p>

      {props.status === "failed" ? (
        <div role="alert" className="absolute inset-x-3 top-16 z-20 rounded-field-md bg-warn-bg p-3 text-warn-ink lg:inset-x-auto lg:top-20 lg:left-1/2 lg:w-96 lg:-translate-x-1/2">
          <p className="text-admin-subhead">{props.loadError}</p>
          <Button kind="secondary" size="compact" className="mt-2" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      ) : null}

      {props.snack && !props.confirming ? (
        <div
          role="status"
          className="absolute inset-x-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.5rem)] z-20 flex items-center gap-2 rounded-field-md bg-ink py-1 pr-1 pl-4 text-paper lg:inset-x-auto lg:bottom-14 lg:left-1/2 lg:w-96 lg:-translate-x-1/2"
        >
          <p className="min-w-0 flex-1 truncate text-admin-body">{props.snack}</p>
          <Button kind="quiet" size="compact" className="text-prop-soft" onClick={props.onUndoErase}>
            Undo
          </Button>
        </div>
      ) : null}

      {props.error && !props.confirming ? (
        <p role="alert" className="absolute inset-x-3 bottom-24 z-20 rounded-field-md bg-error-bg px-3 py-2 text-admin-subhead text-oxide lg:inset-x-auto lg:right-3 lg:bottom-3 lg:w-80">
          {props.error}
        </p>
      ) : null}

      {/* Phone toolbar (R2–R4). */}
      {!props.confirming ? (
        <div data-route-draw-tools className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 flex items-center gap-0.5 rounded-field-lg border border-line bg-surface p-1.5 text-ink shadow-admin-float lg:hidden">
          <IconButton label="Undo" onClick={props.onUndo} disabled={!props.canUndo}>
            <UndoIcon className="size-6" />
          </IconButton>
          <IconButton label="Redo" onClick={props.onRedo} disabled={!props.canRedo}>
            <RedoIcon className="size-6" />
          </IconButton>
          <IconButton
            label="Erase"
            aria-pressed={props.erasing}
            onClick={props.onToggleErase}
            disabled={!ready}
            className={props.erasing ? "bg-prop-soft text-prop" : ""}
          >
            <EraseIcon className="size-6" />
          </IconButton>
          <div className="min-w-0 flex-1 px-1" aria-live="polite">
            <p className="truncate text-admin-body-strong tabular-nums">{count}</p>
            <p className="truncate text-admin-caption text-ink-muted">{sub}</p>
          </div>
          <Button size="compact" onClick={props.onSave} disabled={!props.canSave || props.saving}>
            {props.saving ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : null}

      {props.confirming ? (
        <section
          ref={sheet}
          aria-label="Save this route"
          className="absolute inset-x-0 bottom-0 z-20 rounded-t-admin-sheet bg-surface px-5 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink shadow-admin-sheet motion-safe:animate-admin-sheet-in lg:inset-x-auto lg:bottom-3 lg:left-3 lg:w-[360px] lg:rounded-admin-sheet lg:border lg:border-line lg:pt-5"
        >
          <div aria-hidden className="flex justify-center pb-2 lg:hidden">
            <span className="h-1.5 w-9 rounded-full bg-ink-faint" />
          </div>
          <h2 className="text-admin-title">Save this route?</h2>
          <p className="mt-1 text-admin-body text-ink-soft">{lines.summary}</p>
          {lines.leftOut ? (
            <p className="mt-3 flex items-start gap-2.5 rounded-field-md bg-field-bg px-3 py-2.5 text-admin-subhead text-ink-soft">
              <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-ink-faint" />
              {lines.leftOut}
            </p>
          ) : null}
          {props.error ? (
            <p role="alert" className="mt-3 text-admin-subhead text-oxide">
              {props.error}
            </p>
          ) : null}
          <Button className="mt-4 w-full" onClick={props.onConfirmSave} disabled={props.saving}>
            {props.saving ? "Saving…" : "Save route"}
          </Button>
          <Button kind="quiet" className="mt-1 w-full" onClick={props.onKeepDrawing} disabled={props.saving}>
            Keep drawing
          </Button>
        </section>
      ) : null}
    </>
  );
}
