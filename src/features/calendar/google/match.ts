/**
 * Zuordnung iCal-Adresse → Google-Kalender (#64, N1a). Die geheime Adresse eines Google-Kalenders
 * enthält seine ID: `https://calendar.google.com/calendar/ical/<ID>/private-…/basic.ics`. Ist der
 * Kalender über das Google-Konto eingeschaltet, ist die iCal-Quelle „ersetzt durch Google“ – damit
 * nichts doppelt erscheint (das Lesen selbst stellt N1b um). Rein, ohne Server-Abhängigkeiten.
 */

export const GOOGLE_ICAL_ORIGIN = "https://calendar.google.com";
const GOOGLE_ICAL_PATH = "/calendar/ical/";

/** Kalender-ID aus der geheimen Google-Adresse; jede andere Adresse → null. */
export function calendarIdFromIcalUrl(value: string | URL): string | null {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value.trim()) : value;
  } catch {
    return null;
  }
  if (url.origin !== GOOGLE_ICAL_ORIGIN || !url.pathname.startsWith(GOOGLE_ICAL_PATH)) return null;
  const id = url.pathname.slice(GOOGLE_ICAL_PATH.length).split("/")[0] ?? "";
  try {
    return decodeURIComponent(id) || null;
  } catch {
    return null;
  }
}

/** Kalender-IDs vergleichen: E-Mail-artig, Groß/Klein egal. */
export const sameCalendarId = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * iCal-Quellen, die ein eingeschalteter Google-Kalender ersetzt: Quelle → Google-Kalender-ID.
 * Quellen ohne Google-Adresse (oder mit einem nicht eingeschalteten Kalender) fehlen.
 */
export function icalReplacedByGoogle(
  icalSources: ReadonlyArray<{ id: string; url: string }>,
  googleCalendarIds: Iterable<string>,
): Map<string, string> {
  const wanted = new Map<string, string>();
  for (const id of googleCalendarIds) wanted.set(id.trim().toLowerCase(), id);
  const replaced = new Map<string, string>();
  for (const source of icalSources) {
    const id = calendarIdFromIcalUrl(source.url);
    const google = id ? wanted.get(id.trim().toLowerCase()) : undefined;
    if (google) replaced.set(source.id, google);
  }
  return replaced;
}
