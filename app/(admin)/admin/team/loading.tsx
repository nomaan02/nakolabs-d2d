/** UI-10 F5c: the shape of Team while it loads. No spinner. */
export default function TeamLoading() {
  const bar = "rounded-full bg-line motion-safe:animate-pulse";
  return (
    <div className="mx-auto max-w-2xl px-4 pt-14 lg:max-w-4xl lg:px-10 lg:pt-8" role="status" aria-label="Loading Team">
      <div className={`h-8 w-28 ${bar}`} />
      <div className={`mt-2 h-4 w-44 ${bar}`} />
      <div className="mt-5 flex gap-2">
        {["w-24", "w-28", "w-20"].map((width) => (
          <div key={width} className={`h-9 ${width} ${bar}`} />
        ))}
      </div>
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-field-lg bg-surface p-4">
            <div className={`h-6 w-1/3 ${bar}`} />
            <div className={`mt-4 h-8 w-full ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
