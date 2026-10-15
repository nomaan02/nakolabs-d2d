/**
 * FUI-1a (owner 2026-10-14, O2; Figma "Field — UI fixes (14 Oct)", frame
 * 05). The field drawer: a full map of the app. The four bottom tabs stay.
 * "My results" and "Leaderboard" only appear for an account linked to the
 * CRM (the P4b views); "Open admin" only for an admin who went canvassing.
 */
export type FieldNavKey = "map" | "logger" | "leads" | "week" | "callbacks" | "you" | "results" | "leaderboard";

export type FieldNavItem = {
  key: FieldNavKey;
  label: string;
  href: string;
  group: "today" | "you";
  /** Shown only when the account is linked to the CRM. */
  crmOnly?: boolean;
};

export const FIELD_NAV: readonly FieldNavItem[] = [
  { key: "map", label: "Map", href: "/field", group: "today" },
  { key: "logger", label: "Logger", href: "/field/logger", group: "today" },
  { key: "leads", label: "Leads", href: "/field/leads", group: "today" },
  { key: "week", label: "This week", href: "/field/leads", group: "today", crmOnly: true },
  { key: "callbacks", label: "Call-backs", href: "/field/leads", group: "today" },
  { key: "you", label: "You", href: "/field/profile", group: "you" },
  { key: "results", label: "My results", href: "/field/profile#my-results", group: "you", crmOnly: true },
  { key: "leaderboard", label: "Leaderboard", href: "/field/profile/leaderboard", group: "you", crmOnly: true },
];

/** Which drawer item is the current page. Call-backs is a view inside Leads, so Leads lights up. */
export function activeFieldNav(pathname: string): FieldNavKey | null {
  if (pathname === "/field") return "map";
  if (pathname.startsWith("/field/logger")) return "logger";
  if (pathname.startsWith("/field/leads")) return "leads";
  if (pathname.startsWith("/field/profile/leaderboard")) return "leaderboard";
  if (pathname.startsWith("/field/profile")) return "you";
  return null;
}

export type LeadsView = "today" | "week" | "callbacks";

/** The Leads tab's remembered view (CRM-5 C). */
export const LEADS_VIEW_KEY = "d2d.leads.view";
const LEADS_VIEW_EVENT = "d2d:leads-view";

export function parseLeadsView(value: string | null): LeadsView {
  return value === "callbacks" || value === "week" ? value : "today";
}

/**
 * The drawer's Leads, This week and Call-backs items open the Leads tab on that view.
 * Stored first, so a Leads tab that mounts next reads it; the event moves a
 * Leads tab that is already open.
 */
export function requestLeadsView(view: LeadsView): void {
  try {
    window.localStorage.setItem(LEADS_VIEW_KEY, view);
  } catch {
    // Private mode: the event below still switches an open tab.
  }
  window.dispatchEvent(new CustomEvent<LeadsView>(LEADS_VIEW_EVENT, { detail: view }));
}

/** Subscribe to drawer requests. Returns the unsubscribe function. */
export function onLeadsViewRequest(handler: (view: LeadsView) => void): () => void {
  const listener = (event: Event) => {
    if (event instanceof CustomEvent) handler(parseLeadsView(String(event.detail)));
  };
  window.addEventListener(LEADS_VIEW_EVENT, listener);
  return () => window.removeEventListener(LEADS_VIEW_EVENT, listener);
}
