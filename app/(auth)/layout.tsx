export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-stone-50 px-4 py-10 text-stone-950">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
