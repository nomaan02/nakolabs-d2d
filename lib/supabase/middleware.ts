import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/types";
import { getOwnProfile } from "@/lib/auth/profile";
import {
  homeForRole,
  isAccountPendingPath,
  isAuthPath,
  mayOpen,
  roleForPath,
} from "@/lib/auth/roles";

function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie);
  });
  to.headers.set("Cache-Control", "private, no-store");
  return to;
}

function redirectWithSession(
  request: NextRequest,
  sessionResponse: NextResponse,
  pathname: string,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return copyCookies(sessionResponse, NextResponse.redirect(url));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing public Supabase environment variables");
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not insert logic between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const requiredRole = roleForPath(pathname);
  const authPath = isAuthPath(pathname);
  const pendingPath = isAccountPendingPath(pathname);

  if (!user) {
    if (requiredRole || pendingPath) {
      return redirectWithSession(request, supabaseResponse, "/login");
    }
    return supabaseResponse;
  }

  const profile = await getOwnProfile(supabase, user.id);
  const usable = profile !== null && profile.active;

  if (!usable) {
    if (pendingPath) return supabaseResponse;
    return redirectWithSession(request, supabaseResponse, "/account-pending");
  }

  const home = homeForRole(profile.role);

  if (authPath || pendingPath || pathname === "/") {
    return redirectWithSession(request, supabaseResponse, home);
  }

  // UI-10 F6c (owner A30): /field is for anyone who canvasses, the admin included.
  if (!mayOpen(pathname, profile.role)) {
    return redirectWithSession(request, supabaseResponse, home);
  }

  return supabaseResponse;
}
