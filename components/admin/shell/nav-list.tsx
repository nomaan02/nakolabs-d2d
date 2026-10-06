"use client";

import Link from "next/link";

import { AdminIcon } from "@/components/admin/ui/admin-icon";
import { Avatar } from "@/components/admin/ui/avatar";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { BRANCH_LABEL, initialOf, navGroups, type AdminNavKey } from "@/lib/admin/nav";

/**
 * UI-10 F1c. The nav items shared by the phone drawer and the desktop rail
 * (Figma NavItem, frames 02 and D1). Active = prop-soft fill + prop text,
 * with aria-current. `compact` is the 64px rail: icons only, with a tooltip.
 */
export function NavList({
  active,
  compact = false,
  onNavigate,
}: {
  active: AdminNavKey | null;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const { main, tools } = navGroups();
  const render = (items: typeof main) =>
    items.map((item) => {
      const isActive = item.key === active;
      return (
        <li key={item.key}>
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            aria-label={compact ? item.label : undefined}
            title={compact ? item.label : undefined}
            className={`flex min-h-12 items-center rounded-field-md text-admin-body-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
              compact ? "size-12 justify-center" : "gap-3.5 px-3"
            } ${isActive ? "bg-prop-soft text-prop" : "text-ink"}`}
          >
            <AdminIcon name={item.icon} className="size-6 shrink-0" />
            {compact ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
          </Link>
        </li>
      );
    });

  return (
    <nav aria-label="Admin" className="flex flex-col">
      <ul className="flex flex-col gap-1">{render(main)}</ul>
      {tools.length > 0 ? (
        <>
          <div aria-hidden className={`my-2 h-px bg-line ${compact ? "mx-2" : "mx-3"}`} />
          <ul className="flex flex-col gap-1">{render(tools)}</ul>
        </>
      ) : null}
    </nav>
  );
}

export function AccountRow({ name, compact = false }: { name: string; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex justify-center py-2" title={name}>
        <Avatar initial={initialOf(name)} size="md" />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3 px-2 py-2">
      <Avatar initial={initialOf(name)} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-admin-headline">{name || "Signed in"}</p>
        <p className="text-admin-subhead text-ink-muted">Admin · {BRANCH_LABEL}</p>
      </div>
    </div>
  );
}

export function SignOutRow() {
  return (
    <SignOutButton className="flex min-h-12 w-full items-center rounded-field-md px-3 text-left text-admin-body-strong text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop" />
  );
}
