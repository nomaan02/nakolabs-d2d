"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { NavDrawer } from "@/components/admin/shell/nav-drawer";
import { NavRail } from "@/components/admin/shell/nav-rail";
import { IconButton } from "@/components/admin/ui/icon-button";
import { MenuIcon } from "@/components/field/icons";
import {
  RAIL_STORAGE_KEY,
  activeNavKey,
  isDarkReady,
  parseRailState,
  type RailState,
} from "@/lib/admin/nav";

const OpenDrawerContext = createContext<() => void>(() => {});

/**
 * UI-10 F1c. The admin frame around every /admin page: the desktop rail, the
 * phone drawer, Sora, and the shared theme. Pages own their own header and
 * put <AdminMenuButton /> in its top-left corner (hidden on desktop, where
 * the rail is always there).
 */
export function AdminShell({
  name,
  fontClassName,
  children,
}: {
  name: string;
  /** next/font variable class that defines --font-sora. */
  fontClassName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = activeNavKey(pathname);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rail, setRail] = useState<RailState>("expanded");

  useEffect(() => {
    try {
      setRail(parseRailState(localStorage.getItem(RAIL_STORAGE_KEY)));
    } catch {
      // Storage blocked: stay expanded for this visit.
    }
  }, []);

  const toggleRail = useCallback(() => {
    setRail((current) => {
      const next: RailState = current === "expanded" ? "collapsed" : "expanded";
      try {
        localStorage.setItem(RAIL_STORAGE_KEY, next);
      } catch {
        // Storage blocked: the choice still applies until reload.
      }
      return next;
    });
  }, []);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <OpenDrawerContext.Provider value={openDrawer}>
      <div
        data-admin-dark={isDarkReady(pathname) ? undefined : "off"}
        className={`${fontClassName} admin-root flex h-dvh overflow-hidden bg-field-bg pt-[env(safe-area-inset-top)] font-body text-ink antialiased`}
      >
        <NavRail state={rail} onToggle={toggleRail} active={active} name={name} />
        <div className="relative min-w-0 flex-1 overflow-y-auto">{children}</div>
        <NavDrawer open={drawerOpen} onClose={closeDrawer} active={active} name={name} />
      </div>
    </OpenDrawerContext.Provider>
  );
}

/** Top-left of every admin page header on a phone (A16). Hidden on desktop. */
export function AdminMenuButton({ floating = false }: { floating?: boolean }) {
  const openDrawer = useContext(OpenDrawerContext);
  return (
    <IconButton label="Open menu" kind={floating ? "floating" : "plain"} onClick={openDrawer} className="lg:hidden">
      <MenuIcon className="size-6" />
    </IconButton>
  );
}
