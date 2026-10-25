import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  collectMedia,
  decodeBase64,
  decodeText,
  findMedia,
  imageForAi,
  inTextOrder,
  isOwnPath,
  MAX_INLINE_UPLOAD_BYTES,
  normalizeRef,
  sniffType,
  storedMime,
} from "./media";
import { pdfText } from "./pdf-text";
import { ToolInputError } from "./resolve";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const NOTE = "22222222-2222-4222-8222-222222222222";
const IMG = "33333333-3333-4333-8333-333333333333";
const PDF = "44444444-4444-4444-8444-444444444444";

/** kleinstes PDF mit Text „Hallo Welt“ */
const MINI_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 20 100 Td (Hallo Welt) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Liste " },
        {
          type: "noteImage",
          attrs: { path: `${USER}/${NOTE}/${IMG}.png`, alt: "Namensliste", width: null },
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "noteFile",
          attrs: {
            path: `${USER}/${NOTE}/${PDF}.pdf`,
            name: "Bilanz März.pdf",
            size: 1234,
            mime: "application/pdf",
            view: "tile",
          },
        },
        // dasselbe Bild noch einmal: nur einmal gezählt
        { type: "noteImage", attrs: { path: `${USER}/${NOTE}/${IMG}.png`, alt: "" } },
      ],
    },
  ],
};

/**
 * Dekompressions-Bombe: Graustufen-PNG mit 1 Bit je Pixel, alles Null – wenige KB Datei,
 * ausgepackt aber `width × height` Pixel.
 */
