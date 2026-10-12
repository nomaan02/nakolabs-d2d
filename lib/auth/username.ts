/**
 * CRM-5 U (owner 2026-10-12): canvassers sign in with a username, not an
 * email. Supabase Auth needs an email, so a username is stored as
 * `<username>@users.nakolabs-d2d.invalid`. `.invalid` is a reserved domain
 * (RFC 2606): nothing can ever be emailed to it. Accounts are created by an
 * admin with `scripts/create-accounts.ts`; nobody signs up with a username.
 *
 * Real emails keep working: anything with an "@" is used as typed.
 */

export const USERNAME_DOMAIN = "users.nakolabs-d2d.invalid";

/** 2 to 31 characters: a lower-case letter first, then letters, digits, dot, dash or underscore. */
const USERNAME = /^[a-z][a-z0-9._-]{1,30}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME.test(username);
}

/** What the login box gives Supabase. Null when it is neither an email nor a valid username. */
export function loginEmail(typed: string): string | null {
  const value = typed.trim().toLowerCase();
  if (value === "") return null;
  if (value.includes("@")) return value;
  return isValidUsername(value) ? `${value}@${USERNAME_DOMAIN}` : null;
}

/** The username behind a username account's email, or null for a real email. */
export function usernameFrom(email: string | null | undefined): string | null {
  if (!email) return null;
  const suffix = `@${USERNAME_DOMAIN}`;
  return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : null;
}

/** For "Signed in as …" when there is no name: the username, or the email. */
export function accountLabel(email: string | null | undefined): string {
  return usernameFrom(email) ?? email ?? "";
}
