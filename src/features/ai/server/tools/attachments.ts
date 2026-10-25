/**
 * Bilder und Dateien lesen (#71, E37): „fetch“ liefert die Bilder eines Eintrags als MCP-
 * Bildinhalt mit (höchstens 5 bzw. 3,5 MB Base64 je Antwort), „get_attachment“ holt ein einzelnes
 * Bild oder den Inhalt einer Datei (PDF-Text, Textdateien). Gelesen wird nur, was im Eintrag
 * steht, aus dem eigenen Ordner in R2 (nach KI-Freigabe). Lesen schreibt nicht ins
 * KI-Protokoll (wie alle Lesewerkzeuge).
 */
import type { ContentBlock, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fileExt } from "@/features/outliner/model/files";
import { type AiContext, appUrl, ref } from "../context";
import { loadNoteBlocks, loadSnapshot, type Snapshot } from "../data";
import {
  collectMedia,
  decodeText,
  FETCH_MEDIA_BUDGET_MS,
  findMedia,
  formatSize,
  imageBlock,
  imageForAi,
  inTextOrder,
  isTextLike,
  loadStored,
  MAX_RESULT_IMAGES,
  MAX_RESULT_MEDIA_CHARS,
  MAX_TEXT_CHARS,
  type MediaRef,
  sniffType,
  TooLargeError,
} from "../media";
import { pdfText } from "../pdf-text";
import { ToolInputError } from "../resolve";
import { defineTool, READ_ONLY, type ToolOutput } from "./define";
import { id } from "./schema";

export interface MediaEntry {
  kind: "notiz" | "aufgabe" | "projekt";
  id: string;
  title: string;
  url: string;
  media: MediaRef[];
}

/** Notiz, Aufgabe oder Projekt (Freitext) mit seinen Bildern und Dateien. */
export async function mediaEntry(
  ctx: AiContext,
  snapshot: Snapshot,
  entryId: string,
): Promise<MediaEntry> {
  const note = snapshot.notes.find((n) => n.id === entryId);
  if (note) {
    const blocks = await loadNoteBlocks(ctx, note.id);
    return {
      kind: "notiz",
      id: note.id,
      title: note.title,
      url: appUrl.note(ctx.origin, note.id),
      media: collectMedia(blocks.map((b) => b.content)),
    };
  }
  const task = snapshot.tasks.find((t) => t.id === entryId);
  if (task) {
    return {
      kind: "aufgabe",
      id: task.id,
      title: task.title,
      url: appUrl.task(ctx.origin, task.id),
      media: collectMedia([task.body]),
    };
  }
  const project = snapshot.projects.find((p) => p.id === entryId);
  if (project) {
    return {
      kind: "projekt",
      id: project.id,
      title: project.title,
      url: appUrl.project(ctx.origin, project.id),
      media: collectMedia([project.body]),
    };
  }
  throw new ToolInputError(
    `Keine Notiz, Aufgabe und kein Projekt mit der ID ${entryId} – Bilder und Dateien stehen nur dort.`,
  );
}

const call = (entryId: string, media: MediaRef) =>
  `„get_attachment“ mit eintrag „${entryId}“ und datei „${media.ref}“`;

const fileKind = (media: MediaRef) => {
  const ext = fileExt(media.name);
  if (media.mime === "application/pdf" || ext === "pdf") return "PDF";
  return ext === "bin" ? "Datei" : ext.toUpperCase();
};

const MAX_LISTED = 40;

/**
 * Für „fetch“: Abschnitt „Bilder und Dateien“ unter dem Text und die Bilder als Bildinhalt –
 * höchstens 5 und 3,5 MB Base64 je Antwort, der Rest mit dem Aufruf für „get_attachment“.
 * Scheitert ein Bild, steht der Grund im Abschnitt; „fetch“ selbst scheitert nie daran.
 */
