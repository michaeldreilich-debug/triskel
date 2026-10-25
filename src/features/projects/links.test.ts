import { describe, expect, it } from "vitest";
import { linkHost, linkLabel, normalizeLinkUrl, parseLinks } from "./links";

describe("Projekt-Links", () => {
  it("Adresse: https ergänzen, http(s) und mailto erlaubt, sonst nichts", () => {
    expect(normalizeLinkUrl("elster.de")).toBe("https://elster.de/");
    expect(normalizeLinkUrl(" https://www.notion.so/Werkstatt-123 ")).toBe(
      "https://www.notion.so/Werkstatt-123",
    );
    expect(normalizeLinkUrl("http://192.168.0.10:8080/x")).toBe("http://192.168.0.10:8080/x");
    expect(normalizeLinkUrl("mailto:kasse@beispiel.de")).toBe("mailto:kasse@beispiel.de");
    expect(normalizeLinkUrl("kasse@beispiel.de")).toBe("mailto:kasse@beispiel.de");
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(normalizeLinkUrl("notiz")).toBeNull();
    expect(normalizeLinkUrl("zwei wörter.de")).toBeNull();
    expect(normalizeLinkUrl("")).toBeNull();
  });

  it("Anzeige: Name, sonst die Kurzform der Adresse", () => {
    expect(linkHost("https://www.elster.de/eportal")).toBe("elster.de");
    expect(linkHost("mailto:kasse@beispiel.de")).toBe("kasse@beispiel.de");
    expect(linkLabel({ name: " ", url: "https://www.elster.de" })).toBe("elster.de");
    expect(linkLabel({ name: "Elster", url: "https://www.elster.de" })).toBe("Elster");
  });

  it("jsonb defensiv lesen", () => {
    expect(parseLinks(null)).toEqual([]);
    expect(parseLinks([{ name: "A", url: "https://a.de" }, "x", { id: "2", url: 3 }])).toEqual([
      { id: "link-0", name: "A", url: "https://a.de" },
      { id: "2", name: "", url: "" },
    ]);
  });
});
