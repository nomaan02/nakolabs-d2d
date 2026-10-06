/**
 * UI-10 F1b. Avatar — Figma "Avatar". A canvasser's initial. Never a photo,
 * never a location. Overlap avatars with `-space-x-1.5` in a team stack.
 */
const SIZE_CLASS = {
  sm: "size-7 text-admin-pill",
  md: "size-8 text-admin-pill",
  lg: "size-10 text-admin-headline",
} as const;

export function Avatar({ initial, size = "sm" }: { initial: string; size?: keyof typeof SIZE_CLASS }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-field-bg text-ink-soft ring-2 ring-surface ${SIZE_CLASS[size]}`}
    >
      {initial}
    </span>
  );
}
