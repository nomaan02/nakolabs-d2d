import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

/**
 * UI-10 F5f (owner A35, 2026-10-09). The service-role client, for the one
 * job that needs it: inviting a canvasser by email
 * (`auth.admin.inviteUserByEmail`). Server only: the key is
 * SUPABASE_SERVICE_ROLE_KEY, never a NEXT_PUBLIC_ variable, and this module
 * refuses to run in a browser. It bypasses RLS, so callers check the caller
 * is an active admin first and use it for nothing else.
 */
export function createServiceClient() {
  if (typeof window !== "undefined") throw new Error("The service client is server only.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service environment variables");
  return createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
