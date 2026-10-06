/**
 * UI-10: browser-free checks for the admin redesign's pure logic.
 * F1a: lib/admin/nav.ts. Later phases append their own blocks.
 *
 *   npm run verify:ui10
 */
import {
  ADMIN_NAV,
  activeNavKey,
  initialOf,
  isDarkReady,
  navGroups,
  parseRailState,
  type AdminNavItem,
} from "../lib/admin/nav";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

// --- F1a: nav ---

const keys = ADMIN_NAV.map((item) => item.key);
const hrefs = ADMIN_NAV.map((item) => item.href);
check("nav keys are unique", new Set(keys).size === keys.length, keys.join(","));
check("nav hrefs are unique", new Set(hrefs).size === hrefs.length, hrefs.join(","));
check(
  "every href is an admin route",
  ADMIN_NAV.every((item) => item.href === "/admin" || item.href.startsWith("/admin/")),
);
check(
  "labels are sentence case and non-empty",
  ADMIN_NAV.every((item) => /^[A-Z][a-z]+( [a-z]+)*$/.test(item.label)),
  ADMIN_NAV.map((item) => item.label).join(","),
);
check("Today is the first item", ADMIN_NAV[0]?.key === "today");

const cases: Array<[string, string | null]> = [
  ["/admin", "props"],
  ["/admin/", "props"],
  ["/admin/dashboard", "today"],
  ["/admin/allocate", "allocate"],
  ["/admin/allocate/anything", "allocate"],
  ["/admin/coverage", "coverage"],
  ["/admin/settings", "settings"],
  ["/admin/unknown", null],
  ["/field", null],
  ["/administrator", null],
];
for (const [path, expected] of cases) {
  const got = activeNavKey(path);
  check(`active item for ${path}`, got === expected, `got ${String(got)}`);
}

// Longest prefix wins, and `exact` stops a parent swallowing its children.
const nested: AdminNavItem[] = [
  { key: "today", label: "Today", href: "/admin/today", icon: "today", group: "main" },
  { key: "calendar", label: "Calendar", href: "/admin/today/calendar", icon: "calendar", group: "main" },
  { key: "props", label: "Props", href: "/admin", icon: "props", group: "main", exact: true },
];
check("longest prefix wins", activeNavKey("/admin/today/calendar/2026-10", nested) === "calendar");
check("parent still matches its own children", activeNavKey("/admin/today/add", nested) === "today");
check("exact item does not match children", activeNavKey("/admin/team", nested) === null);

const groups = navGroups();
check(
  "groups split main and tools",
  groups.main.length + groups.tools.length === ADMIN_NAV.length &&
    groups.tools.every((item) => item.group === "tools"),
);

check("rail defaults to expanded", parseRailState(null) === "expanded");
check("rail reads collapsed", parseRailState("collapsed") === "collapsed");
check("rail ignores junk", parseRailState("sideways") === "expanded");

check("initial of a name", initialOf("nomaan") === "N");
check("initial trims spaces", initialOf("  ada ") === "A");
check("initial of nothing", initialOf(null) === "?" && initialOf("   ") === "?");

check("old pages stay light in F1", !isDarkReady("/admin/dashboard") && !isDarkReady("/admin"));
check("a ready path and its children go dark", isDarkReady("/admin/today/add", ["/admin/today"]));
check("a ready path does not leak to siblings", !isDarkReady("/admin/todays", ["/admin/today"]));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
