import type { ReactNode } from "react";

/**
 * UI-10 F1b. Filter chip — Figma "Chip". 36px to look at, 44px to tap (the
 * button is 44 tall; the visible chip sits inside it). On = ink fill.
 */
export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="group inline-flex h-11 shrink-0 items-center focus-visible:outline-none"
    >
      <span
        className={`inline-flex h-9 items-center rounded-full px-3.5 text-admin-pill group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-prop ${
          on ? "bg-ink text-paper" : "border border-line bg-surface text-ink"
        }`}
      >
        {children}
      </span>
    </button>
  );
}
