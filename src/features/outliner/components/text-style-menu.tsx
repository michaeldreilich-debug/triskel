"use client";

import type { ChainedCommands, Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Heading, Minus, Palette } from "lucide-react";
import {
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { PARAGRAPH } from "../model/names";
import {
  BLOCK_KIND_LABELS,
  type BlockKind,
  COLOR_LABELS,
  MARKER,
  MARKER_COLORS,
  parseBlockKind,
  parseMarkerColor,
  parseTextColor,
  TEXT_COLOR,
  TEXT_COLORS,
} from "../model/text-style";
import { runFocused } from "./format-state";

type StyleKind = Exclude<BlockKind, "divider">;
const STYLE_KINDS: Array<{ kind: StyleKind | null; label: string; keys: string; short: string }> = [
  { kind: null, label: "Text", keys: "⌘⌥0", short: "Text" },
  { kind: "h1", label: BLOCK_KIND_LABELS.h1, keys: "#", short: "Ü1" },
  { kind: "h2", label: BLOCK_KIND_LABELS.h2, keys: "##", short: "Ü2" },
  { kind: "h3", label: BLOCK_KIND_LABELS.h3, keys: "###", short: "Ü3" },
  { kind: "quote", label: BLOCK_KIND_LABELS.quote, keys: ">", short: "Zitat" },
  { kind: "callout", label: BLOCK_KIND_LABELS.callout, keys: "", short: "Hinweis" },
];

/** Formatierung am Cursor: Absatzart, Textfarbe, Marker (#40). */
export function useTextStyleState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { $from } = e.state.selection;
      const available = Boolean(e.schema.marks[TEXT_COLOR]);
      return {
        available,
        kind: $from.parent.type.name === PARAGRAPH ? parseBlockKind($from.parent.attrs.kind) : null,
        color: available ? parseTextColor(e.getAttributes(TEXT_COLOR).color) : null,
        marker:
          available && e.isActive(MARKER)
            ? (parseMarkerColor(e.getAttributes(MARKER).color) ?? "gelb")
            : null,
      };
    },
  });
}

/**
 * Untermenüs „Absatz“ und „Farbe“ im Rechtsklick-Menü (Desktop). `run` gibt den Fokus zurück an
 * den Editor und führt den Befehl aus.
 */
