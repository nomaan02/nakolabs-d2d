"use client";

/**
 * UI-6 B2b (owner B2-1, 2026-10-04). Small scrollable view pills for the
 * Logger, under the prop name and visit line. Figma: ViewPill. Each pill
 * looks 28px tall but the button is 44px (field-ergonomics); the row's
 * negative margin keeps the header from growing by more than the pill.
 * More views are added by adding an entry; the row scrolls sideways.
 */

export type ViewTab<T extends string> = { id: T; label: string };

export function ViewTabs<T extends string>({
  views,
  active,
  onChange,
}: {
  views: ReadonlyArray<ViewTab<T>>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Logger view"
      className="-my-2 flex gap-1.5 overflow-x-auto"
      data-testid="view-tabs"
    >
      {views.map((view) => {
        const selected = view.id === active;
        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(view.id)}
            className="flex h-11 shrink-0 items-center"
            data-testid={`view-tab-${view.id}`}
          >
            <span
              className={
                selected
                  ? "flex h-7 items-center rounded-full bg-ink px-3 text-field-button-label text-surface"
                  : "flex h-7 items-center rounded-full border border-line px-3 text-field-button-label text-ink-soft"
              }
            >
              {view.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
