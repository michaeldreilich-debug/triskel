/**
 * Testdaten direkt über die API anlegen (als Testnutzer A, nur Testprojekt) – für Tests, die
 * Ansichten prüfen und nicht das Anlegen. Nutzt die Sitzung aus auth.setup (schont das Auth-Limit).
 * Alle Titel tragen das E2E-Präfix, der Teardown löscht sie.
 */
import { generateKeyBetween } from "fractional-indexing";
import { isoWeekNumber, isoWeekYear } from "@/lib/dates";
import type { Database } from "@/lib/supabase/database.types";
import { retryingFetch } from "../../support/retry-fetch";
import { type Db, userClient } from "../../support/supabase-node";
import { storedAccessToken } from "./session";

type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];
type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];

let client: Promise<Db> | null = null;

/**
 * Client als Testnutzer A mit der Sitzung aus auth.setup (keine weitere Anmeldung). Kommt die
 * Verbindung zum Testprojekt kurz nicht zustande (ECONNREFUSED unter Last, N4), wiederholt er
 * die Anfrage bis zu zweimal – Antworten und Fehler danach prüft jeder Test unverändert.
 */
export function seedDb(): Promise<Db> {
  client ??= storedAccessToken().then((session) => userClient(session, { fetch: retryingFetch() }));
  return client;
}

export async function areaIds(): Promise<{ beruf: string; privat: string }> {
  const db = await seedDb();
  const { data, error } = await db.from("areas").select("id, name").order("sort");
  if (error) throw new Error(`Bereiche: ${error.message}`);
  const byName = (name: string) => data?.find((a) => a.name === name)?.id ?? "";
  return { beruf: byName("Beruf"), privat: byName("Privat") };
}

// gültige Fractional-Indexing-Schlüssel (die App rechnet damit weiter)
let lastKey: string | null = null;
const sortKey = () => {
  lastKey = generateKeyBetween(lastKey, null);
  return lastKey;
};

export async function seedTasks(rows: Array<Partial<TaskInsert> & { title: string }>) {
  const db = await seedDb();
  const withIds = rows.map((row) => ({
    id: crypto.randomUUID(),
    body_text: "",
    status: "offen",
    in_inbox: false,
    sort: sortKey(),
    ...row,
  }));
  const { error } = await db.from("tasks").insert(withIds, { defaultToNull: false });
  if (error) throw new Error(`Aufgaben: ${error.message}`);
  return withIds.map((r) => r.id);
}

export async function seedProject(
  row: Partial<ProjectInsert> & { title: string; area_id: string },
) {
  const db = await seedDb();
  const id = crypto.randomUUID();
  const { error } = await db
    .from("projects")
    .insert({ id, sort: sortKey(), ...row }, { defaultToNull: false });
  if (error) throw new Error(`Projekt: ${error.message}`);
  return id;
}

export async function seedDependency(taskId: string, blockerId: string) {
  const db = await seedDb();
  const { error } = await db
    .from("task_dependencies")
    .insert({ task_id: taskId, blocked_by_task_id: blockerId });
  if (error) throw new Error(`Abhängigkeit: ${error.message}`);
}