export async function fetchMedia(
  ctx: AiContext,
  entryId: string,
  media: MediaRef[],
  text: string,
  options: { images: boolean },
): Promise<{ section: string; content: ContentBlock[] }> {
  if (media.length === 0) return { section: "", content: [] };
  const ordered = inTextOrder(media, text);
  const images = ordered.filter((m) => m.kind === "image");
  const candidates = options.images ? images.slice(0, MAX_RESULT_IMAGES) : [];
  // laden parallel (Bilder: je höchstens 10 MB), verkleinern nacheinander (Speicher)
  const loaded = await Promise.all(
    candidates.map((m) =>
      loadStored(ctx, m).catch((error: unknown) => ({
        problem: error instanceof Error ? error.message : "Bild nicht ladbar.",
      })),
    ),
  );
  const outcome = new Map<string, string>();
  const delivered: Array<{ media: MediaRef; block: ContentBlock }> = [];
  let chars = 0;
  const deadline = Date.now() + FETCH_MEDIA_BUDGET_MS;
  for (const [index, media] of candidates.entries()) {
    const bytes = loaded[index];
    if (Date.now() > deadline) {
      outcome.set(media.path, `nicht mitgeliefert (Zeit abgelaufen) → ${call(entryId, media)}`);
      continue;
    }
    if (!bytes || "problem" in bytes) {
      outcome.set(media.path, `nicht ladbar: ${bytes?.problem ?? "unbekannt"}`);
      continue;
    }
    const image = await imageForAi(bytes);
    if ("problem" in image) {
      outcome.set(media.path, image.problem);
    } else if (chars + image.data.length > MAX_RESULT_MEDIA_CHARS) {
      outcome.set(
        media.path,
        `nicht mitgeliefert (Antwort wäre zu groß) → ${call(entryId, media)}`,
      );
    } else {
      chars += image.data.length;
      delivered.push({ media, block: imageBlock(image) });
      outcome.set(media.path, "mitgeliefert");
    }
  }
  const reason = options.images
    ? `nicht mitgeliefert (höchstens ${MAX_RESULT_IMAGES} Bilder je Antwort)`
    : "nicht mitgeliefert (bilder: false)";
  const lines = ordered.slice(0, MAX_LISTED).map((m) => {
    if (m.kind === "image") {
      const number = images.indexOf(m) + 1;
      const alt = m.name !== m.ref ? ` „${m.name}“` : "";
      return `- Bild ${number}${alt}: ![[${m.ref}]] – ${outcome.get(m.path) ?? `${reason} → ${call(entryId, m)}`}`;
    }
    const size = m.size ? `, ${formatSize(m.size)}` : "";
    return `- Datei „${m.name}“ (${fileKind(m)}${size}): [[${m.ref}]] → Inhalt mit ${call(entryId, m)}`;
  });
  if (ordered.length > MAX_LISTED) lines.push(`- … und ${ordered.length - MAX_LISTED} weitere`);
  const intro = delivered.length
    ? `${delivered.length === 1 ? "Das Bild kommt" : `Die ${delivered.length} Bilder kommen`} als Bildinhalt nach diesem Text, jeweils mit dem Verweis davor. Weitere Bilder und den Inhalt von Dateien liefert „get_attachment“.`
    : "Bilder und den Inhalt von Dateien liefert „get_attachment“.";
  const content: ContentBlock[] = delivered.flatMap(({ media, block }, index) => [
    {
      type: "text",
      text: `Bild ${index + 1} von ${delivered.length}: ![[${media.ref}]]${media.name !== media.ref ? ` („${media.name}“)` : ""}`,
    },
    block,
  ]);
  return { section: `\n## Bilder und Dateien\n\n${intro}\n\n${lines.join("\n")}\n`, content };
}

/** Eingebettete PDF höchstens so groß (Base64 passt mit Text unter die Grenze je Antwort). */
const MAX_EMBED_PDF_BYTES = Math.floor((MAX_RESULT_MEDIA_CHARS * 3) / 4) - 200_000;

