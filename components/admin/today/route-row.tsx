import { ChevronRightIcon, RouteIcon } from "@/components/field/icons";

/**
 * RT-START P1 (Figma S1 239:5276, S3a/S3b). One visit's route: its name and
 * length, where it starts, and Change (or Locked once the visit has a knock).
 * `card`: the bordered row on Add visit. `plain`: the visit sheet's row.
 */
export function RouteRow({
  title,
  sub,
  state,
  look,
  onChange,
}: {
  /** "Route A · 30.0 km". */
  title: string;
  /** "Starts on Henleaze Road · default". */
  sub: string;
  /** change: tappable. locked: says so. none: shows the route only. */
  state: "change" | "locked" | "none";
  look: "card" | "plain";
  onChange?: () => void;
}) {
  const body = (
    <>
      {look === "card" ? <RouteIcon className="size-6 shrink-0 text-ink-soft" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-admin-body-strong tabular-nums">{title}</span>
        <span className="block truncate text-admin-subhead text-ink-muted">{sub}</span>
      </span>
      {state === "change" ? (
        <span className="flex shrink-0 items-center gap-0.5 text-admin-body-strong text-prop">
          Change
          <ChevronRightIcon className="size-5" />
        </span>
      ) : state === "locked" ? (
        <span className="shrink-0 text-admin-subhead text-ink-muted">Locked</span>
      ) : null}
    </>
  );
  const frame =
    look === "card"
      ? "flex min-h-16 w-full items-center gap-3 rounded-field-lg border border-line bg-surface px-3 py-2 text-left"
      : "flex min-h-14 w-full items-center gap-3 border-t border-line pt-3 text-left";

  if (state !== "change" || !onChange) {
    return (
      <div className={frame} data-testid="route-row">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={`${title}. ${sub}. Change the route`}
      className={`${frame} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop`}
      data-testid="route-row"
    >
      {body}
    </button>
  );
}
