import { describe, expect, it } from "vitest";
import { parseTheme } from "./theme";
import { parseUiPrefs } from "./ui-prefs";

describe("Oberflächen-Einstellungen aus Cookies", () => {
  const from = (cookies: Record<string, string>) => parseUiPrefs((name) => cookies[name]);

  it("Standard: Dunkel, Alles, Sidebar offen, Notizen neueste zuerst", () => {
    expect(from({})).toEqual({
      theme: "dark",
      area: null,
      sidebarCollapsed: false,
      noteSort: "neueste",
      fontSize: "normal",
      stored: { theme: false, area: false },
    });
  });

  it("liest gültige Werte", () => {
    const area = "3f1c2b7e-0d4a-4c1e-9a55-1b2c3d4e5f60";
    expect(
      from({
        "sz-theme": "paper",
        "sz-area": area,
        "sz-sidebar": "1",
        "sz-note-sort": "az",
        "sz-font": "gross",
      }),
    ).toEqual({
      theme: "paper",
      area,
      sidebarCollapsed: true,
      noteSort: "az",
      fontSize: "gross",
      stored: { theme: true, area: true },
    });
  });

  it("verwirft ungültige Werte", () => {
    expect(parseTheme("neon")).toBe("dark");
    expect(from({ "sz-area": "<script>" }).area).toBeNull();
    expect(from({ "sz-area": "" }).area).toBeNull();
    expect(from({ "sz-note-sort": "zufall" }).noteSort).toBe("neueste");
    expect(from({ "sz-font": "riesig" }).fontSize).toBe("normal");
  });

  it("leerer Bereichs-Cookie heißt „Alles“ gewählt (nicht: noch nie gewählt)", () => {
    expect(from({ "sz-area": "" }).stored).toEqual({ theme: false, area: true });
  });
});