export function TextStyleSubmenus({
  editor,
  run,
}: {
  editor: Editor;
  run: (command: (chain: ChainedCommands) => ChainedCommands) => void;
}) {
  const state = useTextStyleState(editor);
  if (!state.available) return null;
  return (
    <>
      <MenuSub>
        <MenuSubTrigger>
          <Heading aria-hidden />
          Absatz
        </MenuSubTrigger>
        <MenuSubContent aria-label="Absatz">
          {STYLE_KINDS.map(({ kind, label, keys }) => (
            <MenuCheckboxItem
              key={label}
              shortcut={keys || undefined}
              checked={state.kind === kind}
              onCheckedChange={() => run((c) => c.setBlockKind(kind))}
            >
              {label}
            </MenuCheckboxItem>
          ))}
          <MenuSeparator />
          <MenuItem shortcut="---" onSelect={() => run((c) => c.insertDivider())}>
            <Minus aria-hidden />
            {BLOCK_KIND_LABELS.divider}
          </MenuItem>
        </MenuSubContent>
      </MenuSub>
      <MenuSub>
        <MenuSubTrigger>
          <Palette aria-hidden />
          Farbe
        </MenuSubTrigger>
        <MenuSubContent aria-label="Farbe">
          <MenuLabel>Textfarbe</MenuLabel>
          <MenuCheckboxItem
            checked={state.color === null}
            onCheckedChange={() => run((c) => c.unsetTextColor())}
          >
            <span aria-hidden className="tx-swatch">
              A
            </span>
            Standard
          </MenuCheckboxItem>
          {TEXT_COLORS.map((color) => (
            <MenuCheckboxItem
              key={color}
              checked={state.color === color}
              onCheckedChange={() => run((c) => c.setTextColor(color))}
            >
              <span aria-hidden className="tx-swatch tx-color" data-color={color}>
                A
              </span>
              {COLOR_LABELS[color]}
            </MenuCheckboxItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Marker</MenuLabel>
          <MenuCheckboxItem
            shortcut="⌘⇧H"
            checked={state.marker === null}
            onCheckedChange={() => run((c) => c.unsetMarker())}
          >
            <span aria-hidden className="tx-swatch" />
            Kein Marker
          </MenuCheckboxItem>
          {MARKER_COLORS.map((color) => (
            <MenuCheckboxItem
              key={color}
              shortcut={color === "gelb" ? "==" : undefined}
              checked={state.marker === color}
              onCheckedChange={() => run((c) => c.setMarker(color))}
            >
              <span aria-hidden className="tx-swatch tx-marker" data-marker={color} />
              {`Marker ${COLOR_LABELS[color].toLowerCase()}`}
            </MenuCheckboxItem>
          ))}
        </MenuSubContent>
      </MenuSub>
    </>
  );
}

/** Knopf der Handy-Leiste: 44 px Touch-Ziel, ab md kompakt. */
const panelButton = (pressed: boolean) =>
  cn(
    "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-control px-2 text-ui-sm text-muted transition-colors md:h-8 md:min-w-8",
    "hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong",
    pressed && "bg-surface-2 text-fg",
  );

/**
 * Absatzart und Farben in der Leiste am Handy (dort gibt es keinen Rechtsklick): drei Zeilen –
 * Absatzarten, Textfarben, Marker.
 */
export function TextStylePanel({ editor, onBack }: { editor: Editor; onBack: () => void }) {
  const state = useTextStyleState(editor);
  const run = (command: (chain: ChainedCommands) => ChainedCommands) => runFocused(editor, command);
  return (
    <div className="flex max-w-[calc(100vw-32px)] flex-col gap-1 md:max-w-sm">
      <fieldset
        aria-label="Absatz"
        className="m-0 flex min-w-0 flex-wrap items-center gap-0 border-0 p-0 md:gap-0.5"
      >
        {STYLE_KINDS.map(({ kind, label, short }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-pressed={state.kind === kind}
            onClick={() => run((c) => c.setBlockKind(kind))}
            className={panelButton(state.kind === kind)}
          >
            {short}
          </button>
        ))}
        <button
          type="button"
          aria-label={BLOCK_KIND_LABELS.divider}
          onClick={() => run((c) => c.insertDivider())}
          className={panelButton(false)}
        >
          <Minus size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </fieldset>
      <fieldset
        aria-label="Textfarbe"
        className="m-0 flex min-w-0 flex-wrap items-center gap-0 border-0 p-0 md:gap-0.5"
      >
        <button
          type="button"
          aria-label="Textfarbe Standard"
          aria-pressed={state.color === null}
          onClick={() => run((c) => c.unsetTextColor())}
          className={panelButton(state.color === null)}
        >
          <span aria-hidden className="tx-swatch">
            A
          </span>
        </button>
        {TEXT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Textfarbe ${COLOR_LABELS[color]}`}
            aria-pressed={state.color === color}
            onClick={() => run((c) => c.setTextColor(color))}
            className={panelButton(state.color === color)}
          >
            <span aria-hidden className="tx-swatch tx-color" data-color={color}>
              A
            </span>
          </button>
        ))}
      </fieldset>
      <fieldset
        aria-label="Marker"
        className="m-0 flex min-w-0 flex-wrap items-center gap-0 border-0 p-0 md:gap-0.5"
      >
        <button
          type="button"
          aria-label="Kein Marker"
          aria-pressed={state.marker === null}
          onClick={() => run((c) => c.unsetMarker())}
          className={panelButton(state.marker === null)}
        >
          <span aria-hidden className="tx-swatch" />
        </button>
        {MARKER_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Marker ${COLOR_LABELS[color]}`}
            aria-pressed={state.marker === color}
            onClick={() => run((c) => c.setMarker(color))}
            className={panelButton(state.marker === color)}
          >
            <span aria-hidden className="tx-swatch tx-marker" data-marker={color} />
          </button>
        ))}
        <button type="button" onClick={onBack} className={cn(panelButton(false), "ml-auto")}>
          Fertig
        </button>
      </fieldset>
    </div>
  );
}
