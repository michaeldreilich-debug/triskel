import { describe, expect, it } from "vitest";
import { RPC_TASK_STATUS } from "@/lib/save-queue/supabase-persister";
import {
  activityHref,
  canUndo,
  editedBlockIds,
  parseUndo,
  undoConflicts,
  undoNoteIds,
  undoOps,
} from "./activity";

const NOW = "2026-10-17T10:00:00.000Z";

describe("KI-Protokoll: Rückgängig (#33)", () => {
  it("Umwandeln (#65): Original zurück, Neues in den Papierkorb, Eintrag markiert", () => {
    const undo = {
      kind: "convert",
      restore: { table: "tasks", id: "t1" },
      trash: { table: "notes", id: "n1" },
    };
    expect(parseUndo(undo)).toEqual(undo);
    expect(parseUndo({ ...undo, trash: { table: "meilensteine", id: "x" } })).toBeNull();
    expect(undoOps({ id: "log9", undo }, NOW)).toEqual([
      { table: "tasks", id: "t1", mode: "update", values: { deleted_at: null } },
      { table: "notes", id: "n1", mode: "update", values: { deleted_at: NOW } },
      { table: "ai_activity", id: "log9", mode: "update", values: { undone_at: NOW } },
    ]);
  });

  it("Inhalt ersetzt → alte Blöcke zurück, neue weich weg, Titel zurück, Eintrag markiert", () => {
    const ops = undoOps(
      {
        id: "log1",
        undo: {
          kind: "replace",
          note_id: "n1",
          removed: ["b1", "b2"],
          added: ["b3"],
          note_before: { title: "Alt" },
        },
      },
      NOW,
    );
    expect(ops).toEqual([
      { table: "note_blocks", id: "b1", mode: "update", values: { deleted_at: null } },
      { table: "note_blocks", id: "b2", mode: "update", values: { deleted_at: null } },
      { table: "note_blocks", id: "b3", mode: "update", values: { deleted_at: NOW } },
      { table: "notes", id: "n1", mode: "update", values: { title: "Alt" } },
      { table: "ai_activity", id: "log1", mode: "update", values: { undone_at: NOW } },
    ]);
  });

  it("Felder zurück, erledigt → wieder öffnen über complete_task-Rückgängig", () => {
    const ops = undoOps(
      {
        id: "log2",
        undo: {
          kind: "update",
          table: "tasks",
          id: "t1",
          before: { due_date: null },
          status: { kind: "complete", task_id: "t1" },
        },
      },
      NOW,
    );
    expect(ops.map((o) => [o.table, o.id, o.values])).toEqual([
      ["tasks", "t1", { due_date: null }],
      [RPC_TASK_STATUS, "t1", { action: "undo" }],
      ["ai_activity", "log2", { undone_at: NOW }],
    ]);
    expect(
      undoOps({ id: "l", undo: { kind: "status", task_id: "t1", before: "wartet" } }, NOW)[0],
    ).toEqual({ table: "tasks", id: "t1", mode: "update", values: { status: "wartet" } });
  });

  it("Rückblick von der KI geändert → Werte und Antworten zurück (Migration 34, update_recap)", () => {
    const before = { mood: 3, answers: { good: "Lauf" } };
    const ops = undoOps(
      {
        id: "log-r",
        undo: {
          kind: "update",
          table: "recaps",
          id: "r1",
          before,
          after: { mood: 4, answers: { good: "Lauf\n\nvon der KI" } },
        },
      },
      NOW,
    );
    expect(ops).toEqual([
      { table: "recaps", id: "r1", mode: "update", values: before },
      { table: "ai_activity", id: "log-r", mode: "update", values: { undone_at: NOW } },
    ]);
    expect(activityHref({ entity: "rueckblick", entity_id: "r1" })).toBe("/rueckblicke/r1");
  });

  it("in den Papierkorb gelegt → aus dem Papierkorb zurück", () => {
    expect(undoOps({ id: "l", undo: { kind: "trash", table: "notes", id: "n1" } }, NOW)).toEqual([
      { table: "notes", id: "n1", mode: "update", values: { deleted_at: null } },
      { table: "ai_activity", id: "l", mode: "update", values: { undone_at: NOW } },
    ]);
    expect(parseUndo({ kind: "trash", table: "user_settings", id: "x" })).toBeNull();
  });

  it("Unbekanntes oder Fremdes wird nie ausgeführt; schon zurückgeholt → kein Knopf", () => {
    expect(parseUndo({ kind: "update", table: "areas", id: "x", before: {} })).toBeNull();
    expect(parseUndo({ kind: "drop" })).toBeNull();
    expect(parseUndo(null)).toBeNull();
    expect(undoOps({ id: "l", undo: "kaputt" }, NOW)).toEqual([]);
    const undo = { kind: "append", note_id: "n", added: ["b"] };
    expect(canUndo({ undo, undone_at: null })).toBe(true);
    expect(canUndo({ undo, undone_at: NOW })).toBe(false);
    expect(canUndo({ undo: null, undone_at: null })).toBe(false);
  });

  it("Links in die App", () => {
    expect(activityHref({ entity: "notiz", entity_id: "n" })).toBe("/wissen/n");
    expect(activityHref({ entity: "aufgabe", entity_id: "t" })).toBe("/aufgaben?aufgabe=t");
    expect(activityHref({ entity: "rueckblick", entity_id: "r" })).toBe("/rueckblicke/r");
    expect(activityHref({ entity: "thema", entity_id: "x" })).toBeNull();
  });
});

