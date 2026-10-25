/**
 * iCalendar (RFC 5545) lesen – nur, was Google Kalender in die geheime iCal-Adresse schreibt:
 * VEVENT mit DTSTART/DTEND/DURATION (Datum, Wanduhrzeit mit TZID, UTC, „schwebend“), RRULE,
 * RDATE, EXDATE, RECURRENCE-ID (verschobene und abgesagte Instanzen), STATUS, TRANSP, SUMMARY,
 * LOCATION, DESCRIPTION. VTIMEZONE-Blöcke werden ignoriert: Google verwendet IANA-Namen, die
 * Zeitzonen-Rechnung macht @date-fns/tz. Reine Funktionen ohne Netz – Tests mit eigener ICS.
 */
import type { IsoDate } from "@/lib/dates";

export interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Ein Zeitwert, noch ohne Zeitzonen-Rechnung. */
export type IcsTime =
  | { kind: "date"; date: IsoDate }
  | {
      kind: "datetime";
      /** Wanduhrzeit */
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      second: number;
      /** IANA-Zone, "UTC" oder null = schwebend (gilt in der Zone der App) */
      tz: string | null;
    };

export interface IcsEvent {
  uid: string;
  summary: string;
  location: string | null;
  description: string | null;
  start: IcsTime | null;
  /** Ende (exklusiv); fehlt es, gilt DURATION bzw. die Vorgabe (ganztägig ein Tag, sonst 0) */
  end: IcsTime | null;
  /** Dauer in Sekunden, wenn DURATION statt DTEND gesetzt ist */
  durationSeconds: number | null;
  rrule: string | null;
  rdates: IcsTime[];
  exdates: IcsTime[];
  /** welche Instanz einer Wiederholung dieser Eintrag ersetzt */
  recurrenceId: IcsTime | null;
  cancelled: boolean;
  /** TRANSP:TRANSPARENT = als frei markiert */
  transparent: boolean;
}

export interface IcsCalendar {
  /** X-WR-CALNAME */
  name: string | null;
  events: IcsEvent[];
}

/** Zeilen entfalten (Fortsetzungszeilen beginnen mit Leerzeichen oder Tab). */
export function unfoldLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else if (raw.length > 0) {
      lines.push(raw);
    }
  }
  return lines;
}

/** `NAME;PARAM=wert;PARAM="mit:Doppelpunkt":wert` → Eigenschaft. */
export function parseProperty(line: string): IcsProperty | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = splitOutsideQuotes(head, ";");
  const name = (parts[0] ?? "").trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    // mehrere Werte (TZID hat nie mehrere) – der erste genügt, Anführungszeichen weg
    const first = splitOutsideQuotes(part.slice(eq + 1), ",")[0] ?? "";
    params[key] = first.replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

function splitOutsideQuotes(text: string, separator: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === separator && !inQuotes) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

/** TEXT-Werte: `\n`, `\,`, `\;`, `\\` auflösen. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATETIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/;

/** Einen Zeitwert lesen; `tzid` ist der TZID-Parameter der Eigenschaft. */
export function parseIcsTime(value: string, params: Record<string, string> = {}): IcsTime | null {
  const text = value.trim();
  const date = DATE_RE.exec(text);
  if (date || params.VALUE === "DATE") {
    if (!date) return null;
    return { kind: "date", date: `${date[1]}-${date[2]}-${date[3]}` };
  }
  const dt = DATETIME_RE.exec(text);
  if (!dt) return null;
  const [, y, m, d, h, mi, s, z] = dt;
  return {
    kind: "datetime",
    year: Number(y),
    month: Number(m),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s ?? "0"),
    tz: z ? "UTC" : (params.TZID ?? null),
  };
}

/** Mehrere Zeitwerte in einer Eigenschaft (EXDATE, RDATE: durch Komma getrennt). */
function parseIcsTimes(prop: IcsProperty): IcsTime[] {
  return prop.value
    .split(",")
    .map((v) => parseIcsTime(v, prop.params))
    .filter((t): t is IcsTime => t !== null);
}

const DURATION_RE = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** DURATION (`P1DT2H30M`, `PT90M`, `P2W`) → Sekunden; ungültig → null. */
export function parseDuration(value: string): number | null {
  const m = DURATION_RE.exec(value.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const seconds =
    Number(w ?? 0) * 7 * 86_400 +
    Number(d ?? 0) * 86_400 +
    Number(h ?? 0) * 3600 +
    Number(mi ?? 0) * 60 +
    Number(s ?? 0);
  return sign === "-" ? -seconds : seconds;
}

function emptyEvent(): IcsEvent {
  return {
    uid: "",
    summary: "",
    location: null,
    description: null,
    start: null,
    end: null,
    durationSeconds: null,
    rrule: null,
    rdates: [],
    exdates: [],
    recurrenceId: null,
    cancelled: false,
    transparent: false,
  };
}

/**
 * Ganze ICS-Datei → Kalendername und Termine. Unbekannte Komponenten (VTIMEZONE, VALARM, VTODO)
 * werden übersprungen; ein VEVENT ohne UID oder DTSTART fällt weg.
 */
export function parseIcs(text: string): IcsCalendar {
  const calendar: IcsCalendar = { name: null, events: [] };
  // Stapel der offenen Komponenten; nur direkt in VEVENT werden Eigenschaften gelesen
  const stack: string[] = [];
  let event: IcsEvent | null = null;
  for (const line of unfoldLines(text)) {
    const prop = parseProperty(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      const component = prop.value.trim().toUpperCase();
      stack.push(component);
      if (component === "VEVENT" && stack.length === 2) event = emptyEvent();
      continue;
    }
    if (prop.name === "END") {
      const component = stack.pop();
      if (component === "VEVENT" && stack.length === 1 && event) {
        if (event.uid && event.start) calendar.events.push(event);
        event = null;
      }
      continue;
    }
    const inside = stack[stack.length - 1];
    if (inside === "VCALENDAR") {
      if (prop.name === "X-WR-CALNAME") calendar.name = unescapeText(prop.value).trim() || null;
      continue;
    }
    if (inside !== "VEVENT" || !event) continue;
    switch (prop.name) {
      case "UID":
        event.uid = prop.value.trim();
        break;
      case "SUMMARY":
        event.summary = unescapeText(prop.value).trim();
        break;
      case "LOCATION":
        event.location = unescapeText(prop.value).trim() || null;
        break;
      case "DESCRIPTION":
        event.description = unescapeText(prop.value).trim() || null;
        break;
      case "DTSTART":
        event.start = parseIcsTime(prop.value, prop.params);
        break;
      case "DTEND":
        event.end = parseIcsTime(prop.value, prop.params);
        break;
      case "DURATION":
        event.durationSeconds = parseDuration(prop.value);
        break;
      case "RRULE":
        event.rrule = prop.value.trim() || null;
        break;
      case "RDATE":
        event.rdates.push(...parseIcsTimes(prop));
        break;
      case "EXDATE":
        event.exdates.push(...parseIcsTimes(prop));
        break;
      case "RECURRENCE-ID":
        event.recurrenceId = parseIcsTime(prop.value, prop.params);
        break;
      case "STATUS":
        event.cancelled = prop.value.trim().toUpperCase() === "CANCELLED";
        break;
      case "TRANSP":
        event.transparent = prop.value.trim().toUpperCase() === "TRANSPARENT";
        break;
      default:
        break;
    }
  }
  return calendar;
}
