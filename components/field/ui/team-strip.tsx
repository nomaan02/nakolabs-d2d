/**
 * TeamStrip — Figma node 12:179.
 *
 * "Teammate lines (C1). Only when the assignment has 2+ members. 'last
 * knocked #N' comes from live knock sharing (no claims). 'last heard' =
 * stale connection. Names only, no counts or pace."
 *
 * The Figma component itself takes plain formatted strings
 * (`teammate1`/`teammate2`), not `TeammateRow`/`labelFor` — no ticking or
 * staleness logic lives in the primitive. Session C composes `rows` here
 * from `lib/field/door-signals.ts`'s `formatTeammateLine` (existing,
 * Session A), so this file stays presentational only, per this session's
 * scope (b-primitives, not wiring).
 *
 * Renders nothing for a solo assignment (`rows` empty).
 */
export type TeamStripRow = {
  /** `canvasserId` — stable React key. */
  id: string;
  /** Avatar initial, e.g. first letter of the teammate's first name. */
  initial: string;
  /** The already-formatted C1 line, e.g. "Tom · last knocked #80". */
  label: string;
  stale?: boolean;
};

export function TeamStrip({ rows }: { rows: TeamStripRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div
      className="flex h-9 w-full items-center gap-4 border-t border-line bg-surface px-4"
      data-testid="team-strip"
    >
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex shrink-0 items-center gap-1.5"
          data-testid="team-strip-row"
          data-stale={row.stale ? "true" : "false"}
        >
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-line text-field-button-label text-ink"
          >
            {row.initial}
          </span>
          <span className="whitespace-nowrap text-field-button-label text-ink-soft">{row.label}</span>
        </div>
      ))}
    </div>
  );
}
