import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { isAppRole, type AppRole } from "@/lib/auth/roles";

export type OwnProfile = {
  id: string;
  full_name: string | null;
  role: AppRole;
  active: boolean;
};

export async function getOwnProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<OwnProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, active")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data || !isAppRole(data.role)) return null;

  return {
    id: data.id,
    full_name: data.full_name,
    role: data.role,
    active: data.active,
  };
}
