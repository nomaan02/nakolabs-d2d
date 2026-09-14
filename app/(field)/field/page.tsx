import { FieldProp } from "@/components/field/field-prop";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export default async function FieldPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;

  return <FieldProp signedInAs={profile?.full_name ?? user?.email ?? ""} />;
}
