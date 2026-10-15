"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { IconButton } from "@/components/admin/ui/icon-button";
import { MenuIcon } from "@/components/field/icons";
import { FieldDrawer } from "@/components/field/shell/field-drawer";

const OpenDrawerContext = createContext<() => void>(() => {});

/**
 * FUI-1a (owner 2026-10-14, O2). Holds the field drawer's open state. Pages
 * put <FieldMenuButton /> (inside FieldHeader) top-left, the same place as
 * admin's (A16). Rendered inside `.field-root`, so the drawer gets the field
 * tokens, Sora and dark mode.
 */
export function FieldShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // A back gesture changes the page under an open drawer: close it.
  useEffect(() => setOpen(false), [pathname]);
  const openDrawer = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);

  return (
    <OpenDrawerContext.Provider value={openDrawer}>
      {children}
      <FieldDrawer open={open} onClose={closeDrawer} />
    </OpenDrawerContext.Provider>
  );
}

export function FieldMenuButton() {
  const openDrawer = useContext(OpenDrawerContext);
  return (
    <IconButton label="Open menu" onClick={openDrawer} data-testid="field-menu">
      <MenuIcon className="size-6" />
    </IconButton>
  );
}
