/** UI-10 F3c (frame 26): the shape of Today while it loads. No spinner. */
export default function TodayLoading() {
  const bar = "rounded-full bg-line motion-safe:animate-pulse";
  return (
    <div className="mx-auto max-w-2xl px-4 pt-14 lg:px-10 lg:pt-8" role="status" aria-label="Loading Today">
      <div className={`h-8 w-32 ${bar}`} />
      <div className={`mt-2 h-4 w-44 ${bar}`} />
      <div className="mt-6 rounded-field-lg bg-surface p-4">
        <div className={`h-6 w-2/3 ${bar}`} />
        <div className={`mt-3 h-3 w-1/2 ${bar}`} />
      </div>
      {[0, 1].map((key) => (
        <div key={key} className="mt-6 grid grid-cols-[2.75rem_1fr] gap-x-2">
          <div className={`mx-auto h-6 w-6 ${bar}`} />
          <div className="rounded-field-lg bg-surface p-4">
            <div className={`h-4 w-3/5 ${bar}`} />
            <div className={`mt-2 h-3 w-2/5 ${bar}`} />
            <div className={`mt-4 h-1.5 w-full ${bar}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
