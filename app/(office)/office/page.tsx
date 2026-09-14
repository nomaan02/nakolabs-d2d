import { SignOutButton } from "@/components/auth/sign-out-button";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export default async function OfficePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Office</h1>
          <p className="mt-1 text-sm text-stone-600">
            Signed in as {profile?.full_name ?? user?.email}
          </p>
        </div>
        <SignOutButton />
      </div>
    </main>
  );
}
