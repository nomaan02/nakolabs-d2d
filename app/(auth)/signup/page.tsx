import { redirect } from "next/navigation";

/**
 * UI-10 F5e (owner 2026-10-09): invite only. New canvassers are invited
 * from Settings; this old address goes to sign-in.
 */
export default function SignupPage() {
  redirect("/login");
}
