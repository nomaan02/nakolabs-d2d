import type { ReactNode } from "react";

import { SyncProvider } from "@/components/field/sync-provider";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";

/**
 * Field route group. The sync provider mounts once here so the flush
 * triggers survive navigation within /field. The app-shell service worker is
 * registered here too — and only here, so admin and office never get one.
 * The two are independent: the worker caches the shell, the provider owns
 * the outbox, and neither waits on the other.
 */
export default function FieldLayout({ children }: { children: ReactNode }) {
  return (
    <SyncProvider>
      <RegisterServiceWorker />
      {children}
    </SyncProvider>
  );
}
