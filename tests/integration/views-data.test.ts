/**
 * Gespeicherte Ansichten (B6) gegen das Testprojekt: Abfrage der App, Speichern über den
 * Persister (Konfiguration als jsonb, Rundreise über parseViewConfig), anon ohne Zugriff,
 * Testnutzer A sieht nichts von B.
 */
import { afterAll, describe, expect, inject, it } from "vitest";
import { parseViewConfig } from "@/features/views/config";
import { TASK_BOARD_FIELDS, TASK_DEFAULTS, TASK_FIELDS } from "@/features/views/entities/tasks";
import { fetchSavedViews } from "@/features/views/saved";
import { createSupabasePersister, type PersisterClient } from "@/lib/save-queue/supabase-persister";
import { anonClient, runMarker, userClient } from "../support/supabase-node";

const a = userClient(inject("sessionA"));
const b = userClient(inject("sessionB"));
const marker = runMarker();
const ids = { a: crypto.randomUUID(), b: crypto.randomUUID() };

afterAll(async () => {
  await a.from("saved_views").delete().eq("id", ids.a);
  await b.from("saved_views").delete().eq("id", ids.b);
});

describe("gespeicherte Ansichten", () => {
  it("anon bekommt nichts", async () => {
    await expect(fetchSavedViews(anonClient())).rejects.toMatchObject({ code: "42501" });
  });

  it("Konfiguration übersteht die Rundreise; A sieht nur eigene Ansichten", async () => {
    const config = {
      type: "board" as const,
      filters: [
        { field: "priority", op: "in" as const, values: ["1", "2"] },
        { field: "due_date", op: "date" as const, value: "week" as const },
      ],
      sort: { field: "due_date", dir: "asc" as const },
      group: "area",
      board: "priority",
      columns: ["title", "due_date", "project"],
    };
    const persist = createSupabasePersister(() => a as unknown as PersisterClient);
    await persist([
      {
        table: "saved_views",
        id: ids.a,
        mode: "upsert",
        values: {
          entity: "tasks",
          area_id: null,
          name: `A ${marker}`,
          view_type: config.type,
          config,
          sort: "a0",
          deleted_at: null,
        },
      },
    ]);
    const { error } = await b.from("saved_views").insert({
      id: ids.b,
      entity: "tasks",
      name: `B ${marker}`,
      view_type: "liste",
      config: {},
      sort: "a0",
    });
    expect(error).toBeNull();

    const own = await fetchSavedViews(a);
    expect(own.map((v) => v.id)).toContain(ids.a);
    expect(own.map((v) => v.id)).not.toContain(ids.b);
    const saved = own.find((v) => v.id === ids.a);
    expect(parseViewConfig(saved?.config, TASK_FIELDS, TASK_DEFAULTS, TASK_BOARD_FIELDS)).toEqual(
      config,
    );
    expect((await fetchSavedViews(b)).map((v) => v.id)).toEqual(
      expect.not.arrayContaining([ids.a]),
    );
  });
});
