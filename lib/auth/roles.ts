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

/**
 * UI-10 F6 (owner A12, A30; 2026-10-10: the admin is always pickable). Who
 * can be on a visit's team and open the field app: canvassers and the
 * admin. Office never canvasses.
 */
export function canCanvass(role: string | null | undefined): boolean {
  return role === "canvasser" || role === "admin";
}

/** Middleware's rule: /field is for anyone who canvasses; every other area is for its own role. */
export function mayOpen(pathname: string, role: AppRole): boolean {
  const required = roleForPath(pathname);
  if (required === null) return true;
  if (required === "canvasser") return canCanvass(role);
  return required === role;
}
