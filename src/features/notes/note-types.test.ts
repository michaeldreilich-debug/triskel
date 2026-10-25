import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { templatesKey } from "@/features/templates/api";
import type { TemplateRow } from "@/features/templates/types";
import { type SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import { notesKey } from "./api";
import { createNoteTypeActions, noteTypesKey } from "./note-types";
import type { NoteRow, NoteTypeRow } from "./types";

const undos: Array<() => void> = [];
vi.mock("@/components/ui/toast", () => ({
  notifyWithUndo: (_message: string, onUndo: () => void) => undos.push(onUndo),
  toast: () => undefined,
}));

const row = (key: string, sort: string): NoteTypeRow => ({
  id: `id-${key}`,
  key,
  name: key,
  sort,
  counts_as_knowledge: false,
  deleted_at: null,
});

function setup(types: NoteTypeRow[] | undefined) {
  const calls: SaveOp[][] = [];
  const queue = new SaveQueue({ persist: async (batch) => void calls.push(batch), debounceMs: 0 });
  const client = new QueryClient();
  if (types) client.setQueryData(noteTypesKey, types);
  client.setQueryData<Partial<TemplateRow>[]>(templatesKey, [
    { id: "v1", note_type: "besprechung" },
    { id: "v2", note_type: "idee" },
  ]);
  client.setQueryData<Partial<NoteRow>[]>(notesKey, [
    { id: "n1", type: "besprechung" },
    { id: "n2", type: "wissen" },
  ]);
  return { calls, queue, client, actions: createNoteTypeActions(queue, client) };
}

describe("Notiz-Typen anlegen und löschen (#34)", () => {
  it("neuer Typ kommt ans Ende – auch, wenn die Liste noch lädt", () => {
    const { client, actions } = setup(undefined);
    const created = actions.create("Besprechung");
    expect(created?.key).toBe("besprechung");
    expect((created?.sort ?? "") > "a5").toBe(true);
    expect(client.getQueryData<NoteTypeRow[]>(noteTypesKey)?.map((t) => t.key)).toEqual([
      "besprechung",
    ]);
    // gleicher Name: kein zweiter Typ
    const { actions: loaded } = setup([row("wissen", "a0"), row("idee", "a1")]);
    expect(loaded.create("IDEE")?.id).toBe("id-idee");
  });

  it("löschen zieht Notizen in den Zieltyp, Rückgängig holt Typ und Notizen zurück", async () => {
    const { calls, queue, client, actions } = setup([
      row("idee", "a0"),
      row("wissen", "a1"),
      row("besprechung", "a6"),
    ]);
    actions.remove("besprechung", "wissen");
    const notes = () => client.getQueryData<NoteRow[]>(notesKey)?.map((n) => n.type);
    expect(notes()).toEqual(["wissen", "wissen"]);
    await queue.flush();
    expect(calls[0]).toEqual([
      {
        table: "rpc:note_type",
        id: "besprechung",
        mode: "update",
        values: { action: "delete", p_target: "wissen" },
      },
    ]);
    const templates = () =>
      client.getQueryData<TemplateRow[]>(templatesKey)?.map((t) => t.note_type);
    expect(templates()).toEqual(["wissen", "idee"]);
    undos.pop()?.();
    expect(notes()).toEqual(["besprechung", "wissen"]);
    // auch die Vorlage kommt zurück (D-13)
    expect(templates()).toEqual(["besprechung", "idee"]);
    await queue.flush();
    expect(calls[1]?.[0]?.values).toEqual({ action: "restore", p_note_ids: ["n1"] });
    // der Standardtyp (Idee) lässt sich nicht löschen
    actions.remove("idee", "besprechung");
    await queue.flush();
    expect(calls).toHaveLength(2);
  });
});

describe("Notiz-Typ „zählt als Wissen“ (#56, Migration 39)", () => {
  it("neuer Typ zählt zunächst nicht; der Schalter wirkt sofort und wird gespeichert", async () => {
    const { calls, queue, client, actions } = setup([row("idee", "a0")]);
    const created = actions.create("Fahrzeuge");
    expect(created?.counts_as_knowledge).toBe(false);
    actions.setKnowledge(created?.id ?? "", true);
    const cached = client.getQueryData<NoteTypeRow[]>(noteTypesKey) ?? [];
    expect(cached.find((t) => t.key === "fahrzeuge")?.counts_as_knowledge).toBe(true);
    await queue.flush();
    const ops = calls.flat().filter((op) => op.table === "note_types");
    expect(ops.at(-1)?.values).toMatchObject({ counts_as_knowledge: true });
  });
});
