/**
 * Web-Adressen im Text erkennen (#93): reine Funktion für die Anzeige-Erweiterung `AutoLinks`.
 * Erkennung wie Tiptaps Autolink (linkifyjs), aber strenger bei Adressen ohne Schema: Dateinamen
 * („Bericht.pdf“, „notes.md“ – .md ist eine Länder-Endung) sind keine Links.
 */
import { find } from "linkifyjs";
import { normalizeLinkUrl } from "@/features/projects/links";

export interface FoundLink {
  /** Zeichen-Bereich im Text (from inklusive, to exclusive) */
  from: number;
  to: number;
  href: string;
}

/** Endungen, die ohne „https://“ oder „www.“ als Adresse gelten (alles andere ist ein Dateiname). */
const BARE_TLDS = new Set([
  "de",
  "ch",
  "at",
  "com",
  "org",
  "net",
  "eu",
  "info",
  "io",
  "app",
  "dev",
  "gov",
  "edu",
  "uk",
  "fr",
  "it",
  "nl",
  "es",
  "be",
  "li",
  "lu",
  "us",
  "ai",
  "me",
  "tv",
  "co",
  "cloud",
  "online",
]);

const SCHEMA = /^(?:https?:\/\/|www\.)/i;

/** Alle klickbaren Adressen (http, https, mailto) in einem Text. */
export function findWebLinks(text: string): FoundLink[] {
  // schneller Ausstieg: jede Adresse hat einen Punkt (oder ein @)
  if (!/[.@]/.test(text)) return [];
  const found: FoundLink[] = [];
  for (const item of find(text)) {
    if (!item.isLink) continue;
    if (item.type === "url") {
      const tld =
        item.value
          .replace(SCHEMA, "")
          .split(/[/?#:]/)[0]
          ?.split(".")
          .pop() ?? "";
      if (!SCHEMA.test(item.value) && !BARE_TLDS.has(tld.toLowerCase())) continue;
    } else if (item.type !== "email") continue;
    const href = normalizeLinkUrl(item.value);
    if (href) found.push({ from: item.start, to: item.end, href });
  }
  return found;
}
