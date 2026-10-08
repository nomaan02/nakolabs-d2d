/** UI-10 F4c: the shape of Calendar while a month loads. No spinner. */
export default function CalendarLoading() {
  const bar = "rounded-full bg-line motion-safe:animate-pulse";
  return (
    <div className="mx-auto max-w-5xl px-4 pt-14 lg:px-10 lg:pt-8" role="status" aria-label="Loading Calendar">
      <div className={`h-8 w-36 ${bar}`} />
      <div className={`mt-5 h-5 w-40 ${bar}`} />
      <div className="mt-3 rounded-field-lg bg-surface p-4">
        <div className={`h-6 w-2/3 ${bar}`} />
      </div>
      <div className="mt-4 grid grid-cols-7 gap-y-6">
        {Array.from({ length: 35 }, (_, index) => (
          <div key={index} className={`mx-auto size-7 ${bar}`} />
        ))}
      </div>
    </div>
  );
}
