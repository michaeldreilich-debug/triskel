"use client";

/**
 * Öffentliche Freigaben im Client (#94, E42): lesen (`useNoteShares`, nur die aktiven, eine kleine
 * Tabelle ganz im Speicher). Freigeben geht über die Speicher-Warteschlange (neuer Token aus
 * dem Browser); Beenden und sein Rückgängig gehen direkt an die Datenbank und gelten erst nach der
 * Bestätigung (Sicherheit vor Komfort: „beendet“ heißt, der Link ist wirklich tot). Ein beendeter
 * Token kommt nur über dieses Rückgängig wieder; neues Freigeben erzeugt einen neuen.
 */
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { notifyWithUndo, toast } from "@/components/ui/toast";
import { fetchAll } from "@/lib/data/fetch-all";
import { useSupabase } from "@/lib/data/provider";
import { fetchWithOverlay } from "@/lib/data/unconfirmed";
import { newId } from "@/lib/id";
import { useSaveQueue } from "@/lib/save-queue/react";
import type { SaveQueue } from "@/lib/save-queue/save-queue";
import type { Supabase } from "@/lib/supabase/client";
import { newShareToken } from "./token";

/** Cache-Schlüssel = Tabellenname (wie bei den übrigen Tabellen) */
export const noteSharesKey = ["note_shares"] as const;

export interface NoteShareRow {
  id: string;
  note_id: string;
  token: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  deleted_at: string | null;
}

const COLUMNS = "id, note_id, token, created_at, updated_at, revoked_at, deleted_at";

const isActive = (share: NoteShareRow) => !share.revoked_at && !share.deleted_at;

function toShare(row: Record<string, unknown> & { id: string }): NoteShareRow {
  const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  const now = new Date().toISOString();
  return {
    id: row.id,
    note_id: text("note_id") ?? "",
    token: text("token") ?? "",
    created_at: text("created_at") ?? now,
    updated_at: text("updated_at") ?? now,
    revoked_at: text("revoked_at"),
    deleted_at: text("deleted_at"),
  };
}

type RawRow = Record<string, unknown> & { id: string };

async function fetchShareRows(client: Supabase): Promise<RawRow[]> {
  return fetchAll<RawRow>(
    async (from, to) =>
      (await client
        .from("note_shares")
        .select(COLUMNS)
        .is("revoked_at", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)) as { data: RawRow[] | null; error: unknown },
  );
}

/** Aktive Freigaben, neueste zuerst (auch Notizen im Papierkorb: deren Freigabe ruht nur). */
export function useNoteShares() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  return useQuery({
    queryKey: noteSharesKey,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await fetchWithOverlay(queue, "note_shares", () => fetchShareRows(getSupabase()), {
          include: () => true,
        })
      )
        .map(toShare)
        .filter(isActive)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)),
  });
}

/** Aktive Freigabe einer Notiz (oder null). */
export function useNoteShare(noteId: string): NoteShareRow | null {
  const shares = useNoteShares();
  return shares.data?.find((s) => s.note_id === noteId) ?? null;
}

/** Höchstens so lange auf Ungespeichertes warten, bevor direkt beendet wird. */
const FLUSH_WAIT_MS = 3000;

const ENDED_FAILED =
  "Freigabe konnte nicht beendet werden – der Link gilt weiter. Bitte Verbindung prüfen und noch einmal versuchen.";

