import type { ReactNode } from "react";
import Link from "next/link";

export function AdminNav({
  current,
}: {
  current: "draw" | "allocate" | "coverage" | "dashboard" | "settings";
}) {
  return (
    <nav className="grid grid-cols-3 gap-px bg-ink/20 sm:grid-cols-5" aria-label="Admin">
      <NavLink href="/admin" active={current === "draw"}>
        Draw
      </NavLink>
      <NavLink href="/admin/allocate" active={current === "allocate"}>
        Allocate
      </NavLink>
      <NavLink href="/admin/coverage" active={current === "coverage"}>
        Coverage
      </NavLink>
      <NavLink href="/admin/dashboard" active={current === "dashboard"}>
        Dashboard
      </NavLink>
      <NavLink href="/admin/settings" active={current === "settings"}>
        Settings
      </NavLink>
    </nav>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center justify-center px-1 text-center font-data text-[10px] uppercase leading-tight tracking-[0.08em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
        active ? "bg-prop text-paper" : "bg-worksheet text-ink hover:bg-worksheet-deep"
      }`}
    >
      {children}
    </Link>
  );
}
