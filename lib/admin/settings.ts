/**
 * UI-10 F5a (owner A35; frames 23, 24, dark 32; owner 2026-10-09: invite by
 * email through the owner's own SMTP, /signup removed). Settings: the visit
 * threshold, the logging default, Appearance, canvasser accounts and data
 * status.
 *
 * Pure: no React, no network. Checked by `npm run verify:ui10`.
 */

/** "60% worked" (frame 23). */
export function thresholdValue(pct: number): string {
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}% worked`;
}

/** The threshold sheet's input: a percentage from 0 to 100, or null. */
export function parseThreshold(text: string): number | null {
  const trimmed = text.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const pct = Number(trimmed);
  return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null;
}

export const THRESHOLD_ERROR = "Enter a percentage from 0 to 100.";

export type LoggingDefault = "every_door" | "exceptions";

/** Same labels as the field app's You tab (lib/field/logging-mode.ts). */
export const LOGGING_OPTIONS: ReadonlyArray<{ value: LoggingDefault; label: string; detail: string }> = [
  { value: "every_door", label: "Tap every door", detail: "Canvassers log every door they pass." },
  { value: "exceptions", label: "Exceptions only", detail: "Canvassers tap the doors that answer. Doors passed in between are marked Not in." },
];

/** Anything unexpected reads as the safe default (UI-8, owner U8-4). */
export function parseLoggingDefault(value: unknown): LoggingDefault {
  return value === "exceptions" ? "exceptions" : "every_door";
}

export function loggingLabel(value: LoggingDefault): string {
  return LOGGING_OPTIONS.find((option) => option.value === value)?.label ?? "Tap every door";
}

// ---- Canvasser accounts -----------------------------------------------------

export type CanvasserAccount = {
  id: string;
  /** First name only. */
  name: string;
  active: boolean;
  /** Open visits dated today or later with this person on the team. */
  plannedVisits: number;
};

/** Active first, then by name. */
export function sortAccounts(accounts: CanvasserAccount[]): CanvasserAccount[] {
  return [...accounts].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "en-GB"));
}

export function accountLine(account: Pick<CanvasserAccount, "active">): string {
  return account.active ? "Canvasser" : "Inactive · can't sign in";
}

/** Shown when switching someone off who is still on planned visits. */
export function plannedWarning(account: Pick<CanvasserAccount, "name" | "plannedVisits">): string | null {
  if (account.plannedVisits <= 0) return null;
  const visits = account.plannedVisits === 1 ? "1 planned visit" : `${account.plannedVisits} planned visits`;
  return `${account.name} is on ${visits}. They stay on the team until you remove them on Today.`;
}

export function toggleLabel(account: Pick<CanvasserAccount, "name" | "active">): string {
  return account.active ? `${account.name} can sign in` : `${account.name} can't sign in`;
}

// ---- Invite (frame 24) ---------------------------------------------------------

export type FieldCheck = { ok: true; value: string } | { ok: false; message: string };

/** Their first name: trimmed, single spaces, up to 40 characters. */
export function checkFirstName(raw: string): FieldCheck {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, message: "Add their first name." };
  if (value.length > 40) return { ok: false, message: "Use 40 characters or fewer." };
  return { ok: true, value };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

/** Frame 24: "Add the full address, like name@firsthome.co.uk". */
export function checkEmail(raw: string): FieldCheck {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: false, message: "Add their email address." };
  if (!EMAIL.test(value)) return { ok: false, message: "Add the full address, like name@firsthome.co.uk" };
  return { ok: true, value };
}

export function inviteButtonLabel(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first ? `Send invite to ${first}` : "Send invite";
}

export function inviteSentLine(email: string): string {
  return `Invite sent to ${email}. The link works once.`;
}

// ---- Data status -----------------------------------------------------------------

export type DataStatus = {
  ncczZones: number;
  properties: number | null;
  addressLabels: number | null;
  /** The latest load we can see: zones added or address labels updated. */
  lastLoadAt: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Oct 2026" (London). */
export function longDay(iso: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** Frame 23 Data rows. */
export function dataRows(status: DataStatus): Array<{ label: string; value: string }> {
  const n = (value: number | null) => (value === null ? "–" : value.toLocaleString("en-GB"));
  return [
    { label: "No Cold Calling zones", value: status.ncczZones > 0 ? `${n(status.ncczZones)} loaded` : "None loaded" },
    { label: "Properties", value: n(status.properties) },
    { label: "Address labels", value: n(status.addressLabels) },
    { label: "Last data load", value: status.lastLoadAt ? longDay(status.lastLoadAt) : "–" },
  ];
}

/** The later of two instants, either of which may be missing. */
export function latestOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Footer: "nakolabs-d2d · build 82c922c" when the deploy says which commit. */
export function buildLine(sha: string | null | undefined): string {
  const short = (sha ?? "").trim().slice(0, 7);
  return short ? `nakolabs-d2d · build ${short}` : "nakolabs-d2d";
}
