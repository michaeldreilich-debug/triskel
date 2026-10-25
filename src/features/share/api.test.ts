import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import type { Supabase } from "@/lib/supabase/client";
import { createShareActions, type NoteShareRow, noteSharesKey } from "./api";

const undos: Array<() => void> = [];
const messages: string[] = [];
const errors: string[] = [];
vi.mock("@/components/ui/toast", () => ({
  notifyWithUndo: (message: string, onUndo: () => void) => {
    messages.push(message);
    undos.push(onUndo);
  },
  toast: Object.assign((message: string) => void messages.push(message), {
    error: (message: string) => void errors.push(message),
  }),
}));

const share: NoteShareRow = {
  id: "s1",
  note_id: "n1",
  token: "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE",
  created_at: "2026-10-23T10:00:00.000Z",
  updated_at: "2026-10-23T10:00:00.000Z",
  revoked_at: null,
  deleted_at: null,
};

type Reply = { data: unknown[] | null; error: { code?: string } | null } | "throw";

/** Supabase-Ausschnitt `from().update().eq().select()` mit festen Antworten. */
function fakeDb(replies: Reply[]) {
  const updates: Array<{ table: string; values: Record<string, unknown>; id: unknown }> = [];
  const db = {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, id: unknown) => ({
          select: async () => {
            updates.push({ table, values, id });
            const reply = replies.shift() ?? { data: [{ id }], error: null };
            if (reply === "throw") throw new TypeError("Failed to fetch");
            return reply;
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as Supabase, updates };
}

function setup(replies: Reply[] = []) {
  const calls: SaveOp[][] = [];
  const queue = new SaveQueue({ persist: async (batch) => void calls.push(batch), debounceMs: 0 });
  const client = new QueryClient();
  client.setQueryData<NoteShareRow[]>(noteSharesKey, [share]);
  const { db, updates } = fakeDb(replies);
  const actions = createShareActions(queue, client, () => db);
  const list = () => client.getQueryData<NoteShareRow[]>(noteSharesKey) ?? [];
  return { calls, queue, actions, updates, list };
}

beforeEach(() => {
  undos.length = 0;
  messages.length = 0;
  errors.length = 0;
});

describe("Freigabe erstellen (U-8): Kopieren erst nach bestätigtem Speichern", () => {
  it("isUnsaved: wahr, solange die Zeile in der Warteschlange wartet, danach falsch", async () => {
    const { queue, actions } = setup();
    const created = actions.share("n2");
    expect(actions.isUnsaved(created.id)).toBe(true);
    // vorhandene, längst gespeicherte Freigabe: nie „ungespeichert“
    expect(actions.isUnsaved(share.id)).toBe(false);
    await queue.flush();
    expect(actions.isUnsaved(created.id)).toBe(false);
  });
});

describe("Freigabe beenden (#94): direkt gespeichert, nicht optimistisch", () => {
  it("bestätigt → aus der Liste, Meldung mit Rückgängig; nichts über die Warteschlange", async () => {
    const { actions, updates, list, calls } = setup();
    expect(await actions.end(share, "Plan")).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe("note_shares");
    expect(updates[0]?.id).toBe("s1");
    expect(typeof updates[0]?.values.revoked_at).toBe("string");
    expect(list()).toEqual([]);
    expect(messages).toEqual(["Freigabe von „Plan“ beendet – der Link gilt nicht mehr"]);
    expect(calls).toEqual([]);
  });

  it("Fehler oder offline → Fehlermeldung, Freigabe bleibt aktiv, keine Rückgängig-Meldung", async () => {
    for (const reply of [
      { data: null, error: { code: "PGRST301" } },
      "throw",
      { data: [], error: null },
    ] as Reply[]) {
      const { actions, list } = setup([reply]);
      errors.length = 0;
      expect(await actions.end(share, "Plan")).toBe(false);
      expect(list()).toEqual([share]);
      expect(errors).toEqual([
        "Freigabe konnte nicht beendet werden – der Link gilt weiter. Bitte Verbindung prüfen und noch einmal versuchen.",
      ]);
    }
    expect(undos).toEqual([]);
  });

  it("noch nicht gespeicherte Freigabe: erst speichern; bleibt sie ungespeichert, wird nicht beendet", async () => {
    const { actions, queue, updates } = setup();
    const fresh = actions.share("n2");
    // die Warteschlange bekommt nie revoked_at – ein spätes Anlegen dreht kein Beenden zurück
    expect(queue.unconfirmedOps().find((op) => op.id === fresh.id)?.values).toEqual({
      note_id: "n2",
      token: fresh.token,
    });
    expect(await actions.end(fresh, "Neu")).toBe(true);
    expect(updates.map((u) => u.id)).toEqual([fresh.id]);

    // Speichern scheitert (z. B. dauerhaft abgelehnt): die Zeile gibt es in der Datenbank nicht
    const stuck = new SaveQueue({
      persist: async () => {
        throw new Error("abgelehnt");
      },
      debounceMs: 0,
      isRetryable: () => false,
    });
    const client = new QueryClient();
    const blocked = fakeDb([]);
    const offline = createShareActions(stuck, client, () => blocked.db);
    const pending = offline.share("n3");
    expect(await offline.end(pending, "Offline")).toBe(false);
    expect(blocked.updates).toEqual([]);
    expect(errors.at(-1)).toContain("wird noch gespeichert");
    stuck.dispose();
  });

  it("Rückgängig ebenso direkt: erst nach Bestätigung wieder in der Liste; Fehler → Meldung", async () => {
    const { actions, updates, list } = setup([{ data: [{ id: "s1" }], error: null }, "throw"]);
    await actions.end(share, "Plan");
    undos[0]?.();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(updates.at(-1)?.values).toEqual({ revoked_at: null });
    expect(list()).toEqual([]);
    expect(errors[0]).toContain("der Link bleibt beendet");

    const again = setup();
    await again.actions.end(share, "Plan");
    undos.at(-1)?.();
    await vi.waitFor(() => expect(again.list()).toHaveLength(1));
    expect(again.list()[0]?.revoked_at).toBeNull();
    expect(messages.at(-1)).toBe("Freigabe von „Plan“ gilt wieder");
  });

  it("Rückgängig, wenn die Notiz inzwischen einen neuen Link hat: alter bleibt beendet", async () => {
    const { actions, updates } = setup();
    await actions.end(share, "Plan");
    actions.share("n1");
    undos[0]?.();
    await vi.waitFor(() =>
      expect(messages.at(-1)).toBe("Die Notiz hat inzwischen einen neuen öffentlichen Link."),
    );
    expect(updates).toHaveLength(1);
  });
});
