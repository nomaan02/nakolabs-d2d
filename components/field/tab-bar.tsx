"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Four real routes under one layout. Bottom-anchored, inside the safe area,
 * with the active tab carried by a solid fill and a label rather than by a
 * tint — an outline or a pastel highlight disappears in direct sun.
 */

const TABS = [
  { href: "/field", label: "Map", glyph: "◉" },
  { href: "/field/logger", label: "Logger", glyph: "▤" },
  { href: "/field/leads", label: "Leads", glyph: "★" },
  { href: "/field/profile", label: "Profile", glyph: "☖" },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="z-20 grid grid-cols-4 border-t border-ink/15 bg-paper pb-[env(safe-area-inset-bottom)]"
      aria-label="Field sections"
      data-testid="field-tabs"
    >
      {TABS.map((tab) => {
        const active = tab.href === "/field" ? pathname === "/field" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-medium ${
              active ? "bg-ink text-paper" : "text-ink"
            }`}
          >
            <span aria-hidden className="text-base leading-none">
              {tab.glyph}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
