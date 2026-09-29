import type { ReactNode } from "react";
import { Sora } from "next/font/google";

import { FieldDataProvider } from "@/components/field/field-data-provider";
import { SyncProvider } from "@/components/field/sync-provider";
import { TabBar } from "@/components/field/tab-bar";
import { UndoToast } from "@/components/field/undo-toast";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

/**
 * Sora, for the field app only (owner decision 9, P1 — including the data
 * font). `variable` is set here and nowhere else, so `--font-sora` only
 * exists inside this layout's DOM subtree; admin's <html> className in the
 * root layout (bricolage/instrument/martian) is never touched. See the
 * `.field-root` rule in app/globals.css for how the three font roles are
 * re-pointed to Sora inside this subtree only.
 */
const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});

/**
 * The field shell. Four real routes — Map, Logger, Leads, Profile — share
 * this one layout, so the assignment, the labels and the outbox are read
 * once per prop rather than once per tab.
 *
 * The sync provider mounts here so the flush triggers and the undo-promotion
 * sweep survive navigation between tabs. The app-shell service worker is
 * registered here too, and only here, so admin and office never get one. The
 * two are independent: the worker caches the shell, the provider owns the
 * outbox, and neither waits on the other.
 */
export default async function FieldLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;

  return (
    <SyncProvider>
      <RegisterServiceWorker />
      <FieldDataProvider
        signedInAs={profile?.full_name ?? user?.email ?? ""}
        role={profile?.role ?? "canvasser"}
      >
        <main
          className={`${sora.variable} field-root relative flex h-dvh flex-col overflow-hidden bg-field-bg font-body text-ink`}
        >
          <div className="relative min-h-0 flex-1">
            {children}
            <UndoToast />
          </div>
          <TabBar />
        </main>
      </FieldDataProvider>
    </SyncProvider>
  );
}
