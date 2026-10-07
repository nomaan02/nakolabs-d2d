/**
 * Inline SVG icon components for the field app (amendment 3, UI item 1
 * Logger rebuild). Every icon is a single React component using
 * `currentColor` — colour comes only from the caller's `text-*` token
 * class (e.g. `text-prop`, `text-ink-muted`), so there is never an
 * active/inactive pair of the same glyph baked in two colours.
 *
 * Paths were exported once from Figma (file EHxBRxJZGVAU1MuSU59RTH) via
 * `get_design_context` asset URLs, fetched to a temp folder, and copied in
 * here with `stroke`/`fill` rewritten from the exported hex to
 * `currentColor`. The Figma root `width`, `height` and `viewBox` are kept
 * unchanged. No Figma URL, `<img>` or PNG remains in this file.
 *
 * This session (B1) only needed the icons used by the in-scope primitives:
 * TabItem (Map, Logger, Leads, You) and NoteBar (Note, Caret). IdChip's
 * sync dot is drawn with `StatusDot` rather than downloaded, because the
 * exported asset was a plain filled circle with no path detail worth
 * preserving — a `currentColor` circle is pixel-identical and avoids a
 * fourth near-duplicate SVG for the four sync states.
 *
 * Star, Speech, House, HouseOutline and Chevron (Session B2) are the
 * OutcomeButton glyphs, exported the same way from Figma node 6:58.
 */

import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

/** TabItem "Map" glyph — the existing Map tab. Figma node 7:42/7:46. */
export function MapIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15 6L9 3L3 6V21L9 18M9 3V18M9 18L15 21L21 18V3L15 6M15 6V21"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** TabItem "Logger" glyph — a compass. Figma node 7:50/7:55. */
export function LoggerIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="23.7731"
      height="23.7731"
      viewBox="0 0 23.7731 23.7731"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11.8863 20.8015C16.8099 20.8015 20.8012 16.8102 20.8012 11.8866C20.8012 6.96306 16.8099 2.97172 11.8863 2.97172C6.96276 2.97172 2.97142 6.96306 2.97142 11.8866C2.97142 16.8102 6.96276 20.8015 11.8863 20.8015Z"
        stroke="currentColor"
        strokeWidth="1.68393"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.8578 8.9149L10.4 10.4008L8.91412 14.8586L13.3719 13.3726L14.8578 8.9149Z"
        stroke="currentColor"
        strokeWidth="1.68393"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** TabItem "Leads" glyph — a document list. Figma node 7:60/7:65. */
export function LeadsIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="23.7731"
      height="23.7731"
      viewBox="0 0 23.7731 23.7731"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M17.83 2.97172H5.9435C4.84938 2.97172 3.96241 3.85869 3.96241 4.95281V18.8204C3.96241 19.9146 4.84938 20.8015 5.9435 20.8015H17.83C18.9242 20.8015 19.8111 19.9146 19.8111 18.8204V4.95281C19.8111 3.85869 18.9242 2.97172 17.83 2.97172Z"
        stroke="currentColor"
        strokeWidth="1.68393"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.9145 7.92429H14.8582M8.9145 11.8867H14.8582M8.9145 15.8492H11.8863"
        stroke="currentColor"
        strokeWidth="1.68393"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** TabItem "You" glyph — the existing Profile tab. Figma node 7:70/7:75. */
export function YouIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="23.7731"
      height="23.7731"
      viewBox="0 0 23.7731 23.7731"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11.8867 11.3914C13.8016 11.3914 15.3538 9.83914 15.3538 7.92429C15.3538 6.00944 13.8016 4.45716 11.8867 4.45716C9.97186 4.45716 8.41957 6.00944 8.41957 7.92429C8.41957 9.83914 9.97186 11.3914 11.8867 11.3914Z"
        stroke="currentColor"
        strokeWidth="1.68393"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.9534 19.8111C4.9534 17.972 5.68398 16.2083 6.98441 14.9079C8.28483 13.6074 10.0486 12.8769 11.8877 12.8769C13.7268 12.8769 15.4905 13.6074 16.7909 14.9079C18.0914 16.2083 18.8219 17.972 18.8219 19.8111"
        stroke="currentColor"
        strokeWidth="1.68393"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** NoteBar's pencil glyph, inside the round chip on the left. Figma 7:35. */
