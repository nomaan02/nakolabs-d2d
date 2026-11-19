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

/** RT-3 (Figma icon/erase). The erase tool on the route drawing toolbar. */
export function EraseIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M7 20 3.3 16.3a1.8 1.8 0 0 1 0-2.6l9.4-9.4a1.8 1.8 0 0 1 2.6 0l4.4 4.4a1.8 1.8 0 0 1 0 2.6L12 19" />
      <path d="M7 20h13" />
      <path d="m8.5 8.5 7 7" />
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

/** CRM-5 C: ring a call-back lead. */
export function PhoneIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M6.6 3.8h2.6l1.4 3.6-1.9 1.3a10.6 10.6 0 0 0 6.6 6.6l1.3-1.9 3.6 1.4v2.6a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.6 6a2 2 0 0 1 2-2.2z" />
    </StrokeIcon>
  );
}

/** CRM-5 C: You → Leaderboard. */
export function TrophyIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M8 4.5h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 6.5H5.5a2.5 2.5 0 0 0 2.6 3.4" />
      <path d="M16 6.5h2.5a2.5 2.5 0 0 1-2.6 3.4" />
      <path d="M12 13.5v3.5" />
      <path d="M8.5 19.5h7" />
    </StrokeIcon>
  );
}

/**
 * DIAL-1 (Logger V2.1). The V2 line icons, exported as SVG from Figma
 * (Icon/Lead 310:293, Icon/Contact 310:296, Icon/NotIn 310:301, Icon/Rented
 * 310:305, Icon/Note 310:309, Icon/Undo 310:313, Icon/Check 310:316,
 * Icon/Queued 324:814) with the hex stroke rewritten to `currentColor`.
 * One stroke rule (Figma V2.1): 1.75 at 20-24 px, 1.5 at 16 px, 2 when
 * reversed out of a colour fill. Callers pass the size's stroke.
 */
type LineIconProps = IconProps & { stroke?: number };

function LineIcon({ className, stroke = 1.75, children }: LineIconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

/** Lead. Figma Icon/Lead 310:293. */
export function StarLineIcon(props: LineIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M11.525 2.29502C11.5688 2.20648 11.6365 2.13195 11.7205 2.07984C11.8044 2.02773 11.9012 2.00012 12 2.00012C12.0988 2.00012 12.1956 2.02773 12.2795 2.07984C12.3635 2.13195 12.4312 2.20648 12.475 2.29502L14.785 6.97402C14.9372 7.28198 15.1618 7.54842 15.4396 7.75047C15.7174 7.95251 16.0401 8.08413 16.38 8.13402L21.546 8.89002C21.6439 8.9042 21.7358 8.94549 21.8115 9.00921C21.8871 9.07294 21.9434 9.15656 21.974 9.25062C22.0046 9.34468 22.0083 9.44542 21.9846 9.54145C21.9609 9.63748 21.9108 9.72497 21.84 9.79402L18.104 13.432C17.8576 13.6721 17.6733 13.9685 17.5668 14.2956C17.4604 14.6228 17.4351 14.9709 17.493 15.31L18.375 20.45C18.3923 20.5479 18.3817 20.6486 18.3445 20.7407C18.3073 20.8328 18.2449 20.9126 18.1645 20.971C18.0842 21.0294 17.989 21.064 17.8899 21.0709C17.7908 21.0778 17.6917 21.0567 17.604 21.01L12.986 18.582C12.6817 18.4222 12.3432 18.3388 11.9995 18.3388C11.6558 18.3388 11.3173 18.4222 11.013 18.582L6.396 21.01C6.30833 21.0564 6.2094 21.0773 6.11045 21.0703C6.0115 21.0632 5.91652 21.0286 5.83629 20.9702C5.75607 20.9119 5.69383 20.8322 5.65666 20.7402C5.61948 20.6483 5.60886 20.5477 5.626 20.45L6.507 15.311C6.5652 14.9717 6.53998 14.6234 6.43354 14.2961C6.32709 13.9687 6.14261 13.6722 5.896 13.432L2.16 9.79502C2.08859 9.72605 2.03799 9.63841 2.01396 9.54209C1.98993 9.44577 1.99344 9.34463 2.02408 9.25021C2.05472 9.15578 2.11127 9.07186 2.18728 9.008C2.26329 8.94414 2.3557 8.90291 2.454 8.88902L7.619 8.13402C7.95926 8.08451 8.28239 7.95307 8.56058 7.751C8.83878 7.54893 9.0637 7.28229 9.216 6.97402L11.525 2.29502Z" />
    </LineIcon>
  );
}

/** Contact. Figma Icon/Contact 310:296. */
export function MessageLineIcon(props: LineIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" />
    </LineIcon>
  );
}

