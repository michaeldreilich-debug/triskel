import { type ClassValue, clsx } from "clsx";

/** Klassen zusammensetzen (bedingte Klassen, Arrays). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
