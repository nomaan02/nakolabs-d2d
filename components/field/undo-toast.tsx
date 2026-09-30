"use client";

import { usePathname } from "next/navigation";

import { UndoButton } from "@/components/field/ui/undo-button";

/**
 * 2026-09-29 owner D5: the full-width toast is replaced by a 44px ring icon.
 *
 * The Logger paints its own button on the door panel. Every other field
 * route gets this one, top-right, clear of the territory name.
 */
export function FloatingUndo() {
  const pathname = usePathname();
  if (pathname.startsWith("/field/logger")) return null;

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-30">
      <div className="pointer-events-auto">
        <UndoButton />
      </div>
    </div>
  );
}
