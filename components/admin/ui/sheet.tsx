"use client";

import { useRef, type ReactNode } from "react";

import { CloseIcon } from "@/components/field/icons";
import { IconButton } from "@/components/admin/ui/icon-button";
import { useOverlayFocus } from "@/components/admin/ui/use-overlay-focus";

/**
 * UI-10 F1b. Modal sheet: slides up on a phone, a centred panel on desktop.
 * For tasks under ~10 s (visit sheet, invite, day overlay). Map sheets with
 * peek / half / full heights are a separate component (F2).
 * Scrim uses the `scrim` token (it stays dark in dark mode).
 */
export function Sheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling body: the sheet's main action. */
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  useOverlayFocus(panelRef, open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end lg:items-center lg:justify-center lg:p-6">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-scrim/40 motion-safe:animate-admin-fade-in"
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full flex-col rounded-t-admin-sheet bg-surface text-ink shadow-admin-sheet outline-none motion-safe:animate-admin-sheet-in lg:max-h-[85dvh] lg:max-w-lg lg:rounded-admin-sheet"
      >
        <div aria-hidden className="flex justify-center pt-2 pb-1 lg:hidden">
          <span className="h-1.5 w-9 rounded-full bg-ink-faint" />
        </div>
        <header className="flex items-start gap-2 pr-2 pl-5 pt-1 pb-3 lg:pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-admin-title text-balance">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-admin-subhead text-ink-muted">{subtitle}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon className="size-6" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">{children}</div>
        {footer ? (
          <div className="border-t border-line px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>
        ) : null}
      </section>
    </div>
  );
}
