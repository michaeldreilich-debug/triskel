"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { safeNextPath } from "@/lib/auth/routes";

function errorMessage(code: string | undefined, message: string): string {
  if (code === "invalid_credentials") return "E-Mail oder Passwort stimmt nicht.";
  if (code === "email_not_confirmed") return "Die E-Mail-Adresse ist noch nicht bestätigt.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit")
    return "Zu viele Versuche. Bitte kurz warten.";
  return `Anmeldung fehlgeschlagen: ${message}`;
}

export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailId = useId();
  const passwordId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const { error: signInError } = await createClient().auth.signInWithPassword({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (signInError) {
        setError(errorMessage(signInError.code, signInError.message));
        return;
      }
      router.replace(safeNextPath(searchParams.get("next")));
      router.refresh();
    } catch (cause) {
      setError(`Anmeldung fehlgeschlagen: ${(cause as Error).message}`);
    } finally {
      setPending(false);
    }
  }

  return (
    // method="post": Läuft das Skript (noch) nicht, landen E-Mail und Passwort nie in der Adresse
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
      {!configured ? (
        <p
          role="status"
          className="rounded-control border border-warning/50 px-3 py-2 text-ui-sm text-warning"
        >
          Supabase ist noch nicht konfiguriert (.env.local). Anmelden ist erst danach möglich.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>E-Mail</Label>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          inputMode="email"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={passwordId}>Passwort</Label>
        <Input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
      <Button type="submit" variant="primary" disabled={pending || !configured}>
        {pending ? "Anmelden …" : "Anmelden"}
      </Button>
    </form>
  );
}