export function registerAttachmentTools(server: McpServer, ctx: AiContext) {
  defineTool(
    server,
    "get_attachment",
    {
      title: "Anhang lesen",
      description:
        "Liest ein Bild oder eine Datei aus einer Notiz, einer Aufgabe oder dem Freitext eines Projekts: „eintrag“ = ID (oder Link) des Eintrags, „datei“ = der Verweis aus dem Text von „fetch“ (![[…]] für Bilder, [[…]] für Dateien – der Dateiname reicht). Bilder kommen verkleinert als Bild (längste Kante 1600 px), PDFs als Text (bis 50 Seiten), Textdateien (txt, md, csv, json …) als Text – nur bis 25 MB, größere Dateien nennt das Werkzeug nur mit einem Hinweis; andere Dateien nur mit Name, Art und Größe. Liest nur, was im Eintrag steht.",
      input: z.object({
        eintrag: id.describe("ID oder Link der Notiz, Aufgabe oder des Projekts"),
        datei: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe("Verweis aus dem Text, z. B. ![[1a2b….png]] oder [[Bilanz-1a2b3c4d.pdf]]"),
        pdf_einbetten: z
          .boolean()
          .default(false)
          .describe(
            "PDF zusätzlich als eingebettete Datei (application/pdf, bis etwa 2,4 MB) – nur, wenn der Text nicht reicht (z. B. gescannte Seiten ohne Text)",
          ),
      }),
      annotations: READ_ONLY,
    },
    async (input): Promise<ToolOutput> => {
      const snapshot = await loadSnapshot(ctx.db);
      const entry = await mediaEntry(ctx, snapshot, input.eintrag);
      const media = findMedia(entry.media, input.datei);
      let bytes: Uint8Array;
      try {
        bytes = await loadStored(ctx, media);
      } catch (error) {
        if (!(error instanceof TooLargeError)) throw error;
        // zu groß zum Lesen (PDF-Text/Textdatei bis 25 MB): Hinweis statt Text, kein Fehler
        const size = error.size ?? media.size;
        return {
          text: `Datei „${media.name}“ [[${media.ref}]] aus ${ref(entry.title, entry.url, entry.id)} · ${fileKind(media)}${size ? ` · ${formatSize(size)}` : ""}\n\nDie Datei ist größer als ${formatSize(error.limit)} – so große Dateien liest der Server nicht (Speicher und Laufzeit). In der App öffnen oder herunterladen: ${entry.url}`,
        };
      }
      // Bewusst ohne `structured`: Name, Art und Größe stehen schon im Text, und der käme dort
      // als `text` noch einmal hinein (PDF-Text doppelt).
      const sniffed = sniffType(bytes);
      const where = ref(entry.title, entry.url, entry.id);

      const looksLikeImage =
        media.kind === "image" ||
        (sniffed !== null && sniffed !== "application/pdf") ||
        (media.mime?.startsWith("image/") === true && media.mime !== "image/svg+xml");
      if (looksLikeImage) {
        const image = await imageForAi(bytes);
        const label = media.kind === "image" ? "Bild" : `Bild-Datei „${media.name}“`;
        if ("problem" in image) {
          return {
            text: `${label} ![[${media.ref}]] aus ${where} (${formatSize(bytes.length)}): ${image.problem}`,
          };
        }
        const size = image.width ? ` · ${image.width}×${image.height} px` : "";
        const resized = image.original
          ? ` (verkleinert von ${image.original.width}×${image.original.height})`
          : "";
        return {
          text: `${label}${media.name !== media.ref && media.kind === "image" ? ` „${media.name}“` : ""} ![[${media.ref}]] aus ${where}${size}${resized} – kommt als Bildinhalt nach diesem Text.`,
          content: [imageBlock(image)],
        };
      }

      const head = `Datei „${media.name}“ [[${media.ref}]] aus ${where} · ${fileKind(media)} · ${formatSize(bytes.length)}`;
      if (sniffed === "application/pdf" || media.mime === "application/pdf") {
        const extracted = sniffed === "application/pdf" ? await pdfText(bytes) : null;
        const pages = extracted
          ? ` · ${extracted.pages} ${extracted.pages === 1 ? "Seite" : "Seiten"}`
          : "";
        const parts = [head + pages];
        if (!extracted) {
          parts.push(
            "Den Text dieses PDFs konnte der Server nicht lesen (beschädigt oder zu langsam). Mit „pdf_einbetten: true“ das PDF selbst holen oder in der App öffnen.",
          );
        } else if (!extracted.text.replace(/--- Seite \d+ ---/g, "").trim()) {
          parts.push(
            "Das PDF enthält keinen lesbaren Text (vermutlich gescannte Seiten). Mit „pdf_einbetten: true“ das PDF selbst holen, falls diese Oberfläche PDFs lesen kann, oder in der App ansehen.",
          );
        } else {
          parts.push(
            extracted.truncated
              ? `Text der Seiten 1–${extracted.read} (gekürzt, ${extracted.pages} Seiten insgesamt):`
              : "Text:",
            extracted.text,
          );
        }
        const content: ContentBlock[] = [];
        if (input.pdf_einbetten) {
          if (bytes.length <= MAX_EMBED_PDF_BYTES) {
            content.push({
              type: "resource",
              resource: {
                uri: `schaltzentrale://anhang/${encodeURIComponent(media.ref)}`,
                mimeType: "application/pdf",
                blob: Buffer.from(bytes).toString("base64"),
              },
            });
            parts.push("Das PDF selbst kommt als eingebettete Datei nach diesem Text.");
          } else {
            parts.push(
              `Zum Einbetten ist das PDF zu groß (höchstens ${formatSize(MAX_EMBED_PDF_BYTES)}).`,
            );
          }
        }
        return { text: parts.join("\n\n"), content };
      }

      if (isTextLike(media.mime, media.name)) {
        const text = decodeText(bytes);
        if (text !== null) {
          const cut = text.length > MAX_TEXT_CHARS || bytes.length > MAX_TEXT_CHARS * 4;
          return {
            text: `${head}${cut ? ` · gekürzt auf ${MAX_TEXT_CHARS.toLocaleString("de-DE")} Zeichen` : ""}\n\nInhalt:\n\n${cut ? text.slice(0, MAX_TEXT_CHARS) : text}`,
          };
        }
      }
      return {
        text: `${head}\n\nDen Inhalt dieser Dateiart kann der Server nicht lesen – in der App öffnen oder herunterladen: ${entry.url}`,
      };
    },
  );
}
