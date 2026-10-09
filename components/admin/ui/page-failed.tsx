"use client";

import { useRouter } from "next/navigation";

import { AdminMenuButton } from "@/components/admin/shell/admin-shell";

/**
 * UI-10 F5c. A page that could not load: its title, what happened and
 * "Try again" (reads the page again). Same shape as Calendar's.
 */
export function PageFailed({ title, message }: { title: string; message: string }) {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-2xl px-4 pt-2 lg:px-10 lg:pt-8">
      <div className="-ml-1.5 lg:hidden">
        <AdminMenuButton />
      </div>
      <h1 className="mt-1 text-admin-large-title">{title}</h1>
      <div role="alert" className="mt-6 rounded-field-lg bg-surface p-5">
        <p className="text-admin-body">{message}</p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 inline-flex min-h-11 items-center text-admin-body-strong text-prop focus-visible:outline-2 focus-visible:outline-prop"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
