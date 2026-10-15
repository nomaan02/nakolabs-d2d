"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ComponentType, type TouchEvent } from "react";

import { Avatar } from "@/components/admin/ui/avatar";
import { IconButton } from "@/components/admin/ui/icon-button";
import { useOverlayFocus } from "@/components/admin/ui/use-overlay-focus";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { useFieldData } from "@/components/field/field-data-provider";
import {
  CalendarIcon,
  CloseIcon,
  InsightsIcon,
  LeadsIcon,
  LoggerIcon,
  MapIcon,
  PhoneIcon,
  TodayIcon,
  TrophyIcon,
  YouIcon,
} from "@/components/field/icons";
import { BRANCH_LABEL, initialOf } from "@/lib/admin/nav";
import { knownCrmMe } from "@/lib/field/crm-data";
import { FIELD_NAV, activeFieldNav, requestLeadsView, type FieldNavItem, type FieldNavKey } from "@/lib/field/nav";
import { setThemePref, useThemePref, type ThemePref } from "@/lib/field/theme";

/** A swipe this far left (px) closes the drawer (admin NavDrawer's value). */
const SWIPE_CLOSE_PX = 60;

const ICON: Record<FieldNavKey, ComponentType<{ className?: string }>> = {
  map: MapIcon,
  logger: LoggerIcon,
  leads: LeadsIcon,
  week: CalendarIcon,
  callbacks: PhoneIcon,
  you: YouIcon,
  results: InsightsIcon,
  leaderboard: TrophyIcon,
};

/** The You tab's words for the same setting ("Auto", not admin's "System"). */
const APPEARANCE: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const ROW =
  "flex min-h-12 items-center gap-3.5 rounded-field-md px-3 text-admin-body-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop";

/**
 * FUI-1a (owner 2026-10-14, O2; Figma frame 05). The field drawer, built
 * like admin's NavDrawer (UI-10 F1c): an overlay from the left, about 85%
 * wide. The scrim, the close button, Escape, a left swipe and picking an item
 * all close it. No edge-swipe to open: it would fight map panning and iOS
 * Back. Focus is trapped while it is open and goes back to the menu button.
 */
export function FieldDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <DrawerPanel onClose={onClose} /> : null;
}

/** Mounted only while open. The CRM link comes from this phone's last load: no request. */
function DrawerPanel({ onClose }: { onClose: () => void }) {
  const { signedInAs, role, canvasserId } = useFieldData();
  const pathname = usePathname();
  const linked = knownCrmMe(canvasserId)?.name != null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const startX = useRef<number | null>(null);
  useOverlayFocus(panelRef, true, onClose);

  const active = activeFieldNav(pathname);
  const visible = FIELD_NAV.filter((item) => !item.crmOnly || linked);
  const today = visible.filter((item) => item.group === "today");
  const you = visible.filter((item) => item.group === "you");

  const onTouchStart = (event: TouchEvent) => {
    startX.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = startX.current;
    const end = event.changedTouches[0]?.clientX;
    startX.current = null;
    if (start !== null && end !== undefined && start - end > SWIPE_CLOSE_PX) onClose();
  };

  const pick = (item: FieldNavItem) => {
    if (item.key === "leads") requestLeadsView("today");
    if (item.key === "week") requestLeadsView("week");
    if (item.key === "callbacks") requestLeadsView("callbacks");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50" data-testid="field-drawer">
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-scrim/40 motion-safe:animate-admin-fade-in"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="absolute inset-y-0 left-0 flex w-[85%] max-w-82 flex-col gap-2 rounded-r-admin-sheet bg-surface px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[max(1rem,env(safe-area-inset-bottom))] text-ink shadow-admin-sheet outline-none motion-safe:animate-admin-drawer-in"
      >
        <div className="flex items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2">
            <Avatar initial={initialOf(signedInAs)} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-admin-headline">{signedInAs || "Signed in"}</p>
              <p className="text-admin-subhead text-ink-muted">
                {role === "admin" ? "Admin" : "Canvasser"} · {BRANCH_LABEL}
              </p>
            </div>
          </div>
          <IconButton label="Close menu" onClick={onClose}>
            <CloseIcon className="size-6" />
          </IconButton>
        </div>

        <nav aria-label="Field" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <NavGroup title="Today" items={today} active={active} onPick={pick} />
          <div aria-hidden className="mx-3 my-2 h-px bg-line" />
          <NavGroup title="You" items={you} active={active} onPick={pick} />
          {role === "admin" ? (
            <>
              <div aria-hidden className="mx-3 my-2 h-px bg-line" />
              <ul className="flex flex-col gap-1">
                <li>
                  <Link href="/admin/today" onClick={onClose} className={`${ROW} text-ink`} data-testid="drawer-open-admin">
                    <TodayIcon className="size-6 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">Open admin</span>
                  </Link>
                </li>
              </ul>
            </>
          ) : null}
        </nav>

        <Appearance />
        <SignOutButton className={`${ROW} w-full text-left text-ink-muted`} />
      </div>
    </div>
  );
}

/**
 * Auto / Light / Dark, the same choice as the You tab, stored on this
 * phone. Admin's control is 36px tall; the field needs 44px targets.
 */
function Appearance() {
  const pref = useThemePref();
  return (
    <div className="px-2 py-2">
      <p className="mb-1.5 text-admin-section text-ink-muted">Appearance</p>
      <div role="radiogroup" aria-label="Appearance" className="flex gap-1 rounded-field-md bg-field-bg p-1">
        {APPEARANCE.map((option) => {
          const selected = option.value === pref;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setThemePref(option.value)}
              className={`min-h-tap-min flex-1 rounded-field-sm px-3 text-admin-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
                selected ? "bg-surface text-ink shadow-admin-float" : "text-ink-muted"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavGroup({
  title,
  items,
  active,
  onPick,
}: {
  title: string;
  items: FieldNavItem[];
  active: FieldNavKey | null;
  onPick: (item: FieldNavItem) => void;
}) {
  return (
    <>
      <p className="px-3 pt-1 pb-1 text-admin-caption text-ink-muted">{title}</p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = ICON[item.key];
          const isActive = item.key === active;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                onClick={() => onPick(item)}
                aria-current={isActive ? "page" : undefined}
                className={`${ROW} ${isActive ? "bg-prop-soft text-prop" : "text-ink"}`}
                data-testid={`drawer-${item.key}`}
              >
                <Icon className="size-6 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
