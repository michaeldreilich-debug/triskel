/**
 * Links im Projekt-Steckbrief (Entscheidung 17.10.2026, Migration 22): Name + Adresse, ein Klick
 * öffnet. Rein, ohne Browser-Code – auch die KI-Werkzeuge nutzen es.
 */

export interface ProjectLink {
  id: string;
  name: string;
  url: string;
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Adresse prüfen und vereinheitlichen: http(s) und mailto, ohne Schema wird https:// ergänzt
 * („elster.de“). Alles andere (javascript:, data: …) ergibt null – nie anklickbar.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  const explicit = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (!explicit && value.includes("@") && !value.includes("/"))
    return normalizeLinkUrl(`mailto:${value}`);
  try {
    const url = new URL(explicit ? value : `https://${value}`);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    if (url.protocol === "mailto:") return url.pathname.includes("@") ? url.href : null;
    // ohne Schema getippt: Punkt im Namen verlangen („notiz“ ist kein Link)
    if (!explicit && !url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Kurzform der Adresse: „elster.de“, bei mailto die E-Mail-Adresse. */
export function linkHost(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:") return decodeURIComponent(parsed.pathname);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Anzeigename: der Name, sonst die Kurzform der Adresse. */
export const linkLabel = (link: Pick<ProjectLink, "name" | "url">) =>
  link.name.trim() || linkHost(link.url);

/** jsonb defensiv lesen (Daten könnten von Hand oder älter sein). */
export function parseLinks(value: unknown): ProjectLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : `link-${index}`,
      name: typeof item.name === "string" ? item.name : "",
      url: typeof item.url === "string" ? item.url : "",
    }));
}
