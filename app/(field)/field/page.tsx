import { SignOutButton } from "@/components/auth/sign-out-button";
import { getOwnProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export default async function FieldPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getOwnProfile(supabase, user.id) : null;

  return (
    <main className="flex min-h-dvh flex-col bg-white text-stone-950">
      <div className="flex-1 px-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight">Field</h1>
        <p className="mt-1 text-sm text-stone-600">
          Signed in as {profile?.full_name ?? user?.email}
        </p>
      </div>
      <div className="sticky bottom-0 border-t border-stone-200 bg-white p-4">
        <SignOutButton className="min-h-11 w-full rounded-md bg-stone-900 px-4 text-base font-medium text-white hover:bg-stone-800" />
      </div>
    </main>
  );
}
