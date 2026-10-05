"use client";

import { useState } from "react";

import { useGeo } from "@/components/field/geo-provider";
import { Sheet } from "@/components/field/sheet";
import { Button } from "@/components/field/ui/button";
import { setSharing, useShareState } from "@/lib/field/position-share";

/**
 * UI-7 C3b (owner U7-1). "Sharing" / "Not sharing", in the Logger and Map
 * headers. Tap: a sheet to Stop, or to share again. Hidden when location is
 * denied or unavailable, because then nothing is shared.
 */
export function SharingPill({ assignmentId }: { assignmentId: string }) {
  const geo = useGeo();
  const share = useShareState();
  const [open, setOpen] = useState(false);
  if (geo.status === "denied" || geo.status === "unavailable") return null;
  const on = !(share.assignmentId === assignmentId && share.stopped);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={on ? "Sharing your location. Tap to stop." : "Not sharing your location. Tap to share."}
        className="-my-2 flex h-11 shrink-0 items-center"
        data-testid="sharing-pill"
        data-sharing={on ? "true" : "false"}
      >
        <span className="flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-field-button-label">
          <span
            aria-hidden
            className={on ? "size-2 rounded-full bg-you" : "size-2.5 rounded-full border-2 border-ink-muted"}
          />
          <span className={on ? "text-ink-soft" : "text-ink-muted"}>{on ? "Sharing" : "Not sharing"}</span>
        </span>
      </button>
      {open ? (
        <Sheet
          title={on ? "Stop sharing your location?" : "Share your location again?"}
          onDismiss={() => setOpen(false)}
        >
          <p className="text-field-body text-ink-soft">
            {on
              ? "Your partner and admins stop seeing where you are for the rest of this prop. The arrow on your own map keeps working."
              : "Your partner sees how far along the route you are, and admins see where you are. Current position only: nothing is kept as a trail."}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              kind="primary"
              onClick={() => {
                void setSharing(assignmentId, !on);
                setOpen(false);
              }}
            >
              {on ? "Stop sharing" : "Share location"}
            </Button>
            <Button kind="secondary" onClick={() => setOpen(false)}>
              {on ? "Keep sharing" : "Not now"}
            </Button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
