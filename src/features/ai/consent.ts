/**
 * Freigabe eines KI-Zugangs (#33): der Nutzer erlaubt auf /ki-zugang, dass Claude oder ChatGPT mit
 * seinem Triskel arbeiten darf (Supabase OAuth-Server, Seite angemeldet mit TOTP).
 * „Erlauben“ trägt den Client zuerst in ai_clients ein (nur mit aal2 möglich, Migration 21) –
 * erst diese Freigabe öffnet die Daten, denn Supabase lässt das Erlauben selbst schon mit dem
 * Passwort allein zu (E27 Fall B). Dazu Hilfen, damit die Seite nie an ein unerwartetes Ziel
 * weiterleitet.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CONSENT_PATH = "/ki-zugang";

export const CONSENT_TEXT = {
  title: "Zugang für KI erlauben",
  description: "Einmal erlauben, danach arbeitet die KI mit deinem Triskel.",
  may: [
    "suchen und lesen",
    "Notizen, Aufgaben und Projekte anlegen",
    "Einträge ändern",
    "in den Papierkorb legen – nur nach deiner Rückfrage",
  ],
  mayNot: "Endgültig löschen – das bleibt bei dir in der App.",
  revoke: "Trennen jederzeit unter Einstellungen › KI-Zugänge.",
} as const;

/** Nur https (lokal auch http://localhost) – nie javascript:, data: o. Ä. */
export function safeRedirect(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
      return url.toString();
    return null;
  } catch {
    return null;
  }
}

/**
 * Rücksprung-Ziele der KIs, die der Nutzer selbst verbindet (Claude, ChatGPT, lokal z. B. Claude
 * Code). Ein anderes Ziel heißt: Den Zugang hat womöglich jemand anderes registriert – die
 * Selbst-Registrierung (DCR) kann auch vertrauliche Clients anlegen (S-2).
 */
const KNOWN_REDIRECT_HOSTS = ["claude.ai", "claude.com", "chatgpt.com", "openai.com"];

export function isKnownRedirectHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").toLowerCase();
  if (name === "localhost" || name === "127.0.0.1") return true;
  return KNOWN_REDIRECT_HOSTS.some((known) => name === known || name.endsWith(`.${known}`));
}

/** Wohin es nach der Entscheidung geht, z. B. „claude.ai“. */
export function hostOf(value: string | null | undefined): string | null {
  const safe = safeRedirect(value);
  return safe ? new URL(safe).host : null;
}

export interface ConsentDetails {
  authorizationId: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  redirectHost: string | null;
  scopes: string[];
}

export type ConsentState =
  | { kind: "details"; details: ConsentDetails }
  /** schon erlaubt: direkt weiter */
  | { kind: "redirect"; url: string };

export class ConsentError extends Error {}

export interface ConsentApi {
  load(authorizationId: string): Promise<ConsentState>;
  decide(details: ConsentDetails, allow: boolean): Promise<string>;
}

const describe = (error: { message?: string } | null) =>
  error?.message?.includes("expired") || error?.message?.includes("not found")
    ? "Die Anfrage ist abgelaufen. Bitte in Claude bzw. ChatGPT neu verbinden."
    : `Das hat nicht geklappt${error?.message ? `: ${error.message}` : ""}.`;

/**
 * Freigabe in ai_clients eintragen bzw. nach „Trennen“ wieder öffnen. Bewusst direkt statt über
 * die Speicher-Warteschlange: Die Seite leitet gleich weiter, die Freigabe muss vorher stehen.
 */
export async function allowClient(
  client: SupabaseClient,
  details: Pick<ConsentDetails, "clientId" | "clientName">,
) {
  const table = () => client.from("ai_clients");
  const existing = await table().select("id").eq("client_id", details.clientId).maybeSingle();
  if (existing.error) throw new ConsentError(describe(existing.error));
  const result = existing.data
    ? await table()
        .update({ name: details.clientName, revoked_at: null, deleted_at: null })
        .eq("id", existing.data.id)
    : await table().insert({ client_id: details.clientId, name: details.clientName });
  if (result.error) throw new ConsentError(describe(result.error));
}

export function createConsentApi(client: SupabaseClient): ConsentApi {
  return {
    async load(authorizationId) {
      const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
      if (error || !data) throw new ConsentError(describe(error));
      if ("redirect_url" in data && !("authorization_id" in data)) {
        const url = safeRedirect(data.redirect_url);
        if (!url) throw new ConsentError("Unerwartetes Ziel – Zugang nicht freigegeben.");
        return { kind: "redirect", url };
      }
      const details = data as Extract<typeof data, { authorization_id: string }>;
      return {
        kind: "details",
        details: {
          authorizationId: details.authorization_id,
          clientId: details.client.id,
          clientName: details.client.name?.trim() || "Unbekannter Client",
          clientUri: safeRedirect(details.client.uri),
          redirectHost: hostOf(details.redirect_uri),
          scopes: (details.scope ?? "").split(" ").filter(Boolean),
        },
      };
    },
    async decide(details, allow) {
      const options = { skipBrowserRedirect: true };
      if (allow) await allowClient(client, details);
      const { data, error } = allow
        ? await client.auth.oauth.approveAuthorization(details.authorizationId, options)
        : await client.auth.oauth.denyAuthorization(details.authorizationId, options);
      if (error || !data) throw new ConsentError(describe(error));
      const url = safeRedirect(data.redirect_url);
      if (!url) throw new ConsentError("Unerwartetes Ziel – bitte neu verbinden.");
      return url;
    },
  };
}
