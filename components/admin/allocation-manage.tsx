"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  addMemberAction,
  previewAssignmentRemoval,
  removeAssignmentAction,
  removeMemberAction,
  type RemovalPreview,
} from "@/lib/props/reallocation";

export type AllocationMember = {
  canvasserId: string;
  fullName: string;
  leftAt: string | null;
};

const control =
  "min-h-11 border border-ink/25 px-3 font-data text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-worksheet-deep disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop";

/**
 * Team and removal controls for one open allocation. Each action awaits its
 * server call and only then refreshes. A refresh must not sit between two
 * awaited actions in the same transition.
 */
export function AllocationManage({
  assignmentId,
  workDate,
  members,
  canvassers,
  bookings,
  onNotice,
}: {
  assignmentId: string;
  workDate: string;
  members: AllocationMember[];
  canvassers: { id: string; fullName: string }[];
  bookings: { canvasserId: string; workDate: string }[];
  onNotice: (text: string) => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RemovalPreview | null>(null);
  const [pending, startTransition] = useTransition();

  const active = members.filter((member) => !member.leftAt);
  const eligible = useMemo(() => {
    const taken = new Set(
      bookings.filter((booking) => booking.workDate === workDate).map((booking) => booking.canvasserId),
    );
    return canvassers.filter((person) => !taken.has(person.id));
  }, [bookings, canvassers, workDate]);

  const fail = (message: string) => {
    setError(message);
  };

  const addMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!picked) return;
    const name = canvassers.find((person) => person.id === picked)?.fullName ?? "Canvasser";
    const canvasserId = picked;
    setError(null);
    startTransition(async () => {
      try {
        const result = await addMemberAction(assignmentId, canvasserId);
        if (!result.ok) {
          fail(result.message);
          return;
        }
        setPicked("");
        onNotice(
          result.action === "readded" ? `Added ${name} back onto this visit.` : `Added ${name}.`,
        );
        router.refresh();
      } catch {
        fail("That request did not complete. Refresh the page before trying again.");
      }
    });
  };

  const removeMember = (canvasserId: string, name: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeMemberAction(assignmentId, canvasserId);
        if (!result.ok) {
          fail(result.message);
          return;
        }
        onNotice(
          result.assignmentClosed
            ? `Removed ${name}. This visit has ended.`
            : `Removed ${name}.`,
        );
        router.refresh();
      } catch {
        fail("That request did not complete. Refresh the page before trying again.");
      }
    });
  };

  const loadPreview = () => {
    setError(null);
    setPreview(null);
    startTransition(async () => {
      try {
        const result = await previewAssignmentRemoval(assignmentId);
        if (!result.ok) {
          fail(result.message);
          return;
        }
        setPreview(result.preview);
      } catch {
        fail("That request did not complete. Refresh the page before trying again.");
      }
    });
  };

  const confirmRemoval = () => {
    if (!preview) return;
    const shown = preview;
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeAssignmentAction(assignmentId);
        if (!result.ok) {
          fail(result.message);
          return;
        }
        const previewText =
          shown.kind === "close" ? `${shown.sentence} ${shown.thresholdSentence}` : shown.sentence;
        onNotice(`Preview: ${previewText} Confirmed: ${result.removal.sentence}`);
        setPreview(null);
        router.refresh();
      } catch {
        fail("That request did not complete. Refresh the page before trying again.");
      }
    });
  };

  return (
    <div className="mt-2 flex flex-col gap-3 border border-ink/15 bg-worksheet p-3" data-testid={`allocation-${assignmentId}`}>
      <div>
        <p className="font-data text-[10px] uppercase tracking-[0.16em] text-ink-soft">
          Team · {active.length} of 3
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {members.map((member) => (
            <li key={member.canvasserId} className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-[14px] text-ink" data-testid={`member-${assignmentId}-${member.canvasserId}`}>
                {member.fullName}
                {member.leftAt ? (
                  <span className="ml-2 font-data text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                    Left
                  </span>
                ) : null}
              </span>
              {!member.leftAt ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => removeMember(member.canvasserId, member.fullName)}
                  data-testid={`remove-member-${assignmentId}-${member.canvasserId}`}
                  className={control}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {active.length >= 3 ? (
        <p className="text-[13px] text-ink-soft">This team is already three.</p>
      ) : eligible.length === 0 ? (
        <p className="text-[13px] text-ink-soft">No other canvasser is free on this date.</p>
      ) : (
        <form onSubmit={addMember} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-data text-[10px] uppercase tracking-[0.16em] text-ink-soft">
              Add member
            </span>
            <select
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
              data-testid={`add-member-${assignmentId}`}
              className="min-h-11 w-full border border-ink/25 bg-paper px-3 font-data text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-prop"
            >
              <option value="">Choose a canvasser</option>
              {eligible.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending || !picked} className={`${control} w-fit`}>
            {pending ? "Saving…" : "Add member"}
          </button>
        </form>
      )}

      <div className="border-t border-ink/15 pt-3">
        {!preview ? (
          <button
            type="button"
            disabled={pending}
            onClick={loadPreview}
            data-testid={`remove-allocation-${assignmentId}`}
            className={control}
          >
            Remove allocation
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] leading-relaxed text-ink" data-testid={`removal-preview-${assignmentId}`}>
              {preview.sentence}
            </p>
            <p className="text-[13px] leading-relaxed text-ink-soft" data-testid={`removal-threshold-${assignmentId}`}>
              {preview.kind === "delete"
                ? "This cannot be undone."
                : preview.thresholdSentence}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={confirmRemoval}
                data-testid={`confirm-removal-${assignmentId}`}
                className="min-h-11 border border-oxide px-3 font-data text-[10px] uppercase tracking-[0.14em] text-oxide hover:bg-paper disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oxide"
              >
                {pending ? "Removing…" : preview.kind === "delete" ? "Delete this allocation" : "End this visit"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setPreview(null)}
                className={control}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error ? (
        <p className="text-[14px] text-oxide" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
