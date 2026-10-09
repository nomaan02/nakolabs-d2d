import { ChipLink } from "@/components/admin/ui/chip";

/**
 * UI-10 F5c (A34). This week / Last 4 weeks / All time. Each chip is a link,
 * so the server reads the new period and Back returns to the last one.
 */
export function PeriodChips({ links }: { links: ReadonlyArray<{ label: string; href: string; on: boolean }> }) {
  return (
    <nav aria-label="Period" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
      {links.map((link) => (
        <ChipLink key={link.href} on={link.on} href={link.href}>
          {link.label}
        </ChipLink>
      ))}
    </nav>
  );
}
