/** UI-10 F5d: the shape of Insights while it loads. No spinner. */
export default function InsightsLoading() {
  const bar = "rounded-full bg-line motion-safe:animate-pulse";
  return (
    <div className="mx-auto max-w-2xl px-4 pt-14 lg:max-w-5xl lg:px-10 lg:pt-8" role="status" aria-label="Loading Insights">
      <div className={`h-8 w-32 ${bar}`} />
      <div className={`mt-2 h-4 w-48 ${bar}`} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index}>
            <div className={`mb-2 h-5 w-40 ${bar}`} />
            <div className="h-40 rounded-field-lg bg-surface p-4">
              <div className="h-full w-full rounded-field-md bg-line motion-safe:animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
