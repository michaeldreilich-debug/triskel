/**
 * Inhalt einer öffentlich freigegebenen Notiz (#94, E42) als reine Darstellung aus dem Blockbaum –
 * Server-Komponente ohne Zustand, ohne Editor und nie mit rohem HTML aus dem Inhalt (React setzt
 * nur Text und geprüfte Attribute):
 * - Absatzarten wie im Editor (Überschrift 1–3 als h2–h4 unter dem Titel, Zitat, Hinweis-Kasten,
 *   Trennlinie), Farben nur als Token-Schlüssel (`tx-color`/`tx-marker`).
 * - Marken fett/kursiv/durchgestrichen/Code/Marker/Link; Links nur über `normalizeLinkUrl`
 *   (http(s)/mailto), Adressen ohne Link-Markierung wie in der App (`findWebLinks`, #93).
 * - `[[…]]` → „verknüpfte Notiz“ (ohne Titel, ohne Link), `#tag` als Text, Bilder und Dateien über
 *   die Freigabe-Route, Mermaid als Code, „Block → Aufgabe“ als nicht anklickbares Kästchen,
 *   eingeklappte Punkte als `<details>`.
 */
import type { JSONContent } from "@tiptap/core";
import { FileText, Paperclip } from "lucide-react";
import type { ReactNode } from "react";
import { fileExt } from "@/features/outliner/model/files";
import {
  BLOCK,
  MERMAID,
  NOTE_FILE,
  NOTE_IMAGE,
  NOTE_LINK,
  TAG,
} from "@/features/outliner/model/names";
import {
  type BlockKind,
  kindOf,
  MARKER,
  parseMarkerColor,
  parseTextColor,
  TEXT_COLOR,
} from "@/features/outliner/model/text-style";
import { findWebLinks } from "@/features/outliner/model/web-links";
import { normalizeLinkUrl } from "@/features/projects/links";
import { isMediaPath } from "@/features/storage/paths";
import { sharedFilePath } from "../model";

/** Externe Links: neuer Tab, kein Zugriff auf diese Seite, kein Referer, keine Empfehlung. */
const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

