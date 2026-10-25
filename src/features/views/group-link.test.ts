import { describe, expect, it } from "vitest";
import { projectGroupLink, typeGroupLink } from "./group-link";

const types = [
  { key: "idee", name: "Idee", counts_as_knowledge: false },
  { key: "wissen", name: "Wissen", counts_as_knowledge: true },
];

describe("Gruppenkopf-Links", () => {
  it("Typ, der als Wissen zählt, führt ins Wissen; andere Typen und Felder nicht", () => {
    expect(typeGroupLink("type", "wissen", types)).toEqual({
      href: "/wissen",
      label: "„Wissen“ im Wissen ansehen",
    });
    expect(typeGroupLink("type", "idee", types)).toBeNull();
    expect(typeGroupLink("area", "wissen", types)).toBeNull();
    expect(typeGroupLink("type", "", types)).toBeNull();
  });

  it("Projektgruppen führen weiter ins Projekt", () => {
    expect(projectGroupLink("project", "p1", [{ id: "p1", title: "Steuer" }])?.href).toBe(
      "/projekte/p1",
    );
  });
});
