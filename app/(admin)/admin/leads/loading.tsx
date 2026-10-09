/** UI-10 F5d: the shape of Leads while it loads. No spinner. */
export default function LeadsLoading() {
  const bar = "rounded-full bg-line motion-safe:animate-pulse";
  return (
    <div className="mx-auto max-w-2xl px-4 pt-14 lg:max-w-3xl lg:px-10 lg:pt-8" role="status" aria-label="Loading Leads">
      <div className={`h-8 w-28 ${bar}`} />
      <div className={`mt-2 h-4 w-56 ${bar}`} />
      <div className="mt-5 flex gap-2">
        {["w-24", "w-28", "w-20"].map((width) => (
          <div key={width} className={`h-9 ${width} ${bar}`} />
        ))}
      </div>
      <div className="mt-6 rounded-field-lg bg-surface">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="border-t border-line px-4 py-4 first:border-t-0">
            <div className={`h-5 w-1/2 ${bar}`} />
            <div className={`mt-2 h-4 w-2/3 ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
