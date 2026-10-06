"use client";

import { useState } from "react";

import { Sheet } from "@/components/field/sheet";
import { Button } from "@/components/field/ui/button";
import type { InferredDoor } from "@/lib/field/inference";

/**
 * UI-8 D2c (owner H7, U8-2; 2026-10-06). Exceptions-only logging asks before
 * filling a gap of 25+ doors or one that crosses a street. Every door starts
 * ticked; untick any that were not knocked. Figma: page 5:2, section
 * "UI-8 Exceptions only (2026-10-06)".
 */

export type InferSheetRow = {
  door: InferredDoor;
  street: string;
  address: string;
};

export function InferSheet({
  rows,
  reason,
  onConfirm,
  onDismiss,
}: {
  rows: ReadonlyArray<InferSheetRow>;
  reason: "big_gap" | "street_change";
  onConfirm: (doors: InferredDoor[]) => void;
  onDismiss: () => void;
}) {
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(() => new Set());
  const ticked = rows.filter((row) => !unticked.has(row.door.uprn));

  const toggle = (uprn: number) => {
    setUnticked((current) => {
      const next = new Set(current);
      if (next.has(uprn)) next.delete(uprn);
      else next.add(uprn);
      return next;
    });
  };

  const subtitle =
    reason === "street_change"
      ? "You changed street since your last log. Untick any door you did not knock."
      : `${rows.length} doors since your last log. Untick any door you did not knock.`;

  return (
    <Sheet
      title={`Mark ${rows.length} doors Not In?`}
      onDismiss={onDismiss}
      footer={
        <div className="flex gap-2">
          <Button
            kind="primary"
            className="flex-1"
            disabled={ticked.length === 0}
            onClick={() => onConfirm(ticked.map((row) => row.door))}
            data-testid="infer-confirm"
          >
            {`Mark ${ticked.length} Not In`}
          </Button>
          <Button kind="secondary" className="flex-1" onClick={onDismiss} data-testid="infer-leave">
            Leave them
          </Button>
        </div>
      }
    >
      <p className="text-field-body text-ink-soft" data-testid="infer-subtitle">
        {subtitle}
      </p>
      <ul className="mt-2" data-testid="infer-list">
        {rows.map((row, i) => {
          const newStreet = i === 0 || rows[i - 1]?.street !== row.street;
          const checked = !unticked.has(row.door.uprn);
          return (
            <li key={row.door.uprn}>
              {newStreet ? (
                <p className="pt-3 pb-1 text-field-eyebrow uppercase text-ink-muted">{row.street}</p>
              ) : null}
              <label className="flex min-h-11 items-center gap-3 border-b border-line text-field-body text-ink">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(row.door.uprn)}
                  className="size-5 shrink-0 accent-prop"
                  data-testid="infer-row"
                />
                <span className="min-w-0 truncate">{row.address}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
