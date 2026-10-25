import { describe, expect, it } from "vitest";
import { unusedPaths } from "./media";

const image = (path: string) => ({
  type: "block",
  content: [{ type: "paragraph", content: [{ type: "noteImage", attrs: { path, alt: "" } }] }],
});
const file = (path: string) => ({ type: "noteFile", attrs: { path, name: "plan.pdf" } });

describe("unusedPaths – Papierkorb leeren entfernt nur Ungenutztes", () => {
  const own = "u1/aufgabe-a/plan.pdf";
  const other = "u1/aufgabe-a/foto.jpg";

  it("ohne Verweise sind alle Pfade ungenutzt", () => {
    expect(unusedPaths([own, other], [])).toEqual([own, other]);
  });

  it("in eine andere Notiz kopierte Datei bleibt, der Rest geht", () => {
    expect(unusedPaths([own, other], [image("u1/notiz-b/x.png"), file(own)])).toEqual([other]);
  });

  it("findet Pfade tief verschachtelt und in noch nicht gespeicherten Werten", () => {
    const pending = { content: { type: "doc", content: [image(other)] } };
    expect(unusedPaths([own, other], [pending])).toEqual([own]);
  });

  it("findet Pfade auch in Inhalten, die als JSON-Text vorliegen", () => {
    expect(unusedPaths([own], [JSON.stringify(file(own))])).toEqual([]);
  });

  it("leere Inhalte (null, undefined) stören nicht", () => {
    expect(unusedPaths([own], [null, undefined, {}])).toEqual([own]);
  });
});
