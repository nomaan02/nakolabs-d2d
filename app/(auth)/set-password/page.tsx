import Link from "next/link";

import { setPassword } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";

const ERRORS: Record<string, string> = {
  short: "Use at least 8 characters.",
  weak: "That password is too easy to guess. Use a longer one with letters and numbers.",
  failed: "That didn't save. Try again.",
};

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

/**
 * UI-10 F5e (owner 2026-10-09). The invited canvasser chooses a password.
 * Reached from the invite link (/auth/confirm), which signs them in first.
 */
export default async function SetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] : undefined;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Link expired</h1>
        <p className="mt-2 text-sm text-stone-600">That invite link has expired or was already used. Ask your manager for a new invite.</p>
        <Link href="/login" className="mt-6 inline-flex min-h-11 items-center text-base font-medium text-stone-950 underline">
          Go to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a password</h1>
      <p className="mt-2 text-sm text-stone-600">For {user.email}. You&apos;ll use it to sign in to the field app.</p>

      <form action={setPassword} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby="password-hint"
            className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-base font-normal"
          />
        </label>
        <p id="password-hint" className="-mt-2 text-sm text-stone-600">
          At least 8 characters.
        </p>

        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="min-h-11 rounded-md bg-stone-900 px-3 text-base font-medium text-white hover:bg-stone-800">
          Save password
        </button>
      </form>
    </>
  );
}
