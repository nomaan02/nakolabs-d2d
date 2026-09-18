import type { ReactNode } from "react";
import Link from "next/link";

export function AdminNav({
  current,
}: {
  current: "draw" | "allocate" | "coverage" | "dashboard";
}) {
  return (
    <nav className="grid grid-cols-4 gap-px bg-ink/20" aria-label="Admin">
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
      className={`flex min-h-11 items-center justify-center px-1 text-center font-data text-[10px] uppercase tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
        active ? "bg-prop text-paper" : "bg-worksheet text-ink hover:bg-worksheet-deep"
      }`}
    >
      {children}
    </Link>
  );
}
