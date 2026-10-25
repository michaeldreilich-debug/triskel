/**
 * Datei anhängen (#33, optional): lädt eine Datei von einem Notion-Download-Link, nimmt eine
 * über `prepare_upload` hochgeladene Datei (#51, E33) oder den Inhalt als Base64 direkt aus dem
 * Chat (#71, E37 – Claudes Cloud-Umgebung erreicht den Speicher-Host oft nicht) und hängt sie an eine Notiz
 * (neue Zeile unten) oder Aufgabe (Notiz der Aufgabe) – als Bild oder Datei-Kachel, genau wie
 * Ablegen in der App. Gespeichert mit dem Token des Nutzers im eigenen Ordner.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { JSONContent } from "@tiptap/core";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import {
  ATTACHMENT_BUCKET,
  IMAGE_EXT,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  NOTE_IMAGE_BUCKET,
} from "@/features/notes/storage";
import { fileExt } from "@/features/outliner/model/files";
import { MERMAID, NOTE_FILE, NOTE_IMAGE } from "@/features/outliner/model/names";
import { inlineText } from "@/features/outliner/model/serializer";
import { handleUpload } from "@/features/storage/handlers";
import { maxBytesFor } from "@/features/storage/paths";
import { newId } from "@/lib/id";
import { lastTopSort } from "../../model/note-markdown";
import { appendTaskNodes, taskBodyText } from "../../model/task-markdown";
import { type AiContext, appUrl, check, logActivity, ref } from "../context";
import { loadNoteBlocks, loadSnapshot } from "../data";
import { download } from "../download";
import {
  decodeBase64,
  formatSize,
  heicToJpeg,
  isNoteImageType,
  MAX_INLINE_BASE64_CHARS,
  MAX_INLINE_UPLOAD_BYTES,
  sniffType,
  storedMime,
} from "../media";
import { aiFiles, headStored, storeFile } from "../r2";
import { ToolInputError } from "../resolve";
import { assertNoteNotShared } from "../shares";
import {
  mimeForExt,
  parseUploadRef,
  UPLOAD_VALID_HOURS,
  UPLOAD_VALID_SECONDS,
  uploadRef,
  uploadTarget,
} from "../upload";
import { CREATES, defineTool, type ToolOutput } from "./define";
import { titleOf } from "./notes";

/** Knoten für Bild bzw. Datei (Schema wie noteImage/noteFile im Editor). */
export function mediaNode(
  file: { path: string; name: string; size: number; mime: string },
  options: { asImage: boolean; full: boolean },
): JSONContent {
  return options.asImage
    ? { type: NOTE_IMAGE, attrs: { path: file.path, alt: file.name, width: null } }
    : {
        type: NOTE_FILE,
        attrs: {
          path: file.path,
          name: file.name,
          size: file.size,
          mime: file.mime,
          view: options.full && file.mime === "application/pdf" ? "full" : "tile",
        },
      };
}

type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;

/** Notiz oder Aufgabe zur ID – sonst ein verständlicher Fehler. */
function findTarget(snapshot: Snapshot, id: string) {
  const note = snapshot.notes.find((n) => n.id === id);
  const task = note ? null : snapshot.tasks.find((t) => t.id === id);
  if (!note && !task) throw new ToolInputError(`Keine Notiz oder Aufgabe mit der ID ${id}.`);
  return { note, task };
}

