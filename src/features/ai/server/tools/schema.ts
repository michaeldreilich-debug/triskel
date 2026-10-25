/** Gemeinsame Eingabe-Bausteine der Werkzeuge (#33). */
import { z } from "zod";
import { PRIORITY_INPUT, PROJECT_STATUS_INPUT, TASK_STATUS_INPUT } from "../resolve";

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT")
  .describe("Datum JJJJ-MM-TT");
export const dateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, "Zeitpunkt als JJJJ-MM-TT HH:MM (Berlin)")
  .describe("Zeitpunkt JJJJ-MM-TT HH:MM, Uhrzeit Europe/Berlin");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * ID aus einem App-Link (#47, „Link kopieren“): …/wissen/<id>, …/projekte/<id>,
 * …/aufgaben?aufgabe=<id>, …/rueckblicke/<id>. Eine reine ID bleibt, wie sie ist.
 */
export function idFromLink(value: string): string {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return text;
  try {
    const url = new URL(text);
    const task = url.searchParams.get("aufgabe");
    if (task && UUID.test(task)) return (UUID.exec(task) as RegExpExecArray)[0].toLowerCase();
    const match = UUID.exec(url.pathname);
    return match ? match[0].toLowerCase() : text;
  } catch {
    return text;
  }
}

export const id = z
  .string()
  .max(2000)
  .transform(idFromLink)
  .pipe(z.string().uuid("Eine ID (UUID) oder ein Link aus der App"))
  .describe("ID (UUID) oder kopierter Link aus der App");
export const reference = (what: string) =>
  z.string().min(1).max(200).describe(`${what}: ID oder Name`);

export const title = z.string().trim().min(1).max(500);
export const markdown = z.string().max(100_000);
/** Notiz-Typ (#34: eigene Typen) – Schlüssel oder Name, geprüft gegen die Typen des Nutzers */
export const noteType = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .describe("Notiz-Typ: Schlüssel oder Name (Liste im Überblick)");
export const taskStatus = z.enum(TASK_STATUS_INPUT);
export const projectStatus = z.enum(PROJECT_STATUS_INPUT);
export const priority = z.enum(PRIORITY_INPUT);
export const tags = z.array(z.string().trim().min(1).max(50)).max(30);
/** #77: für wen die Aufgabe ist – „ki“ nur für eigene Arbeitsschritte (stehen nur im Projekt) */
export const assignee = z
  .enum(["ich", "ki"])
  .describe(
    "Zuständig: „ich“ = der Nutzer (Standard – alles, was er tun, prüfen, testen oder entscheiden soll), „ki“ = eigener Arbeitsschritt der KI (z. B. beim Bauen; erscheint nur im Projekt, nicht auf Heute, in der Inbox oder im Kalender)",
  );
export const assigneeOf = (value: "ich" | "ki" | undefined) =>
  value === "ki" ? ("ai" as const) : ("user" as const);
