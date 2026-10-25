/**
 * Nach dem Lauf: E2E-Testdaten von Testnutzer A im Testprojekt löschen (Notizen, Themen,
 * Aufgaben, Projekte, Rückblicke, Vorlagen, gespeicherte Ansichten, Bilder), Einstellungen
 * zurücksetzen und die gespeicherte Sitzung entfernen.
 */
import { rmSync } from "node:fs";
import { test as teardown } from "@playwright/test";
import { assertTestBackend } from "../guard";
import { removeR2Folders, testR2Config } from "../support/media";
import { listGrants, revokeGrant } from "../support/oauth";
import { signIn, userClient } from "../support/supabase-node";
import { AUTH_FILE, E2E_PREFIX } from "./support/auth";

teardown("E2E-Testdaten aufräumen", async () => {
  try {
    const sessionA = await signIn("A");
    const db = userClient(sessionA);
    // Notizen mit E2E-Präfix oder ohne Titel (Abbruch vor dem Benennen); Blöcke/Links per cascade
    const notes = await db.from("notes").delete().or(`title.like.${E2E_PREFIX}%,title.eq.`);
    if (notes.error) throw new Error(`Notizen: ${notes.error.message}`);
    const topics = await db.from("topics").delete().like("name", `${E2E_PREFIX}%`);
    if (topics.error) throw new Error(`Themen: ${topics.error.message}`);
    // Aufgaben in E2E-Projekten (z. B. aus der Schnellerfassung „Lebenslauf @Projekt“)
    const e2eProjects = await db.from("projects").select("id").like("title", `${E2E_PREFIX}%`);
    if (e2eProjects.error) throw new Error(`Projekte: ${e2eProjects.error.message}`);
    const projectIds = (e2eProjects.data ?? []).map((p) => p.id);
    if (projectIds.length > 0) {
      const inProjects = await db.from("tasks").delete().in("project_id", projectIds);
      if (inProjects.error) throw new Error(`Aufgaben in Projekten: ${inProjects.error.message}`);
    }
    // Aufgaben (Abhängigkeiten per cascade), auch Folgeinstanzen und unbenannte
    const tasks = await db.from("tasks").delete().or(`title.like.${E2E_PREFIX}%,title.eq.`);
    if (tasks.error) throw new Error(`Aufgaben: ${tasks.error.message}`);
    // Projekte (Meilensteine per cascade)
    const projects = await db.from("projects").delete().or(`title.like.${E2E_PREFIX}%,title.eq.`);
    if (projects.error) throw new Error(`Projekte: ${projects.error.message}`);
    // eigene Vorlagen aus E2E-Tests (auch unbenannte „Neue …-Vorlage“), die mitgelieferten bleiben
    const templates = await db
      .from("templates")
      .delete()
      .is("seed_key", null)
      .or(`name.like.${E2E_PREFIX}%,name.like.Neue %-Vorlage`);
    if (templates.error) throw new Error(`Vorlagen: ${templates.error.message}`);
    // Rückblicke haben keinen Titel; Testnutzer A legt sie nur in E2E-Tests an
    // Kalenderquellen aus Tests (S2a/S2b): Name mit Präfix
    const sources = await db.from("calendar_sources").delete().like("name", `${E2E_PREFIX}%`);
    if (sources.error) throw new Error(`Kalenderquellen: ${sources.error.message}`);
    // Google-Konto (#64): Testnutzer A verbindet nur den Google-Ersatz /dev/google
    const google = await db.from("google_accounts").delete().not("id", "is", null);
    if (google.error) throw new Error(`Google-Konto: ${google.error.message}`);
    const recaps = await db.from("recaps").delete().not("id", "is", null);
    if (recaps.error) throw new Error(`Rückblicke: ${recaps.error.message}`);
    // Notiz-Typen aus Tests (#34): Name mit Präfix; ihre Notizen sind oben schon weg
    const noteTypes = await db.from("note_types").delete().like("name", `${E2E_PREFIX}%`);
    if (noteTypes.error) throw new Error(`Notiz-Typen: ${noteTypes.error.message}`);
    const views = await db.from("saved_views").delete().like("name", `${E2E_PREFIX}%`);
    if (views.error) throw new Error(`Ansichten: ${views.error.message}`);
    // Bilder und Dateien aus E2E-Notizen/-Aufgaben (#27) im R2-Test-Bucket (E41); Testnutzer A hat
    // dort nur Testdateien, aufgeräumt wird nur unter seiner Kennung. Ohne R2 gab es keine.
    const r2 = testR2Config();
    if (r2) {
      await removeR2Folders(r2, "note-images", sessionA.userId);
      await removeR2Folders(r2, "attachments", sessionA.userId);
    }
    // KI-Zugänge aus E2E-Tests (#33) trennen, ihr Protokoll und ihre Freigaben löschen
    const env = assertTestBackend();
    const grants = await listGrants(env, sessionA.accessToken).catch(() => []);
    for (const grant of Array.isArray(grants) ? grants : []) {
      if (grant.client.name.startsWith(E2E_PREFIX))
        await revokeGrant(env, sessionA.accessToken, grant.client.id);
    }
    const activity = await db.from("ai_activity").delete().like("summary", `%${E2E_PREFIX}%`);
    if (activity.error) throw new Error(`KI-Protokoll: ${activity.error.message}`);
    const allowed = await db.from("ai_clients").delete().like("name", `${E2E_PREFIX}%`);
    if (allowed.error) throw new Error(`KI-Freigaben: ${allowed.error.message}`);
    const settings = await db
      .from("user_settings")
      .update({ theme: "dark", active_area_id: null })
      .not("id", "is", null);
    if (settings.error) throw new Error(`Einstellungen: ${settings.error.message}`);
  } finally {
    rmSync(AUTH_FILE, { force: true });
  }
});
