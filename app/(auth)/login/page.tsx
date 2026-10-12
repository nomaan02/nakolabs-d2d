import { signIn } from "@/lib/auth/actions";

const ERRORS: Record<string, string> = {
  credentials: "Incorrect username or password.",
  link: "That link has expired or was already used. Ask your manager for a new invite.",
};

const NOTICES: Record<string, string> = {
  created: "Account created. Sign in with your username or email and your password.",
};

type PageProps = {
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params.error ? ERRORS[params.error] : undefined;
  const notice = params.notice ? NOTICES[params.notice] : undefined;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-stone-600">
        Use the username (or email) and password your manager gave you.
      </p>

      <form action={signIn} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Username or email
          <input
            type="text"
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-base font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            minLength={6}
            className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-base font-normal"
          />
        </label>

        {notice ? (
          <p className="text-sm text-stone-700" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="min-h-11 rounded-md bg-stone-900 px-3 text-base font-medium text-white hover:bg-stone-800"
        >
          Sign in
        </button>
      </form>

      <p className="mt-6 text-sm text-stone-600">No account? Ask your manager for an invite.</p>
    </>
  );
}
