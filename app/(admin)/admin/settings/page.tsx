import { LoggingDefaultSetting } from "@/components/admin/logging-default-setting";
import { RotationSettings } from "@/components/admin/rotation-settings";
import { getOwnProfile } from "@/lib/auth/profile";
import { describeVisitThreshold } from "@/lib/geo/reallocation";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Settings · nakolabs-d2d" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;

  const { data } = await supabase.from("app_settings").select("value").eq("key", "rotation").maybeSingle();
  const threshold = describeVisitThreshold(data?.value);
  // UI-8 (owner U8-4). Anything unexpected reads as the safe default.
  const { data: loggingDefault } = await supabase.rpc("logging_default");

  return (
    <RotationSettings
      signedInAs={profile?.full_name ?? user?.email ?? ""}
      initialPct={threshold.pct}
      detail={threshold.detail}
      extra={<LoggingDefaultSetting initial={loggingDefault === "exceptions" ? "exceptions" : "every_door"} />}
    />
  );
}
