/**
 * Gemeinsame Hilfen der Medien-Knoten (Bild, Datei, Diagramm, O-19): Einfügen mit Hochladen,
 * Ablagestelle beim Ziehen, Knoten nach gescheitertem Hochladen entfernen, Attribute setzen.
 */
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { cursorAfterSelectedMedia, visibleEnd } from "../model/commands";

/**
 * HTTP-Status, mit dem der Speicher ein Hochladen ablehnte; null = keine Antwort angekommen
 * (Verbindung unterwegs abgebrochen, z. B. Firmen-Proxy oder Sicherheitssoftware, #72).
 */
export function uploadStatus(error: unknown): number | null {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status
    : null;
}

/** Endgültige Ablehnung des Speichers (4xx außer 404/408/429) – Wiederholen bringt nichts. */
export function isFinalUploadRejection(error: unknown): boolean {
  const status = uploadStatus(error);
  return status !== null && status >= 400 && status < 500 && ![404, 408, 429].includes(status);
}

/** Meldung, wenn das Hochladen noch offen ist: die Datei bleibt, der nächste Versuch kommt (V-1). */
export function uploadPendingMessage(name: string, error: unknown): string {
  return `${uploadFailedMessage(name, error)} Die Datei bleibt in der Notiz und wird hochgeladen, sobald die Verbindung wieder da ist.`;
}

/** Meldung nach gescheitertem Hochladen – mit Grund, damit sich der Fehler eingrenzen lässt (#72). */
export function uploadFailedMessage(name: string, error: unknown): string {
  const status = uploadStatus(error);
  if (status === null) {
    return `„${name}“ kam nicht beim Speicher an – die Verbindung brach unterwegs ab (Netzwerk, Firmen-Proxy oder Sicherheitssoftware?).`;
  }
  if (status === 503)
    return `„${name}“ konnte nicht hochgeladen werden – Dateien sind hier nicht verfügbar.`;
  const reason = error instanceof Error && error.message ? `: ${error.message}` : "";
  return `„${name}“ konnte nicht hochgeladen werden – der Speicher lehnte ab (${status}${reason}).`;
}

/** Einfügestelle: Position beim Ziehen, „end“ = ans Ende (Ablegen neben dem Editor). */
export type InsertAt = number | "end" | undefined;

/** Knoten dieses Typs mit diesem Pfad entfernen (Hochladen gescheitert). */
export function removeNodesByPath(view: EditorView, typeName: string, path: string) {
  const { state } = view;
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type.name === typeName && node.attrs.path === path) {
      tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize));
    }
  });
  if (tr.docChanged) view.dispatch(tr);
}

/**
 * Attribute des Knotens an `getPos()` ändern – nur, wenn dort noch ein Knoten dieses Typs steht
 * (nicht gelöscht oder verschoben). `select` lässt ihn ausgewählt (Werkzeuge bleiben sichtbar).
 */
export function updateNodeAttrs(
  view: EditorView,
  getPos: (() => number | undefined) | undefined,
  typeName: string,
  attrs: Record<string, unknown>,
  options: { select?: boolean } = {},
): boolean {
  const pos = typeof getPos === "function" ? getPos() : undefined;
  const current = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
  if (typeof pos !== "number" || current?.type.name !== typeName) return false;
  const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs });
  if (options.select) tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
  return true;
}

/**
 * Ablagestellen, die über ein `await` (Bild aufbereiten, O-3) mitwandern: Jede Transaktion
 * verschiebt sie, Tippen davor verschiebt also nicht die Stelle des Bilds.
 */
type DropMeta = { add: [number, number] } | { remove: number };
const dropKey = new PluginKey<Map<number, number>>("mediaDropPositions");
let dropToken = 0;
export const mediaDropPositions = new Plugin<Map<number, number>>({
  key: dropKey,
  state: {
    init: () => new Map(),
    apply(tr, value) {
      let next = value;
      if (tr.docChanged && value.size > 0) {
        next = new Map([...value].map(([token, pos]) => [token, tr.mapping.map(pos)]));
      }
      const meta = tr.getMeta(dropKey) as DropMeta | undefined;
      if (meta && "add" in meta) next = new Map(next).set(meta.add[0], meta.add[1]);
      if (meta && "remove" in meta) {
        next = new Map(next);
        next.delete(meta.remove);
      }
      return next;
    },
  },
});

