/**
 * Papierkorb leeren gegen das Testprojekt und den R2-Test-Bucket (E24, #27, E41): Bilder und Dateien einer endgültig
 * gelöschten Aufgabe gehen nur, wenn nichts anderes mehr auf sie zeigt. Ein in Notiz B kopiertes
 * PDF und ein Bild in einer Notiz im Papierkorb bleiben, Ungenutztes wird entfernt.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { MediaFolderApi } from "@/features/notes/media-api";
import { deleteObjects, headObject, listKeys, putObject } from "@/features/storage/client";
import { folderPrefix, objectKey, parseKey } from "@/features/storage/paths";
import { removeUnusedMedia } from "@/features/trash/media";
import type { Supabase } from "@/lib/supabase/client";
import { testR2Config } from "../support/media";
import { runMarker, userClient } from "../support/supabase-node";

const session = inject("sessionA");
const db = userClient(session);
const r2 = testR2Config();
if (!r2) throw new Error("R2-Werte fehlen in .env.test.local");
const config = r2;
// wie die Routen /api/dateien/liste und /loeschen, nur ohne Next.js
const api: MediaFolderApi = {
  async list(bucket, ownerId) {
    const keys = await listKeys(config, folderPrefix(bucket, session.userId, ownerId));
    return keys.flatMap((key) => parseKey(key)?.path ?? []);
  },
  async remove(bucket, paths) {
    await deleteObjects(
      config,
      paths.map((path) => objectKey(bucket, path)),
    );
  },
};
const run = (ownerIds: string[], pending: unknown[] = []) =>
  removeUnusedMedia(db as unknown as Supabase, session.userId, ownerIds, pending, api);
const marker = runMarker();
const ids = {
  task: crypto.randomUUID(),
  copy: crypto.randomUUID(),
  trashed: crypto.randomUUID(),
  copyBlock: crypto.randomUUID(),
  trashedBlock: crypto.randomUUID(),
};
const folder = `${session.userId}/${ids.task}`;
const paths = {
  copied: `${folder}/kopiert.pdf`,
  unused: `${folder}/ungenutzt.pdf`,
  imageInTrash: `${folder}/im-papierkorb.png`,
  imageUnused: `${folder}/ungenutzt.png`,
};
const pdf = () => new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" });
// 1×1 PNG
const png = () =>
  new Blob(
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    { type: "image/png" },
  );
const fileNode = (path: string) => ({
  type: "paragraph",
  content: [{ type: "noteFile", attrs: { path, name: "kopiert.pdf" } }],
});
const imageNode = (path: string) => ({
  type: "paragraph",
  content: [{ type: "noteImage", attrs: { path, alt: "" } }],
});

const exists = async (bucket: "attachments" | "note-images", path: string) =>
  (await headObject(config, objectKey(bucket, path))).exists;

beforeAll(async () => {
  const { data } = await db.from("areas").select("id").order("sort").limit(1).single();
  const areaId = data?.id ?? "";
  expect(areaId).not.toBe("");
  for (const [bucket, path, blob] of [
    ["attachments", paths.copied, pdf()],
    ["attachments", paths.unused, pdf()],
    ["note-images", paths.imageInTrash, png()],
    ["note-images", paths.imageUnused, png()],
  ] as const) {
    await putObject(config, objectKey(bucket, path), await blob.arrayBuffer(), blob.type);
  }
  // Aufgabe A (wird „endgültig gelöscht“) – ihr Inhalt zählt nicht als Verweis
  expect(
    (
      await db.from("tasks").insert({
        id: ids.task,
        title: `E2E-Aufgabe ${marker}`,
        area_id: areaId,
        sort: "a0",
        body: { type: "doc", content: [fileNode(paths.unused), imageNode(paths.imageUnused)] },
      })
    ).error,
  ).toBeNull();
  // Notiz B: das PDF wurde hierher kopiert; Notiz C liegt im Papierkorb und hat das Bild
  expect(
    (
      await db.from("notes").insert([
        { id: ids.copy, title: `E2E-Kopie ${marker}`, area_id: areaId },
        {
          id: ids.trashed,
          title: `E2E-Papierkorb ${marker}`,
          area_id: areaId,
          deleted_at: new Date().toISOString(),
        },
      ])
    ).error,
  ).toBeNull();
  expect(
    (
      await db.from("note_blocks").insert([
        {
          id: ids.copyBlock,
          note_id: ids.copy,
          sort: "a0",
          content: fileNode(paths.copied),
          content_text: "",
        },
        {
          id: ids.trashedBlock,
          note_id: ids.trashed,
          sort: "a0",
          content: imageNode(paths.imageInTrash),
          content_text: "",
        },
      ])
    ).error,
  ).toBeNull();
});

afterAll(async () => {
  await db.from("notes").delete().in("id", [ids.copy, ids.trashed]);
  await db.from("tasks").delete().eq("id", ids.task);
  await deleteObjects(config, [
    objectKey("attachments", paths.copied),
    objectKey("attachments", paths.unused),
    objectKey("note-images", paths.imageInTrash),
    objectKey("note-images", paths.imageUnused),
  ]);
});

describe("Papierkorb leeren: Bilder und Dateien", () => {
  it("lebt der Besitzer noch (anderswo zurückgeholt, Löschen gescheitert), bleiben seine Dateien (D-11)", async () => {
    await run([ids.task]);
    expect(await exists("attachments", paths.unused)).toBe(true);
    expect(await exists("note-images", paths.imageUnused)).toBe(true);
  });

  it("entfernt nach dem endgültigen Löschen nur, was nirgends sonst steht", async () => {
    // wie empty_trash: Aufgabe A ist weg
    const deleted = await db.from("tasks").delete().eq("id", ids.task).select("id");
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(1);
    await run([ids.task]);
    expect(await exists("attachments", paths.copied)).toBe(true);
    expect(await exists("attachments", paths.unused)).toBe(false);
    expect(await exists("note-images", paths.imageInTrash)).toBe(true);
    expect(await exists("note-images", paths.imageUnused)).toBe(false);
  });

  it("noch nicht gespeicherte Werte schützen eine Datei ebenfalls", async () => {
    const pending = `${folder}/wartend.pdf`;
    await putObject(
      config,
      objectKey("attachments", pending),
      await pdf().arrayBuffer(),
      "application/pdf",
    );
    try {
      await run([ids.task], [{ content: fileNode(pending) }]);
      expect(await exists("attachments", pending)).toBe(true);
    } finally {
      await deleteObjects(config, [objectKey("attachments", pending)]);
    }
  });
});
