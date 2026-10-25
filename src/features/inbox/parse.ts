/**
 * Schnellerfassung (B8): Kürzel im Text ordnen direkt zu.
 *   #job / #beruf / #privat / #pr…  → Bereich (Name, Anfang ab 2 Buchstaben, Kürzel „job“)
 *   @Projekt / @"zwei Wörter" / @zwei_woerter → Projekt (unscharf, siehe scoreProject)
 *   #notiz → wird eine Notiz statt einer Aufgabe (Rückmeldung 12.10.2026)
 * Ohne Kürzel → Inbox. Mehrdeutige oder unbekannte Kürzel ordnen nichts zu und bleiben im Text,
 * damit nichts verloren geht.
 */

export interface CaptureArea {
  id: string;
  name: string;
}

export interface CaptureProject {
  id: string;
  title: string;
  area_id: string;
  status: string;
}

export interface CaptureResult {
  /** Text ohne erkannte Kürzel */
  title: string;
  /** „#notiz“ → Notiz, sonst Aufgabe */
  kind: "task" | "note";
  areaId: string | null;
  projectId: string | null;
  /** @-Kürzel mit mehreren gleich guten Treffern */
  ambiguous: { token: string; candidates: CaptureProject[] } | null;
  /** @-Kürzel ohne Treffer */
  unknownProject: string | null;
  /** #-Kürzel ohne (eindeutigen) Bereich – bleiben als Text stehen */
  unknownAreas: string[];
}

/** Kleinbuchstaben, Umlaute ausgeschrieben, Bindestrich/Unterstrich als Leerzeichen. */
export function normalize(value: string): string {
  return value
    .toLocaleLowerCase("de")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Kürzel, das eine Notiz statt einer Aufgabe anlegt */
export const NOTE_TOKEN = "notiz";

/** feste Kurzformen (zusätzlich zu Name und Namensanfang) */
const AREA_ALIASES: Record<string, string[]> = {
  beruf: ["job"],
};

export function matchArea(token: string, areas: CaptureArea[]): CaptureArea | null {
  const t = normalize(token);
  if (!t) return null;
  const exact = areas.filter((a) => normalize(a.name) === t);
  if (exact.length === 1) return exact[0] as CaptureArea;
  const alias = areas.filter((a) => AREA_ALIASES[normalize(a.name)]?.includes(t));
  if (alias.length === 1) return alias[0] as CaptureArea;
  if (t.length < 2) return null;
  const prefix = areas.filter((a) => normalize(a.name).startsWith(t));
  return prefix.length === 1 ? (prefix[0] as CaptureArea) : null;
}

/** Levenshtein-Abstand (klein, für einzelne Wörter). */
export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] as number;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length] as number;
}

/**
 * Wie gut passt das Kürzel zum Projekttitel? 0 = gar nicht.
 * 100 genau · 80 Titelanfang · 60 Wortanfang · 40 enthalten · 20 Tippfehler (1 Zeichen bei
 * 4–6 Buchstaben, 2 ab 7) gegen ein Wort.
 */
export function scoreProject(token: string, title: string): number {
  const t = normalize(token);
  const name = normalize(title);
  if (!t || !name) return 0;
  if (name === t) return 100;
  if (name.startsWith(t)) return 80;
  const words = name.split(" ");
  if (words.some((w) => w.startsWith(t))) return 60;
  if (name.includes(t)) return 40;
  if (t.length >= 4 && !t.includes(" ")) {
    const allowed = t.length >= 7 ? 2 : 1;
    if (
      words.some((w) => distance(t, w) <= allowed || distance(t, w.slice(0, t.length)) <= allowed)
    ) {
      return 20;
    }
  }
  return 0;
}

const isOpen = (p: CaptureProject) => p.status !== "abgeschlossen" && p.status !== "archiv";

