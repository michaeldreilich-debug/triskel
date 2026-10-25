import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolInputError } from "../resolve";
import { defineTool, READ_ONLY, type ToolOutput } from "./define";

/** Werkzeug registrieren und den Handler direkt aufrufen (ohne MCP-Transport) */
function call(run: () => Promise<ToolOutput>): Promise<CallToolResult> {
  let handler: ((args: unknown) => Promise<CallToolResult>) | undefined;
  const server = {
    registerTool: (_name: string, _config: unknown, h: typeof handler) => {
      handler = h;
    },
  } as unknown as McpServer;
  defineTool(
    server,
    "probe",
    { title: "Probe", description: "", input: z.object({}), annotations: READ_ONLY },
    run,
  );
  if (!handler) throw new Error("nicht registriert");
  return handler({});
}

describe("defineTool – Text auch in den strukturierten Daten", () => {
  it("strukturierte Daten bekommen den ganzen Text als `text` (Claude Code zeigt nur diese)", async () => {
    const result = await call(async () => ({
      text: "Aufgabe angelegt. Hinweis: Fokus ist voll.",
      structured: { id: "1", url: "https://x/1" },
    }));
    expect(result.structuredContent).toEqual({
      id: "1",
      url: "https://x/1",
      text: "Aufgabe angelegt. Hinweis: Fokus ist voll.",
    });
    expect(result.content).toEqual([
      { type: "text", text: "Aufgabe angelegt. Hinweis: Fokus ist voll." },
    ]);
  });

  it("ein eigenes `text` (fetch) wird zum ganzen Text, Bilder bleiben im Inhalt", async () => {
    const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
    const result = await call(async () => ({
      text: "# Notiz\n\nBild 6 – nicht mitgeliefert\n[In der App öffnen](https://x/1)",
      structured: { id: "1", title: "Notiz", text: "# Notiz\n", url: "https://x/1" },
      content: [image],
    }));
    expect(result.structuredContent).toEqual({
      id: "1",
      title: "Notiz",
      text: "# Notiz\n\nBild 6 – nicht mitgeliefert\n[In der App öffnen](https://x/1)",
      url: "https://x/1",
    });
    expect(result.content?.[1]).toEqual(image);
  });

  it("ohne strukturierte Daten keine; Eingabefehler als Text mit isError", async () => {
    const plain = await call(async () => ({ text: "Nur Text" }));
    expect(plain.structuredContent).toBeUndefined();
    const failed = await call(async () => {
      throw new ToolInputError("Projekt nicht gefunden.");
    });
    expect(failed).toEqual({
      isError: true,
      content: [{ type: "text", text: "Projekt nicht gefunden." }],
    });
  });
});
