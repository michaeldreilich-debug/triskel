"use client";

import { useMemo } from "react";
import { toast } from "@/components/ui/toast";
import type { OutlineFiles } from "@/features/outliner/extensions/note-file";
import type { OutlineImages } from "@/features/outliner/extensions/note-image";
import { isFullCrop } from "@/features/outliner/model/crop";
import { useUserId } from "@/lib/data/provider";
import { useSaveQueue } from "@/lib/save-queue/react";
import {
  checkFile,
  createAttachmentStore,
  fileMeta,
  isPdf,
  openPdf,
  saveBlob,
} from "./attachments";
import { openCropDialog } from "./components/crop-dialog";
import { openImageViewer } from "./components/image-viewer";
import { createImageStore, cropImageFile, isAcceptedImage, prepareImage } from "./images";
import { mountPdf } from "./pdf-view";

const uploads = new Map<string, Promise<void>>();

/**
 * Bilder und Dateien für den Editor einer Notiz, Aufgabe oder des Projekt-Freitexts (#27, #44):
 * Ordner je Nutzer und Notiz bzw. Aufgabe bzw. Projekt in R2 (E41).
 */
export function useOutlineMedia(ownerId: string): {
  images: OutlineImages;
  files: OutlineFiles;
} {
  const userId = useUserId();
  const queue = useSaveQueue();
  return useMemo(() => {
    const imageStore = createImageStore(userId, ownerId);
    const fileStore = createAttachmentStore(userId, ownerId);
    const onError = (message: string) => toast.error(message);
    // solange hochgeladen wird, zeigt der Speicherstatus „wartet“ statt „gespeichert“ (V-1)
    const tracked = (upload: Promise<void>) => {
      const token = {};
      queue.markDirty(token, true);
      return upload.finally(() => queue.markDirty(token, false));
    };
    const images: OutlineImages = {
      accepts: isAcceptedImage,
      async add(file, options) {
        const prepared = await prepareImage(file);
        // Notiz inzwischen geschlossen: nicht mehr hochladen (O-3, sonst verwaiste Datei)
        if (options?.cancelled?.()) return null;
        const path = imageStore.newPath(prepared.ext);
        return { path, uploaded: tracked(imageStore.upload(path, prepared)) };
      },
      url: (path) => imageStore.url(path),
      onError,
      // Zuschneiden (#28): neue Datei, der Knoten zeigt danach auf sie (⌘Z holt das Original)
      async crop(path, alt) {
        const url = await imageStore.url(path);
        const rect = await openCropDialog(url, alt);
        if (!rect || isFullCrop(rect)) return null;
        const ext = path.split(".").pop() ?? "jpg";
        const file = await cropImageFile(url, rect, `${alt || "bild"}.${ext}`);
        const prepared = await prepareImage(file);
        const next = imageStore.newPath(prepared.ext);
        await imageStore.upload(next, prepared);
        return next;
      },
      // Großansicht im Fenster (#59)
      view: (items, start, { editable }) =>
        openImageViewer({ items, start, editable, load: (path) => imageStore.url(path) }),
    };
    const files: OutlineFiles = {
      async add(file) {
        const problem = checkFile(file);
        if (problem) throw new Error(problem);
        const path = fileStore.newPath(file.name);
        const uploaded = tracked(fileStore.upload(path, file));
        uploads.set(path, uploaded);
        uploaded.then(
          () => uploads.delete(path),
          () => uploads.delete(path),
        );
        return { path, uploaded };
      },
      uploading: (path) => uploads.get(path),
      open: (file) => openPdf(() => fileStore.blob(file.path), onError),
      download: (file) => {
        fileStore
          .blob(file.path)
          .then((blob) => saveBlob(blob, file.name))
          .catch(() => onError(`„${file.name}“ konnte nicht geladen werden.`));
      },
      mountPdf: (container, path, status, onPage) =>
        mountPdf(container, () => fileStore.blob(path), status, onPage),
      describe: fileMeta,
      isPdf,
      onError,
    };
    return { images, files };
  }, [userId, ownerId, queue]);
}
