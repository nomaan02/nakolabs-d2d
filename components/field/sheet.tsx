"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Bottom-anchored sheet. Everything the canvasser needs is visible at rest —
 * no hover, no long-press-to-reveal, no tooltip, none of which work with a
 * wet thumb on a doorstep.
 */
export function Sheet({
  title,
  onDismiss,
  children,
  footer,
}: {
  title: string;
  onDismiss: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-testid="field-sheet">
      <button
        type="button"
        aria-label="Close"
        onClick={onDismiss}
        className="absolute inset-0 bg-ink/45"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[85%] overflow-y-auto rounded-t-xl border-t-2 border-ink bg-paper"
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink/15 px-4 py-3">
          <h2 className="font-display text-lg tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-11 rounded-md border border-ink/25 px-4 text-sm font-medium"
          >
            Close
          </button>
        </header>
        <div className="px-4 py-3">{children}</div>
        {footer ? <div className="border-t border-ink/15 px-4 py-3">{footer}</div> : null}
      </section>
    </div>
  );
}
