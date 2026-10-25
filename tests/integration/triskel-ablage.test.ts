/**
 * Triskel-Ablage (#76) gegen das Testprojekt: das Programm am Mac (stdio, eigener Prozess) mit
 * der echten KI-Verbindung im Test – Datei suchen, vorbereiten, `prepare_upload`, hochladen,
 * `attach_file`; Fotos werden verkleinert (nur auf dem Mac, `sips`); Sperren für fremde Ordner,
 * versteckte Dateien und fremde Adressen. Der Benutzerordner ist ein Testordner (HOME).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { getObject } from "@/features/storage/client";
import { objectKey } from "@/features/storage/paths";
import { assertTestBackend } from "../guard";
import { asAllowedAi, connectAi } from "../support/mcp";
import { removeR2Folders, testR2Config } from "../support/media";
import { runMarker, userClient } from "../support/supabase-node";

const sessionA = inject("sessionA");
const db = userClient(sessionA);
const marker = runMarker();
const r2 = testR2Config();
const SCRIPT = fileURLToPath(new URL("../../scripts/triskel-ablage.mts", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "ablage-home-"));
const downloads = join(home, "Downloads");
const uploaded: Array<{ bucket: string; path: string }> = [];
let ai: Awaited<ReturnType<typeof connectAi>>;
let ablage: Client;
let noteId: string;

/** Werkzeug der Ablage aufrufen; Text und Fehlerflag */
async function local(name: string, args: Record<string, unknown>) {
  const result = await ablage.callTool({ name, arguments: args });
  const content = (result.content ?? []) as Array<{ text?: string }>;
  return { text: content.map((c) => c.text ?? "").join("\n"), isError: result.isError === true };
}

const field = (text: string, key: string) =>
  new RegExp(`^${key}: (.+)$`, "m").exec(text)?.[1] ?? "";

/** Ganzer Ablauf wie in der Desktop-App: vorbereiten → prepare_upload → hochladen → anhängen */
async function file(path: string) {
  const prepared = await local("datei_vorbereiten", { pfad: path });
  expect(prepared.isError, prepared.text).toBe(false);
  const name = field(prepared.text, "name");
  const link = await ai.call("prepare_upload", {
    ziel: noteId,
    name,
    groesse: Number(field(prepared.text, "bytes")),
  });
  expect(link.isError, link.text).toBe(false);
  const upload = String(link.structured?.upload);
  const put = await local("datei_hochladen", {
    datei: field(prepared.text, "datei"),
    upload_url: link.structured?.upload_url,
    content_type: link.structured?.content_type,
  });
  expect(put.isError, put.text).toBe(false);
  // derselbe Link ein zweites Mal: nichts überschrieben, verständlicher Hinweis statt Fehler (P)
  const again = await local("datei_hochladen", {
    datei: field(prepared.text, "datei"),
    upload_url: link.structured?.upload_url,
    content_type: link.structured?.content_type,
  });
  expect(again.isError, again.text).toBe(false);
  expect(again.text).toContain("schon eine Datei");
  const attached = await ai.call("attach_file", { ziel: noteId, upload, name });
  expect(attached.isError, attached.text).toBe(false);
  const [bucket, ...rest] = upload.split(":");
  const stored = { bucket: bucket as string, path: rest.join(":") };
  uploaded.push(stored);
  return { prepared, name, stored };
}

beforeAll(async () => {
  mkdirSync(downloads, { recursive: true });
  mkdirSync(join(home, ".ssh"));
  writeFileSync(join(home, ".ssh", "id_test"), "geheim");
  writeFileSync(join(downloads, ".versteckt.pdf"), "%PDF-1.7");
  ai = await connectAi({
    db: asAllowedAi(db),
    userId: sessionA.userId,
    clientId: `test-${marker}`,
    origin: "https://app.test",
    now: () => new Date(),
    r2,
  });
  const note = await ai.call("create_note", { titel: `${marker} Ablage`, bereich: "Privat" });
  noteId = String(note.structured?.id);
  ablage = new Client({ name: "test", version: "1.0.0" });
  await ablage.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SCRIPT],
      env: {
        ...getDefaultEnvironment(),
        HOME: home,
        TRISKEL_SUPABASE_URL: assertTestBackend().url,
        // R2: eigenes Konto und – nur für den Test – der Test-Bucket (genau dieser Name)
        TRISKEL_R2_ACCOUNT_ID: r2?.accountId ?? "",
        TRISKEL_R2_BUCKET: r2?.bucket ?? "",
      },
      stderr: "pipe",
    }),
  );
});

