"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LeadsIcon, LoggerIcon, MapIcon, YouIcon } from "@/components/field/icons";

/**
 * TabItem — Figma node 7:80.
 *
 * "Bottom tab. Tabs: Map (was Home — owner decision 2026-09-27; the
 * existing Map tab), Logger, Leads, You (the existing Profile tab). Active
 * = prop colour + label; inactive = ink-muted (not opacity, for
 * sunlight). Whole cell is the tap target (≥44px)."
 *
 * Four real routes under one layout, bottom-anchored, inside the safe
 * area. The active tab is carried by a solid icon-plus-label colour, never
 * a tint or an opacity change — either disappears in direct sun (owner
 * decision 5 relabels "Profile" to "You"; the route is unchanged).
 */
const TABS = [
  { href: "/field", label: "Map", Icon: MapIcon },
  { href: "/field/logger", label: "Logger", Icon: LoggerIcon },
  { href: "/field/leads", label: "Leads", Icon: LeadsIcon },
  { href: "/field/profile", label: "You", Icon: YouIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="z-20 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      aria-label="Field sections"
      data-testid="field-tabs"
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = href === "/field" ? pathname === "/field" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            prefetch
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 text-field-tab-label ${
              active ? "text-prop" : "text-ink-muted"
            }`}
            data-testid={`field-tab-${label.toLowerCase()}`}
          >
            <Icon className="size-6" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
