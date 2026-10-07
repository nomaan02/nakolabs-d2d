import { redirect } from "next/navigation";

/**
 * UI-10 F2 (owner A50). The old draw page is replaced by Props. `/admin`
 * stays the admin home (lib/auth/roles.ts) and redirects; F3 points it at
 * Today. The old components are deleted in F6.
 */
export default function AdminHome() {
  redirect("/admin/props");
}