export function createShareActions(
  queue: SaveQueue,
  queryClient: QueryClient,
  getSupabase: () => Supabase,
) {
  const list = () => queryClient.getQueryData<NoteShareRow[]>(noteSharesKey) ?? [];
  const setList = (update: (old: NoteShareRow[]) => NoteShareRow[]) =>
    queryClient.setQueryData<NoteShareRow[]>(noteSharesKey, (old) => update(old ?? []));
  const activeFor = (noteId: string) => list().find((s) => s.note_id === noteId && isActive(s));
  const unsaved = (id: string) =>
    queue.unconfirmedOps().some((op) => op.table === "note_shares" && op.id === id);

  /** revoked_at direkt in der Datenbank setzen (nicht über die Warteschlange); true = bestätigt. */
  const setRevoked = async (id: string, revokedAt: string | null) => {
    const { data, error } = await getSupabase()
      .from("note_shares")
      .update({ revoked_at: revokedAt })
      .eq("id", id)
      .select("id");
    return { ok: !error && (data?.length ?? 0) === 1, code: error?.code };
  };

  return {
    /**
     * Noch nicht bestätigt gespeichert (U-8): Der Link gilt erst, wenn die Zeile in der Datenbank
     * steht – bis dahin sperrt der Dialog das Kopieren (offline oder 23505 vom zweiten Gerät
     * ergäben sonst einen toten Link beim Empfänger).
     */
    isUnsaved(shareId: string): boolean {
      return unsaved(shareId);
    },

    /**
     * Freigeben: vorhandene aktive Freigabe bleibt, sonst eine neue mit neuem Token (über die
     * Warteschlange; `revoked_at` schreibt sie nie – ein spät gesendetes Anlegen kann ein Beenden
     * so nicht zurückdrehen).
     */
    share(noteId: string): NoteShareRow {
      const existing = activeFor(noteId);
      if (existing) return existing;
      const now = new Date().toISOString();
      const row: NoteShareRow = {
        id: newId(),
        note_id: noteId,
        token: newShareToken(),
        created_at: now,
        updated_at: now,
        revoked_at: null,
        deleted_at: null,
      };
      setList((old) => [row, ...old.filter((s) => s.id !== row.id)]);
      queue.enqueue({
        table: "note_shares",
        id: row.id,
        mode: "upsert",
        values: { note_id: noteId, token: row.token },
      });
      return row;
    },

    /**
     * Beenden – nicht optimistisch: direkt in der Datenbank, die Meldung (mit Rückgängig) erst nach
     * der Bestätigung. Offline oder Fehler: klare Meldung, die Freigabe gilt weiter als aktiv.
     * true = beendet.
     */
    async end(share: NoteShareRow, title: string): Promise<boolean> {
      // gerade erst angelegt: erst speichern, sonst gibt es die Zeile noch nicht
      await Promise.race([
        queue.flush(),
        new Promise<void>((resolve) => setTimeout(resolve, FLUSH_WAIT_MS)),
      ]);
      if (unsaved(share.id)) {
        toast.error(
          "Die Freigabe wird noch gespeichert – sie gilt weiter. Gleich noch einmal beenden.",
        );
        return false;
      }
      let result: { ok: boolean };
      try {
        result = await setRevoked(share.id, new Date().toISOString());
      } catch {
        result = { ok: false };
      }
      if (!result.ok) {
        toast.error(ENDED_FAILED);
        return false;
      }
      setList((old) => old.filter((s) => s.id !== share.id));
      notifyWithUndo(`Freigabe von „${title}“ beendet – der Link gilt nicht mehr`, () => {
        void (async () => {
          // inzwischen neu freigegeben: der neue Link gilt, der alte bleibt beendet
          if (activeFor(share.note_id)) {
            toast("Die Notiz hat inzwischen einen neuen öffentlichen Link.");
            return;
          }
          let restored: { ok: boolean; code?: string };
          try {
            restored = await setRevoked(share.id, null);
          } catch {
            restored = { ok: false };
          }
          if (!restored.ok) {
            toast.error(
              restored.code === "23505"
                ? "Die Notiz hat inzwischen einen neuen öffentlichen Link."
                : "Freigabe konnte nicht wiederhergestellt werden – der Link bleibt beendet. Bitte Verbindung prüfen.",
            );
            return;
          }
          setList((old) => [
            { ...share, revoked_at: null },
            ...old.filter((s) => s.id !== share.id),
          ]);
          toast(`Freigabe von „${title}“ gilt wieder`);
        })();
      });
      return true;
    },
  };
}

export function useShareActions() {
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  const getSupabase = useSupabase();
  return useMemo(
    () => createShareActions(queue, queryClient, getSupabase),
    [queue, queryClient, getSupabase],
  );
}
