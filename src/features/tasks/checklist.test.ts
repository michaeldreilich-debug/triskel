import { describe, expect, it } from "vitest";
import { checklistFollow, checklistProgress } from "./checklist";

const item = (checked: boolean, ...content: object[]) => ({
  type: "taskItem",
  attrs: { checked },
  content: [{ type: "paragraph", content: [{ type: "text", text: "Punkt" }] }, ...content],
});

describe("Checkliste einer Aufgabe (#42)", () => {
  it("zählt erledigte und alle Punkte, auch eingerückte und in mehreren Listen", () => {
    const body = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [item(true), item(false, { type: "taskList", content: [item(true)] })],
        },
        { type: "paragraph", content: [{ type: "text", text: "Zwischentext" }] },
        { type: "taskList", content: [item(false), item(false)] },
      ],
    };
    expect(checklistProgress(body)).toEqual({ done: 2, total: 5 });
  });

  it("ohne Checkliste: null", () => {
    expect(checklistProgress(null)).toBeNull();
    expect(checklistProgress({ type: "doc", content: [{ type: "paragraph" }] })).toBeNull();
  });
});

describe("Aufgabe folgt ihrer Checkliste (#86)", () => {
  const list = (...checked: boolean[]) => ({
    type: "doc",
    content: [{ type: "taskList", content: checked.map((c) => item(c)) }],
  });

  it("letzter offener Punkt abgehakt → erledigt (auch aus „in Arbeit“ und „wartet“)", () => {
    expect(checklistFollow(list(true, false), list(true, true), "offen")).toBe("erledigt");
    expect(checklistFollow(list(false), list(true), "in_arbeit")).toBe("erledigt");
    expect(checklistFollow(list(true, false), list(true, true), "wartet")).toBe("erledigt");
    // Punkte anlegen und abhaken in einem Speichern (400 ms im Editor)
    expect(checklistFollow(null, list(true, true), "offen")).toBe("erledigt");
  });

  it("erledigte Aufgabe mit allen Punkten: Haken weg oder neuer Punkt → offen", () => {
    expect(checklistFollow(list(true, true), list(true, false), "erledigt")).toBe("offen");
    expect(checklistFollow(list(true, true), list(true, true, false), "erledigt")).toBe("offen");
  });

  it("sonst keine Änderung", () => {
    // noch nicht alle abgehakt
    expect(checklistFollow(list(false, false), list(true, false), "offen")).toBeNull();
    // schon erledigt (von Hand, Punkte offen) – restliche Punkte abhaken ändert nichts
    expect(checklistFollow(list(true, false), list(true, true), "erledigt")).toBeNull();
    // von Hand erledigt mit offenen Punkten – weiteren Haken entfernen öffnet nicht
    expect(checklistFollow(list(true, false), list(false, false), "erledigt")).toBeNull();
    // von Hand wieder geöffnet, alle Punkte abgehakt – Text tippen ändert nichts
    expect(checklistFollow(list(true, true), list(true, true), "offen")).toBeNull();
    // alle Punkte gelöscht
    expect(checklistFollow(list(true), null, "erledigt")).toBeNull();
    expect(checklistFollow(list(false), null, "offen")).toBeNull();
  });
});
