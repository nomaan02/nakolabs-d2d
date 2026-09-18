"use client";

import { useEffect, useState } from "react";

import { useFieldData } from "@/components/field/field-data-provider";
import {
  fetchAssignmentCompletion,
  type PropCompletion,
} from "@/lib/prop-completion";
import { createClient } from "@/lib/supabase/client";

/**
 * Status for today's prop only. Three counts, no ranking, no colour
 * grading, no comparison with other props, no percentage.
 */
export function PropStatus() {
  const { phase } = useFieldData();
  const assignmentId = phase.kind === "ready" ? phase.assignment.assignment_id : null;
  const [row, setRow] = useState<PropCompletion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!assignmentId) {
      setRow(null);
      setMessage(null);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      const result = await fetchAssignmentCompletion(createClient(), assignmentId);
      if (cancelled) return;
      if (!result.ok) {
        setRow(null);
        setMessage(result.message);
        setLoaded(true);
        return;
      }
      setMessage(null);
      setRow(result.row);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  if (phase.kind !== "ready") return null;
  if (!loaded) {
    return <p className="mt-2 text-sm text-ink-soft">Loading counts…</p>;
  }

  if (message) {
    return (
      <p className="mt-2 text-sm text-ink-soft" data-testid="prop-status-unavailable">
        {message}
      </p>
    );
  }

  if (!row) {
    return (
      <p className="mt-2 text-sm text-ink-soft" data-testid="prop-status-unavailable">
        No counts for this prop.
      </p>
    );
  }

  return (
    <dl
      className="mt-3 grid grid-cols-3 gap-px bg-ink/15"
      data-testid="prop-status"
    >
      <Stat label="Worked" value={row.worked} testId="prop-status-worked" />
      <Stat label="Answered" value={row.answered} testId="prop-status-answered" />
      <Stat label="Doors remaining" value={row.remaining} testId="prop-status-remaining" />
    </dl>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <div className="bg-paper px-2 py-3">
      <dt className="font-data text-[10px] uppercase tracking-[0.14em] text-ink-soft">{label}</dt>
      <dd
        className="mt-1 font-data text-[28px] leading-none tracking-[-0.04em] text-ink tabular-nums"
        data-testid={testId}
      >
        {value.toLocaleString("en-GB")}
      </dd>
    </div>
  );
}
