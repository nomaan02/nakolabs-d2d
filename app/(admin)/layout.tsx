import type { ReactNode } from "react";
import { Sora } from "next/font/google";

import { AdminShell } from "@/components/admin/shell/admin-shell";
import { FieldThemeSync } from "@/components/field/field-theme-sync";
import { ADMIN_THEME_BOOT_SCRIPT } from "@/lib/admin/theme-boot";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

/**
 * UI-10 F1c (owner A3, A14-A16, A28, A51). Sora for admin, as in the field
 * app: `--font-sora` exists only inside the admin shell, and `.admin-root`
 * in app/globals.css points the three font roles at it.
 */
const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: ADMIN_THEME_BOOT_SCRIPT }} />
      <FieldThemeSync />
      <AdminShell name={profile?.full_name ?? user?.email ?? ""} fontClassName={sora.variable}>
        {children}
      </AdminShell>
    </>
  );
}