interface Ctx {
  token: string;
  taskDone: Map<string, boolean>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Text ohne Link-Markierung: Adressen darin klickbar wie im Editor (#93), sonst nur Text. */
function plainText(value: string, key: string): ReactNode {
  const found = findWebLinks(value);
  if (found.length === 0) return value;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const link of found) {
    if (link.from > at) parts.push(value.slice(at, link.from));
    parts.push(
      <a key={`${key}-${link.from}`} href={link.href} {...EXTERNAL}>
        {value.slice(link.from, link.to)}
      </a>,
    );
    at = link.to;
  }
  if (at < value.length) parts.push(value.slice(at));
  return parts;
}

function textNode(node: JSONContent, key: string): ReactNode {
  const marks = node.marks ?? [];
  const value = node.text ?? "";
  const linked = marks.some((m) => m.type === "link" || m.type === "code");
  let out: ReactNode = linked ? value : plainText(value, key);
  for (const mark of marks) {
    if (mark.type === "bold") out = <strong>{out}</strong>;
    else if (mark.type === "italic") out = <em>{out}</em>;
    else if (mark.type === "strike") out = <s>{out}</s>;
    else if (mark.type === "code") out = <code>{out}</code>;
    else if (mark.type === TEXT_COLOR) {
      const color = parseTextColor(mark.attrs?.color);
      if (color)
        out = (
          <span className="tx-color" data-color={color}>
            {out}
          </span>
        );
    } else if (mark.type === MARKER) {
      out = (
        <mark className="tx-marker" data-marker={parseMarkerColor(mark.attrs?.color) ?? "gelb"}>
          {out}
        </mark>
      );
    }
  }
  // Link zuletzt (außen), damit Formatierung im Link bleibt; ungültige Adressen bleiben Text
  const link = marks.find((m) => m.type === "link");
  const href = link ? normalizeLinkUrl(text(link.attrs?.href)) : null;
  return href ? (
    <a key={key} href={href} {...EXTERNAL}>
      {out}
    </a>
  ) : (
    <span key={key}>{out}</span>
  );
}

function imageNode(node: JSONContent, key: string, ctx: Ctx): ReactNode {
  const path = node.attrs?.path;
  const alt = text(node.attrs?.alt);
  if (!isMediaPath(path)) return alt ? <span key={key}>[Bild: {alt}]</span> : null;
  const width = Number(node.attrs?.width);
  return (
    // biome-ignore lint/performance/noImgElement: Bild aus der Freigabe-Route (302 auf R2), keine Optimierung
    <img
      key={key}
      src={sharedFilePath(ctx.token, path)}
      alt={alt}
      loading="lazy"
      className="sn-image"
      style={
        Number.isFinite(width) && width >= 10 && width < 100 ? { width: `${width}%` } : undefined
      }
    />
  );
}

function fileNode(node: JSONContent, key: string, ctx: Ctx): ReactNode {
  const path = node.attrs?.path;
  const name = text(node.attrs?.name).trim() || "Datei";
  if (!isMediaPath(path)) return <span key={key}>[Datei: {name}]</span>;
  const pdf = fileExt(path) === "pdf";
  const Icon = pdf ? FileText : Paperclip;
  return (
    <a
      key={key}
      href={sharedFilePath(ctx.token, path, name)}
      className="sn-file"
      title={pdf ? "Im neuen Tab öffnen" : "Herunterladen"}
      aria-label={pdf ? `„${name}“ öffnen` : `„${name}“ herunterladen`}
      {...EXTERNAL}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden />
      <span className="sn-file-name">{name}</span>
    </a>
  );
}

/** Inhalt eines Absatzes ohne Diagramme (die stehen als Code darunter). */
function inline(content: JSONContent[] | undefined, ctx: Ctx): ReactNode[] {
  return (content ?? []).map((node, index) => {
    const key = String(index);
    switch (node.type) {
      case "text":
        return textNode(node, key);
      case "hardBreak":
        return <br key={key} />;
      case NOTE_LINK:
        // verknüpfte Notizen bleiben privat: weder Titel noch Link
        return (
          <span key={key} className="sn-muted">
            verknüpfte Notiz
          </span>
        );
      case TAG:
        return (
          <span key={key} className="sn-tag">
            #{text(node.attrs?.name)}
          </span>
        );
      case NOTE_IMAGE:
        return imageNode(node, key, ctx);
      case NOTE_FILE:
        return fileNode(node, key, ctx);
      case MERMAID:
        return null;
      default:
        return node.content ? <span key={key}>{inline(node.content, ctx)}</span> : null;
    }
  });
}

const HEADING: Record<"h1" | "h2" | "h3", "h2" | "h3" | "h4"> = { h1: "h2", h2: "h3", h3: "h4" };

function Paragraph({ kind, children }: { kind: BlockKind | null; children: ReactNode }) {
  if (kind === "h1" || kind === "h2" || kind === "h3") {
    const Heading = HEADING[kind];
    return (
      <Heading className="sn-p" data-kind={kind}>
        {children}
      </Heading>
    );
  }
  if (kind === "quote")
    return (
      <blockquote className="sn-p" data-kind="quote">
        {children}
      </blockquote>
    );
  if (kind === "callout")
    return (
      <div className="sn-p" data-kind="callout" role="note">
        {children}
      </div>
    );
  return <div className="sn-p">{children}</div>;
}

function Block({ block, ctx }: { block: JSONContent; ctx: Ctx }) {
  const [paragraph, ...rest] = block.content ?? [];
  const children = rest.filter((c) => c.type === BLOCK);
  const kind = kindOf(paragraph);
  const id = text(block.attrs?.id);
  const done = ctx.taskDone.get(id);
  const isTask = done !== undefined;
  const diagrams = (paragraph?.content ?? []).filter((n) => n.type === MERMAID);
  const collapsed = Boolean(block.attrs?.collapsed) && children.length > 0;
  const list =
    children.length > 0 ? (
      <ul className="sn-list">
        {children.map((child, index) => (
          <Block key={text(child.attrs?.id) || index} block={child} ctx={ctx} />
        ))}
      </ul>
    ) : null;

  return (
    <li
      className="sn-block"
      data-kind={kind ?? undefined}
      data-task={isTask ? (done ? "done" : "open") : undefined}
    >
      {kind === "divider" ? (
        <hr />
      ) : (
        <div className="sn-row">
          {isTask ? (
            <input
              type="checkbox"
              className="sn-check"
              defaultChecked={done}
              disabled
              aria-label={done ? "Erledigt" : "Offen"}
            />
          ) : null}
          <Paragraph kind={kind}>{inline(paragraph?.content, ctx)}</Paragraph>
        </div>
      )}
      {diagrams.map((diagram, index) => (
        <figure
          // biome-ignore lint/suspicious/noArrayIndexKey: Diagramme eines Absatzes ändern sich hier nicht
          key={index}
          className="sn-diagram"
          aria-label="Diagramm (Mermaid)"
        >
          <pre className="sn-code">
            <code>{text(diagram.attrs?.code)}</code>
          </pre>
        </figure>
      ))}
      {collapsed ? (
        <details className="sn-fold">
          <summary>
            {children.length === 1 ? "1 Unterpunkt" : `${children.length} Unterpunkte`}
          </summary>
          {list}
        </details>
      ) : (
        list
      )}
    </li>
  );
}

/** Ganzer Inhalt (Dokument aus `sharedDoc`). */
export function SharedOutline({
  doc,
  taskDone,
  token,
}: {
  doc: JSONContent;
  taskDone: Map<string, boolean>;
  token: string;
}) {
  const ctx: Ctx = { token, taskDone };
  const blocks = (doc.content ?? []).filter((b) => b.type === BLOCK);
  return (
    <ul className="sn-list sn-root">
      {blocks.map((block, index) => (
        <Block key={text(block.attrs?.id) || index} block={block} ctx={ctx} />
      ))}
    </ul>
  );
}
