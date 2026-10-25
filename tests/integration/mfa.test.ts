/**
 * B16-Abnahme (E17) gegen das Testprojekt: Ohne zweiten Faktor ist nichts lesbar, auch nicht
 * direkt über die API. Dieselbe Anmeldung von Testnutzer A einmal mit Passwort allein (aal1)
 * und einmal nach dem TOTP-Code (aal2), siehe signIn in tests/support/supabase-node.ts.
 * anon und die A/B-Isolation prüft rls.test.ts (mit aal2-Sitzungen).
 */
import { describe, expect, inject, it } from "vitest";
import { aal1Client, anonClient, type Db, runMarker, userClient } from "../support/supabase-node";

const TABLES = [
  "user_settings",
  "areas",
  "topics",
  "projects",
  "milestones",
  "tasks",
  "task_dependencies",
  "notes",
  "note_blocks",
  "links",
  "task_note_links",
  "recaps",
  "templates",
  "saved_views",
  "ai_activity",
  "ai_clients",
] as const;
const VIEWS = ["v_tasks", "v_projects"] as const;
type Relation = (typeof TABLES)[number] | (typeof VIEWS)[number];

const sessionA = inject("sessionA");
const aal1 = aal1Client(sessionA);
const aal2 = userClient(sessionA);
const anon = anonClient();
const marker = runMarker();

/** aal-Claim aus dem JWT (ohne Signaturprüfung, nur zur Kontrolle der Testvoraussetzung) */
function aalOf(token: string): unknown {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString()).aal;
}

async function select(client: Db, relation: Relation) {
  return client.from(relation as "areas").select("*");
}

describe("Voraussetzung", () => {
  it("die Tokens sind wirklich aal1 bzw. aal2 und gehören zu A", () => {
    expect(aalOf(sessionA.aal1AccessToken)).toBe("aal1");
    expect(aalOf(sessionA.accessToken)).toBe("aal2");
  });
});

describe("aal1 (nur Passwort) liest nichts", () => {
  it.each([...TABLES, ...VIEWS])("%s: leer", async (relation) => {
    const { data, error } = await select(aal1, relation);
    expect(error, `${relation}: ${error?.message}`).toBeNull();
    expect(data).toEqual([]);
  });

  it("dieselben Seeds sieht A mit aal2 (2 Bereiche, 3 Vorlagen, Einstellungen)", async () => {
    const areas = await aal2.from("areas").select("id").is("deleted_at", null);
    const templates = await aal2.from("templates").select("id").is("deleted_at", null);
    const settings = await aal2.from("user_settings").select("id");
    expect(areas.data).toHaveLength(2);
    expect(templates.data).toHaveLength(3);
    expect(settings.data).toHaveLength(1);
  });

  it("anon liest auch nichts (Gegenprobe zu aal1)", async () => {
    const { data, error } = await anon.from("areas").select("*");
    expect(data ?? []).toEqual([]);
    if (error) expect(error.code).toBe("42501");
  });
});

describe("aal1 ändert nichts", () => {
  it("Anlegen scheitert an RLS, Ändern und Löschen treffen keine Zeile", async () => {
    const { data: areas } = await aal2.from("areas").select("id, name").order("sort").limit(1);
    const area = areas?.[0];
    expect(area).toBeDefined();
    if (!area) return;

    // Ändern/Löschen zielen auf ein eigenes Probe-Thema, nie auf Seeds: Fehlt die Sperre
    // (z. B. Lauf vor Migration 13), bleiben so keine kaputten Testdaten zurück.
    const probeId = crypto.randomUUID();
    const probe = await aal2
      .from("topics")
      .insert({ id: probeId, area_id: area.id, name: `MFA-Probe ${marker}`, sort: "a0" });
    expect(probe.error).toBeNull();
    try {
      const insert = await aal1
        .from("topics")
        .insert({ area_id: area.id, name: `MFA ${marker}`, sort: "a0" });
      expect(insert.error?.code).toBe("42501");

      const update = await aal1
        .from("topics")
        .update({ name: `Gekapert ${marker}` })
        .eq("id", probeId)
        .select("id");
      expect(update.error).toBeNull();
      expect(update.data).toEqual([]);

      const remove = await aal1.from("topics").delete().eq("id", probeId).select("id");
      expect(remove.error).toBeNull();
      expect(remove.data).toEqual([]);

      const after = await aal2.from("topics").select("name").eq("id", probeId).single();
      expect(after.data?.name).toBe(`MFA-Probe ${marker}`);
      const injected = await aal2.from("topics").select("id").eq("name", `MFA ${marker}`);
      expect(injected.data).toEqual([]);
    } finally {
      await aal2.from("topics").delete().like("name", `%${marker}`);
    }
  });
});

describe("aal1: RPCs sehen nichts", () => {
  it("search_all findet mit aal1 nichts, was aal2 findet; complete_task findet die Aufgabe nicht", async () => {
    const { data: areas } = await aal2.from("areas").select("id").order("sort").limit(1);
    const taskId = crypto.randomUUID();
    const title = `Zweitfaktorprobe ${marker}`;
    const created = await aal2
      .from("tasks")
      .insert({ id: taskId, area_id: areas?.[0]?.id ?? "", title, sort: "a0" });
    expect(created.error).toBeNull();
    try {
      const visible = await aal2.rpc("search_all", { p_query: "Zweitfaktorprobe" });
      expect(visible.error).toBeNull();
      expect((visible.data ?? []).some((row) => row.id === taskId)).toBe(true);

      const hidden = await aal1.rpc("search_all", { p_query: "Zweitfaktorprobe" });
      expect(hidden.error).toBeNull();
      expect(hidden.data).toEqual([]);

      const complete = await aal1.rpc("complete_task", { p_task_id: taskId });
      expect(complete.error?.message).toMatch(/Aufgabe nicht gefunden/);
      const task = await aal2.from("tasks").select("status").eq("id", taskId).single();
      expect(task.data?.status).not.toBe("erledigt");
    } finally {
      await aal2.from("tasks").delete().eq("id", taskId);
    }
  });
});
