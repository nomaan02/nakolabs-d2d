import { DashboardView } from "@/components/admin/dashboard-view";
import { clampStaleWeeks, fetchAdminDashboard } from "@/lib/admin/dashboard";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · nakolabs-d2d" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;
  const params = await searchParams;
  const weeks = clampStaleWeeks(params.weeks);

  const result = await fetchAdminDashboard(supabase, weeks);

  if (!result.ok) {
    return (
      <main className="min-h-dvh bg-worksheet p-8 text-ink">
        <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
        <p className="mt-3 text-[15px]">{result.message}</p>
        {result.detail ? (
          <p className="mt-2 font-data text-[12px] text-ink-soft">{result.detail}</p>
        ) : null}
      </main>
    );
  }

  return (
    <DashboardView
      payload={result.payload}
      signedInAs={profile?.full_name ?? user?.email ?? ""}
    />
  );
}
