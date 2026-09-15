import type { ReactNode } from "react";

import { SyncProvider } from "@/components/field/sync-provider";

/**
 * Field route group. The sync provider mounts once here so the flush
 * triggers survive navigation within /field. The service-worker registration
 * lands in this layout in the app-shell pass, not this one.
 */
export default function FieldLayout({ children }: { children: ReactNode }) {
  return <SyncProvider>{children}</SyncProvider>;
}
