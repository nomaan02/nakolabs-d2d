import { PropDrawer, type SavedProp } from "@/components/admin/prop-drawer";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;

  const { data } = await supabase
    .from("territories")
    .select("id, name, created_at")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(8);

  return (
    <PropDrawer
      savedProps={(data ?? []) as SavedProp[]}
      signedInAs={profile?.full_name ?? user?.email ?? ""}
    />
  );
}