export function matchProject(
  token: string,
  projects: CaptureProject[],
): { project: CaptureProject | null; candidates: CaptureProject[] } {
  let best = 0;
  let candidates: CaptureProject[] = [];
  for (const project of projects.filter(isOpen)) {
    const score = scoreProject(token, project.title);
    if (score === 0 || score < best) continue;
    if (score > best) {
      best = score;
      candidates = [project];
    } else candidates.push(project);
  }
  return {
    project: candidates.length === 1 ? (candidates[0] as CaptureProject) : null,
    candidates,
  };
}

// Kürzel nur am Wortanfang: „#job“, „@Projekt“, „@"zwei Wörter"“
const TOKEN = /(^|\s)([#@])("([^"]+)"|[\p{L}\p{N}_.-]+)/gu;

export function parseCapture(
  text: string,
  ctx: { areas: CaptureArea[]; projects: CaptureProject[] },
): CaptureResult {
  let areaId: string | null = null;
  let projectId: string | null = null;
  let kind: CaptureResult["kind"] = "task";
  let ambiguous: CaptureResult["ambiguous"] = null;
  let unknownProject: string | null = null;
  const unknownAreas: string[] = [];
  const remove: Array<[number, number]> = [];

  for (const match of text.matchAll(TOKEN)) {
    const [, lead = "", sign, raw = "", quoted] = match;
    const token = (quoted ?? raw).replace(/[.]+$/, "");
    const start = (match.index ?? 0) + lead.length;
    const end = (match.index ?? 0) + match[0].length;
    if (sign === "#" && normalize(token) === NOTE_TOKEN) {
      if (kind === "task") {
        kind = "note";
        remove.push([start, end]);
      }
    } else if (sign === "#") {
      const area = matchArea(token, ctx.areas);
      if (area && !areaId) {
        areaId = area.id;
        remove.push([start, end]);
      } else if (!area) unknownAreas.push(token);
    } else {
      const { project, candidates } = matchProject(token, ctx.projects);
      if (project && !projectId) {
        projectId = project.id;
        remove.push([start, end]);
      } else if (candidates.length > 1 && !ambiguous) {
        ambiguous = { token, candidates };
      } else if (candidates.length === 0 && !unknownProject) {
        unknownProject = token;
      }
    }
  }

  let title = text;
  for (const [start, end] of [...remove].sort((a, b) => b[0] - a[0])) {
    title = title.slice(0, start) + title.slice(end);
  }
  title = title.replace(/\s+/g, " ").trim();

  // Projekt bestimmt den Bereich (wie der DB-Trigger)
  if (projectId) {
    areaId = ctx.projects.find((p) => p.id === projectId)?.area_id ?? areaId;
  }
  return { title, kind, areaId, projectId, ambiguous, unknownProject, unknownAreas };
}

/**
 * Mehrdeutiges @-Kürzel auflösen: `@bew` → `@"Bewerbung Musterfirma"` (danach erkennt `parseCapture` das
 * Projekt eindeutig und nimmt das Kürzel aus dem Titel). Passt das Kürzel nicht als ganzes Wort,
 * bleibt der Text gleich.
 */
export function resolveProjectToken(text: string, token: string, title: string): string {
  const pattern = new RegExp(`(^|\\s)@${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`);
  return text.replace(pattern, (_, lead: string) => `${lead}@"${title}"`);
}

/**
 * Auswahl aus dem Sheet „Festhalten“ (Handy): Art, Bereich und Projekt aus den Knöpfen.
 * Kürzel im Text gehen vor; ein gewähltes Projekt bestimmt den Bereich (wie der DB-Trigger).
 */
export interface CaptureChoices {
  kind?: CaptureResult["kind"];
  areaId?: string | null;
  projectId?: string | null;
}

export function applyChoices(
  result: CaptureResult,
  choices: CaptureChoices,
  projects: CaptureProject[],
): CaptureResult {
  const kind = result.kind === "note" ? "note" : (choices.kind ?? result.kind);
  const projectId = result.projectId ?? choices.projectId ?? null;
  let areaId = result.areaId ?? choices.areaId ?? null;
  if (projectId && !result.projectId) {
    areaId = projects.find((p) => p.id === projectId)?.area_id ?? areaId;
  }
  return { ...result, kind, areaId, projectId };
}
