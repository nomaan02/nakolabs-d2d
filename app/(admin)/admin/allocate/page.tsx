import { redirect } from "next/navigation";

/**
 * UI-10 F3 (owner A24, A50). Allocating starts from a date on Today: Add
 * visit, then the visit sheet to manage the team. `?prop=` (old links) opens
 * Add visit for tomorrow with that prop picked. The old allocate components
 * are deleted in F6.
 */
export default async function AllocateRedirect({
  searchParams,
}: {
  searchParams: Promise<{ prop?: string }>;
}) {
  const params = await searchParams;
  redirect(params.prop ? `/admin/today/add?prop=${encodeURIComponent(params.prop)}` : "/admin/today");
}
