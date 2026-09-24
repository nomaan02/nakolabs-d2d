"use client";

import { handPhrase, variantLabel } from "@/lib/map/route-layers";

export type RouteVariantChoice = {
  key: string;
  hand: string;
  totalM: number;
  steps: number;
};

/**
 * Floating generate / save controls on the draw map. The picker only changes
 * which variant is highlighted. Save is not given the highlighted key.
 */
export function RouteOverlay({
  canGenerate,
  generateHint,
  generating,
  saving,
  variants,
  highlighted,
  stale,
  notice,
  error,
  canSave,
  onGenerate,
  onHighlight,
  onSave,
}: {
  canGenerate: boolean;
  generateHint: string | null;
  generating: boolean;
  saving: boolean;
  variants: RouteVariantChoice[];
  highlighted: string | null;
  stale: boolean;
  notice: string | null;
  error: string | null;
  canSave: boolean;
  onGenerate: () => void;
  onHighlight: (key: string) => void;
  onSave: () => void;
}) {
  const shown = variants.find((variant) => variant.key === highlighted) ?? null;

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-start gap-2">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate || generating || saving}
          data-testid="generate-route"
          className="min-h-11 bg-prop px-4 font-data text-[11px] uppercase tracking-[0.14em] text-paper hover:bg-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {generating ? "Generating…" : "Generate a route"}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          data-testid="save-route"
          className="min-h-11 border border-ink/30 bg-paper px-4 font-data text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {generateHint ? (
        <p className="pointer-events-auto bg-paper/95 px-3 py-2 text-[13px] text-ink-soft">{generateHint}</p>
      ) : null}

      {variants.length > 0 ? (
        <div
          className="pointer-events-auto flex flex-wrap gap-px bg-ink/20"
          role="radiogroup"
          aria-label="Route variant"
          data-testid="variant-picker"
        >
          {variants.map((variant) => {
            const on = variant.key === highlighted;
            return (
              <button
                key={variant.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onHighlight(variant.key)}
                className={`min-h-11 px-3 font-data text-[11px] uppercase tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop ${
                  on ? "bg-prop text-paper" : "bg-paper text-ink hover:bg-worksheet"
                }`}
              >
                {variantLabel(variant.key)}
              </button>
            );
          })}
        </div>
      ) : null}

      {shown ? (
        <p className="pointer-events-auto bg-paper/95 px-3 py-2 font-data text-[11px] text-ink" data-testid="route-detail">
          {variantLabel(shown.key)} · {shown.steps.toLocaleString("en-GB")} steps ·{" "}
          {(shown.totalM / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} km ·{" "}
          {handPhrase(shown.hand)}
        </p>
      ) : null}

      {stale ? (
        <p
          className="pointer-events-auto max-w-md border border-oxide bg-paper px-3 py-2 text-[13px] leading-snug text-ink"
          role="status"
          data-testid="route-stale"
        >
          The boundary has changed since this route was generated. Generate it again before saving.
        </p>
      ) : null}

      {notice ? (
        <p className="pointer-events-auto bg-paper/95 px-3 py-2 text-[13px] text-ink" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="pointer-events-auto max-w-md bg-paper px-3 py-2 text-[13px] text-oxide" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
