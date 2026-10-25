"use client";

import type { Editor } from "@tiptap/core";
import { Camera, Images } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";

// HEIC/HEIF (#39): am Mac sind iPhone-Fotos sonst im Dialog ausgegraut
const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif";

/**
 * Dateiauswahl für Bilder und Dateien (#27): „Bild einfügen …“ zeigt am iPhone die Fotos,
 * „Datei einfügen …“ alles (PDF, Office …). Beides landet über `insertMedia` im Editor.
 */
export function useMediaPicker(getEditor: () => Editor | null) {
  const image = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const insert = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length) getEditor()?.chain().focus().insertMedia(files).run();
  };
  return {
    pickImage: () => image.current?.click(),
    pickFile: () => file.current?.click(),
    /** Kamera direkt öffnen (F2, #54); ein Foto je Aufnahme */
    pickCamera: () => camera.current?.click(),
    inputs: (
      <>
        <input
          ref={image}
          type="file"
          accept={IMAGE_TYPES}
          multiple
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={insert}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={insert}
        />
        <input ref={file} type="file" multiple hidden aria-hidden tabIndex={-1} onChange={insert} />
      </>
    ),
  };
}

const touchButton =
  "hidden min-h-11 items-center gap-1.5 rounded-control px-1 text-ui-sm text-faint hover:text-fg pointer-coarse:inline-flex";

/**
 * Sichtbare Knöpfe am Handy (F2, #54): „Foto aufnehmen“ öffnet die Kamera, „Fotos wählen“ die
 * iOS-Auswahl (Mediathek, Foto aufnehmen, Dateien – mehrere auf einmal). Am Mac mit Maus
 * unsichtbar; dort gibt es „Bild einfügen …“ im Menü.
 */
export function TouchPhotoButtons({
  picker,
  iconOnly,
}: {
  picker: Pick<ReturnType<typeof useMediaPicker>, "pickCamera" | "pickImage">;
  /** nur Symbole (Kopfzeile der Notiz, wo der Platz knapp ist) */
  iconOnly?: boolean;
}) {
  if (iconOnly) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Foto aufnehmen"
          onClick={picker.pickCamera}
          className="hidden pointer-coarse:inline-flex"
        >
          <Camera size={16} strokeWidth={1.5} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Fotos wählen"
          onClick={picker.pickImage}
          className="hidden pointer-coarse:inline-flex"
        >
          <Images size={16} strokeWidth={1.5} aria-hidden />
        </Button>
      </>
    );
  }
  return (
    <>
      <button type="button" onClick={picker.pickCamera} className={touchButton}>
        <Camera size={14} strokeWidth={1.5} aria-hidden />
        Foto aufnehmen
      </button>
      <button type="button" onClick={picker.pickImage} className={touchButton}>
        <Images size={14} strokeWidth={1.5} aria-hidden />
        Fotos wählen
      </button>
    </>
  );
}
