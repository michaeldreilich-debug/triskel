/**
 * `fetch` für Testdaten-Zugriffe aus Node (E2E-Seeds, N4): Kommt die Verbindung zum
 * Supabase-Testprojekt gar nicht erst zustande (ECONNREFUSED, DNS, Zeitlimit beim Verbinden),
 * wird die Anfrage nach kurzer Pause wiederholt – höchstens zweimal. Die Anfrage hat den Server
 * dann nie erreicht, eine Wiederholung ändert also nichts doppelt. Antworten mit Fehlerstatus
 * (4xx/5xx) und Fehler nach dem Senden gehen unverändert durch: Prüfungen bleiben streng.
 */

/** Fehlercodes, bei denen keine Verbindung zustande kam. */
const CONNECT_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

interface CodedError {
  code?: unknown;
  errors?: unknown;
}

/** `fetch failed` mit einer Ursache, die nur beim Verbindungsaufbau entsteht (auch AggregateError). */
export function isConnectError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const cause = (error as { cause?: unknown }).cause as CodedError | undefined;
  if (!cause) return false;
  const nested = Array.isArray(cause.errors) ? (cause.errors as CodedError[]) : [];
  return [cause, ...nested].some((e) => typeof e?.code === "string" && CONNECT_CODES.has(e.code));
}

export function retryingFetch(
  options: { attempts?: number; delayMs?: number; fetchImpl?: typeof fetch } = {},
): typeof fetch {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (input, init) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fetchImpl(input, init);
      } catch (error) {
        if (attempt >= attempts || !isConnectError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  };
}
