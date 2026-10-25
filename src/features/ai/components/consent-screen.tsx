"use client";

import { Check, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HOME_PATH } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/client";
import {
  CONSENT_TEXT,
  type ConsentApi,
  type ConsentDetails,
  ConsentError,
  createConsentApi,
  isKnownRedirectHost,
} from "../consent";

const messageOf = (cause: unknown) =>
  cause instanceof ConsentError
    ? cause.message
    : `Das hat nicht geklappt: ${(cause as Error).message}`;

type View =
  | { kind: "loading" }
  | { kind: "details"; details: ConsentDetails }
  | { kind: "leaving"; to: string }
  | { kind: "error"; message: string }
  /** ohne Anfrage aufgerufen: kein Fehler, nur ein Hinweis */
  | { kind: "hint" };

/** Ziel außerhalb der App: Seite verlassen (Claude, ChatGPT … übernehmen dort). */
const leave = (url: string) => window.location.assign(url);

/**
 * Freigabe-Seite (#33): Wer will zugreifen, wohin geht es danach, was darf er – Erlauben oder
 * Ablehnen. Schon erlaubte Clients gehen ohne Rückfrage weiter (Supabase merkt sich die Freigabe).
 */
export function ConsentView({
  api,
  authorizationId,
}: {
  api: ConsentApi;
  authorizationId: string | null;
}) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  /** unbekanntes Ziel bestätigt (S-2) */
  const [ownClient, setOwnClient] = useState(false);

  useEffect(() => {
    if (!authorizationId) {
      setView({ kind: "hint" });
      return;
    }
    let active = true;
    api.load(authorizationId).then(
      (state) => {
        if (!active) return;
        if (state.kind === "redirect") {
          setView({ kind: "leaving", to: new URL(state.url).host });
          leave(state.url);
        } else setView({ kind: "details", details: state.details });
      },
      (cause) => active && setView({ kind: "error", message: messageOf(cause) }),
    );
    return () => {
      active = false;
    };
  }, [api, authorizationId]);

  async function decide(allow: boolean) {
    if (view.kind !== "details" || pending) return;
    setPending(allow ? "allow" : "deny");
    try {
      const url = await api.decide(view.details, allow);
      setView({ kind: "leaving", to: new URL(url).host });
      leave(url);
    } catch (cause) {
      setPending(null);
      setView({ kind: "error", message: messageOf(cause) });
    }
  }

  if (view.kind === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-11 w-full md:h-9" />
      </div>
    );
  }
  if (view.kind === "leaving") {
    return (
      <p className="text-ui" role="status">
        Weiter zu {view.to} …
      </p>
    );
  }
  if (view.kind === "error" || view.kind === "hint") {
    return (
      <div className="flex flex-col gap-4">
        {view.kind === "error" ? (
          <FieldError>{view.message}</FieldError>
        ) : (
          <p className="text-ui text-muted">
            Diese Seite öffnet sich, wenn du in Claude oder ChatGPT Triskel verbindest.
          </p>
        )}
        <Link href={HOME_PATH} className="text-ui text-link hover:underline">
          Zu Triskel
        </Link>
      </div>
    );
  }

  const { details } = view;
  const unknownHost = !isKnownRedirectHost(details.redirectHost);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-ui" data-testid="consent-client">
        <strong className="font-semibold">{details.clientName}</strong> möchte mit deinem Triskel
        arbeiten
        {details.redirectHost ? (
          <>
            {" "}
            und kehrt danach zu <span className="font-medium">{details.redirectHost}</span> zurück
          </>
        ) : null}
        .
      </p>
      <ul className="flex flex-col gap-1.5 text-ui" aria-label="Darf">
        {CONSENT_TEXT.may.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <Check size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-success" aria-hidden />
            {item}
          </li>
        ))}
        <li className="flex items-start gap-2 text-muted">
          <X size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <span className="sr-only">Darf nicht: </span>
            {CONSENT_TEXT.mayNot}
          </span>
        </li>
      </ul>
      <p className="text-ui-sm text-muted">{CONSENT_TEXT.revoke}</p>
      {unknownHost ? (
        <div
          className="flex flex-col gap-2 rounded-control border border-warning/60 px-3 py-2 text-ui"
          data-testid="consent-unknown-host"
        >
          <p className="flex items-start gap-2">
            <TriangleAlert
              size={16}
              strokeWidth={1.5}
              className="mt-0.5 shrink-0 text-warning"
              aria-hidden
            />
            <span>
              Unbekanntes Ziel{details.redirectHost ? ` „${details.redirectHost}“` : ""}: Claude und
              ChatGPT kehren zu claude.ai bzw. chatgpt.com zurück. Wer dir diesen Link geschickt
              hat, bekäme sonst Zugriff auf deine Daten.
            </span>
          </p>
          <label className="flex min-h-11 items-center gap-2 md:min-h-8">
            <input
              type="checkbox"
              checked={ownClient}
              onChange={(event) => setOwnClient(event.currentTarget.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Ich habe diesen Zugang selbst eingerichtet
          </label>
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={() => decide(false)} disabled={pending !== null}>
          {pending === "deny" ? "Lehne ab …" : "Ablehnen"}
        </Button>
        <Button
          variant="primary"
          onClick={() => decide(true)}
          disabled={pending !== null || (unknownHost && !ownClient)}
        >
          {pending === "allow" ? "Erlaube …" : "Erlauben"}
        </Button>
      </div>
    </div>
  );
}

export function ConsentScreen() {
  const api = useMemo(() => createConsentApi(createClient()), []);
  const authorizationId = useSearchParams().get("authorization_id");
  return <ConsentView api={api} authorizationId={authorizationId} />;
}
