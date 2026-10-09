"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/admin/ui/button";
import { Sheet } from "@/components/admin/ui/sheet";
import { WarningIcon } from "@/components/field/icons";
import { inviteCanvasserAction } from "@/lib/admin/accounts";
import { checkEmail, checkFirstName, inviteButtonLabel } from "@/lib/admin/settings";

type Errors = { name?: string; email?: string; form?: string };

/**
 * UI-10 F5f (owner A35; frame 24). Invite a canvasser: first name and
 * email, checked when a field is left (never while typing), cleared as soon
 * as it is fixed. Sending creates the account and emails a link to set a
 * password; the account can only open the field app.
 */
export function InviteSheet({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: (text: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setErrors({});
  }, [open]);

  const send = () => {
    const nameCheck = checkFirstName(name);
    const emailCheck = checkEmail(email);
    const next: Errors = {
      name: nameCheck.ok ? undefined : nameCheck.message,
      email: emailCheck.ok ? undefined : emailCheck.message,
    };
    setErrors(next);
    if (!nameCheck.ok) {
      document.getElementById("invite-name")?.focus();
      return;
    }
    if (!emailCheck.ok) {
      document.getElementById("invite-email")?.focus();
      return;
    }
    startTransition(async () => {
      try {
        const result = await inviteCanvasserAction(nameCheck.value, emailCheck.value);
        if (result.ok) {
          onSent(result.message);
          return;
        }
        if (result.field === "name") setErrors({ name: result.message });
        else if (result.field === "email") setErrors({ email: result.message });
        else setErrors({ form: result.message });
      } catch {
        setErrors({ form: "The invite didn't send. Check your signal, then try again." });
      }
    });
  };

  const input = (bad: boolean) =>
    `mt-1.5 block min-h-12 w-full rounded-field-md border bg-surface px-3 text-admin-body focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-prop ${
      bad ? "border-oxide" : "border-line"
    }`;

  return (
    <Sheet
      open={open}
      title="Invite a canvasser"
      onClose={onClose}
      footer={
        <Button type="submit" form="invite-form" className="w-full" disabled={pending}>
          {pending ? "Sending…" : inviteButtonLabel(checkFirstName(name).ok ? name : "")}
        </Button>
      }
    >
      <form
        id="invite-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="flex flex-col gap-4"
      >
        <div>
          <label htmlFor="invite-name" className="px-1 text-admin-section">
            First name
          </label>
          <input
            id="invite-name"
            type="text"
            autoComplete="off"
            autoCapitalize="words"
            value={name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "invite-name-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name && checkFirstName(event.target.value).ok) setErrors((current) => ({ ...current, name: undefined }));
            }}
            onBlur={() => {
              const check = checkFirstName(name);
              if (name !== "" && !check.ok) setErrors((current) => ({ ...current, name: check.message }));
            }}
            data-autofocus
            className={input(Boolean(errors.name))}
          />
          {errors.name ? <FieldError id="invite-name-error" text={errors.name} /> : null}
        </div>
        <div>
          <label htmlFor="invite-email" className="px-1 text-admin-section">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "invite-email-error" : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              if (errors.email && checkEmail(event.target.value).ok) setErrors((current) => ({ ...current, email: undefined }));
            }}
            onBlur={() => {
              const check = checkEmail(email);
              if (email !== "" && !check.ok) setErrors((current) => ({ ...current, email: check.message }));
            }}
            className={input(Boolean(errors.email))}
          />
          {errors.email ? <FieldError id="invite-email-error" text={errors.email} /> : null}
        </div>
        <p className="px-1 text-admin-subhead text-ink-muted">They get an email link to set a password. They can only use the field app.</p>
        {errors.form ? (
          <p role="alert" className="px-1 text-admin-subhead text-oxide">
            {errors.form}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

function FieldError({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 px-1 text-admin-subhead text-oxide">
      <WarningIcon className="mt-px size-4 shrink-0" />
      {text}
    </p>
  );
}