/** Bild bzw. Datei-Kachel unten an die Notiz oder in die Notiz der Aufgabe – mit KI-Protokoll. */
async function appendMedia(
  ctx: AiContext,
  snapshot: Snapshot,
  target: ReturnType<typeof findTarget>,
  node: JSONContent,
  what: string,
): Promise<ToolOutput> {
  const { note, task } = target;
  // Protokoll vor der Änderung (K-5): ohne Eintrag kein Rückgängig – dann lieber nichts ändern
  if (note) {
    const existing = await loadNoteBlocks(ctx, note.id);
    const content = { type: "paragraph", content: [node] };
    const block = {
      id: newId(),
      note_id: note.id,
      parent_id: null,
      sort: generateKeyBetween(lastTopSort(existing), null),
      content: content as never,
      content_text: inlineText(content.content.filter((n) => n.type !== MERMAID)),
      collapsed: false,
      task_id: null,
    };
    await logActivity(ctx, {
      tool: "attach_file",
      entity: "notiz",
      entityId: note.id,
      summary: `${what} an „${note.title}“ gehängt`,
      undo: { kind: "append", note_id: note.id, added: [block.id] },
    });
    check("Datei in die Notiz", await ctx.db.from("note_blocks").insert(block).select("id"));
    const url = appUrl.note(ctx.origin, note.id);
    return {
      text: `${what} an ${ref(note.title, url, note.id)} gehängt`,
      structured: { id: note.id, url },
    };
  }

  const current = task as NonNullable<typeof task>;
  const body = appendTaskNodes(current.body, [{ type: "paragraph", content: [node] }]);
  const bodyText = taskBodyText(body, { resolveTitle: titleOf(snapshot) });
  await logActivity(ctx, {
    tool: "attach_file",
    entity: "aufgabe",
    entityId: current.id,
    summary: `${what} an „${current.title}“ gehängt`,
    undo: {
      kind: "update",
      table: "tasks",
      id: current.id,
      before: { body: current.body, body_text: current.body_text },
      // Stand danach: erkennt spätere eigene Änderungen an der Notiz der Aufgabe (K-2, D-8)
      after: { body, body_text: bodyText },
    },
  });
  check(
    "Datei an die Aufgabe",
    await ctx.db
      .from("tasks")
      .update({ body: body as never, body_text: bodyText })
      .eq("id", current.id)
      .select("id")
      .single(),
  );
  const url = appUrl.task(ctx.origin, current.id);
  return {
    text: `${what} an ${ref(current.title, url, current.id)} gehängt`,
    structured: { id: current.id, url },
  };
}

/** Größe und Typ einer hochgeladenen Datei (HEAD) – fehlt sie, ist der PUT nicht gelaufen. */
async function uploadedFile(
  ctx: AiContext,
  bucket: typeof ATTACHMENT_BUCKET | typeof NOTE_IMAGE_BUCKET,
  path: string,
) {
  const head = await headStored(ctx, bucket, path);
  if (!head.exists) {
    throw new ToolInputError(
      `Unter diesem Verweis liegt noch keine Datei – erst per PUT an den Link aus „prepare_upload“ hochladen (er gilt 1 Stunde).`,
    );
  }
  const size = head.size ?? 0;
  const mime = (head.contentType ?? "application/octet-stream").split(";")[0]?.trim() ?? "";
  if (size <= 0 || size > maxBytesFor(bucket)) {
    throw new ToolInputError(
      "Die hochgeladene Datei hat eine unzulässige Größe – „prepare_upload“ mit der richtigen „groesse“ neu aufrufen.",
    );
  }
  if (bucket === NOTE_IMAGE_BUCKET && !IMAGE_EXT[mime]) {
    throw new ToolInputError(
      "Die hochgeladene Datei ist kein unterstütztes Bild (PNG, JPEG, WebP, GIF).",
    );
  }
  return { size, mime: mime || "application/octet-stream" };
}

/** Schreibweise der Header in der Anleitung an die KI */
const HEADER_NAMES: Record<string, string> = {
  "content-type": "Content-Type",
  "if-none-match": "If-None-Match",
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);
const TYPE_NAMES: Record<string, string> = {
  "image/png": "PNG-Bild",
  "image/jpeg": "JPEG-Bild",
  "image/webp": "WebP-Bild",
  "image/gif": "GIF-Bild",
  "application/pdf": "PDF",
};

/**
 * Datei aus dem Chat (#71): Base64 dekodieren, Typ am Inhalt prüfen (Bild bzw. PDF muss auch eins
 * sein – sonst ist das Base64 meist abgeschnitten), HEIC wenn möglich in JPEG umwandeln.
 */