describe("KI-Rückgängig vollständig (G6)", () => {
  it("wieder geöffnete Wiederholung: Folgeaufgabe aus dem Papierkorb, abhaken ohne neue (S-3)", () => {
    const ops = undoOps(
      { id: "log", undo: { kind: "status", task_id: "t1", before: "erledigt", restore: ["f1"] } },
      NOW,
    );
    expect(ops).toEqual([
      { table: "tasks", id: "f1", mode: "update", values: { deleted_at: null } },
      { table: RPC_TASK_STATUS, id: "t1", mode: "update", values: { action: "complete" } },
      { table: "ai_activity", id: "log", mode: "update", values: { undone_at: NOW } },
    ]);
  });

  it("angehängte Checkboxen: die daraus entstandenen Aufgaben kommen mit in den Papierkorb (S-4)", () => {
    const ops = undoOps(
      { id: "log", undo: { kind: "append", note_id: "n1", added: ["b1"], tasks_added: ["t9"] } },
      NOW,
    );
    expect(ops).toContainEqual({
      table: "tasks",
      id: "t9",
      mode: "update",
      values: { deleted_at: NOW },
    });
  });

  it("Projekt: Meilensteine zurück, ergänzte in den Papierkorb – auch ohne Projektfelder (S-10)", () => {
    const undo = {
      kind: "update",
      table: "projects",
      id: "p1",
      before: {},
      milestones_before: { m1: { done_at: null } },
      milestones_added: ["m2"],
    };
    expect(canUndo({ undo, undone_at: null })).toBe(true);
    expect(undoOps({ id: "log", undo }, NOW)).toEqual([
      { table: "milestones", id: "m1", mode: "update", values: { done_at: null } },
      { table: "milestones", id: "m2", mode: "update", values: { deleted_at: NOW } },
      { table: "ai_activity", id: "log", mode: "update", values: { undone_at: NOW } },
    ]);
  });

  it("seitdem selbst geändert: nennt die Felder, Gleiches trotz anderer Schreibweise nicht (D-8)", () => {
    const undo = parseUndo({
      kind: "update",
      table: "tasks",
      id: "t1",
      before: { title: "Alt", body: null, body_text: "", scheduled_at: null },
      after: {
        title: "KI",
        body: { type: "doc", content: [{ type: "p", attrs: { a: 1, b: 2 } }] },
        body_text: "x",
        scheduled_at: "2026-10-18T08:00:00.000Z",
      },
    });
    const untouched = {
      title: "KI",
      body: { content: [{ attrs: { b: 2, a: 1 }, type: "p" }], type: "doc" },
      body_text: "anders, aber abgeleitet",
      scheduled_at: "2026-10-18T08:00:00+00:00",
    };
    expect(undoConflicts(undo, untouched)).toEqual([]);
    expect(undoConflicts(undo, { ...untouched, title: "Alex" })).toEqual(["title"]);
    // ohne „nachher“ (ältere Einträge) lässt sich nichts vergleichen
    expect(
      undoConflicts(parseUndo({ kind: "update", table: "tasks", id: "t1", before: {} }), {}),
    ).toEqual([]);
  });
});

