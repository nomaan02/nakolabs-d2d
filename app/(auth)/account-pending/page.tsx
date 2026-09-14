import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getOwnProfile } from "@/lib/auth/profile";
import { homeForRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export default async function AccountPendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await getOwnProfile(supabase, user.id);

  if (profile?.active) {
    redirect(homeForRole(profile.role));
  }

  const inactive = profile !== null && !profile.active;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        {inactive ? "Account inactive" : "Setting up your account"}
      </h1>
      <p className="mt-3 text-sm text-stone-600">
        {inactive
          ? "This account is inactive. Please speak to an administrator."
          : "Your account is still being set up. Refresh this page in a moment."}
      </p>

      <div className="mt-8 flex flex-col gap-3">
        {!inactive ? (
          <a
            href="/account-pending"
            className="flex min-h-11 items-center justify-center rounded-md bg-stone-900 px-3 text-base font-medium text-white hover:bg-stone-800"
          >
            Refresh
          </a>
        ) : null}
        <SignOutButton className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 hover:bg-stone-100" />
      </div>
    </>
  );
}