afterAll(async () => {
  await ablage?.close();
  await ai?.close();
  if (r2 && noteId) {
    for (const bucket of ["note-images", "attachments"] as const) {
      await removeR2Folders(r2, bucket, sessionA.userId, [noteId]);
    }
  }
  if (noteId) {
    await db.from("note_blocks").delete().eq("note_id", noteId);
    await db.from("notes").delete().eq("id", noteId);
  }
  rmSync(home, { recursive: true, force: true });
});

describe("Triskel-Ablage (#76)", () => {
  it("Excel aus Downloads: suchen, unverändert hochladen, an die Notiz hängen", async () => {
    const bytes = Buffer.from(`PK\u0003\u0004 ${marker} Tabelle`.repeat(400));
    writeFileSync(join(downloads, `${marker} Liste.xlsx`), bytes);

    const found = await local("dateien_suchen", { suchwort: `${marker} liste` });
    expect(found.text).toContain(join(downloads, `${marker} Liste.xlsx`));
    expect((await local("dateien_suchen", { suchwort: "versteckt" })).text).toContain(
      "Keine Datei",
    );

    const { prepared, stored } = await file(join(downloads, `${marker} Liste.xlsx`));
    expect(prepared.text).toContain("unverändert");
    expect(stored.bucket).toBe("attachments");
    const download = await getObject(r2 as never, objectKey("attachments", stored.path));
    expect(Buffer.from(download?.body as ArrayBuffer).equals(bytes)).toBe(true);
    const block = (
      await db.from("note_blocks").select("content_text").eq("note_id", noteId).single()
    ).data;
    expect(block?.content_text).toContain(`[Datei: ${marker} Liste.xlsx]`);
  });

  it.skipIf(process.platform !== "darwin")(
    "Foto wird verkleinert (längste Seite 2000 px), HEIC wird JPEG und erscheint als Bild",
    async () => {
      const jpeg = join(downloads, "Wache.jpg");
      await sharp({
        create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 40, b: 40 } },
      })
        .jpeg({ quality: 100 })
        .toFile(jpeg);
      execFileSync("/usr/bin/sips", [
        "-s",
        "format",
        "heic",
        jpeg,
        "--out",
        join(downloads, "IMG_0042.HEIC"),
      ]);

      const photo = await file(jpeg);
      expect(photo.prepared.text).toMatch(/verkleinert von/);
      const heic = await file(join(downloads, "IMG_0042.HEIC"));
      expect(heic.name).toBe("IMG_0042.jpg");
      expect(heic.stored.bucket).toBe("note-images");
      const download = await getObject(r2 as never, objectKey("note-images", heic.stored.path));
      const meta = await sharp(Buffer.from(download?.body as ArrayBuffer)).metadata();
      expect(meta.format).toBe("jpeg");
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(2000);
    },
  );

  it("Sperren: fremde Ordner, versteckte Dateien, fremde Adressen", async () => {
    const outside = await local("datei_vorbereiten", { pfad: join(home, ".ssh", "id_test") });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain("Nur Dateien aus");
    const hidden = await local("datei_vorbereiten", { pfad: join(downloads, ".versteckt.pdf") });
    expect(hidden.isError).toBe(true);
    expect(hidden.text).toContain("Versteckte");

    writeFileSync(join(downloads, `${marker} Brief.pdf`), "%PDF-1.7 Brief");
    const foreign = await local("datei_hochladen", {
      datei: join(downloads, `${marker} Brief.pdf`),
      upload_url: "https://fremd.supabase.co/storage/v1/object/upload/sign/a/b.pdf?token=x",
    });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toContain("nur zu Triskel");

    // R2-Link: fremdes Konto, fremder Bucket, ohne Signatur → abgelehnt
    const signed = `?X-Amz-Expires=3600&X-Amz-Credential=k&X-Amz-Signature=abc`;
    const bad = [
      `https://fedcba9876543210fedcba9876543210.eu.r2.cloudflarestorage.com/${r2?.bucket}/a/b/c.pdf${signed}`,
      `https://${r2?.accountId}.eu.r2.cloudflarestorage.com/fremder-bucket/a/b/c.pdf${signed}`,
      `https://${r2?.accountId}.eu.r2.cloudflarestorage.com/${r2?.bucket}/a/b/c.pdf`,
    ];
    for (const upload_url of bad) {
      const refused = await local("datei_hochladen", {
        datei: join(downloads, `${marker} Brief.pdf`),
        upload_url,
      });
      expect(refused.isError, upload_url).toBe(true);
    }
  });

  it("Größe: datei_vorbereiten nennt die genauen Bytes für prepare_upload", async () => {
    writeFileSync(join(downloads, `${marker} Genau.pdf`), "%PDF-1.7 12345");
    const prepared = await local("datei_vorbereiten", {
      pfad: join(downloads, `${marker} Genau.pdf`),
    });
    expect(field(prepared.text, "bytes")).toBe(String(Buffer.byteLength("%PDF-1.7 12345")));
  });
});
