/**
 * UI-7 C1b (owner H3). Shown on the maps when location is denied or
 * unavailable. Quiet on purpose: the Logger and maps work exactly as before.
 * The caller positions it (`className` carries the absolute offsets).
 */
export function LocationOffNotice({ className = "" }: { className?: string }) {
  return (
    <p
      role="status"
      className={`pointer-events-none absolute z-[2] flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-field-button-label text-ink-muted ${className}`}
      data-testid="location-off"
    >
      <span aria-hidden className="size-2.5 rounded-full border-2 border-ink-muted" />
      Location off
    </p>
  );
}
