import { signOut } from "@/lib/auth/actions";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className={
          className ??
          "min-h-11 rounded-md bg-stone-900 px-4 text-base font-medium text-white hover:bg-stone-800"
        }
      >
        Sign out
      </button>
    </form>
  );
}
