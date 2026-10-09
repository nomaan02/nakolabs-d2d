import { leadMark, type LeadMark } from "@/lib/admin/leads";

const MARK_CLASS: Record<LeadMark, string> = {
  awaiting: "border-2 border-lead",
  reapp: "border-2 border-prop",
  sale: "bg-lead",
  pitched: "bg-ink-soft",
  closed: "bg-ink-faint",
};

/** Text colour that goes with each mark (frame 21). */
export const MARK_TEXT: Record<LeadMark, string> = {
  awaiting: "text-lead",
  reapp: "text-prop",
  sale: "text-lead",
  pitched: "text-ink-soft",
  closed: "text-ink-muted",
};

/**
 * UI-10 F5c (frame 21). The office status mark: a ring while the office
 * still has the lead, a dot once settled. Always beside its word.
 */
export function LeadMarkDot({ status }: { status: string }) {
  return <span aria-hidden className={`inline-block size-2.5 shrink-0 rounded-full ${MARK_CLASS[leadMark(status)]}`} />;
}
