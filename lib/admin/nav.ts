/**
 * UI-10 F1a (owner A14-A16, A39, A50; 2026-10-06). The admin navigation:
 * one list drives the phone drawer and the desktop rail.
 *
 * Pure: no React, no browser API, no network. Checked by `npm run verify:ui10`.
 *
 * Items appear here only once their page exists. Later phases change an
 * item's `href` when its new page lands (A50: old routes redirect, then go).
 */

export type AdminIconName =
  | "today"
  | "calendar"
  | "props"
  | "team"
  | "leads"
  | "coverage"
  | "insights"
  | "allocate"
  | "canvass"
  | "settings";

export type AdminNavKey = AdminIconName;

export type AdminNavItem = {
  key: AdminNavKey;
  label: string;
  href: string;
  icon: AdminIconName;
  /** "main" sits at the top; "tools" sits under the divider. */
  group: "main" | "tools";
  /** Match only this exact path, never its children (the old `/admin` draw page). */
  exact?: boolean;
};

/** A13: the branch slot. Fixed until a second branch exists. */
export const BRANCH_LABEL = "Bristol";

/**
 * F2 state. Today points at the old dashboard (it carries the Live now panel)
 * until F3; Props is the new full-screen map (F2); Allocate is a temporary
 * item that F3 removes (allocating moves into Today, A24).
 */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { key: "today", label: "Today", href: "/admin/dashboard", icon: "today", group: "main" },
  { key: "props", label: "Props", href: "/admin/props", icon: "props", group: "main" },
  { key: "allocate", label: "Allocate", href: "/admin/allocate", icon: "allocate", group: "main" },
  { key: "coverage", label: "Coverage", href: "/admin/coverage", icon: "coverage", group: "main" },
  { key: "settings", label: "Settings", href: "/admin/settings", icon: "settings", group: "tools" },
];

function matches(item: AdminNavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  if (item.exact) return false;
  return pathname.startsWith(`${item.href}/`);
}

/** The item for this pathname: the longest matching href wins. Null when none match. */
export function activeNavKey(
  pathname: string,
  items: readonly AdminNavItem[] = ADMIN_NAV,
): AdminNavKey | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: AdminNavItem | null = null;
  for (const item of items) {
    if (!matches(item, path)) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best ? best.key : null;
}

export function navGroups(items: readonly AdminNavItem[] = ADMIN_NAV): {
  main: AdminNavItem[];
  tools: AdminNavItem[];
} {
  return {
    main: items.filter((item) => item.group === "main"),
    tools: items.filter((item) => item.group === "tools"),
  };
}

/** A15: the desktop rail is expanded (240) or collapsed (64), remembered per device. */
export type RailState = "expanded" | "collapsed";

export const RAIL_STORAGE_KEY = "d2d.admin.rail";

export function parseRailState(value: string | null | undefined): RailState {
  return value === "collapsed" ? "collapsed" : "expanded";
}

/**
 * A28 (dark mode now) without breaking the old pages: dark tokens apply only
 * to pages rebuilt in the new design. Each phase adds its routes here; until
 * then the old "worksheet" pages stay light.
 */
export const DARK_READY_PATHS: readonly string[] = ["/admin/props"];

export function isDarkReady(
  pathname: string,
  readyPaths: readonly string[] = DARK_READY_PATHS,
): boolean {
  return readyPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** First letter of a name for the avatar; "?" when there is nothing usable. */
export function initialOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().charAt(0);
  return first ? first.toLocaleUpperCase("en-GB") : "?";
}

/**
 * Where a prop's "Open visit" goes. F2: the old allocate page for that prop
 * (it manages the visit's team and route). F3 points this at the visit sheet
 * on Today (A26).
 */
export function visitHref(propId: string): string {
  return `/admin/allocate?prop=${encodeURIComponent(propId)}`;
}

/** Prop detail's "Show on Coverage" (frame 06). */
export function coverageHref(propId: string): string {
  return `/admin/coverage?prop=${encodeURIComponent(propId)}`;
}
