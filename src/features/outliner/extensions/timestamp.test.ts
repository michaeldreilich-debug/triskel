// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskBodyExtensions } from "@/features/tasks/components/task-body-editor";
import { createTestEditor, outline, type } from "../test-utils";
import { Timestamp, timestampText } from "./timestamp";

// 17.10.2026 20:45 in Berlin (Sommerzeit, UTC+2)
const NOW = new Date("2026-10-17T18:45:00Z");
let editor: Editor | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Zeitstempel per Kürzel (Rückmeldung 17.10.2026)", () => {
  it("Text in Europe/Berlin: mit Uhrzeit bzw. nur Datum", () => {
    expect(timestampText("jetzt", NOW)).toBe("17.10.2026 20:45");
    expect(timestampText("heute", NOW)).toBe("17.10.2026");
    // Winterzeit (UTC+1)
    expect(timestampText("jetzt", new Date("2026-12-24T17:05:00Z"))).toBe("24.12.2026 18:05");
  });

  it("Outliner: „@jetzt “ wird zum Zeitstempel, davor stehender Text bleibt", () => {
    editor = createTestEditor(outline([""]));
    editor.commands.focus("end");
    type(editor, "Anruf Kreis @jetzt ");
    expect(editor.state.doc.textContent).toBe("Anruf Kreis 17.10.2026 20:45 ");
    type(editor, "@heute ");
    expect(editor.state.doc.textContent).toBe("Anruf Kreis 17.10.2026 20:45 17.10.2026 ");
  });

  it("Aufgaben-Notiz: am Zeilenanfang und über den Befehl", () => {
    const element = document.createElement("div");
    document.body.append(element);
    editor = new Editor({
      element,
      extensions: createTaskBodyExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.commands.focus("end");
    type(editor, "@jetzt ");
    expect(editor.state.doc.textContent).toBe("17.10.2026 20:45 ");
    expect(editor.extensionManager.extensions.some((x) => x.name === Timestamp.name)).toBe(true);
    editor.commands.insertTimestamp("heute");
    expect(editor.state.doc.textContent).toBe("17.10.2026 20:45 17.10.2026 ");
    // ohne Leerzeichen davor (z. B. E-Mail-Adresse) passiert nichts
    type(editor, "x@jetzt ");
    expect(editor.state.doc.textContent.endsWith("x@jetzt ")).toBe(true);
  });
});
