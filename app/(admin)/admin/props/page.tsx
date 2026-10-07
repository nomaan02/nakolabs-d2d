import { PropsScreen } from "@/components/admin/props/props-screen";
import { loadDoorCounts, loadPropRows } from "@/lib/admin/props-data";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Props · nakolabs-d2d" };

/**
 * UI-10 F2 (owner A19-A23, A25, M2). The Props map: every prop, its detail,
 * and Draw / Edit shape, on one full-screen map. `?prop=<id>` opens a prop.
 * Door counts are not awaited: the list renders first and they stream in.
 */
export default async function PropsPage({
  searchParams,
}: {
  searchParams: Promise<{ prop?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;
  const loaded = await loadPropRows(supabase);

  if (!loaded.ok) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-admin-title">Props</h1>
        <p className="text-admin-body text-ink-muted">{loaded.message}</p>
      </main>
    );
  }

  return (
    <PropsScreen
      today={londonDate()}
      rows={loaded.rows}
      doorCounts={loadDoorCounts(supabase, loaded.rows)}
      initialPropId={params.prop ?? null}
    />
  );
}
