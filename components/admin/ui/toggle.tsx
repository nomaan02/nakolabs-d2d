/**
 * UI-10 F1b. Switch — Figma "Toggle". `label` is the accessible name; put the
 * visible label in the row and make the whole row the 44px target.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop disabled:opacity-40 ${
        checked ? "bg-prop" : "bg-line"
      }`}
    >
      <span
        aria-hidden
        className={`size-6 rounded-full bg-outcome-on-pill shadow-field-knob transition-transform duration-150 motion-reduce:transition-none ${
          checked ? "translate-x-5.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
