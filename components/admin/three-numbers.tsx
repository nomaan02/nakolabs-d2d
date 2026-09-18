export function ThreeNumbers({
  worked,
  answered,
  remaining,
}: {
  worked: number;
  answered: number;
  remaining: number;
}) {
  return (
    <dl
      className="grid grid-cols-3 gap-px bg-ink/15"
      data-testid="coverage-three-numbers"
    >
      <Stat label="Worked" value={worked} testId="coverage-worked" />
      <Stat label="Answered" value={answered} testId="coverage-answered" />
      <Stat label="Remaining" value={remaining} testId="coverage-remaining" />
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
    <div className="bg-paper px-3 py-3">
      <dt className="font-data text-[10px] uppercase tracking-[0.16em] text-ink-soft">{label}</dt>
      <dd
        className="mt-1 font-data text-[28px] leading-none tracking-[-0.04em] text-ink tabular-nums"
        data-testid={testId}
      >
        {value.toLocaleString("en-GB")}
      </dd>
    </div>
  );
}
