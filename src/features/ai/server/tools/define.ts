/**
 * Werkzeug registrieren (#33): einheitliche Fehler (Eingabe- und Datenfehler gehen als Text an
 * die KI zurück, `isError`), Textausgabe als Markdown plus optional strukturierte Daten und
 * weitere Inhalte nach dem Text (#71: Bilder, eingebettete Dateien).
 */
import type { CallToolResult, ContentBlock, McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { DataError } from "../context";
import { ToolInputError } from "../resolve";

export interface ToolOutput {
  text: string;
  /**
   * Bekommt `text` als Feld dazu (überschreibt ein eigenes `text`): Claude Code zeigt bei
   * `structuredContent` nur dieses an, der Textinhalt fiele sonst weg (Bilder kommen trotzdem).
   */
  structured?: Record<string, unknown>;
  /** nach dem Text: Bilder (`type: "image"`), Bildunterschriften, eingebettete Dateien */
  content?: ContentBlock[];
}

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
export const CREATES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
export const CHANGES = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;
/** In den Papierkorb legen: zerstörerisch, damit die KI-Oberfläche vor jedem Aufruf fragt. */
export const TRASHES = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function defineTool<S extends z.ZodObject>(
  server: McpServer,
  name: string,
  config: {
    title: string;
    description: string;
    input: S;
    annotations: {
      readOnlyHint: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint: boolean;
    };
  },
  run: (args: z.output<S>) => Promise<ToolOutput>,
): void {
  const handler = async (args: unknown): Promise<CallToolResult> => {
    try {
      const output = await run(args as z.output<S>);
      const result: CallToolResult = {
        content: [{ type: "text", text: output.text }, ...(output.content ?? [])],
      };
      if (output.structured) result.structuredContent = { ...output.structured, text: output.text };
      return result;
    } catch (error) {
      if (error instanceof ToolInputError || error instanceof DataError) {
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
      throw error;
    }
  };
  server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.input,
      annotations: { title: config.title, ...config.annotations },
    },
    // Argumente prüft das SDK mit dem Schema; der generische Typ lässt sich hier nicht ableiten
    handler as never,
  );
}
