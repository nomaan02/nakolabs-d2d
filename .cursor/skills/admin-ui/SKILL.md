---
name: admin-ui
description: Screen patterns for the redesigned admin app (UI-10) — the shell and drawer/rail, page headers, Today schedule cards, map pages with sheets, Draw mode, sheets and confirm dialogs. Use whenever building or changing anything under app/(admin), components/admin or lib/admin. Read the 25-admin-ui rule first; this skill shows how the pieces fit together.
---

# Admin UI patterns (UI-10)

Figma page "Admin — design" (40:289). Phone frames 01–38 in section 89:295, desktop D1–D3 in 100:1709. Build to the frame named in your prompt; do not invent layout.

## 1. Page skeleton (non-map pages)

```tsx
export default async function Page() {
  // fetch on the server
  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <header className="flex h-13 items-center justify-between px-2 lg:hidden">
        <AdminMenuButton />
        {/* optional right-hand IconButton */}
      </header>
      <div className="px-5 pt-0.5 pb-4 lg:pt-9">
        <h1 className="text-admin-large-title">Today</h1>
        <p className="text-admin-subhead text-ink-muted">Tuesday 6 October</p>
      </div>
      <div className="flex flex-col gap-3 px-4">{/* content */}</div>
    </div>
  );
}
```

- Content column: `max-w-3xl` (720) on desktop, centred. The right-hand detail panel on desktop is 400px (`w-100`).
- Cards: `rounded-field-lg bg-surface p-4`. No shadow on cards that sit on `field-bg`.
- Grouped lists (Settings, Earlier, Leads): one `rounded-field-lg bg-surface` container, rows split by `border-t border-line` (not the first row), 52–64px rows.

## 2. Map pages (Props, Coverage, Live)

- The map fills the page (`absolute inset-0`). Controls float on solid surfaces: `IconButton kind="floating"`, search pill `rounded-full border border-line bg-surface shadow-admin-float`.
- Top row: `<AdminMenuButton floating />`, search, layers. Locate button bottom-right above the sheet.
- The list lives in a sheet with three heights (peek / half / full) on phone, and a floating 380px panel on desktop.
- MapLibre: gate updates on `getSource(...)`, never `isStyleLoaded()`. "User moved the map" = `movestart` with an `originalEvent`.

## 3. Draw mode

- Full screen, no drawer button, no sheet. Solid top bar: Cancel (Quiet) · title · layers.
- One-line hint pill under the top bar. Floating toolbar at the bottom: Undo, Redo, corner count, Close shape.
- First corner is the close target. Dragging a corner shows the magnifier.

## 4. Today schedule

- Date rail (36px) on the left: day numeral `text-admin-day` + weekday `text-admin-caption`; today in `text-prop`.
- Visit card: name (`text-admin-headline`), meta line, StatusPill, progress bar split by outcome colour on a `field-bg` track, worked / left, contacts and leads with outcome dots, team avatars.

## 5. Overlays

- `Sheet` for short tasks; pinned `footer` for the main action.
- `ConfirmDialog` for anything destructive.
- Never stack two modals; a multi-step task gets its own route (e.g. `/admin/today/add`).

## 6. Analytics, lists and settings (UI-10 F5)

- Period pages (Team, a canvasser, Leads): `PeriodChips` (links: This week / Last 4 weeks / All time, `?period=`), numbers worked out on the server (`lib/admin/team.ts`), only figures reach the browser. Sorts and status filters live in the URL via `history.replaceState(null, "", …)`.
- Grouped settings: section label (`text-admin-section`, sentence case) above one `rounded-field-lg bg-surface` group, one line of help under it. A value row opens a `Sheet`; switches sit at the row end; switching something off asks first (`ConfirmDialog`).
- Read-only lists (Leads): a visible list frame, rows 64px, the empty line inside the frame, 50 rows then "Show N more".
- A page that cannot load uses `PageFailed` (title, what happened, Try again).

## 7. Checklist before you finish

- [ ] Only tokens and `text-admin-*` styles; no hex, no `dark:`.
- [ ] `<AdminMenuButton />` in the header; nav changes only in `lib/admin/nav.ts`.
- [ ] New route added to `DARK_READY_PATHS` only when the whole page uses tokens.
- [ ] 44px targets; focus ring visible; overlays trap and restore focus.
- [ ] No resident names; admin never edits lead status.
- [ ] Phone check items listed for 375 / 390 / 430 and 1440.
