"use client";

import { type Editor, isTextSelection } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Code,
  ExternalLink,
  FileText,
  Italic,
  Link2,
  Strikethrough,
  Type,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { normalizeHref, selectionAsNoteTitle } from "../model/format";
import { TEXT_COLOR } from "../model/text-style";
import { formatState, runFocused } from "./format-state";
import { TextStylePanel } from "./text-style-menu";

export const FORMAT_MARKS = [
  { mark: "bold", label: "Fett", keys: "⌘B", Icon: Bold },
  { mark: "italic", label: "Kursiv", keys: "⌘I", Icon: Italic },
  { mark: "strike", label: "Durchgestrichen", keys: "⌘⇧S", Icon: Strikethrough },
  { mark: "code", label: "Code", keys: "⌘E", Icon: Code },
] as const;

const PLUGIN_KEY = "formatToolbar";

/** Nur bei echter Textauswahl mit Inhalt, solange Editor oder Leiste den Fokus haben. */
function shouldShowToolbar({
  editor,
  view,
  state,
  element,
}: {
  editor: Editor;
  view: EditorView;
  state: EditorState;
  element: HTMLElement;
}) {
  const inMenu = element.contains(document.activeElement);
  if (!editor.isEditable || !(view.hasFocus() || inMenu)) return false;
  const { selection } = state;
  if (!isTextSelection(selection) || selection.empty) return false;
  return state.doc.textBetween(selection.from, selection.to, " ").trim().length > 0;
}

// Fokus in Leiste und Menü immer sofort über view.focus(): TipTaps focus() wartet einen Frame,
// der späte Fokuswechsel schließt sonst ein inzwischen geöffnetes Menü oder schluckt Tasten.

/** Touch-Gerät (Handy, Tablet): kein Rechtsklick – dort erscheint die Leiste beim Markieren. */
export const isTouchDevice = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0);

/** Markierten Text als „((Titel“ einsetzen: öffnet die Notiz-Auswahl (Treffer oder „anlegen“). */
export function linkSelectionAsNote(editor: Editor) {
  const title = selectionAsNoteTitle(editor.state);
  if (!title) return;
  const { from, to } = editor.state.selection;
  editor.view.focus();
  editor
    .chain()
    .insertContentAt({ from, to }, { type: "text", text: `((${title}` })
    .run();
}

/**
 * Formatierungsleiste an der Markierung: Fett, Kursiv, Durchgestrichen, Code, Absatz und Farbe
 * (#40), Web-Link und „Als Notiz verlinken“. Auf Touch-Geräten erscheint sie beim Markieren (unter der Auswahl,
 * sonst Kollision mit dem System-Menü). Am Desktop formatiert das Rechtsklick-Menü (Rückmeldung
 * 11.10.2026); die Leiste kommt dort nur für die Link-Eingabe (`linkRequest`).
 */
