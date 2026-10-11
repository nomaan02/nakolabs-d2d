import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // App-shell files (sw.js, manifest, offline page, icons, MapLibre worker)
  // are public static assets; the session check must not run on them, and
  // the service worker must be able to precache them without a cookie.
  // CRM-4 A: /api/cron/* is called by Supabase pg_cron with its own secret,
  // never a session cookie.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|health|api/cron/|sw\\.js|manifest\\.webmanifest|offline\\.html|icons/|maplibre/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
