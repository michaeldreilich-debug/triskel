/**
 * Adressen der Einträge in der App – eine Quelle für „Link kopieren“ (#47) und die Links, die die
 * KI-Werkzeuge nennen (#33). Ohne Browser-Code.
 */
import { isoWeekRange } from "./dates";

/** Zeitraum eines Rückblicks als Adresse: „monat-2026-10“ bzw. „woche-2026-10-12“ (S1a). */
export const recapPeriodSlug = (kind: "woche" | "monat", start: string) =>
  kind === "monat" ? `monat-${start.slice(0, 7)}` : `woche-${isoWeekRange(start).start}`;

export const appPath = {
  /** Projekt; mit `tab` ein bestimmter Reiter (z. B. „abschluss“) */
  project: (id: string, tab?: string) =>
    tab ? `/projekte/${id}?reiter=${tab}` : `/projekte/${id}`,
  /** Projekte-Datenbank */
  projects: () => "/projekte",
  /** Zeitstrahl aller Projekte (#55) */
  timeline: () => "/projekte/zeitstrahl",
  note: (id: string) => `/wissen/${id}`,
  /** Wissen: Notizen der Typen, die als Wissen zählen (#56) */
  knowledge: () => "/wissen",
  /** Notizen-Datenbank (alle Notizen) */
  notes: () => "/notizen",
  task: (id: string) => `/aufgaben?aufgabe=${id}`,
  /** Aufgaben-Datenbank */
  tasks: () => "/aufgaben",
  recap: (id: string) => `/rueckblicke/${id}`,
  /** Liste der Rückblicke */
  recaps: () => "/rueckblicke",
  /** Rückblick eines Zeitraums – öffnet den vorhandenen oder bietet „schreiben“ an */
  recapPeriod: (kind: "woche" | "monat", start: string) =>
    `/rueckblicke/${recapPeriodSlug(kind, start)}`,
  /** Geführtes Wochenreview (S1c); mit Datum eine andere Woche als die laufende */
  weeklyReview: (week?: string) => (week ? `/wochenreview?woche=${week}` : "/wochenreview"),
  /** Kalender auf einen Tag (Woche als Standard-Ansicht) */
  calendar: (date: string, view: "tag" | "woche" | "monat" | "liste" = "woche") =>
    `/kalender?ansicht=${view}&tag=${date}`,
  /** Öffentlich freigegebene Notiz (#94) – ohne Anmeldung lesbar */
  share: (token: string) => `/freigabe/${token}`,
  /** Einstellungen; mit `section` ein Abschnitt (z. B. „kalender“, „sicherung“), der sich öffnet */
  settings: (section?: string) => (section ? `/einstellungen#${section}` : "/einstellungen"),
  /** Freigaben in den Einstellungen (#94) */
  shares: () => "/einstellungen#freigaben",
};

/**
 * Öffentliche Adresse einer freigegebenen Notiz (#94) als volle URL – für „Öffentlichen Link
 * kopieren“ und die Anzeige im Fenster. Im Browser die eigene Origin.
 */
export function publicShareUrl(token: string, origin = globalThis.location?.origin ?? ""): string {
  return `${origin}${appPath.share(token)}`;
}
