"use client";

import { useEffect, useRef, useState } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Text-Eingabe mit lokalem Entwurf für Werte aus dem Query-Cache.
 *
 * TanStack Query meldet Cache-Änderungen zeitversetzt (setTimeout 0). Ein direkt an den Cache
 * gebundenes Feld würde React nach jedem Tastendruck auf den alten Wert zurücksetzen – bei
 * schnellem Tippen gingen Zeichen verloren. Darum: Während das Feld den Fokus hat, gilt der
 * lokale Entwurf; jede Änderung geht sofort weiter (Cache + Speicher-Warteschlange). Ohne Fokus
 * folgt das Feld dem Cache (z. B. Änderung auf einem anderen Gerät).
 */
export function useBufferedText(
  value: string,
  onChange: (value: string) => void,
  transform: (raw: string) => string = (raw) => raw,
) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  return {
    value: draft,
    onChange: (event: React.ChangeEvent<Field>) => {
      const next = transform(event.target.value);
      setDraft(next);
      onChange(next);
    },
    onFocus: () => {
      editing.current = true;
    },
    onBlur: () => {
      editing.current = false;
      setDraft(latest.current);
    },
  };
}
