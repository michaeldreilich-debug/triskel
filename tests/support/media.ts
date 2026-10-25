/**
 * Aufräum-Helfer für Tests: Bilder und Dateien nur in den Ordnern der Testnutzer entfernen.
 * - R2 (E41): über die Speicher-Schicht gegen den Test-Bucket (`.env.test.local`).
 */
import { deleteObjects, listKeys } from "@/features/storage/client";
import { type R2Config, readR2Config } from "@/features/storage/config";
import { folderPrefix } from "@/features/storage/paths";
import { assertR2TestBucket } from "../guard";
import { readEnvFile } from "./env-file";

/** R2-Konfiguration des Test-Buckets (bricht beim Prod-Bucket ab); null = nicht eingerichtet. */
export function testR2Config(): R2Config | null {
  assertR2TestBucket();
  return readR2Config(readEnvFile(".env.test.local"));
}

/** Alle Objekte unter `<bucket>/<user>/` (bzw. nur der genannten Besitzer) im Test-Bucket entfernen. */
export async function removeR2Folders(
  config: R2Config,
  bucket: "note-images" | "attachments",
  userId: string,
  ownerIds?: string[],
) {
  const prefixes = ownerIds
    ? ownerIds.map((ownerId) => folderPrefix(bucket, userId, ownerId))
    : [`${bucket}/${userId}/`];
  for (const prefix of prefixes) {
    const keys = await listKeys(config, prefix);
    if (keys.length > 0) await deleteObjects(config, keys);
  }
}
