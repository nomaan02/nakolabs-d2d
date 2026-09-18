import { CoverageView } from "@/components/admin/coverage-view";
import { fetchCoverageMap } from "@/lib/admin/coverage";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coverage · nakolabs-d2d" };

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ stress?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;
  const params = await searchParams;
  const stressRaw = Number(params.stress ?? "");
  const stressDots = Number.isFinite(stressRaw) && stressRaw >= 2000 ? Math.min(stressRaw, 4000) : null;

  const result = await fetchCoverageMap(supabase);

  if (!result.ok) {
    return (
      <main className="min-h-dvh bg-worksheet p-8 text-ink">
        <h1 className="font-display text-2xl font-semibold">Coverage</h1>
        <p className="mt-3 text-[15px]">{result.message}</p>
        {result.detail ? (
          <p className="mt-2 font-data text-[12px] text-ink-soft">{result.detail}</p>
        ) : null}
      </main>
    );
  }

  return (
    <CoverageView
      doors={result.payload.doors}
      outcomes={result.payload.outcomes}
      props={result.payload.props}
      signedInAs={profile?.full_name ?? user?.email ?? ""}
      stressDots={stressDots}
    />
  );
}