export function NoteIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="15.8498"
      height="15.8498"
      viewBox="0 0 15.8498 15.8498"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7.92471 13.207H13.868M10.8963 2.31108C11.159 2.04837 11.5154 1.90078 11.8869 1.90078C12.2584 1.90078 12.6147 2.04837 12.8774 2.31108C13.1401 2.57379 13.2877 2.9301 13.2877 3.30162C13.2877 3.67315 13.1401 4.02946 12.8774 4.29216L4.6229 12.5467L1.98145 13.207L2.64182 10.5656L10.8963 2.31108Z"
        stroke="currentColor"
        strokeWidth="1.18865"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * NoteBar's trailing caret, up by default (Figma shows the closed/expand
 * state). Rotate 180deg via a wrapper class to point down when open.
 * Figma node 7:38.
 */
export function CaretIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="17.8199"
      height="17.8199"
      viewBox="0 0 17.8199 17.8199"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13.3641 11.1375L8.90911 6.68254L4.45413 11.1375"
        stroke="currentColor"
        strokeWidth="1.33649"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * IdChip's sync-state dot (Sent/Pending/Offline/Failed). A plain filled
 * circle, drawn rather than downloaded — the four exported Figma assets
 * were indistinguishable other than fill colour, so one `currentColor`
 * circle plus a `text-*` class on the caller replaces all four without a
 * fourth near-duplicate asset. Figma node 7:31 (and its Sync= variants).
 */
export function StatusDot({ className }: IconProps) {
  return (
    <svg aria-hidden className={className} width="8" height="8" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

/** OutcomeButton "Lead" glyph. Figma node 6:4. */
export function StarIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="21.0869"
      height="21.0869"
      viewBox="0 0 21.0869 21.0869"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10.1042 3.07529L12.3007 7.4684L17.1331 8.1713L13.6186 11.5979L14.4533 16.4304L10.1042 14.1459L5.75498 16.4304L6.58967 11.5979L3.07518 8.1713L7.9076 7.4684L10.1042 3.07529Z"
        stroke="currentColor"
        strokeWidth="0.99061"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** OutcomeButton "Contact" glyph — a speech bubble. Figma node 6:16. */
export function SpeechIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="21.0869"
      height="21.0869"
      viewBox="0 0 21.0869 21.0869"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M18.4514 13.179C18.4514 13.645 18.2662 14.092 17.9367 14.4215C17.6071 14.7511 17.1602 14.9362 16.6941 14.9362H6.15064L2.63615 18.4507V4.39275C2.63615 3.9267 2.82128 3.47973 3.15083 3.15019C3.48038 2.82064 3.92734 2.6355 4.39339 2.6355H16.6941C17.1602 2.6355 17.6071 2.82064 17.9367 3.15019C18.2662 3.47973 18.4514 3.9267 18.4514 4.39275V13.179Z"
        stroke="currentColor"
        strokeWidth="0.99061"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** OutcomeButton "Rented / Council" glyph — a block with windows. Figma node 6:28. */
export function HouseIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="21.0869"
      height="21.0869"
      viewBox="0 0 21.0869 21.0869"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2.63615 18.4509H18.4514" stroke="currentColor" strokeWidth="1.49366" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M4.39293 18.451V7.02886L10.5433 3.51437L16.6936 7.02886V18.451"
        stroke="currentColor"
        strokeWidth="1.49366"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.90747 18.451V14.9366H13.1792V18.451M7.90747 10.5434H7.91626M13.1792 10.5434H13.188"
        stroke="currentColor"
        strokeWidth="1.49366"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** OutcomeButton "Not In" glyph — a house struck through. Figma node 6:44. */
export function HouseOutlineIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="21.0869"
      height="21.0869"
      viewBox="0 0 21.0869 21.0869"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3.51475 18.451V7.90756L10.5437 3.51444L17.5727 7.90756V18.451"
        stroke="currentColor"
        strokeWidth="1.49366"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.90768 18.4509V13.1792H13.1794V18.4509"
        stroke="currentColor"
        strokeWidth="1.49366"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        opacity="0.55"
        d="M3.51475 3.51444L17.5727 17.5724"
        stroke="currentColor"
        strokeWidth="1.49366"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * OutcomeButton's trailing chevron. Exported pointing left; Figma rotates
 * it 180deg, so callers add `rotate-180` for the pill's right-pointing form.
 * Figma node 6:7.
 */
export function ChevronIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="10.5496"
      height="19.4651"
      viewBox="0 0 10.5496 19.4651"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9.73257 18.6481L0.817075 9.73257L9.73257 0.817075"
        stroke="currentColor"
        strokeWidth="1.63415"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Turn instruction on the Logger status line. UI item 1b, 2026-09-29. */
export function TurnIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

/** Undo control. Drawn here for Session G2. */
export function UndoIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

/** UI-6 B1. Recentre on the current door: a target with a centre dot. */
export function LocateIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <path d="M12 2V5M12 19V22M2 12H5M19 12H22" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/*
 * UI-10 F1b (2026-10-06): admin icons. Same grammar as the field set: 24px
 * grid, 1.7 stroke, round caps and joins, `currentColor`. Figma: page
 * 40:289, section "Admin / UI-10 — Components" (icon/*).
 */
function StrokeIcon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </StrokeIcon>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </StrokeIcon>
  );
}

