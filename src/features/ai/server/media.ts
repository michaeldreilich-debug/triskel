/**
 * Bilder und Dateien für die KI (#71, E37): Bild- und Datei-Knoten eines Eintrags finden, aus dem
 * eigenen Speicher laden (mit dem Token des Nutzers, nie mit service_role), Bilder verkleinert als
 * MCP-Bildinhalt liefern, Text aus Dateien lesen und Base64 aus dem Chat prüfen.
 *
 * Grenzen (Stolperfallen): Vercel nimmt je Anfrage und Antwort höchstens 4,5 MB, das MCP-SDK liest
 * höchstens 4 MiB Anfrage – deshalb höchstens 3,5 MB Base64 je Antwort und 2,5 MB je Datei aus dem
 * Chat. Bilder: nur PNG, JPEG, WebP und GIF werden dekodiert, höchstens 60 Megapixel
 * (Dekompressions-Bombe), mit Zeitlimit; HEIC kann die Bildbibliothek nicht lesen.
 */
import type { ContentBlock } from "@modelcontextprotocol/server";
import type { JSONContent } from "@tiptap/core";
import { ATTACHMENT_BUCKET, IMAGE_EXT, NOTE_IMAGE_BUCKET } from "@/features/notes/storage";
import { exportFileName, fileExt } from "@/features/outliner/model/files";
import { NOTE_FILE, NOTE_IMAGE } from "@/features/outliner/model/names";
import { getObject } from "@/features/storage/client";
import { isOwnPath, objectKey } from "@/features/storage/paths";
import type { AiContext } from "./context";
import { aiFiles, headStored, storageProblem } from "./r2";
import { ToolInputError } from "./resolve";

/** längste Kante der Bilder für die KI (Claude verkleinert größere ohnehin auf ~1568 px) */
export const RESULT_IMAGE_SIDE = 1600;
/** höchstens so viele Bilder liefert „fetch“ in einer Antwort mit */
export const MAX_RESULT_IMAGES = 5;
/** Base64-Zeichen aller Bilder/Dateien einer Antwort – unter Vercels 4,5 MB je Antwort */
export const MAX_RESULT_MEDIA_CHARS = 3_500_000;
/** Bilder bis zu dieser Größe und Kantenlänge gehen unverändert hinaus */
const PASS_THROUGH_BYTES = 1024 * 1024;
/** Dekompressions-Bombe: mehr Pixel dekodiert der Server nicht (iPhone 48 MP passt) */
export const MAX_INPUT_PIXELS = 60_000_000;
/** Zeitlimit je Bild (die MCP-Funktion hat 60 s) */
const IMAGE_TIMEOUT_SECONDS = 15;
/** „fetch“ verkleinert nur so lange Bilder – danach Rest per „get_attachment“ (60 s je Aufruf) */
export const FETCH_MEDIA_BUDGET_MS = 25_000;
/** so viel Text aus einer Datei geht an die KI */
export const MAX_TEXT_CHARS = 100_000;
/** Datei aus dem Chat (`attach_file` mit `inhalt_base64`), nach dem Dekodieren */
export const MAX_INLINE_UPLOAD_BYTES = Math.floor(2.5 * 1024 * 1024);
/** Länge der Eingabe vorher begrenzen: Base64 (4/3) plus Zeilenumbrüche und data:-Vorspann */
export const MAX_INLINE_BASE64_CHARS = Math.ceil((MAX_INLINE_UPLOAD_BYTES * 4) / 3 / 0.96) + 200;

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/* ------------------------------------------------------------------ */
/* Bild- und Datei-Knoten eines Eintrags                              */
/* ------------------------------------------------------------------ */

export interface MediaRef {
  kind: "image" | "file";
  bucket: typeof NOTE_IMAGE_BUCKET | typeof ATTACHMENT_BUCKET;
  path: string;
  /** so steht der Verweis im Markdown von „fetch“: Bild `![[ref]]`, Datei `[[ref]]` */
  ref: string;
  /** Alternativtext des Bildes bzw. Originalname der Datei */
  name: string;
  mime: string | null;
  size: number | null;
}

