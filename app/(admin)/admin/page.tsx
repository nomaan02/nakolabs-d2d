import { redirect } from "next/navigation";

/**
 * UI-10 (owner A50). `/admin` stays the admin home (lib/auth/roles.ts) and
 * opens Today (F3). The old components are deleted in F6.
 */
export default function AdminHome() {
  redirect("/admin/today");
}
