"use client";

import { AccountRow, NavList, SignOutRow } from "@/components/admin/shell/nav-list";
import { IconButton } from "@/components/admin/ui/icon-button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/field/icons";
import type { AdminNavKey, RailState } from "@/lib/admin/nav";

/**
 * UI-10 F1c (owner A15; Figma D1, D2). Desktop navigation (lg and up): a left
 * rail, expanded 240px with labels or collapsed 64px with icons and
 * tooltips. The choice is remembered on this device.
 */
export function NavRail({
  state,
  onToggle,
  active,
  name,
}: {
  state: RailState;
  onToggle: () => void;
  active: AdminNavKey | null;
  name: string;
}) {
  const collapsed = state === "collapsed";
  return (
    <aside
      className={`hidden shrink-0 flex-col gap-3 border-r border-line bg-surface py-4 lg:flex ${
        collapsed ? "w-16 items-center px-2" : "w-60 px-3"
      }`}
    >
      <AccountRow name={name} compact={collapsed} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavList active={active} compact={collapsed} />
      </div>
      {collapsed ? null : <SignOutRow />}
      <div className={collapsed ? "" : "px-1"}>
        <IconButton label={collapsed ? "Expand menu" : "Collapse menu"} onClick={onToggle}>
          {collapsed ? (
            <ChevronRightIcon className="size-5 text-ink-muted" />
          ) : (
            <ChevronLeftIcon className="size-5 text-ink-muted" />
          )}
        </IconButton>
      </div>
    </aside>
  );
}