/** Bilder und Dateien in TipTap-JSON (Notiz-Blöcke, Aufgaben-Notiz, Projekt-Freitext), ohne Doppelte. */
export function collectMedia(roots: Iterable<JSONContent | null | undefined>): MediaRef[] {
  const found = new Map<string, MediaRef>();
  const walk = (node: JSONContent | null | undefined) => {
    if (!node || typeof node !== "object") return;
    const path = typeof node.attrs?.path === "string" ? node.attrs.path : "";
    if (node.type === NOTE_IMAGE && path && !found.has(path)) {
      const ref = path.split("/").pop() ?? path;
      found.set(path, {
        kind: "image",
        bucket: NOTE_IMAGE_BUCKET,
        path,
        ref,
        name: String(node.attrs?.alt ?? "").trim() || ref,
        mime: null,
        size: null,
      });
    } else if (node.type === NOTE_FILE && path && !found.has(path)) {
      const name = String(node.attrs?.name ?? "").trim() || "Datei";
      const size = Number(node.attrs?.size);
      found.set(path, {
        kind: "file",
        bucket: ATTACHMENT_BUCKET,
        path,
        ref: exportFileName(path, name),
        name,
        mime: typeof node.attrs?.mime === "string" ? node.attrs.mime : null,
        size: Number.isFinite(size) && size > 0 ? size : null,
      });
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  return [...found.values()];
}

/** In der Reihenfolge, in der die Verweise im Text stehen (Notiz-Blöcke kommen nach Sortierschlüssel). */
export function inTextOrder(media: MediaRef[], text: string): MediaRef[] {
  const position = (m: MediaRef) => {
    const at = text.indexOf(`[[${m.ref}]]`);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  return media
    .map((m, index) => ({ m, index, at: position(m) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => entry.m);
}

// Pfadprüfung liegt an einer Stelle: features/storage/paths.ts
export { isOwnPath };

/** Verweis aus dem Text (`![[…]]`, `[[…]]`, Dateiname, Pfad, `bucket:pfad`) → Vergleichswert. */
export function normalizeRef(value: string): string {
  let text = value.trim().normalize("NFC");
  if (text.startsWith("!")) text = text.slice(1);
  if (text.startsWith("[[") && text.endsWith("]]")) text = text.slice(2, -2);
  text = text.split("|")[0]?.trim() ?? "";
  for (const bucket of [NOTE_IMAGE_BUCKET, ATTACHMENT_BUCKET]) {
    if (text.startsWith(`${bucket}:`)) text = text.slice(bucket.length + 1);
  }
  return text;
}

/**
 * Den Verweis unter den Bildern und Dateien des Eintrags finden – nur was dort steht, lässt sich
 * lesen (kein frei gewählter Pfad, kein anderer Bucket).
 */
export function findMedia(media: MediaRef[], value: string): MediaRef {
  const wanted = normalizeRef(value);
  if (!wanted) throw new ToolInputError("„datei“ ist leer – den Verweis aus dem Text übernehmen.");
  const lower = wanted.toLocaleLowerCase("de");
  const exact = media.filter((m) => m.ref === wanted || m.path === wanted);
  const loose = exact.length
    ? exact
    : media.filter(
        (m) =>
          m.ref.toLocaleLowerCase("de") === lower ||
          m.name.normalize("NFC").toLocaleLowerCase("de") === lower ||
          (m.path.split("/").pop() ?? "").toLocaleLowerCase("de") === lower,
      );
  if (loose.length === 1) return loose[0] as MediaRef;
  const listing = media
    .slice(0, 12)
    .map((m) => (m.kind === "image" ? `![[${m.ref}]]` : `[[${m.ref}]] („${m.name}“)`))
    .join(", ");
  if (loose.length > 1) {
    throw new ToolInputError(
      `„${wanted}“ ist nicht eindeutig – den genauen Verweis nehmen: ${listing}`,
    );
  }
  throw new ToolInputError(
    media.length
      ? `„${wanted}“ steht nicht in diesem Eintrag. Vorhanden: ${listing}${media.length > 12 ? " …" : ""}`
      : "Dieser Eintrag enthält keine Bilder oder Dateien.",
  );
}

/** Die KI liest höchstens so große Dateien (PDF-Text, Textdateien, Bilder) – Speicher und Laufzeit der Funktion */
export const MAX_READ_BYTES = 25 * 1024 * 1024;

/** Datei zu groß zum Lesen für die KI (mit Größe, falls bekannt). */
export class TooLargeError extends ToolInputError {
  constructor(
    readonly limit: number,
    readonly size?: number,
  ) {
    super(`Die Datei ist größer als ${formatSize(limit)}.`);
  }
}

/** Datei aus dem eigenen Ordner in R2 laden (KI-Freigabe und eigener Pfad werden geprüft). */
export async function loadStored(
  ctx: AiContext,
  media: Pick<MediaRef, "bucket" | "path" | "size">,
  maxBytes = MAX_READ_BYTES,
): Promise<Uint8Array> {
  if (!isOwnPath(media.path, ctx.userId)) {
    throw new ToolInputError("Diese Datei liegt nicht im eigenen Ordner.");
  }
  if (media.size && media.size > maxBytes) throw new TooLargeError(maxBytes, media.size);
  // erst HEAD: große Dateien gar nicht erst laden
  const head = await headStored(ctx, media.bucket, media.path);
  if (!head.exists) {
    throw new ToolInputError("Datei nicht ladbar (nicht im Speicher) – in der App prüfen.");
  }
  if (head.size && head.size > maxBytes) throw new TooLargeError(maxBytes, head.size);
  const files = await aiFiles(ctx);
  let got: Awaited<ReturnType<typeof getObject>>;
  try {
    got = await getObject(files.config, objectKey(media.bucket, media.path));
  } catch (caught) {
    return storageProblem(caught);
  }
  if (!got) throw new ToolInputError("Datei nicht ladbar (nicht im Speicher) – in der App prüfen.");
  if (got.body.byteLength > maxBytes) throw new TooLargeError(maxBytes, got.body.byteLength);
  return new Uint8Array(got.body);
}

/* ------------------------------------------------------------------ */
/* Dateityp am Inhalt erkennen                                         */
/* ------------------------------------------------------------------ */

export type SniffedType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/heic"
  | "application/pdf";

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

/** Typ an den ersten Bytes (nicht an Endung oder Angabe der KI). */
export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (bytes.length >= 8 && ascii(bytes, 1, 3) === "PNG" && bytes[0] === 0x89) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return "image/webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 4)))
    return "image/heic";
  // PDF: Kopf in den ersten 1024 Bytes (die Norm erlaubt Vorspann)
  if (ascii(bytes, 0, Math.min(bytes.length, 1024)).includes("%PDF-")) return "application/pdf";
  return null;
}

/* ------------------------------------------------------------------ */
/* Bilder für die KI                                                   */
/* ------------------------------------------------------------------ */

type Sharp = typeof import("sharp")["default"];
let sharpLoader: Promise<Sharp | null> | null = null;

/** Bildbibliothek erst bei Bedarf laden – fehlt sie (Plattform), gehen kleine Bilder unverändert. */
function loadSharp(): Promise<Sharp | null> {
  sharpLoader ??= import("sharp")
    .then((module) => {
      // zur Laufzeit gibt es nur den Standard-Export (die Typen nennen auch benannte)
      const sharp = module.default;
      // kein Zwischenspeicher im Prozess (Serverless, jede Datei nur einmal)
      (sharp as unknown as { cache?: (enable: boolean) => unknown }).cache?.(false);
      return sharp;
    })
    .catch(() => null);
  return sharpLoader;
}

export interface AiImage {
  data: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  /** Kantenlänge vor dem Verkleinern, falls verkleinert */
  original: { width: number; height: number } | null;
}

/** Hintergrund für transparente Bilder (JPEG kennt keine Transparenz) – keine UI-Farbe */
const WHITE = { r: 255, g: 255, b: 255 };

const DECODABLE = new Set<SniffedType>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Bild als MCP-Bildinhalt vorbereiten: längste Kante höchstens 1600 px (JPEG, Transparenz auf
 * Weiß), EXIF-Drehung angewandt; kleine Bilder unverändert. Nie ein Absturz – sonst `problem`.
 */
export async function imageForAi(bytes: Uint8Array): Promise<AiImage | { problem: string }> {
  const type = sniffType(bytes);
  if (type === "image/heic") {
    return {
      problem:
        "HEIC-Foto (iPhone) – die Bildbibliothek des Servers kann es nicht umwandeln; in der App ansehen.",
    };
  }
  if (!type || !DECODABLE.has(type)) {
    return { problem: "Kein lesbares Bild (PNG, JPEG, WebP oder GIF)." };
  }
  const sharp = await loadSharp();
  const plain = (): AiImage => ({
    data: Buffer.from(bytes).toString("base64"),
    mimeType: type,
    width: null,
    height: null,
    original: null,
  });
  if (!sharp) {
    return bytes.length <= PASS_THROUGH_BYTES
      ? plain()
      : { problem: "Bild zu groß und hier nicht verkleinerbar – in der App ansehen." };
  }
  try {
    const meta = await sharp(bytes, { pages: 1 }).metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    const width = (swap ? meta.height : meta.width) ?? 0;
    const height = (swap ? meta.width : meta.height) ?? 0;
    if (!width || !height) return { problem: "Bildgröße nicht lesbar." };
    if (width * height > MAX_INPUT_PIXELS) {
      return {
        problem: `Bild mit ${Math.round((width * height) / 1e6)} Megapixeln ist zu groß zum Verkleinern – in der App ansehen.`,
      };
    }
    if (
      Math.max(width, height) <= RESULT_IMAGE_SIDE &&
      bytes.length <= PASS_THROUGH_BYTES &&
      (meta.orientation ?? 1) === 1
    ) {
      return { ...plain(), width, height };
    }
    const { data, info } = await sharp(bytes, {
      pages: 1,
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    })
      .timeout({ seconds: IMAGE_TIMEOUT_SECONDS })
      .rotate()
      .resize({
        width: RESULT_IMAGE_SIDE,
        height: RESULT_IMAGE_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: WHITE })
      .jpeg({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return {
      data: data.toString("base64"),
      mimeType: "image/jpeg",
      width: info.width,
      height: info.height,
      original: info.width !== width || info.height !== height ? { width, height } : null,
    };
  } catch (error) {
    return {
      problem: `Bild nicht lesbar${error instanceof Error ? ` (${error.message.slice(0, 120)})` : ""}.`,
    };
  }
}

export const imageBlock = (image: AiImage): ContentBlock => ({
  type: "image",
  data: image.data,
  mimeType: image.mimeType,
});

/** HEIC aus dem Chat in JPEG umwandeln, wenn die Bibliothek es kann – sonst null. */
export async function heicToJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .timeout({ seconds: IMAGE_TIMEOUT_SECONDS })
      .rotate()
      .jpeg({ quality: 85 })
      .toBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Textdateien                                                         */
/* ------------------------------------------------------------------ */

const TEXT_EXT = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "xml",
  "yaml",
  "yml",
  "html",
  "htm",
  "svg",
  "ics",
  "vcf",
  "log",
  "ini",
  "toml",
  "conf",
  "js",
  "mjs",
  "ts",
  "css",
  "py",
  "sh",
  "sql",
  "eml",
  "rtf",
  "tex",
]);
const TEXT_MIME =
  /^(text\/|application\/(json|xml|x-yaml|yaml|csv|javascript|rtf|x-sh|sql)|image\/svg\+xml)/;

export const isTextLike = (mime: string | null, name: string) =>
  (mime ? TEXT_MIME.test(mime) : false) || TEXT_EXT.has(fileExt(name));

/**
 * Text einer Datei (UTF-8, sonst Windows-1252); Binärdateien → null. Dekodiert höchstens so viel,
 * wie ausgegeben wird (`maxChars` Zeichen brauchen höchstens 4 Bytes je Zeichen).
 */
export function decodeText(bytes: Uint8Array, maxChars = MAX_TEXT_CHARS): string | null {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return null;
  const part = bytes.subarray(0, maxChars * 4);
  // „stream“: ein am Schnitt halbes Zeichen ist kein Fehler
  const stream = part.length < bytes.length;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(part, { stream });
  } catch {
    return new TextDecoder("windows-1252").decode(part.subarray(0, maxChars));
  }
}

/* ------------------------------------------------------------------ */
/* Datei aus dem Chat (Base64)                                         */
/* ------------------------------------------------------------------ */

/** Base64 (auch mit `data:…;base64,`-Vorspann, Zeilenumbrüchen oder base64url) → Bytes. */
export function decodeBase64(value: string): { bytes: Uint8Array; declaredMime: string | null } {
  let text = value.trim();
  let declaredMime: string | null = null;
  const dataUrl = /^data:([^;,]*)(;[^,]*)?,/i.exec(text);
  if (dataUrl) {
    if (!/;base64/i.test(dataUrl[2] ?? "")) {
      throw new ToolInputError("„inhalt_base64“: data:-Adresse ohne „;base64“.");
    }
    declaredMime = dataUrl[1]?.trim().toLowerCase() || null;
    text = text.slice(dataUrl[0].length);
  }
  text = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!text) throw new ToolInputError("„inhalt_base64“ ist leer.");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 === 1) {
    throw new ToolInputError(
      "„inhalt_base64“ ist kein gültiges Base64 (nur A–Z, a–z, 0–9, +, / und = am Ende).",
    );
  }
  const estimated = Math.floor((text.length * 3) / 4);
  if (estimated > MAX_INLINE_UPLOAD_BYTES + 3) {
    throw new ToolInputError(
      `Die Datei ist größer als ${formatSize(MAX_INLINE_UPLOAD_BYTES)} – größere Dateien über einen Notion-Link oder „prepare_upload“ (vom eigenen Rechner).`,
    );
  }
  const bytes = new Uint8Array(Buffer.from(text, "base64"));
  if (bytes.length === 0) throw new ToolInputError("„inhalt_base64“ ist leer.");
  if (bytes.length > MAX_INLINE_UPLOAD_BYTES) {
    throw new ToolInputError(
      `Die Datei ist größer als ${formatSize(MAX_INLINE_UPLOAD_BYTES)} – größere Dateien über einen Notion-Link oder „prepare_upload“ (vom eigenen Rechner).`,
    );
  }
  return { bytes, declaredMime };
}

const MIME_SHAPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
/** Typen, die ein Browser ausführen oder darstellen würde – gespeichert als reiner Text. */
const ACTIVE_MIME = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/javascript",
  "application/javascript",
  "text/xml",
  "application/xml",
]);

/** Content-Type, der gespeichert wird: am Inhalt erkannt, sonst die (bereinigte) Angabe, sonst Endung. */
export function storedMime(
  sniffed: SniffedType | null,
  declared: string | null | undefined,
  fallback: string,
): string {
  if (sniffed) return sniffed;
  const clean = (declared ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const unknown = clean === "application/octet-stream" || clean === "binary/octet-stream";
  const mime = MIME_SHAPE.test(clean) && !unknown ? clean : fallback;
  return ACTIVE_MIME.has(mime) ? "text/plain" : mime;
}

/** Bildtypen, die als Bild (nicht als Datei-Kachel) in der Notiz stehen. */
export const isNoteImageType = (mime: string) => Boolean(IMAGE_EXT[mime]);
