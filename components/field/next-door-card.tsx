"use client";

import { useEffect, useRef } from "react";

import { pulse, useInputLock } from "@/lib/field/feedback";
import type { SequenceDoor } from "@/lib/field/sequence";

/**
 * The next door, large, with the street and Take. Take claims it; the
 * outcome buttons already on the screen are the sheet.
 */
export function NextDoorCard({
  door,
  plate,
  street,
  onTake,
}: {
  door: SequenceDoor | null;
  plate: string;
  street: string | null;
  onTake: () => void;
}) {
  const lock = useInputLock();
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const uprn = door?.uprn ?? null;
    if (previous.current !== null && uprn !== null && previous.current !== uprn) pulse(20);
    previous.current = uprn;
  }, [door]);

  return (
    <section
      className="rounded-md border-2 border-ink bg-paper px-3 py-3"
      data-testid="next-door"
      data-uprn={door ? String(door.uprn) : ""}
      data-sequence={door ? String(door.position) : ""}
    >
      <p className="font-data text-xs uppercase tracking-wide text-ink">Next door</p>
      {door ? (
        <>
          <p className="mt-2 text-center font-data text-5xl leading-none" data-testid="next-door-plate">
            {plate}
          </p>
          <p className="mt-2 text-center text-base text-ink" data-testid="next-door-street">
            {street ?? `Door ${door.position + 1}`}
          </p>
          <button
            type="button"
            onClick={() =>
              lock(() => {
                pulse(30);
                onTake();
              })
            }
            className="mt-2 flex min-h-12 w-full items-center justify-center rounded-md bg-ink text-lg font-semibold text-paper"
            data-testid="take-next-door"
          >
            Take
          </button>
        </>
      ) : (
        <p className="mt-2 text-base font-semibold" data-testid="next-door-empty">
          No doors left on this prop.
        </p>
      )}
    </section>
  );
}