describe("Rückgängig-Daten aus der Datenbank: Positivliste (Review Teil B, M-1/K-4)", () => {
  it("update: nur bekannte Spalten je Tabelle – deleted_at, user_id, id, status fallen weg", () => {
    const undo = parseUndo({
      kind: "update",
      table: "notes",
      id: "n1",
      before: { deleted_at: null, user_id: "fremd", id: "x", title: "Alt", status: "offen" },
      after: { deleted_at: "2026-10-24T10:00:00Z", title: "KI" },
    });
    expect(undo).toEqual({
      kind: "update",
      table: "notes",
      id: "n1",
      before: { title: "Alt" },
      after: { title: "KI" },
    });
    // Rückblick: Art, Zeitraum, Abschluss und Statistik bleiben außen vor (Migration 34 öffnet sie)
    expect(
      parseUndo({
        kind: "update",
        table: "recaps",
        id: "r1",
        before: { kind: "woche", period_start: "2026-01-01", closed_at: null, mood: 2, stats: {} },
      }),
    ).toMatchObject({ before: { mood: 2 } });
    // Aufgabe: Status läuft nur über die RPC (kind „status“/„complete“), nie als Spalte
    expect(
      parseUndo({
        kind: "update",
        table: "tasks",
        id: "t1",
        before: { status: "offen", deleted_at: null, due_date: "2026-10-30" },
      }),
    ).toMatchObject({ before: { due_date: "2026-10-30" } });
    // Termin-Verknüpfung: deleted_at nur als Zeitpunkt oder null
    expect(
      parseUndo({ kind: "update", table: "event_links", id: "e1", before: { deleted_at: 5 } }),
    ).toMatchObject({ before: {} });
    expect(
      parseUndo({ kind: "update", table: "event_links", id: "e1", before: { deleted_at: null } }),
    ).toMatchObject({ before: { deleted_at: null } });
  });

  it("replace: note_before und Meilensteine ebenso gefiltert; Status nur aus der Werteliste", () => {
    expect(
      parseUndo({
        kind: "replace",
        note_id: "n1",
        removed: ["b1"],
        added: [],
        note_before: { deleted_at: null, user_id: "fremd" },
      }),
    ).toEqual({ kind: "replace", note_id: "n1", removed: ["b1"], added: [] });
    expect(
      parseUndo({
        kind: "update",
        table: "projects",
        id: "p1",
        before: {},
        milestones_before: { m1: { done_at: null, deleted_at: null }, m2: { user_id: "fremd" } },
      }),
    ).toEqual({
      kind: "update",
      table: "projects",
      id: "p1",
      before: {},
      milestones_before: { m1: { done_at: null } },
    });
    expect(parseUndo({ kind: "status", task_id: "t1", before: "gekapert" })).toBeNull();
    expect(parseUndo({ kind: "status", task_id: "t1", before: "wartet" })).toMatchObject({
      before: "wartet",
    });
    // Termin anlegen ohne etag: kein Rückgängig (die App-Route prüft keine Serie)
    expect(parseUndo({ kind: "event_create", calendar_id: "c", event_id: "e" })).toBeNull();
    expect(
      undoOps(
        {
          id: "l",
          undo: { kind: "update", table: "notes", id: "n1", before: { deleted_at: null } },
        },
        NOW,
      ),
    ).toEqual([{ table: "ai_activity", id: "l", mode: "update", values: { undone_at: NOW } }]);
  });

  it("undoNoteIds: welche Notizen ein Rückgängig berührt (Rückfrage bei Freigabe)", () => {
    expect(undoNoteIds(parseUndo({ kind: "append", note_id: "n1", added: [] }))).toEqual(["n1"]);
    expect(
      undoNoteIds(parseUndo({ kind: "update", table: "notes", id: "n2", before: {} })),
    ).toEqual(["n2"]);
    expect(undoNoteIds(parseUndo({ kind: "trash", table: "notes", id: "n3" }))).toEqual(["n3"]);
    expect(undoNoteIds(parseUndo({ kind: "trash", table: "tasks", id: "t1" }))).toEqual([]);
    expect(
      undoNoteIds(
        parseUndo({
          kind: "convert",
          restore: { table: "notes", id: "n4" },
          trash: { table: "tasks", id: "t1" },
        }),
      ),
    ).toEqual(["n4"]);
    expect(undoNoteIds(null)).toEqual([]);
  });

  it("editedBlockIds: eingefügte Blöcke, die seitdem bearbeitet wurden (K-2)", () => {
    expect(
      editedBlockIds([
        { id: "a", created_at: "2026-10-24T10:00:00+00:00", updated_at: "2026-10-24T10:00:00Z" },
        { id: "b", created_at: "2026-10-24T10:00:00Z", updated_at: "2026-10-24T10:00:01Z" },
      ]),
    ).toEqual(["b"]);
  });
});

describe("KI-Protokoll: Termine (N1d)", () => {
  it("Link führt auf den Tag im Kalender, nur mit Datum in den Rückgängig-Daten", () => {
    expect(
      activityHref({
        entity: "termin",
        entity_id: null,
        undo: { kind: "event_create", date: "2026-12-09" },
      }),
    ).toBe("/kalender?ansicht=tag&tag=2026-12-09");
    expect(activityHref({ entity: "termin", entity_id: null, undo: null })).toBeNull();
    expect(
      activityHref({ entity: "termin", entity_id: null, undo: { date: "morgen" } }),
    ).toBeNull();
  });
});
