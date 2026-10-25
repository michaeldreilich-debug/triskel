"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { createMfaApi } from "../mfa";
import { TotpChallenge, TotpSetup } from "./totp-forms";

/** Echte Anbindung an Supabase Auth für /mfa und /mfa/einrichten. */
function useMfa() {
  const api = useMemo(() => createMfaApi(createClient()), []);
  const next = useSearchParams().get("next");
  return { api, next };
}

export function MfaChallengeScreen() {
  const { api, next } = useMfa();
  return <TotpChallenge api={api} next={next} />;
}

export function MfaSetupScreen() {
  const { api, next } = useMfa();
  return <TotpSetup api={api} next={next} />;
}
