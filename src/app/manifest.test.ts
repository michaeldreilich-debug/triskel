import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/auth/routes";
import { THEME_COLORS } from "@/lib/theme";
import manifest from "./manifest";

describe("Web-App-Manifest", () => {
  const m = manifest();

  it("startet als eigenständige App auf Heute", () => {
    expect(m.name).toBe("Triskel");
    expect(m.short_name).toBe("Triskel");
    expect(m.lang).toBe("de");
    expect(m.start_url).toBe("/heute");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe(THEME_COLORS.dark);
    expect(m.theme_color).toBe(THEME_COLORS.dark);
  });

  it("verweist nur auf vorhandene, öffentliche Symbole", () => {
    expect(m.icons?.length).toBeGreaterThan(0);
    for (const icon of m.icons ?? []) {
      expect(isPublicPath(icon.src)).toBe(true);
    }
    expect(m.icons?.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
  });

  it("ist selbst ohne Anmeldung abrufbar", () => {
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
  });
});
