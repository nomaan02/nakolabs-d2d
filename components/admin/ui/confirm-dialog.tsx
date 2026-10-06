"use client";

import { useRef } from "react";

import { Button } from "@/components/admin/ui/button";
import { useOverlayFocus } from "@/components/admin/ui/use-overlay-focus";

/**
 * UI-10 F1b. Destructive confirmation (Figma frames 19 and 33). The title
 * names exactly what happens ("End visit 3 of Whitechurch Lane - Hartcliffe?"),
 * the confirm button repeats the verb, and Cancel has the focus so Enter or
 * Escape never destroys anything by accident.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  useOverlayFocus(panelRef, open, onCancel);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-7">
      <div aria-hidden className="absolute inset-0 bg-scrim/45 motion-safe:animate-admin-fade-in" />
      <section
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-sm rounded-admin-sheet bg-surface p-5 pb-4 text-ink shadow-admin-sheet outline-none"
      >
        <h2 className="text-admin-title text-balance">{title}</h2>
        <p className="mt-2 text-admin-body text-pretty text-ink-soft">{body}</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button kind="danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
          <Button kind="secondary" onClick={onCancel} data-autofocus>
            Cancel
          </Button>
        </div>
      </section>
    </div>
  );
}
