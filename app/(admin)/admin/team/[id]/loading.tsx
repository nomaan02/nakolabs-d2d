/** UI-10 F5c: the shape of a canvasser profile while it loads. No spinner. */
export default function CanvasserLoading() {
  const bar = "rounded-full bg-line motion-safe:animate-pulse";
  return (
    <div className="mx-auto max-w-2xl px-4 pt-14 lg:max-w-5xl lg:px-10 lg:pt-8" role="status" aria-label="Loading profile">
      <div className="flex items-center gap-3">
        <div className={`size-10 ${bar}`} />
        <div className={`h-8 w-32 ${bar}`} />
      </div>
      <div className="mt-5 flex gap-2">
        {["w-24", "w-28", "w-20"].map((width) => (
          <div key={width} className={`h-9 ${width} ${bar}`} />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="rounded-field-lg bg-surface p-4">
            <div className={`h-8 w-full ${bar}`} />
            <div className={`mt-4 h-24 w-full rounded-field-md bg-line motion-safe:animate-pulse`} />
          </div>
        ))}
      </div>
    </div>
  );
}
