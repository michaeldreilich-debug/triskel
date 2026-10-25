/**
 * Aufgaben-Notiz (`tasks.body`, TipTap-Dokument) ↔ Markdown für die KI-Schnittstelle (#33).
 * Schema wie `createTaskBodyExtensions`: Absätze (auch Überschrift, Zitat, Hinweis, Linie – #40),
 * Listen, Checkliste (`taskList`/`taskItem`), Notiz-Links, Bilder und Dateien. Keine Tags (die
 * kennt die Aufgaben-Notiz nicht).
 * `body_text` entsteht wie im Editor (`getText` mit Zeilenumbruch, Notiz-Links als Titel).
 */
import type { JSONContent } from "@tiptap/core";
import { NOTE_LINK, PARAGRAPH } from "@/features/outliner/model/names";
import { parseInline } from "@/features/outliner/model/paste";
import { inlineMarkdown, inlineText } from "@/features/outliner/model/serializer";
import {
  kindFromMarkdown,
  kindMarkdown,
  kindOf,
  paragraphWith,
} from "@/features/outliner/model/text-style";

export interface TaskBodyOptions {
  /** Notiz-ID zu einem Titel (für `[[Titel]]`) */
  resolveNoteByTitle?: (title: string) => string | undefined;
  /** Titel einer verlinkten Notiz */
  resolveTitle?: (noteId: string) => string | undefined;
  /** `![[…]]`/`[[…]]` auf Bilder und Dateien, die schon im Inhalt stehen (`existingMediaResolver`) */
  resolveMedia?: (ref: string) => JSONContent | undefined;
}

const LIST = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const BARE_CHECKBOX = /^(\s*)\[([ xX])\]\s+(.*)$/;

type Kind = "paragraph" | "bulletList" | "orderedList" | "taskList";

const paragraph = (text: string, options: TaskBodyOptions): JSONContent => {
  const content = parseInline(text.trim(), {
    resolveNoteByTitle: options.resolveNoteByTitle,
    resolveMedia: options.resolveMedia,
    tags: false,
  });
  return content.length > 0 ? { type: PARAGRAPH, content } : { type: PARAGRAPH };
};

/** Markdown → Inhalt der Aufgaben-Notiz (Knotenliste ohne `doc`). Leerer Text → []. */
export function markdownToTaskNodes(
  markdown: string,
  options: TaskBodyOptions = {},
): JSONContent[] {
  const nodes: JSONContent[] = [];
  let list: { kind: Kind; node: JSONContent } | null = null;
  const push = (kind: Kind, item: JSONContent) => {
    if (kind === "paragraph") {
      list = null;
      nodes.push(item);
      return;
    }
    if (!list || list.kind !== kind) {
      list = { kind, node: { type: kind, content: [] } };
      nodes.push(list.node);
    }
    (list.node.content as JSONContent[]).push(item);
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) {
      list = null;
      continue;
    }
    const bare = BARE_CHECKBOX.exec(raw);
    const match = bare ? null : LIST.exec(raw);
    if (bare || match?.[4] !== undefined) {
      const checked = (bare ? bare[2] : match?.[4]) !== " ";
      const text = (bare ? bare[3] : match?.[5]) ?? "";
      push("taskList", {
        type: "taskItem",
        attrs: { checked },
        content: [paragraph(text, options)],
      });
    } else if (match) {
      const kind: Kind = match[3] !== undefined ? "orderedList" : "bulletList";
      push(kind, { type: "listItem", content: [paragraph(match[5] ?? "", options)] });
    } else {
      // Überschrift, Zitat, Hinweis, Trennlinie (#40)
      const styled = kindFromMarkdown(raw);
      const node = paragraph(styled.text, options);
      push("paragraph", styled.kind ? paragraphWith(node.content, styled.kind) : node);
    }
  }
  return nodes;
}

/** Bestehendes Dokument + neue Knoten; eine Checkliste am Ende wird fortgesetzt. */
export function appendTaskNodes(body: JSONContent | null, added: JSONContent[]): JSONContent {
  const content = [...((body?.type === "doc" ? body.content : null) ?? [])].filter(
    (node, index, all) =>
      // ein einzelner leerer Absatz (leere Notiz) zählt nicht
      !(all.length === 1 && index === 0 && node.type === PARAGRAPH && !node.content?.length),
  );
  const last = content[content.length - 1];
  const [first, ...rest] = added;
  if (last && first && last.type === first.type && first.type === "taskList") {
    content[content.length - 1] = {
      ...last,
      content: [...(last.content ?? []), ...(first.content ?? [])],
    };
    return { type: "doc", content: [...content, ...rest] };
  }
  return { type: "doc", content: [...content, ...added] };
}

/** Klartext wie im Editor: Textblöcke mit Zeilenumbruch, Notiz-Links als Titel (ohne Klammern). */
export function taskBodyText(body: JSONContent | null, options: TaskBodyOptions = {}): string {
  if (!body) return "";
  const lines: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === PARAGRAPH) {
      lines.push(
        (node.content ?? [])
          .map((child) =>
            child.type === NOTE_LINK
              ? (options.resolveTitle?.(String(child.attrs?.noteId ?? "")) ?? "")
              : inlineText([child]),
          )
          .join(""),
      );
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(body);
  return lines
    .filter((line, index) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trim();
}

/** Aufgaben-Notiz als Markdown (Lesen über die KI-Schnittstelle). */
export function taskBodyToMarkdown(
  body: JSONContent | null,
  options: TaskBodyOptions = {},
): string {
  if (!body) return "";
  const inline = (node: JSONContent | undefined) =>
    inlineMarkdown(node?.content, { resolveTitle: options.resolveTitle });
  const lines: string[] = [];
  const walk = (nodes: JSONContent[], depth: number) => {
    const pad = "  ".repeat(depth);
    for (const node of nodes) {
      if (node.type === PARAGRAPH) {
        lines.push(`${pad}${kindMarkdown(kindOf(node), inline(node))}`.replace(/\s+$/, ""));
      } else if (
        node.type === "bulletList" ||
        node.type === "orderedList" ||
        node.type === "taskList"
      ) {
        (node.content ?? []).forEach((item, index) => {
          const [first, ...children] = item.content ?? [];
          const marker =
            node.type === "orderedList"
              ? `${index + 1}.`
              : node.type === "taskList"
                ? `- [${item.attrs?.checked ? "x" : " "}]`
                : "-";
          lines.push(`${pad}${marker} ${inline(first)}`.replace(/\s+$/, ""));
          walk(children, depth + 1);
        });
      } else {
        walk(node.content ?? [], depth);
      }
    }
  };
  walk(body.type === "doc" ? (body.content ?? []) : [body], 0);
  return lines.join("\n").trim();
}
