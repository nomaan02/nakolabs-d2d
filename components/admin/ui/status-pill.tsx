/**
 * UI-10 F1b. StatusPill — Figma "StatusPill". Visit state only, never
 * ordinary metadata. "Live" becomes a button when `onClick` is given (it
 * opens the live map: current positions only, owner H5).
 */
export type VisitStatus = "live" | "out" | "due" | "done" | "not-started";

const STATUS: Record<VisitStatus, { label: string; className: string; dot: boolean }> = {
  live: { label: "Live", className: "bg-prop text-paper", dot: true },
  out: { label: "Out", className: "bg-prop-soft text-prop", dot: true },
  due: { label: "Due", className: "bg-warn-bg text-warn-ink", dot: false },
  done: { label: "Done", className: "bg-field-bg text-ink-muted", dot: false },
  "not-started": { label: "Not started", className: "bg-field-bg text-ink-soft", dot: false },
};

export function StatusPill({
  status,
  label,
  onClick,
}: {
  status: VisitStatus;
  /** Overrides the default label, e.g. "Due · 6 wks". */
  label?: string;
  onClick?: () => void;
}) {
  const style = STATUS[status];
  const body = (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-admin-pill ${style.className}`}>
      {style.dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {label ?? style.label}
    </span>
  );
  if (!onClick) return body;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
    >
      {body}
    </button>
  );
}
