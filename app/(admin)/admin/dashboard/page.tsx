import { redirect } from "next/navigation";

/** UI-10 F5d (A50): the old dashboard is now Insights. Its components go in F6. */
export default function DashboardPage() {
  redirect("/admin/insights");
}
