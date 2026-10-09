/** UI-10 F5e: the shape of Settings while it loads. No spinner. */
export default function SettingsLoading() {
  const bar = "rounded-full bg-line motion-safe:animate-pulse";
  return (
    <div className="mx-auto max-w-2xl px-4 pt-14 lg:px-10 lg:pt-8" role="status" aria-label="Loading Settings">
      <div className={`h-8 w-36 ${bar}`} />
      {[1, 1, 1, 4, 4].map((rows, index) => (
        <div key={index} className="mt-6">
          <div className={`mb-2 h-4 w-24 ${bar}`} />
          <div className="rounded-field-lg bg-surface">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="border-t border-line px-4 py-4 first:border-t-0">
                <div className={`h-5 w-2/3 ${bar}`} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
