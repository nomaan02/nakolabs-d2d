import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-stone-50 p-8 text-stone-950">
      <h1 className="text-2xl font-semibold tracking-tight">nakolabs-d2d</h1>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Link
          href="/login"
          className="flex min-h-11 items-center justify-center rounded-md bg-stone-900 px-4 text-base font-medium text-white hover:bg-stone-800"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="flex min-h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-base font-medium hover:bg-stone-100"
        >
          Create account
        </Link>
      </div>
    </main>
  );
}
