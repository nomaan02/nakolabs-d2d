import type { ReactNode } from "react";
import Link from "next/link";

export function AdminNav({ current }: { current: "draw" | "allocate" }) {
  return (
    <nav className="grid grid-cols-2 gap-px bg-ink/20" aria-label="Admin">
      <NavLink href="/admin" active={current === "draw"}>
        Draw
      </NavLink>
      <NavLink href="/admin/allocate" active={current === "allocate"}>
        Allocate
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
      className={`flex min-h-11 items-center justify-center font-data text-[11px] uppercase tracking-[0.14em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
        active ? "bg-prop text-paper" : "bg-worksheet text-ink hover:bg-worksheet-deep"
      }`}
    >
      {children}
    </Link>
  );
}