export async function inlineFile(
  value: string,
  name: string,
  declared: string | undefined,
): Promise<{ bytes: Uint8Array; mime: string; name: string; asImage: boolean; note: string }> {
  const decoded = decodeBase64(value);
  let bytes = decoded.bytes;
  let fileName = name;
  const ext = fileExt(name);
  const claimed = (declared ?? decoded.declaredMime ?? "").split(";")[0]?.trim().toLowerCase();
  const sniffed = sniffType(bytes);
  const wantsImage = IMAGE_EXTENSIONS.has(ext) || isNoteImageType(claimed ?? "");
  const wantsPdf = ext === "pdf" || claimed === "application/pdf";
  const expected = wantsPdf
    ? "application/pdf"
    : isNoteImageType(claimed ?? "")
      ? (claimed as string)
      : mimeForExt(ext);
  if (wantsPdf && sniffed !== "application/pdf") {
    throw new ToolInputError(
      "Der Inhalt ist kein PDF (der Anfang „%PDF-“ fehlt) – ist „inhalt_base64“ vollständig?",
    );
  }
  if (wantsImage && !(sniffed && isNoteImageType(sniffed))) {
    throw new ToolInputError(
      `Der Inhalt ist kein ${TYPE_NAMES[expected] ?? "Bild (PNG, JPEG, WebP, GIF)"} – ist „inhalt_base64“ vollständig?`,
    );
  }
  let note = "";
  if (sniffed === "image/heic" || HEIC_EXTENSIONS.has(ext)) {
    const jpeg = sniffed === "image/heic" ? await heicToJpeg(bytes) : null;
    if (jpeg) {
      bytes = jpeg;
      fileName = `${name.replace(/\.[^.]+$/, "")}.jpg`;
      note = " (HEIC in JPEG umgewandelt)";
    } else {
      note = " – HEIC-Foto lässt sich hier nicht umwandeln, deshalb als Datei-Kachel";
    }
  }
  const mime = storedMime(
    sniffType(bytes),
    declared ?? decoded.declaredMime,
    mimeForExt(fileExt(fileName)),
  );
  return { bytes, mime, name: fileName, asImage: isNoteImageType(mime), note };
}