export function TodayIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4" />
    </StrokeIcon>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </StrokeIcon>
  );
}

export function AllocateIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17M12 13v5M9.5 15.5h5" />
    </StrokeIcon>
  );
}

export function TeamIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 19.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5M15.5 5.3a2.9 2.9 0 0 1 0 5.4M17.5 14.6c2 .5 3.4 2.1 4 4.9" />
    </StrokeIcon>
  );
}

export function CoverageIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="6" cy="6" r="1.6" fill="currentColor" />
      <circle cx="12" cy="6" r="1.6" fill="currentColor" />
      <circle cx="18" cy="6" r="1.6" />
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
      <circle cx="6" cy="18" r="1.6" />
      <circle cx="12" cy="18" r="1.6" />
      <circle cx="18" cy="18" r="1.6" />
    </StrokeIcon>
  );
}

export function InsightsIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M5 20V12M10 20V5M15 20v-7M20 20V9" />
    </StrokeIcon>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </StrokeIcon>
  );
}

export function CanvassIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M6.5 21V4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21M3.5 21h17" />
      <circle cx="14.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function SignOutIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14M10 8l-4 4 4 4M6 12h10" />
    </StrokeIcon>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 5v14M5 12h14" />
    </StrokeIcon>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M14.5 6l-6 6 6 6" />
    </StrokeIcon>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M9.5 6l6 6-6 6" />
    </StrokeIcon>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M6 9.5l6 6 6-6" />
    </StrokeIcon>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </StrokeIcon>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
      <path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
    </StrokeIcon>
  );
}

export function DrawIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M5 19l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L9.5 18z" />
      <path d="M13.8 6.7l3.5 3.5" />
    </StrokeIcon>
  );
}

export function RedoIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M20 7v5.5h-5.5" />
      <path d="M4 17a8.5 8.5 0 0 1 14.6-5.9l1.4 1.4" />
    </StrokeIcon>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </StrokeIcon>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function WarningIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M10.3 4.8a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z" />
      <path d="M12 9.5v4" />
      <circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function RouteIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" />
    </StrokeIcon>
  );
}

export function LiveIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" />
    </StrokeIcon>
  );
}

export function InfoIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function MailIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M4.5 7.5l7.5 5.5 7.5-5.5" />
    </StrokeIcon>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </StrokeIcon>
  );
}

/** UI-10 F2b: zoom out on the desktop map. */
export function MinusIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M5 12h14" />
    </StrokeIcon>
  );
}

/** UI-10 F2b: frame every prop (four corners). Admin has no "my location". */
export function FitIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4.5 9V5.5a1 1 0 0 1 1-1H9M15 4.5h3.5a1 1 0 0 1 1 1V9M19.5 15v3.5a1 1 0 0 1-1 1H15M9 19.5H5.5a1 1 0 0 1-1-1V15" />
    </StrokeIcon>
  );
}
