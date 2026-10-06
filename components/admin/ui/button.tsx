import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * UI-10 F1b. Admin Button — Figma "Button" (page 40:289, Admin / UI-10 —
 * Components). Primary is ink, like the field Button (12:151); prop blue is
 * kept for selection, links and Quiet buttons. Danger is the filled confirm
 * inside a destructive dialog; Destructive is the quiet entry point to it.
 * Labels name the result ("Allocate Tom and Ada · Wed 7 Oct"), never "OK".
 */
export type ButtonKind = "primary" | "secondary" | "destructive" | "danger" | "quiet";
export type ButtonSize = "large" | "compact";

const KIND_CLASS: Record<ButtonKind, string> = {
  primary: "bg-ink text-paper",
  secondary: "border border-line bg-surface text-ink",
  destructive: "border border-line bg-surface text-oxide",
  danger: "bg-oxide text-paper",
  quiet: "bg-transparent text-prop",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  large: "min-h-14 px-5",
  compact: "min-h-11 px-3.5",
};

export function buttonClass(kind: ButtonKind = "primary", size: ButtonSize = "large", extra = ""): string {
  return [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-field-md text-admin-button",
    "transition-transform duration-100 active:scale-95 motion-reduce:transition-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prop",
    "disabled:pointer-events-none disabled:opacity-40",
    KIND_CLASS[kind],
    SIZE_CLASS[size],
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  kind = "primary",
  size = "large",
  className,
  children,
  ...props
}: {
  kind?: ButtonKind;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  return (
    <button type="button" className={buttonClass(kind, size, className)} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  kind = "primary",
  size = "large",
  className,
  children,
}: {
  href: string;
  kind?: ButtonKind;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(kind, size, className)}>
      {children}
    </Link>
  );
}
