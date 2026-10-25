/** MCP-Server von Triskel (früher Schaltzentrale) (#33): je Anfrage neu, mit dem Kontext des angemeldeten Nutzers. */
import { McpServer } from "@modelcontextprotocol/server";
import type { AiContext } from "./context";
import { formatSize, MAX_INLINE_UPLOAD_BYTES, MAX_RESULT_IMAGES } from "./media";
import { registerAttachmentTools } from "./tools/attachments";
import { registerCalendarTools } from "./tools/calendar";
import { registerConvertTools } from "./tools/convert";
import { registerEventLinkTools } from "./tools/event-links";
import { registerFileTools } from "./tools/files";
import { registerNoteTools } from "./tools/notes";
import { registerProjectTools } from "./tools/projects";
import { registerReadTools } from "./tools/read";
import { registerRecapTools } from "./tools/recaps";
import { registerTaskTools } from "./tools/tasks";
import { registerTrashTools } from "./tools/trash";

/** Anleitung für die KI; nennt die Adresse der App, damit Links daraus über „fetch“ gelesen werden. */
export function aiInstructions(origin: string): string {
  const host = new URL(origin).host;
  return [
    "Triskel (früher Schaltzentrale) ist ein persönliches System für Wissen und Projekte (Deutsch, Europe/Berlin).",
    "Aufbau: Bereiche (z. B. Beruf, Privat) → Projekte (befristet: Steckbrief, Ergebnis-Checkliste, nummerierte Meilensteine, Aufgaben) und Themen (dauerhaftes Wissen mit Notizen). Aufgaben ohne Zuordnung liegen in der Inbox.",
    "Aufgaben haben „zustaendig“: „ich“ (Standard) für alles, was der Nutzer tun, prüfen, testen oder entscheiden soll – auch wenn du die Aufgabe anlegst; „ki“ nur für deine eigenen Arbeitsschritte (z. B. Bauschritte, die du selbst erledigst). KI-Aufgaben erscheinen nur im Projekt, nicht auf Heute, in der Inbox oder im Kalender.",
    "Zuerst „overview“ aufrufen; IDs aus overview, search und den Listen verwenden. Namen gehen auch, unklare Namen ergeben eine Rückfrage.",
    `Links auf ${host} (…/wissen/<id>, …/projekte/<id>, …?aufgabe=<id>) sind Einträge dieser App: Schickt der Nutzer so einen Link, meint er genau diesen Eintrag. Nie im Browser oder per Web-Abruf öffnen (dort ist eine Anmeldung nötig), sondern den Link wie eine ID verwenden, z. B. mit „fetch“.`,
    "Notizen sind Gliederungen: Inhalt als verschachtelte Markdown-Liste; [[Titel]] verlinkt Notizen, #tag setzt Tags, `- [ ]` erzeugt echte Aufgaben.",
    "Wissen in der App = Notizen der Typen „Wissen“ und „Anleitung“ (Abläufe; je Typ einstellbar, siehe „overview“) – auch mit Projekt. Dauerhaftes Wissen mit passendem Typ anlegen; schnelle Notizen und Unfertiges bleiben „Idee“ (Standard), der Nutzer ordnet sie später unter „Wissen › Noch einordnen“ ein. „list_notes“ mit „nur_wissen“ zeigt nur das Wissen.",
    "Rückblicke (Woche Mo–So, Monat): „list_recaps“ zeigt sie, „create_recap“ legt einen neuen an, „update_recap“ ergänzt Antworten, Werte, Fokus und Themen (Texte werden angehängt, überschrieben nur mit modus „ersetzen“ – vorher mit „fetch“ lesen). Abschließen und löschen nur in der App.",
    `Bilder und Dateien lesen: „fetch“ liefert die Bilder einer Notiz, Aufgabe oder eines Projekt-Freitexts als Bild mit (höchstens ${MAX_RESULT_IMAGES} je Antwort; „bilder: false“ = nur Text). Weitere Bilder und den Inhalt von Dateien (PDF-Text, Textdateien) holt „get_attachment“ mit der ID des Eintrags und dem Verweis aus dem Text (![[…]] bzw. [[…]]).`,
    `Dateien anhängen: eine Datei aus dem Chat (hochgeladen oder selbst erzeugt) mit „attach_file“ und „inhalt_base64“ (Inhalt als Base64, dazu „name“ mit Endung; bis ${formatSize(MAX_INLINE_UPLOAD_BYTES)}, der Inhalt steht im Aufruf – eher für kleine Dateien); von Notion mit „attach_file“ und dem Download-Link (bis 50 MB); eine Datei vom eigenen Rechner (bis 100 MB, Bilder bis 10 MB) erst mit „prepare_upload“ (braucht „groesse“ = genaue Größe in Bytes; Hochlade-Link für 1 Stunde, nur für genau diese Größe und nur einmal), dann per HTTP-PUT mit den Headern aus „prepare_upload“ hochladen, dann „attach_file“ mit „upload“ – der Hochlade-Link geht an den Dateispeicher von Triskel (Cloudflare R2) und kann aus Claudes Cloud-Umgebung gesperrt sein, dort „inhalt_base64“ nehmen. Ist die „Triskel-Ablage“ verbunden (der eigene Mac, Werkzeuge „datei_vorbereiten“/„datei_hochladen“), Dateien vom Mac immer so ablegen: datei_vorbereiten (liefert name und groesse) → prepare_upload (mit groesse) → datei_hochladen → attach_file (bis 100 MB, Fotos verkleinert).`,
    "Termine (Google Kalender, Europe/Berlin): „list_events“ liest sie mit Kalender- und Termin-ID, „create_event“ legt an, „update_event“ ändert (Zeit, Dauer, Titel, Ort, Beschreibung, Kalender; bei Serien nur den einen Termin; vorher mit „list_events“ lesen), „delete_event“ löscht – wie „trash“ ausschließlich, wenn der Nutzer es ausdrücklich will, und erst nach seiner Bestätigung im Chat (Google hält den Termin eine Weile im Papierkorb, das KI-Protokoll holt ihn zurück). Ist Google nicht verbunden, sagt „list_events“, was zu tun ist. Termine lassen sich mit Notizen und Aufgaben verknüpfen: neue mit „termin“ bei create_note/create_task (z. B. Protokoll einer Besprechung als typ „protokoll“), vorhandene mit „link_event“, lösen mit „unlink_event“ (Notiz, Aufgabe und Termin bleiben); „list_events“ nennt die Verknüpfungen, Google selbst bleibt unverändert.",
    "Einträge (Notizen, Aufgaben, Projekte) löschen nur mit „trash“ (Papierkorb der App, wiederherstellbar) – ausschließlich, wenn der Nutzer es ausdrücklich will, und erst nach seiner Bestätigung im Chat; endgültig löschen geht nur in der App. Eine Aufgabe in eine Notiz oder eine Notiz in eine Aufgabe verwandelt „convert“ (das Original kommt in den Papierkorb; Fälligkeit, Priorität und Status bzw. Typ, Thema und Tags gehen nicht mit) – auch nur auf ausdrücklichen Wunsch des Nutzers und nach seiner Bestätigung. Vor dem Ersetzen eines Inhalts mit „fetch“ lesen. Jede Änderung steht im KI-Protokoll der App und lässt sich dort teilweise zurückholen.",
    "Antworte mit Links in die App, wenn du Einträge nennst.",
  ].join("\n");
}

export function createAiServer(ctx: AiContext): McpServer {
  const server = new McpServer(
    { name: "schaltzentrale", title: "Triskel", version: "1.0.0" },
    { instructions: aiInstructions(ctx.origin) },
  );
  registerReadTools(server, ctx);
  registerNoteTools(server, ctx);
  registerTaskTools(server, ctx);
  registerProjectTools(server, ctx);
  registerRecapTools(server, ctx);
  registerFileTools(server, ctx);
  registerAttachmentTools(server, ctx);
  registerCalendarTools(server, ctx);
  registerEventLinkTools(server, ctx);
  registerTrashTools(server, ctx);
  registerConvertTools(server, ctx);
  return server;
}
