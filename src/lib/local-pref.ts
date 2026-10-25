"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Kleine Bequemlichkeit je Gerät (z. B. ein eingeklappter Abschnitt) in localStorage. Erst nach
 * dem Einhängen gelesen, damit Server und Browser gleich rendern; ohne Speicher gilt der Standard.
 */
export function useLocalFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === "1" || raw === "0") setValue(raw === "1");
    } catch {
      // kein Speicher (privates Fenster): Standard bleibt
    }
  }, [key]);
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // nur Bequemlichkeit
      }
    },
    [key],
  );
  return [value, set];
}

/**
 * Zahl je Gerät (z. B. die Breite einer Spalte, #43), auf [min, max] begrenzt. Der dritte Wert
 * vergisst die gespeicherte Zahl wieder (zurück zu `initial`, auch außerhalb von [min, max] – z. B.
 * 0 für „Standard aus dem Token“, #95).
 */
export function useLocalNumber(
  key: string,
  initial: number,
  { min, max }: { min: number; max: number },
): [number, (value: number) => void, () => void] {
  const clamp = useCallback((n: number) => Math.round(Math.min(max, Math.max(min, n))), [min, max]);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = Number(window.localStorage.getItem(key));
      if (Number.isFinite(raw) && raw > 0) setValue(clamp(raw));
    } catch {
      // kein Speicher (privates Fenster): Standard bleibt
    }
  }, [key, clamp]);
  const set = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      setValue(clamped);
      try {
        window.localStorage.setItem(key, String(clamped));
      } catch {
        // nur Bequemlichkeit
      }
    },
    [key, clamp],
  );
  const reset = useCallback(() => {
    setValue(initial);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // nur Bequemlichkeit
    }
  }, [key, initial]);
  return [value, set, reset];
}

/**
 * Klappzustand je Gerät mit berechnetem Standard (z. B. „große Gruppe zu“): Solange nichts
 * gespeichert ist, gilt `fallback` – auch wenn er sich ändert; erst ein Klick speichert.
 */
export function useLocalFlagOr(
  key: string,
  fallback: boolean,
): [boolean, (value: boolean) => void] {
  const [stored, setStored] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      setStored(raw === "1" ? true : raw === "0" ? false : null);
    } catch {
      // kein Speicher (privates Fenster): Standard bleibt
    }
  }, [key]);
  const set = useCallback(
    (next: boolean) => {
      setStored(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // nur Bequemlichkeit
      }
    },
    [key],
  );
  return [stored ?? fallback, set];
}
