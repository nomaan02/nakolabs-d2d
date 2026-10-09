import { SettingsScreen } from "@/components/admin/settings/settings-screen";
import { buildLine } from "@/lib/admin/settings";
import { loadSettings } from "@/lib/admin/settings-data";
import { londonDate } from "@/lib/field/london-date";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · nakolabs-d2d" };

/** UI-10 F5e (owner A35; frames 23, 24, dark 32). */
export default async function SettingsPage() {
  const supabase = await createClient();
  const settings = await loadSettings(supabase, londonDate());
  return <SettingsScreen {...settings} build={buildLine(process.env.VERCEL_GIT_COMMIT_SHA)} />;
}