export function registerFileTools(server: McpServer, ctx: AiContext) {
  defineTool(
    server,
    "prepare_upload",
    {
      title: "Hochladen vorbereiten",
      description: `Für eine Datei vom Rechner (z. B. ein PDF aus einem lokalen Ordner): gibt einen Hochlade-Link für genau diese Notiz oder Aufgabe zurück, gültig 1 Stunde, und zwar nur für genau die angegebene „groesse“ (Bytes) und den Typ aus der Endung – wer eine andere Größe oder einen anderen Typ sendet, wird abgelehnt. Danach die Datei per HTTP-PUT an „upload_url“ senden (Body = Dateiinhalt, dazu genau die Header aus „headers“: Content-Type wie in „content_type“ und If-None-Match: *, z. B. \`curl -X PUT -H "Content-Type: application/pdf" -H "If-None-Match: *" --data-binary @datei.pdf "<upload_url>"\`; der Link nimmt genau eine Datei an und überschreibt nie) und „attach_file“ mit „ziel“ und „upload“ aufrufen. Dateien bis 100 MB; Bilder (png, jpg, webp, gif) bis 10 MB erscheinen als Bild, mit als_datei als Datei-Kachel. Der Link geht an den Dateispeicher von Triskel (Cloudflare R2) – aus Claudes Cloud-Umgebung kann das gesperrt sein, dort stattdessen „attach_file“ mit „inhalt_base64“. Mit der „Triskel-Ablage“ am Mac: vorher „datei_vorbereiten“ (liefert name und groesse), danach „datei_hochladen“ statt curl.`,
      input: z.object({
        ziel: z.string().uuid().describe("ID der Notiz oder Aufgabe"),
        name: z.string().trim().min(1).max(200).describe("Dateiname mit Endung, z. B. Bilanz.pdf"),
        groesse: z
          .number()
          .int()
          .positive()
          .max(MAX_FILE_BYTES, "Höchstens 100 MB je Datei")
          .describe(
            "Größe der Datei in Bytes (genau; der Link gilt nur dafür), z. B. aus datei_vorbereiten",
          ),
        als_datei: z
          .boolean()
          .default(false)
          .describe("Bild trotzdem als Datei-Kachel (nötig bei Bildern über 10 MB)"),
      }),
      annotations: CREATES,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const { note, task } = findTarget(snapshot, input.ziel);
      // freigegebene Notiz (#94): kein Hochlade-Link – die Datei wäre danach öffentlich
      if (note) await assertNoteNotShared(ctx, note.id);
      const owner = (note ?? task) as { id: string; title: string };
      const target = uploadTarget(input.name, { asFile: input.als_datei });
      if (target.bucket === NOTE_IMAGE_BUCKET && input.groesse > MAX_IMAGE_BYTES) {
        throw new ToolInputError(
          `Das Bild hat ${formatSize(input.groesse)} – Bilder gehen nur bis ${formatSize(MAX_IMAGE_BYTES)}. Mit „als_datei: true“ als Datei-Kachel ablegen.`,
        );
      }
      const files = await aiFiles(ctx);
      const response = await handleUpload(
        files,
        {
          bucket: target.bucket,
          ownerId: owner.id,
          contentType: target.mime,
          size: input.groesse,
          name: input.name,
        },
        // Link für genau einen PUT: ein zweiter überschreibt nichts (KI löscht nie, auch nicht so)
        { seconds: UPLOAD_VALID_SECONDS, exclusive: true },
      );
      const signed = (await response.json()) as {
        error?: string;
        path?: string;
        url?: string;
        headers?: Record<string, string>;
      };
      if (!response.ok || !signed.path || !signed.url || !signed.headers) {
        throw new ToolInputError(
          `Hochlade-Link nicht erstellt: ${signed.error ?? "unbekannter Fehler"}`,
        );
      }
      const upload = uploadRef(target.bucket, signed.path);
      const headers = Object.entries(signed.headers)
        .map(([name, value]) => `${HEADER_NAMES[name] ?? name}: ${value}`)
        .join(", ");
      return {
        text: [
          `Hochlade-Link für „${input.name}“ (${formatSize(input.groesse)}) an „${owner.title}“ (gültig ${UPLOAD_VALID_HOURS} Stunde, nur für genau ${input.groesse} Bytes):`,
          `1. PUT ${signed.url}`,
          `   Header ${headers} (genau diese), Body = Dateiinhalt (genau ${input.groesse} Bytes); der Link nimmt nur eine Datei an`,
          `2. attach_file mit ziel „${owner.id}“, upload „${upload}“, name „${input.name}“`,
        ].join("\n"),
        structured: {
          upload_url: signed.url,
          method: "PUT",
          headers: signed.headers,
          content_type: target.mime,
          groesse: input.groesse,
          upload,
          ziel: owner.id,
          name: input.name,
        },
      };
    },
  );

  defineTool(
    server,
    "attach_file",
    {
      title: "Datei anhängen",
      description: `Hängt eine Datei (z. B. PDF-Beleg, Foto, Tabelle) an eine Notiz oder Aufgabe – aus genau einer Quelle: „inhalt_base64“ = Dateiinhalt als Base64 direkt aus dem Chat (mit „name“ samt Endung, bis ${formatSize(MAX_INLINE_UPLOAD_BYTES)}; der Inhalt steht im Aufruf, also eher für kleine Dateien), „url“ = Notion-Download-Link (vorher mit „notion-get-file-download-urls“ holen, sie gelten nur Minuten) oder „upload“ = Verweis aus „prepare_upload“ nach dem PUT vom eigenen Rechner. Über upload bis 100 MB, über url bis 50 MB. Bilder (PNG, JPEG, WebP, GIF bis 10 MB) erscheinen als Bild, alles andere als Datei-Kachel; PDFs auf Wunsch ganz angezeigt.`,
      input: z.object({
        ziel: z.string().uuid().describe("ID der Notiz oder Aufgabe"),
        inhalt_base64: z
          .string()
          .max(
            MAX_INLINE_BASE64_CHARS,
            `Zu groß für einen Aufruf (höchstens ${formatSize(MAX_INLINE_UPLOAD_BYTES)} Datei)`,
          )
          .optional()
          .describe(
            "Dateiinhalt als Base64 (auch data:…;base64,…) – für Dateien aus dem Chat; dazu „name“ mit Endung",
          ),
        content_type: z
          .string()
          .trim()
          .max(100)
          .optional()
          .describe(
            "Art der Datei bei „inhalt_base64“, z. B. image/png – sonst aus Inhalt und Endung",
          ),
        url: z.string().url().max(4000).optional().describe("Notion-Download-Link"),
        upload: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .describe("Verweis aus „prepare_upload“ nach dem Hochladen"),
        name: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("Dateiname mit Endung (bei „inhalt_base64“ nötig), sonst aus dem Link"),
        ganz_anzeigen: z.boolean().default(false).describe("PDF mit allen Seiten in der Notiz"),
      }),
      annotations: { ...CREATES, openWorldHint: true },
    },
    async (input) => {
      const sources = [
        input.inhalt_base64 !== undefined,
        Boolean(input.url),
        Boolean(input.upload),
      ];
      if (sources.filter(Boolean).length !== 1) {
        throw new ToolInputError(
          "Genau eins angeben: „inhalt_base64“ (Datei aus dem Chat), „url“ (Notion-Download-Link) oder „upload“ (Verweis aus „prepare_upload“).",
        );
      }
      if (input.inhalt_base64 !== undefined && !input.name) {
        throw new ToolInputError(
          "Mit „inhalt_base64“ auch „name“ angeben – der Dateiname samt Endung, z. B. Foto.png.",
        );
      }
      const snapshot = await loadSnapshot(ctx.db);
      const target = findTarget(snapshot, input.ziel);
      // vor dem Speichern prüfen: an eine freigegebene Notiz hängt die KI nichts (#94)
      if (target.note) await assertNoteNotShared(ctx, target.note.id);
      const ownerId = (target.note ?? target.task)?.id as string;

      let file: { path: string; name: string; size: number; mime: string };
      let asImage: boolean;
      let note = "";
      if (input.inhalt_base64 !== undefined) {
        const inline = await inlineFile(
          input.inhalt_base64,
          input.name as string,
          input.content_type,
        );
        asImage = inline.asImage;
        note = inline.note;
        const ext = asImage ? (IMAGE_EXT[inline.mime] as string) : fileExt(inline.name);
        const stored = await storeFile(ctx, {
          bucket: asImage ? NOTE_IMAGE_BUCKET : ATTACHMENT_BUCKET,
          ownerId,
          ext,
          bytes: inline.bytes,
          mime: inline.mime,
        });
        file = {
          path: stored.path,
          name: inline.name,
          size: inline.bytes.byteLength,
          mime: stored.mime,
        };
      } else if (input.upload) {
        const parsed = parseUploadRef(input.upload, ctx.userId, ownerId);
        const stored = await uploadedFile(ctx, parsed.bucket, parsed.path);
        const ext = fileExt(parsed.fileName);
        // der Bilder-Bucket nimmt nur Bildtypen an; ohne Content-Type beim PUT zählt die Endung
        asImage = parsed.bucket === NOTE_IMAGE_BUCKET;
        file = {
          path: parsed.path,
          name: input.name ?? `Datei.${ext}`,
          size: stored.size,
          mime: stored.mime === "application/octet-stream" ? mimeForExt(ext) : stored.mime,
        };
      } else {
        const loaded = await download(input.url as string);
        const name = input.name ?? loaded.name;
        // Typ am Inhalt, nicht an Notions Angabe (R-1): HTML/SVG landen als Text, nie als „Bild“
        const mime = storedMime(sniffType(loaded.bytes), loaded.mime, mimeForExt(fileExt(name)));
        asImage = Boolean(IMAGE_EXT[mime]) && loaded.bytes.byteLength <= MAX_IMAGE_BYTES;
        const ext = asImage ? (IMAGE_EXT[mime] as string) : fileExt(name);
        const stored = await storeFile(ctx, {
          bucket: asImage ? NOTE_IMAGE_BUCKET : ATTACHMENT_BUCKET,
          ownerId,
          ext,
          bytes: loaded.bytes,
          mime,
        });
        file = { path: stored.path, name, size: loaded.bytes.byteLength, mime: stored.mime };
      }

      const node = mediaNode(file, { asImage, full: input.ganz_anzeigen });
      const what = `${asImage ? "Bild" : "Datei"} „${file.name}“ (${formatSize(file.size)})${note}`;
      return appendMedia(ctx, snapshot, target, node, what);
    },
  );
}