/** Heutiger Kalendertag in Europe/Berlin (wie die App). */
export const berlinToday = (at: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(at);

export const berlinAddDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

type RecapInsert = Database["public"]["Tables"]["recaps"]["Insert"];

/**
 * Wochenrückblick direkt anlegen. Rückblicke haben keinen Titel: jeder Test nimmt eigene Wochen
 * (Desktop und Mobil verschieden), ein Rest aus einem abgebrochenen Lauf wird vorher entfernt.
 */
export async function seedRecap(row: Partial<RecapInsert> & { period_start: string }) {
  const db = await seedDb();
  await db.from("recaps").delete().eq("kind", "woche").eq("period_start", row.period_start);
  const id = crypto.randomUUID();
  const { error } = await db.from("recaps").insert({
    id,
    kind: "woche",
    period_end: berlinAddDays(row.period_start, 6),
    ...row,
  });
  if (error) throw new Error(`Rückblick: ${error.message}`);
  return id;
}

/** Montag der Woche, die `weeksAgo` Wochen vor der laufenden liegt (Europe/Berlin). */
export function mondayWeeksAgo(weeksAgo: number, today = berlinToday()) {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return berlinAddDays(today, -weekday - 7 * weeksAgo);
}

/** Name einer Woche in der Rückblick-Liste: Wochen anderer Jahre mit Jahr („KW 47/2025“). */
export function weekName(start: string, today = berlinToday()) {
  return isoWeekYear(start) === isoWeekYear(today)
    ? `KW ${isoWeekNumber(start)}`
    : `KW ${isoWeekNumber(start)}/${isoWeekYear(start)}`;
}

/** Erster Tag des Monats, der `monthsAgo` Monate vor dem laufenden liegt (Europe/Berlin). */
export function monthStartMonthsAgo(monthsAgo: number, today = berlinToday()) {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - monthsAgo, 1)).toISOString().slice(0, 10);
}

/** Monatsrückblick direkt anlegen (ein Rest aus einem abgebrochenen Lauf wird vorher entfernt). */
export async function seedMonthRecap(row: Partial<RecapInsert> & { period_start: string }) {
  const db = await seedDb();
  await db.from("recaps").delete().eq("kind", "monat").eq("period_start", row.period_start);
  const [y, m] = row.period_start.split("-").map(Number) as [number, number];
  const id = crypto.randomUUID();
  const { error } = await db.from("recaps").insert({
    id,
    kind: "monat",
    period_end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
    ...row,
  });
  if (error) throw new Error(`Monatsrückblick: ${error.message}`);
  return id;
}

type CalendarSourceInsert = Database["public"]["Tables"]["calendar_sources"]["Insert"];

/** Kalenderquelle direkt anlegen (Adresse zeigt auf die eigene Test-ICS unter /dev/ics). */
export async function seedCalendarSource(
  row: Partial<CalendarSourceInsert> & { name: string; url: string },
) {
  const db = await seedDb();
  const id = crypto.randomUUID();
  const { error } = await db
    .from("calendar_sources")
    .insert({ id, sort: sortKey(), color: "orange", enabled: true, ...row });
  if (error) throw new Error(`Kalenderquelle: ${error.message}`);
  return id;
}

/** Kalenderquelle endgültig entfernen (Aufräumen am Testende). */
export async function deleteCalendarSource(id: string) {
  const db = await seedDb();
  await db.from("calendar_sources").delete().eq("id", id);
}

/** Notizen direkt anlegen (Titel mit E2E-Präfix); Typ-Schlüssel wie „wissen“, „idee“, „anleitung“. */
export async function seedNotes(
  rows: Array<{
    title: string;
    area_id: string;
    type?: string;
    project_id?: string | null;
    topic_id?: string | null;
  }>,
) {
  const db = await seedDb();
  const withIds = rows.map((row) => ({ id: crypto.randomUUID(), ...row }));
  const { error } = await db.from("notes").insert(withIds);
  if (error) throw new Error(`Notizen: ${error.message}`);
  return withIds.map((r) => r.id);
}

/** Eigener Notiz-Typ (Name mit E2E-Präfix, der Teardown räumt ihn weg; gültiger Sortierschlüssel, sonst scheitert „Typ anlegen“ in der App); zählt zunächst nicht als Wissen. */
export async function seedNoteType(name: string, countsAsKnowledge = false) {
  const db = await seedDb();
  const key = `e2e-${crypto.randomUUID().slice(0, 8)}`;
  const { error } = await db.from("note_types").insert({
    key,
    name,
    sort: generateKeyBetween("a5", "a6"),
    counts_as_knowledge: countsAsKnowledge,
  });
  if (error) throw new Error(`Notiz-Typ: ${error.message}`);
  return key;
}
