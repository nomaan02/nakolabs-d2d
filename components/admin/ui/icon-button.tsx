import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * UI-10 F1b. IconButton — Figma "IconButton". 44×44. Floating sits over a map
 * on a solid surface with the float shadow (never a blur). `label` is
 * required: it is the accessible name and the tooltip.
 */
export type IconButtonKind = "plain" | "floating";

const KIND_CLASS: Record<IconButtonKind, string> = {
  plain: "rounded-field-md text-ink",
  floating: "rounded-full border border-line bg-surface text-ink shadow-admin-float",
};

export function IconButton({
  label,
  kind = "plain",
  className,
  children,
  ...props
}: {
  label: string;
  kind?: IconButtonKind;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label" | "title">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[
        "inline-flex size-11 shrink-0 items-center justify-center",
        "transition-transform duration-100 active:scale-95 motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop",
        "disabled:pointer-events-none disabled:opacity-40",
        KIND_CLASS[kind],
        className ?? "",
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
