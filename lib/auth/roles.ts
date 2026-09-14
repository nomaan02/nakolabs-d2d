export const APP_ROLES = ["admin", "office", "canvasser"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin",
  office: "/office",
  canvasser: "/field",
};

export function isAppRole(value: string | null | undefined): value is AppRole {
  return value === "admin" || value === "office" || value === "canvasser";
}

export function homeForRole(role: AppRole): string {
  return ROLE_HOME[role];
}

/** Which business role a protected pathname belongs to, or null if public. */
export function roleForPath(pathname: string): AppRole | null {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/office" || pathname.startsWith("/office/")) return "office";
  if (pathname === "/field" || pathname.startsWith("/field/")) return "canvasser";
  return null;
}

export function isAuthPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/signup";
}

export function isAccountPendingPath(pathname: string): boolean {
  return pathname === "/account-pending";
}
