/**
 * Öffentliche Freigabe einer Notiz (#94, E42, docs/konzept-freigabe.md) – reines Modell ohne
 * „use client“: Antwort von `shared_note` (Migration 45) defensiv lesen, daraus den Outline-Baum
 * bauen (wie die App: `rowsToDoc`) und die Adressen der Dateien bilden.
 */
import type { JSONContent } from "@tiptap/core";
import { type BlockRow, rowsToDoc } from "@/features/outliner/model/serializer";
import { isShareToken } from "./token";

export interface SharedBlock {
  id: string;
  parent_id: string | null;
  sort: string;
  collapsed: boolean;
  /** Absatz als TipTap-JSON (Verweise auf andere Notizen schon ohne Ziel) */
  content: JSONContent;
  /** null = kein „Block → Aufgabe“, sonst ob die Aufgabe erledigt ist */
  task_done: boolean | null;
}

export interface SharedNote {
  title: string;
  blocks: SharedBlock[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseBlock(value: unknown): SharedBlock | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.sort !== "string")
    return null;
  return {
    id: value.id,
    parent_id: typeof value.parent_id === "string" ? value.parent_id : null,
    sort: value.sort,
    collapsed: value.collapsed === true,
    content: isRecord(value.content) ? (value.content as JSONContent) : { type: "paragraph" },
    task_done: typeof value.task_done === "boolean" ? value.task_done : null,
  };
}

/** Antwort von `shared_note` → Notiz oder null (unbekannt, beendet, im Papierkorb, kaputt). */
export function parseSharedNote(value: unknown): SharedNote | null {
  if (!isRecord(value) || typeof value.title !== "string") return null;
  const blocks = Array.isArray(value.blocks) ? value.blocks.map(parseBlock) : [];
  return {
    title: value.title,
    blocks: blocks.filter((b): b is SharedBlock => b !== null),
  };
}

/** Titel für Seite und Kopf (leer = „Ohne Titel“, wie in der App). */
export const sharedTitle = (note: SharedNote) => note.title.trim() || "Ohne Titel";

/**
 * Blöcke → Dokument wie im Editor (verwaiste oder zyklische Blöcke landen oben, nichts fehlt) und
 * der Aufgaben-Stand je Block-ID.
 */
export function sharedDoc(note: SharedNote): { doc: JSONContent; taskDone: Map<string, boolean> } {
  const taskDone = new Map<string, boolean>();
  const rows: BlockRow[] = note.blocks.map((block) => {
    if (block.task_done !== null) taskDone.set(block.id, block.task_done);
    return {
      id: block.id,
      parent_id: block.parent_id,
      sort: block.sort,
      content: block.content,
      content_text: "",
      collapsed: block.collapsed,
      task_id: null,
    };
  });
  return { doc: rowsToDoc(rows), taskDone };
}

/**
 * Adresse einer Datei der freigegebenen Notiz: Die Route prüft Token und Pfad und leitet auf
 * einen kurzlebigen signierten Link um. `name` nur für den Dateinamen beim Herunterladen.
 */
export function sharedFilePath(token: string, path: string, name?: string): string {
  if (!isShareToken(token)) return "";
  const query = new URLSearchParams({ pfad: path });
  if (name) query.set("name", name);
  return `/api/freigabe/${token}/datei?${query.toString()}`;
}