/** Not in. Figma Icon/NotIn 310:301. */
export function DoorLineIcon(props: LineIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M18 20V6C18 5.46957 17.7893 4.96086 17.4142 4.58579C17.0391 4.21071 16.5304 4 16 4H8C7.46957 4 6.96086 4.21071 6.58579 4.58579C6.21071 4.96086 6 5.46957 6 6V20" />
      <path d="M2 20H22" />
      <path d="M14 12V12.01" />
    </LineIcon>
  );
}

/** Rented / council. Figma Icon/Rented 310:305. */
export function KeyLineIcon(props: LineIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M2.586 17.414C2.2109 17.789 2.00011 18.2976 2 18.828V21C2 21.2653 2.10536 21.5196 2.29289 21.7071C2.48043 21.8947 2.73478 22 3 22H6C6.26522 22 6.51957 21.8947 6.70711 21.7071C6.89464 21.5196 7 21.2653 7 21V20C7 19.7348 7.10536 19.4805 7.29289 19.2929C7.48043 19.1054 7.73478 19 8 19H9C9.26522 19 9.51957 18.8947 9.70711 18.7071C9.89464 18.5196 10 18.2653 10 18V17C10 16.7348 10.1054 16.4805 10.2929 16.2929C10.4804 16.1054 10.7348 16 11 16H11.172C11.7024 15.9999 12.211 15.7891 12.586 15.414L13.4 14.6C14.7898 15.0842 16.3028 15.0823 17.6915 14.5948C19.0801 14.1072 20.2622 13.1629 21.0444 11.9162C21.8265 10.6695 22.1624 9.19421 21.9971 7.73178C21.8318 6.26934 21.1751 4.90629 20.1344 3.86561C19.0937 2.82493 17.7307 2.16822 16.2683 2.00293C14.8058 1.83763 13.3306 2.17353 12.0839 2.95568C10.8372 3.73782 9.89279 4.91991 9.40525 6.30856C8.91771 7.69721 8.91585 9.2102 9.4 10.6L2.586 17.414Z" />
      <path d="M16.5 8.10002C16.8314 8.10002 17.1 7.8314 17.1 7.50002C17.1 7.16865 16.8314 6.90002 16.5 6.90002C16.1686 6.90002 15.9 7.16865 15.9 7.50002C15.9 7.8314 16.1686 8.10002 16.5 8.10002Z" fill="currentColor" />
    </LineIcon>
  );
}

/** Add a note to the current door. Figma Icon/Note 310:309. */
export function PencilLineIcon(props: LineIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M12 20H21" />
      <path d="M16.376 3.62198C16.7741 3.22389 17.314 3.00024 17.877 3.00024C18.44 3.00024 18.9799 3.22389 19.378 3.62198C19.7761 4.02007 19.9997 4.55999 19.9997 5.12298C19.9997 5.68596 19.7761 6.22589 19.378 6.62398L7.36801 18.635C7.1301 18.8729 6.83603 19.0469 6.51301 19.141L3.64101 19.979C3.55496 20.0041 3.46375 20.0056 3.37692 19.9833C3.29009 19.9611 3.21083 19.9159 3.14745 19.8525C3.08407 19.7892 3.0389 19.7099 3.01665 19.6231C2.9944 19.5362 2.99591 19.445 3.02101 19.359L3.85901 16.487C3.95323 16.1643 4.12725 15.8706 4.36501 15.633L16.376 3.62198Z" />
    </LineIcon>
  );
}

/** Undo the last log. Figma Icon/Undo 310:313. */
export function UndoLineIcon(props: LineIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M9 14L4 9L9 4" />
      <path d="M4 9H14.5C15.2223 9 15.9375 9.14226 16.6048 9.41866C17.272 9.69506 17.8784 10.1002 18.3891 10.6109C18.8998 11.1216 19.3049 11.728 19.5813 12.3952C19.8577 13.0625 20 13.7777 20 14.5C20 15.2223 19.8577 15.9375 19.5813 16.6048C19.3049 17.272 18.8998 17.8784 18.3891 18.3891C17.8784 18.8998 17.272 19.3049 16.6048 19.5813C15.9375 19.8577 15.2223 20 14.5 20H11" />
    </LineIcon>
  );
}

/** Confirmation mark. Figma Icon/Check 310:316. */
export function CheckLineIcon(props: LineIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M20 6L9 17L4 12" />
    </LineIcon>
  );
}

/** Saved on the phone, waiting to send. Figma Icon/Queued 324:814. */
export function QueuedLineIcon(props: LineIconProps) {
  return (
    <LineIcon {...props}>
      <path d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z" />
      <path d="M12 7V12L15 14" />
    </LineIcon>
  );
}