/** Stelle merken (nur mit dem Plugin; sonst gilt sie unverändert). */
export function trackPosition(view: EditorView, at: InsertAt): () => InsertAt {
  if (typeof at !== "number" || !dropKey.get(view.state)) return () => at;
  const token = ++dropToken;
  view.dispatch(view.state.tr.setMeta(dropKey, { add: [token, at] } satisfies DropMeta));
  return () => {
    if (view.isDestroyed) return at;
    const mapped = dropKey.getState(view.state)?.get(token) ?? at;
    view.dispatch(view.state.tr.setMeta(dropKey, { remove: token } satisfies DropMeta));
    return mapped;
  };
}

export const closedMessage = (file: File) =>
  `„${file.name}“ wurde nicht eingefügt – die Notiz war schon geschlossen.`;

/** Auswahl an die Einfügestelle setzen (beim Ziehen: nächste Textstelle an der Ablageposition). */
export function placeSelection(view: EditorView, at: InsertAt) {
  const tr = view.state.tr;
  if (at === undefined) {
    // ein ausgewähltes Bild wird nicht ersetzt, das neue kommt dahinter (O-1)
    cursorAfterSelectedMedia(tr);
    return tr;
  }
  if (at === "end") return tr.setSelection(visibleEnd(tr.doc));
  const $pos = tr.doc.resolve(Math.min(at, tr.doc.content.size));
  return tr.setSelection(TextSelection.near($pos));
}

/** Was `insertUploads` je Knotenart braucht (Bild bzw. Datei). */
export interface MediaUploader {
  /** Knotentyp, z. B. NOTE_IMAGE */
  type: string;
  onError(message: string): void;
  /** Fehlertext, wenn die Datei nicht passt – sie wird dann übersprungen */
  reject?(file: File): string | null;
  /** aufbereiten und hochladen; null = abgebrochen, weil der Editor schon zu ist */
  add(
    file: File,
    cancelled: () => boolean,
  ): Promise<{ path: string; uploaded: Promise<void> } | null>;
  attrs(file: File, path: string): Record<string, unknown>;
  /** Meldung, wenn das Einfügen ohne eigenen Fehlertext scheitert */
  failed: string;
}

/**
 * Dateien nacheinander hochladen und als Knoten einfügen: das erste an die Ablagestelle, die
 * weiteren dahinter. Scheitert das Hochladen später, bleibt der Knoten (V-1): Die Datei liegt bis
 * zur Bestätigung im Browser und wird von selbst erneut hochgeladen – nur eine endgültige
 * Ablehnung des Speichers (zu groß, kein Recht) nimmt den Knoten wieder heraus.
 */
export async function insertUploads(
  view: EditorView,
  uploader: MediaUploader,
  files: File[],
  at?: InsertAt,
) {
  for (const file of files) {
    const rejected = uploader.reject?.(file);
    if (rejected) {
      uploader.onError(rejected);
      continue;
    }
    // Editor schon zu (Notiz gewechselt): nichts hochladen, Bescheid geben (O-3)
    if (view.isDestroyed) {
      uploader.onError(closedMessage(file));
      continue;
    }
    const place = trackPosition(view, at);
    try {
      const added = await uploader.add(file, () => view.isDestroyed);
      const target = place();
      if (!added || view.isDestroyed) {
        uploader.onError(closedMessage(file));
        continue;
      }
      const { path, uploaded } = added;
      const node = view.state.schema.nodes[uploader.type]?.create(uploader.attrs(file, path));
      if (!node) return;
      // nur das erste an die Ablagestelle, die weiteren folgen dahinter
      const tr = placeSelection(view, target);
      at = undefined;
      tr.replaceSelectionWith(node, false);
      view.dispatch(tr.scrollIntoView());
      uploaded.catch((error: unknown) => {
        if (isFinalUploadRejection(error)) {
          removeNodesByPath(view, uploader.type, path);
          uploader.onError(uploadFailedMessage(file.name, error));
          return;
        }
        uploader.onError(uploadPendingMessage(file.name, error));
      });
    } catch (error) {
      place();
      uploader.onError((error as Error).message || uploader.failed);
    }
  }
}
