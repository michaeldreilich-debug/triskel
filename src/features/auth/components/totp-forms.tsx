"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LOGIN_PATH, MFA_SETUP_PATH, safeNextPath } from "@/lib/auth/routes";
import {
  formatSecret,
  type MfaApi,
  MfaError,
  normalizeCode,
  TOTP_DIGITS,
  type TotpEnrollment,
} from "../mfa";

const messageOf = (cause: unknown) =>
  cause instanceof MfaError ? cause.message : `Das hat nicht geklappt: ${(cause as Error).message}`;

/**
 * Code eingeben und bestätigen. Bei 6 Ziffern wird sofort geprüft (Daumen zuerst), Enter und der
 * Knopf gehen ebenso. Nach Erfolg geht es zum Rücksprungziel; der Proxy sieht jetzt aal2.
 */
function CodeForm({
  api,
  factorId,
  next,
  submitLabel,
  focusWhenReady = false,
}: {
  api: MfaApi;
  factorId: string | null;
  next: string | null;
  submitLabel: string;
  /** Cursor ins Feld, sobald der Faktor bekannt ist (Abfrage; nicht bei der Einrichtung) */
  focusWhenReady?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusWhenReady && factorId) inputRef.current?.focus();
  }, [focusWhenReady, factorId]);

  async function submit(value: string) {
    if (!factorId || pending || value.length !== TOTP_DIGITS) return;
    setPending(true);
    setError(null);
    try {
      await api.verify(factorId, value);
      router.replace(safeNextPath(next));
      router.refresh();
    } catch (cause) {
      setError(messageOf(cause));
      setCode("");
      setPending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <form
      method="post"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(code);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>Code aus der App</Label>
        <Input
          ref={inputRef}
          id={inputId}
          name="code"
          value={code}
          onChange={(event) => {
            const value = normalizeCode(event.target.value);
            setCode(value);
            if (value.length === TOTP_DIGITS) void submit(value);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          placeholder="6 Ziffern"
          required
          disabled={!factorId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="text-center tabular-nums tracking-widest"
        />
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      <Button
        type="submit"
        variant="primary"
        disabled={!factorId || pending || code.length !== TOTP_DIGITS}
      >
        {pending ? "Prüfen …" : submitLabel}
      </Button>
    </form>
  );
}

function SignOutButton({ api }: { api: MfaApi }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="self-center"
      onClick={async () => {
        await api.signOut();
        router.replace(LOGIN_PATH);
        router.refresh();
      }}
    >
      Abmelden
    </Button>
  );
}

/** Abfrage nach dem Login: Code des eingerichteten Faktors eingeben. */
export function TotpChallenge({ api, next }: { api: MfaApi; next: string | null }) {
  const [factor, setFactor] = useState<{ id: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .verifiedFactorId()
      .then((id) => active && setFactor({ id }))
      .catch((cause) => active && setError(messageOf(cause)));
    return () => {
      active = false;
    };
  }, [api]);

  const setupHref = next ? `${MFA_SETUP_PATH}?next=${encodeURIComponent(next)}` : MFA_SETUP_PATH;

  return (
    <div className="flex flex-col gap-5">
      {factor && factor.id === null ? (
        <p role="status" className="text-ui text-muted">
          Für dieses Konto ist noch kein zweiter Faktor eingerichtet.{" "}
          <Link href={setupHref} className="text-link underline underline-offset-2">
            Jetzt einrichten
          </Link>
        </p>
      ) : (
        <CodeForm
          api={api}
          factorId={factor?.id ?? null}
          next={next}
          submitLabel="Bestätigen"
          focusWhenReady
        />
      )}
      {error ? <FieldError>{error}</FieldError> : null}
      <FieldHint>
        Handy nicht zur Hand? Wiederherstellung steht im README („Zweiter Faktor“).
      </FieldHint>
      <SignOutButton api={api} />
    </div>
  );
}

function SecretField({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  const [canCopy, setCanCopy] = useState(false);
  useEffect(() => setCanCopy(typeof navigator !== "undefined" && Boolean(navigator.clipboard)), []);

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-control border border-border bg-surface-2 py-1 pr-1 pl-3">
      <code
        data-testid="totp-secret"
        className="min-w-0 flex-1 select-all break-all font-mono text-ui-sm text-fg"
      >
        {formatSecret(secret)}
      </code>
      {canCopy ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? "Schlüssel kopiert" : "Schlüssel kopieren"}
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
        >
          {copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
        </Button>
      ) : null}
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <p className="text-ui font-medium text-fg">
        <span className="mr-2 text-faint tabular-nums">{number}.</span>
        {title}
      </p>
      {children}
    </li>
  );
}

/** Einrichtung: QR-Code scannen (oder Schlüssel abtippen), dann mit einem Code bestätigen. */
export function TotpSetup({ api, next }: { api: MfaApi; next: string | null }) {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // React (Strict Mode) ruft Effekte in der Entwicklung doppelt auf: nur einmal anlegen
  const started = useRef(-1);

  useEffect(() => {
    if (started.current === attempt) return;
    started.current = attempt;
    api
      .enroll()
      .then(setEnrollment)
      .catch((cause) => setError(messageOf(cause)));
  }, [api, attempt]);

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-5">
        <Step number={1} title="QR-Code mit der Authenticator-App scannen">
          {enrollment ? (
            // biome-ignore lint/performance/noImgElement: SVG als data:-URL von Supabase, kein Bild-Server nötig
            <img
              src={enrollment.qrCode}
              alt="QR-Code für die Authenticator-App"
              width={176}
              height={176}
              className="size-44 rounded-control bg-qr-bg p-2"
            />
          ) : (
            <Skeleton className="size-44" data-testid="qr-skeleton" />
          )}
        </Step>
        <Step number={2} title="Oder den Schlüssel abtippen">
          {enrollment ? <SecretField secret={enrollment.secret} /> : <Skeleton className="h-10" />}
          <FieldHint>Konto: Triskel · zeitbasiert (TOTP) · 6 Ziffern</FieldHint>
        </Step>
        <Step number={3} title="Den angezeigten Code eingeben">
          <CodeForm
            api={api}
            factorId={enrollment?.factorId ?? null}
            next={next}
            submitLabel="Einrichten"
          />
        </Step>
      </ol>
      {error ? (
        <div className="flex flex-col gap-2">
          <FieldError>{error}</FieldError>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => {
              setError(null);
              setEnrollment(null);
              setAttempt((n) => n + 1);
            }}
          >
            Erneut versuchen
          </Button>
        </div>
      ) : null}
      <FieldHint>
        Neu geladen? Dann gilt ein neuer QR-Code; den alten Eintrag in der App löschen.
      </FieldHint>
      <SignOutButton api={api} />
    </div>
  );
}