export function FormatToolbar({
  editor,
  linkRequest = 0,
}: {
  editor: Editor;
  linkRequest?: number;
}) {
  const [mode, setMode] = useState<"marks" | "link" | "style">("marks");
  const [href, setHref] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [touch] = useState(isTouchDevice);
  const placement: "top" | "bottom" = touch ? "bottom" : "top";
  // Link-Eingabe aus dem Rechtsklick-Menü: Leiste auch ohne Touch zeigen, bis sie fertig ist
  const forced = useRef(false);
  const shouldShow = useCallback(
    (props: Parameters<typeof shouldShowToolbar>[0]) =>
      (touch || forced.current) && shouldShowToolbar(props),
    [touch],
  );

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      ...formatState(e),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  // Breite ändert sich mit dem Modus: Position neu berechnen (bleibt im Fenster)
  useEffect(() => {
    if (!editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, "updatePosition"));
    }
    if (mode === "link") inputRef.current?.focus();
  }, [editor, mode]);

  useEffect(() => {
    if (!linkRequest || editor.isDestroyed) return;
    if (editor.state.selection.empty && editor.isActive("link")) {
      editor.commands.extendMarkRange("link");
    }
    forced.current = true;
    setHref((editor.getAttributes("link").href as string | undefined) ?? "");
    setInvalid(false);
    setMode("link");
    editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, "show"));
  }, [editor, linkRequest]);

  const reset = () => {
    forced.current = false;
    setMode("marks");
    setInvalid(false);
  };
  /** Fertig mit der Leiste: am Desktop (ohne Touch) wieder ausblenden */
  const close = () => {
    reset();
    if (editor.isDestroyed) return;
    // erst den Fokus zurück in den Editor, dann ausblenden: sonst entfernt das Blur des
    // Adressfelds die Leiste ein zweites Mal, während sie gerade entfernt wird
    editor.view.focus();
    if (!touch) editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, "hide"));
  };
  const onHide = useRef(reset);
  onHide.current = reset;
  // Stabile Props: Die BubbleMenu schickt bei jeder Änderung eine Transaktion an den Editor –
  // bei jedem Rendern hätte das während schnellen Tippens die frische Markierung überschrieben.
  const floatingOptions = useMemo(
    () => ({
      placement,
      offset: 8,
      flip: true,
      shift: { padding: 8 },
      onHide: () => onHide.current(),
    }),
    [placement],
  );

  const applyLink = () => {
    const value = normalizeHref(href);
    editor.view.focus();
    const chain = editor.chain().extendMarkRange("link");
    const ok = value ? chain.setLink({ href: value }).run() : chain.unsetLink().run();
    if (!ok) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    close();
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={PLUGIN_KEY}
      updateDelay={150}
      shouldShow={shouldShow}
      options={floatingOptions}
      className="z-50"
    >
      <div
        role="toolbar"
        aria-label="Formatieren"
        data-testid="format-toolbar"
        className="flex items-center gap-0.5 rounded-card border border-border bg-surface p-1 text-fg shadow-float"
        onMouseDown={(event) => {
          // Klicks auf die Leiste lassen die Auswahl im Editor stehen (außer im Link-Feld)
          if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
        }}
      >
        {mode === "marks" ? (
          <>
            {FORMAT_MARKS.map(({ mark, label, keys, Icon }) => (
              <ToolbarButton
                key={mark}
                label={label}
                keys={keys}
                pressed={active[mark]}
                onClick={() => runFocused(editor, (c) => c.toggleMark(mark))}
              >
                <Icon size={16} strokeWidth={active[mark] ? 2.25 : 1.75} aria-hidden />
              </ToolbarButton>
            ))}
            {editor.schema.marks[TEXT_COLOR] ? (
              <ToolbarButton label="Absatz und Farbe" onClick={() => setMode("style")}>
                <Type size={16} strokeWidth={1.75} aria-hidden />
              </ToolbarButton>
            ) : null}
            <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
            <ToolbarButton
              label={active.link ? "Link bearbeiten" : "Web-Link"}
              pressed={active.link}
              onClick={() => {
                setHref(active.href);
                setMode("link");
              }}
            >
              <Link2 size={16} strokeWidth={1.75} aria-hidden />
            </ToolbarButton>
            <ToolbarButton
              label="Als Notiz verlinken"
              keys="(("
              disabled={!active.noteTitle}
              onClick={() => linkSelectionAsNote(editor)}
              wide
            >
              <FileText size={16} strokeWidth={1.75} aria-hidden />
              <span className="text-ui-sm">Notiz</span>
            </ToolbarButton>
          </>
        ) : mode === "style" ? (
          <TextStylePanel editor={editor} onBack={() => setMode("marks")} />
        ) : (
          <form
            className="flex items-center gap-0.5"
            onBlur={(event) => {
              // Fokus verlässt Feld und Editor (z. B. Klick in den Titel): Leiste schließen
              const next = event.relatedTarget;
              if (
                next instanceof Node &&
                (event.currentTarget.contains(next) || editor.view.dom.contains(next))
              ) {
                return;
              }
              reset();
              // nach dem Blur ausblenden, nicht mittendrin
              setTimeout(() => {
                if (!editor.isDestroyed) {
                  editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, "hide"));
                }
              }, 0);
            }}
            onSubmit={(event) => {
              event.preventDefault();
              applyLink();
            }}
          >
            <input
              ref={inputRef}
              value={href}
              onChange={(event) => {
                setHref(event.target.value);
                setInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
              }}
              placeholder="Adresse einfügen …"
              aria-label="Link-Adresse"
              aria-invalid={invalid || undefined}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={cn(
                "h-11 w-56 min-w-0 rounded-control bg-transparent px-2 text-body-lg text-fg placeholder:text-faint focus-visible:outline-none md:h-8 md:w-64 md:text-ui",
                invalid && "text-danger",
              )}
            />
            {active.link && active.href ? (
              <>
                <a
                  href={active.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label="Link öffnen"
                  title="Link öffnen"
                  className={buttonClass(false)}
                >
                  <ExternalLink size={16} strokeWidth={1.75} aria-hidden />
                </a>
                <ToolbarButton
                  label="Link entfernen"
                  onClick={() => {
                    runFocused(editor, (c) => c.extendMarkRange("link").unsetLink());
                    close();
                  }}
                >
                  <Unlink size={16} strokeWidth={1.75} aria-hidden />
                </ToolbarButton>
              </>
            ) : null}
            <button type="submit" className={cn(buttonClass(false, true), "text-ui-sm")}>
              Übernehmen
            </button>
          </form>
        )}
      </div>
    </BubbleMenu>
  );
}

/** Mobil 44 px Touch-Ziel, ab md kompakt; `wide` für Knöpfe mit Text. */
function buttonClass(pressed: boolean, wide = false) {
  return cn(
    "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-control text-muted transition-colors md:h-8",
    wide ? "px-2.5" : "w-11 md:w-8",
    "hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong",
    "disabled:pointer-events-none disabled:opacity-40",
    pressed && "bg-surface-2 text-fg",
  );
}

function ToolbarButton({
  label,
  keys,
  pressed,
  disabled,
  wide,
  onClick,
  children,
}: {
  label: string;
  keys?: string;
  pressed?: boolean;
  disabled?: boolean;
  wide?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      title={keys ? `${label} (${keys})` : label}
      disabled={disabled}
      onClick={onClick}
      className={buttonClass(Boolean(pressed), wide)}
    >
      {children}
    </button>
  );
}
