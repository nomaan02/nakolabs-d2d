"use client";

import { useRef, type TouchEvent } from "react";

import { AppearanceControl } from "@/components/admin/shell/appearance";
import { AccountRow, NavList, SignOutRow } from "@/components/admin/shell/nav-list";
import { IconButton } from "@/components/admin/ui/icon-button";
import { useOverlayFocus } from "@/components/admin/ui/use-overlay-focus";
import { CloseIcon } from "@/components/field/icons";
import type { AdminNavKey } from "@/lib/admin/nav";

/** A swipe this far left (px) closes the drawer. */
const SWIPE_CLOSE_PX = 60;

/**
 * UI-10 F1c (owner A14, A16; Figma frame 02). Phone navigation: an overlay
 * drawer from the left, about 85% wide. The scrim, the close button, Escape,
 * a left swipe and picking an item all close it. There is no edge-swipe to
 * open: it would fight map panning and iOS Back.
 */
export function NavDrawer({
  open,
  onClose,
  active,
  name,
}: {
  open: boolean;
  onClose: () => void;
  active: AdminNavKey | null;
  name: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const startX = useRef<number | null>(null);
  useOverlayFocus(panelRef, open, onClose);
  if (!open) return null;

  const onTouchStart = (event: TouchEvent) => {
    startX.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = startX.current;
    const end = event.changedTouches[0]?.clientX;
    startX.current = null;
    if (start !== null && end !== undefined && start - end > SWIPE_CLOSE_PX) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-scrim/40 motion-safe:animate-admin-fade-in"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="absolute inset-y-0 left-0 flex w-[85%] max-w-82 flex-col gap-2 rounded-r-admin-sheet bg-surface px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[max(1rem,env(safe-area-inset-bottom))] text-ink shadow-admin-sheet outline-none motion-safe:animate-admin-drawer-in"
      >
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <AccountRow name={name} />
          </div>
          <IconButton label="Close menu" onClick={onClose}>
            <CloseIcon className="size-6" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavList active={active} onNavigate={onClose} />
        </div>
        <AppearanceControl />
        <SignOutRow />
      </div>
    </div>
  );
}