function pngBomb(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([1, 0, 0, 0, 0], 8);
  const rows = Buffer.alloc((1 + Math.ceil(width / 8)) * height);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(rows, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

describe("Bilder und Dateien eines Eintrags (#71)", () => {
  it("findet Bild und Datei-Kachel (ohne Doppelte) mit dem Verweis wie im Text von „fetch“", () => {
    const media = collectMedia([doc]);
    expect(media).toHaveLength(2);
    expect(media[0]).toMatchObject({
      kind: "image",
      bucket: "note-images",
      ref: `${IMG}.png`,
      name: "Namensliste",
    });
    expect(media[1]).toMatchObject({
      kind: "file",
      bucket: "attachments",
      ref: "Bilanz März-44444444.pdf",
      name: "Bilanz März.pdf",
      size: 1234,
    });
    // Reihenfolge wie im Text
    const text = `[[Bilanz März-44444444.pdf]] dann ![[${IMG}.png]]`;
    expect(inTextOrder(media, text).map((m) => m.kind)).toEqual(["file", "image"]);
  });

  it("Verweis aus dem Text: ![[…]], [[…]], Dateiname, Originalname, mit Bucket davor", () => {
    const media = collectMedia([doc]);
    expect(normalizeRef(` ![[${IMG}.png]] `)).toBe(`${IMG}.png`);
    expect(findMedia(media, `![[${IMG}.png]]`).kind).toBe("image");
    expect(findMedia(media, "[[Bilanz März-44444444.pdf]]").kind).toBe("file");
    expect(findMedia(media, "bilanz märz.pdf").kind).toBe("file");
    expect(findMedia(media, `${USER}/${NOTE}/${PDF}.pdf`).kind).toBe("file");
    // der Bucket kommt immer aus dem Knoten, nie aus der Eingabe
    expect(findMedia(media, `attachments:${USER}/${NOTE}/${IMG}.png`).bucket).toBe("note-images");
  });

  it("nur was im Eintrag steht: fremde Pfade, andere Dateien und Leeres werden abgewiesen", () => {
    const media = collectMedia([doc]);
    for (const value of [
      `${OTHER}/${NOTE}/${IMG}.png`,
      `${USER}/${NOTE}/../${IMG}.png`,
      "../../etc/passwd",
      "andere.png",
    ]) {
      expect(() => findMedia(media, value), value).toThrow(ToolInputError);
    }
    expect(() => findMedia(media, "andere.png")).toThrow(/Vorhanden: !\[\[/);
    expect(() => findMedia([], "x.png")).toThrow(/keine Bilder oder Dateien/);
    expect(() => findMedia(media, " [[ ]] ")).toThrow(/leer/);
  });

  it("Pfad im eigenen Ordner: eigene user_id, genau drei Teile, kein „..“", () => {
    expect(isOwnPath(`${USER}/${NOTE}/${IMG}.png`, USER)).toBe(true);
    expect(isOwnPath(`${OTHER}/${NOTE}/${IMG}.png`, USER)).toBe(false);
    expect(isOwnPath(`${USER}/../${IMG}.png`, USER)).toBe(false);
    expect(isOwnPath(`${USER}/${NOTE}/..`, USER)).toBe(false);
    expect(isOwnPath(`${USER}/${NOTE}/x/${IMG}.png`, USER)).toBe(false);
    expect(isOwnPath(`/${USER}/${NOTE}/${IMG}.png`, USER)).toBe(false);
    expect(isOwnPath(`${USER}/${NOTE}/${IMG}.p.ng`, USER)).toBe(false);
    expect(isOwnPath(`${USER}/${NOTE}`, USER)).toBe(false);
  });
});

describe("Typ am Inhalt, Base64 aus dem Chat (#71)", () => {
  it("erkennt PNG, JPEG, GIF, WebP, HEIC und PDF an den ersten Bytes", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer();
    const jpeg = await sharp(png).jpeg().toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    const gif = await sharp(png).gif().toBuffer();
    expect(sniffType(new Uint8Array(png))).toBe("image/png");
    expect(sniffType(new Uint8Array(jpeg))).toBe("image/jpeg");
    expect(sniffType(new Uint8Array(webp))).toBe("image/webp");
    expect(sniffType(new Uint8Array(gif))).toBe("image/gif");
    const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
    expect(sniffType(heic)).toBe("image/heic");
    expect(sniffType(new TextEncoder().encode(MINI_PDF))).toBe("application/pdf");
    expect(sniffType(new TextEncoder().encode("Hallo"))).toBeNull();
  });

  it("dekodiert Base64 auch als data:-Adresse, mit Umbrüchen und als base64url", () => {
    const text = "Grüße aus Überlingen";
    const b64 = Buffer.from(text).toString("base64");
    expect(Buffer.from(decodeBase64(b64).bytes).toString()).toBe(text);
    const wrapped = `${b64.slice(0, 10)}\n${b64.slice(10)}`;
    expect(Buffer.from(decodeBase64(wrapped).bytes).toString()).toBe(text);
    const dataUrl = decodeBase64(`data:text/plain;base64,${b64}`);
    expect(dataUrl.declaredMime).toBe("text/plain");
    expect(Buffer.from(dataUrl.bytes).toString()).toBe(text);
    const bytes = new Uint8Array([251, 255, 254]);
    const url = Buffer.from(bytes).toString("base64url");
    expect([...decodeBase64(url).bytes]).toEqual([...bytes]);
  });

  it("weist kaputtes, leeres und zu großes Base64 verständlich ab", () => {
    expect(() => decodeBase64("")).toThrow(/leer/);
    expect(() => decodeBase64("ab$c")).toThrow(/kein gültiges Base64/);
    expect(() => decodeBase64("data:text/plain,Hallo")).toThrow(/;base64/);
    const tooBig = "A".repeat(Math.ceil(((MAX_INLINE_UPLOAD_BYTES + 10) * 4) / 3 / 4) * 4);
    expect(() => decodeBase64(tooBig)).toThrow(/größer als 2,5 MB/);
  });

  it("gespeicherter Typ: Inhalt vor Angabe, aktive Typen als Text, Unsinn → Endung", () => {
    expect(storedMime("image/png", "text/html", "x")).toBe("image/png");
    expect(storedMime(null, "text/csv; charset=utf-8", "x")).toBe("text/csv");
    expect(storedMime(null, "text/html", "x")).toBe("text/plain");
    expect(storedMime(null, "image/svg+xml", "x")).toBe("text/plain");
    expect(storedMime(null, "kein typ", "application/octet-stream")).toBe(
      "application/octet-stream",
    );
    expect(storedMime(null, undefined, "application/pdf")).toBe("application/pdf");
  });

  it("Text: UTF-8 mit Umlauten, sonst Windows-1252; Binäres nicht", () => {
    expect(decodeText(new TextEncoder().encode("Größe"))).toBe("Größe");
    expect(decodeText(new Uint8Array([0x47, 0x72, 0xf6, 0xdf, 0x65]))).toBe("Größe");
    expect(decodeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBeNull();
    // nur so viel, wie ausgegeben wird; ein am Schnitt halbes „ö“ ist kein Fehler
    const long = new TextEncoder().encode(`a${"ö".repeat(50)}`);
    expect(decodeText(long, 10)).toBe(`a${"ö".repeat(19)}`);
  });
});

describe("Bilder für die KI verkleinern (#71)", () => {
  it("große Bilder → längste Kante 1600 px als JPEG, Transparenz auf Weiß", async () => {
    const big = await sharp({
      create: {
        width: 3200,
        height: 1000,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const image = await imageForAi(new Uint8Array(big));
    if ("problem" in image) throw new Error(image.problem);
    expect(image).toMatchObject({
      mimeType: "image/jpeg",
      width: 1600,
      height: 500,
      original: { width: 3200, height: 1000 },
    });
    const pixel = await sharp(Buffer.from(image.data, "base64")).raw().toBuffer();
    expect(pixel[0]).toBeGreaterThan(240);
  });

  it("kleine Bilder gehen unverändert hinaus", async () => {
    const small = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 18, g: 52, b: 86 } },
    })
      .png()
      .toBuffer();
    const image = await imageForAi(new Uint8Array(small));
    if ("problem" in image) throw new Error(image.problem);
    expect(image).toMatchObject({ mimeType: "image/png", width: 40, height: 30, original: null });
    expect(image.data).toBe(small.toString("base64"));
  });

  it("Dekompressions-Bombe, HEIC und Kaputtes → Hinweis statt Absturz", async () => {
    const file = pngBomb(10_000, 10_000);
    expect(file.length).toBeLessThan(100_000);
    const bomb = await imageForAi(file);
    expect(bomb).toMatchObject({ problem: expect.stringContaining("100 Megapixeln") });
    const heic = await imageForAi(
      new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]),
    );
    expect(heic).toMatchObject({ problem: expect.stringContaining("HEIC") });
    const broken = await imageForAi(pngBomb(4000, 3000).slice(0, 60));
    expect(broken).toMatchObject({ problem: expect.stringContaining("nicht lesbar") });
    expect(await imageForAi(new TextEncoder().encode("kein Bild"))).toMatchObject({
      problem: expect.stringContaining("Kein lesbares Bild"),
    });
  });
});

describe("Text aus PDFs (#71)", () => {
  it("liest die Textebene je Seite; Kaputtes ergibt null", async () => {
    const result = await pdfText(new TextEncoder().encode(MINI_PDF));
    expect(result).toMatchObject({ pages: 1, read: 1, truncated: false });
    expect(result?.text).toContain("--- Seite 1 ---");
    expect(result?.text).toContain("Hallo Welt");
    expect(await pdfText(new TextEncoder().encode("%PDF-1.4 kaputt"))).toBeNull();
  });

  it("kürzt auf die Zeichengrenze", async () => {
    const result = await pdfText(new TextEncoder().encode(MINI_PDF), { maxChars: 20 });
    expect(result?.truncated).toBe(true);
    expect(result?.text.length).toBeLessThanOrEqual(20);
  });
});
