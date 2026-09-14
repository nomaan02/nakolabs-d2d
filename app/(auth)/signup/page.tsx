import Link from "next/link";
import { signUp } from "@/lib/auth/actions";

const ERRORS: Record<string, string> = {
  invalid: "Please fill in your name, email and password.",
  exists: "An account with this email already exists.",
  email: "That email address is not accepted. Use a real inbox.",
  failed: "Could not create the account. Try again.",
};

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] : undefined;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <p className="mt-2 text-sm text-stone-600">
        New accounts start as canvasser. Office and admin access is granted
        separately.
      </p>

      <form action={signUp} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Full name
          <input
            type="text"
            name="full_name"
            autoComplete="name"
            required
            className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-base font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email address
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-base font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={6}
            className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-base font-normal"
          />
        </label>

        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="min-h-11 rounded-md bg-stone-900 px-3 text-base font-medium text-white hover:bg-stone-800"
        >
          Create account
        </button>
      </form>

      <p className="mt-6 text-sm text-stone-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-stone-950 underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
