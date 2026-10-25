"use client";

import { FileText, Hash, Plus } from "lucide-react";
import { useEffect, useId, useMemo, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import type {
  AnyItem,
  OutlineSuggestionProps,
  SuggestionKind,
  SuggestionRendererFactory,
} from "../extensions/suggestions";

/** sichtbarer Bereich in Koordinaten des Layout-Viewports (iPhone: ohne Bildschirmtastatur) */
export interface VisibleArea {
  top: number;
  height: number;
  /** Höhe des Layout-Viewports (Bezug für `bottom` bei position: fixed) */
  layoutHeight: number;
}

export type SuggestionPlacement =
  | { top: number; maxHeight: number }
  | { bottom: number; maxHeight: number };

/**
 * Unter dem Cursor, wenn dort Platz ist – sonst darüber (O-8): Am iPhone liegt die untere
 * Bildschirmhälfte hinter der Tastatur, „Neue Notiz anlegen“ als letzter Eintrag wäre unsichtbar.
 * Höhe begrenzt auf den freien Platz, die Liste scrollt dann selbst.
 */
export function placeSuggestions(
  caret: { top: number; bottom: number },
  area: VisibleArea,
  wantedHeight: number,
): SuggestionPlacement {
  const gap = 4;
  const below = area.top + area.height - caret.bottom - gap * 2;
  const above = caret.top - area.top - gap * 2;
  if (below >= wantedHeight || below >= above) {
    return { top: caret.bottom + gap, maxHeight: Math.max(88, below) };
  }
  return { bottom: area.layoutHeight - caret.top + gap, maxHeight: Math.max(88, above) };
}

const visibleArea = (): VisibleArea => {
  const viewport = window.visualViewport;
  return {
    top: viewport?.offsetTop ?? 0,
    height: viewport?.height ?? window.innerHeight,
    layoutHeight: window.innerHeight,
  };
};

interface SuggestionState {
  kind: SuggestionKind;
  props: OutlineSuggestionProps;
  selected: number;
}

/**
 * Auswahlliste für ((Notiz-Links)) und #Tags – im Outliner der Notizen und in der Notiz einer
 * Aufgabe gleich. `renderer` geht einmalig in die Extensions (stabil), `popup` wird gerendert.
 */
export function useSuggestionPopup(): {
  renderer: SuggestionRendererFactory;
  popup: React.ReactNode;
} {
  const listId = useId();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const suggestion = useRef<SuggestionState | null>(null);

  const select = (item: AnyItem | undefined) => {
    const current = suggestion.current;
    if (!current || !item) return;
    current.props.command(item);
  };

  // stabil (geht einmalig in die Extensions); alles Veränderliche läuft über Refs
  // biome-ignore lint/correctness/useExhaustiveDependencies: bewusst stabil
  const renderer = useMemo<SuggestionRendererFactory>(
    () => (kind) => ({
      onStart: (props) => {
        suggestion.current = { kind, props, selected: 0 };
        rerender();
      },
      onUpdate: (props) => {
        const previous = suggestion.current;
        const selected =
          previous?.kind === kind
            ? Math.min(previous.selected, Math.max(0, props.items.length - 1))
            : 0;
        suggestion.current = { kind, props, selected };
        rerender();
      },
      onKeyDown: ({ event }) => {
        const current = suggestion.current;
        if (!current || current.props.items.length === 0) return false;
        const count = current.props.items.length;
        if (event.key === "ArrowDown") {
          current.selected = (current.selected + 1) % count;
          rerender();
          return true;
        }
        if (event.key === "ArrowUp") {
          current.selected = (current.selected - 1 + count) % count;
          rerender();
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          select(current.props.items[current.selected]);
          return true;
        }
        if (event.key === "Escape") {
          suggestion.current = null;
          rerender();
          return true;
        }
        return false;
      },
      onExit: () => {
        suggestion.current = null;
        rerender();
      },
    }),
    [],
  );

  const current = suggestion.current;
  const rect = current?.props.clientRect?.() ?? null;
  const open = Boolean(current && rect && current.props.items.length > 0);
  const optionId = (index: number) => `${listId}-${index}`;

  // Bildschirmtastatur auf/zu, Seite gescrollt: neu platzieren
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    viewport.addEventListener("resize", rerender);
    viewport.addEventListener("scroll", rerender);
    return () => {
      viewport.removeEventListener("resize", rerender);
      viewport.removeEventListener("scroll", rerender);
    };
  }, [open]);

  // Screenreader (O-11): Editor als Combobox mit der Liste verbinden, aktive Option melden
  const ariaTarget = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dom = open ? (current?.props.editor.view.dom as HTMLElement | undefined) : undefined;
    if (ariaTarget.current && ariaTarget.current !== dom) {
      for (const name of ["aria-expanded", "aria-controls", "aria-activedescendant"]) {
        ariaTarget.current.removeAttribute(name);
      }
      ariaTarget.current.removeAttribute("aria-autocomplete");
      ariaTarget.current = null;
    }
    if (!dom || !current) return;
    ariaTarget.current = dom;
    dom.setAttribute("aria-autocomplete", "list");
    dom.setAttribute("aria-expanded", "true");
    dom.setAttribute("aria-controls", listId);
    dom.setAttribute("aria-activedescendant", optionId(current.selected));
    document.getElementById(optionId(current.selected))?.scrollIntoView?.({ block: "nearest" });
  });

  const placement =
    open && rect && current
      ? placeSuggestions(
          rect,
          visibleArea(),
          // Zeilen am Handy 44 px, am Desktop 32 px, dazu Rand
          current.props.items.length * (window.innerWidth < 768 ? 44 : 32) + 10,
        )
      : null;
  const popup =
    current && rect && placement
      ? createPortal(
          <div
            id={listId}
            role="listbox"
            aria-label={current.kind === "note" ? "Notiz verlinken" : "Tag einfügen"}
            data-testid="outline-suggestions"
            data-placement={"top" in placement ? "unten" : "oben"}
            className="scroll-quiet fixed z-50 w-72 max-w-[calc(100vw-16px)] overflow-y-auto rounded-card border border-border bg-surface p-1 text-fg shadow-float"
            style={{
              ...placement,
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)),
            }}
          >
            {current.props.items.map((item, index) => (
              <div
                key={
                  item.kind === "note"
                    ? item.id
                    : `${item.kind}-${"title" in item ? item.title : item.name}`
                }
                id={optionId(index)}
                role="option"
                aria-selected={index === current.selected}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(item)}
                onKeyDown={() => {}}
                className={cn(
                  "flex min-h-11 cursor-default items-center gap-2 rounded-control px-2 text-ui md:min-h-8",
                  index === current.selected && "bg-surface-2",
                )}
              >
                {item.kind === "note" ? (
                  <>
                    <FileText
                      size={16}
                      strokeWidth={1.5}
                      className="shrink-0 text-faint"
                      aria-hidden
                    />
                    <span className="truncate">{item.title}</span>
                    {item.archived ? (
                      <span className="ml-auto text-meta text-faint">archiviert</span>
                    ) : null}
                  </>
                ) : item.kind === "create" ? (
                  <>
                    <Plus size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
                    <span className="truncate">Neue Notiz „{item.title}“ anlegen</span>
                  </>
                ) : (
                  <>
                    <Hash size={16} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
                    <span className="truncate">{item.name}</span>
                    {item.isNew ? <span className="ml-auto text-meta text-faint">neu</span> : null}
                  </>
                )}
              </div>
            ))}
          </div>,
          // im Aufgaben-Sheet (modaler Dialog) innerhalb des Dialogs, sonst wären die Einträge
          // dort nicht anklickbar und ein Tippen würde das Sheet schließen
          current.props.editor.view.dom.closest<HTMLElement>('[role="dialog"]') ?? document.body,
        )
      : null;

  return { renderer, popup };
}
