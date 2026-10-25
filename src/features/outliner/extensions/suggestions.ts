import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import type { NoteDirectory, TagDirectory } from "../directory";
import { NOTE_LINK, TAG } from "../model/names";
import { TAG_NAME } from "./tag";

export type NoteItem =
  | { kind: "note"; id: string; title: string; archived?: boolean }
  | { kind: "create"; title: string };
export type TagItem = { kind: "tag"; name: string; isNew: boolean };
export type SuggestionKind = "note" | "tag";
export type AnyItem = NoteItem | TagItem;

type Renderer = ReturnType<NonNullable<SuggestionOptions<AnyItem, AnyItem>["render"]>>;
export type SuggestionRendererFactory = (kind: SuggestionKind) => Renderer;
export type OutlineSuggestionProps = SuggestionProps<AnyItem, AnyItem>;

export const NOTE_SUGGESTION = new PluginKey("noteSuggestion");
export const NOTE_SUGGESTION_PAREN = new PluginKey("noteSuggestionParen");
export const TAG_SUGGESTION = new PluginKey("tagSuggestion");

/**
 * Auslöser für Notiz-Links: „[[“ (wie Obsidian/Roam) und „((“ – auf der deutschen
 * Mac-Tastatur ohne ⌥ erreichbar (Rückmeldung 11.10.2026). Gespeichert wird beides gleich.
 */
export const NOTE_LINK_TRIGGERS = [
  { char: "[[", close: "]]", key: NOTE_SUGGESTION },
  { char: "((", close: "))", key: NOTE_SUGGESTION_PAREN },
] as const;

/** Einträge für [[ bzw. ((: passende Notizen, dazu „Neue Notiz ‚…‘ anlegen“ (keine offenen Verweise). */
export function noteItems(notes: NoteDirectory, rawQuery: string): NoteItem[] {
  const query = rawQuery.replace(/[\])]+$/, "").trim();
  const items: NoteItem[] = notes
    .search(query)
    .slice(0, 8)
    .map((n) => ({
      kind: "note",
      id: n.id,
      title: n.title,
      ...(n.archived ? { archived: true } : {}),
    }));
  if (query && !notes.findByTitle(query)) items.push({ kind: "create", title: query });
  return items;
}

export function tagItems(tags: TagDirectory, query: string): TagItem[] {
  if (query && !TAG_NAME.test(query)) return [];
  const existing = tags.search(query).slice(0, 8);
  const items: TagItem[] = existing.map((name) => ({ kind: "tag", name, isNew: false }));
  if (query && !existing.some((t) => t.toLocaleLowerCase("de") === query.toLocaleLowerCase("de"))) {
    items.push({ kind: "tag", name: query, isNew: true });
  }
  return items;
}

export interface OutlineSuggestionsOptions {
  notes: NoteDirectory | null;
  tags: TagDirectory | null;
  renderer: SuggestionRendererFactory | null;
}

/** Autocomplete für [[Notizen]] bzw. ((Notizen)) und #Tags. */
export const OutlineSuggestions = Extension.create<OutlineSuggestionsOptions>({
  name: "outlineSuggestions",
  // vor den Outline-Tasten: Enter/Tab wählen im offenen Autocomplete aus, statt den Block zu teilen
  priority: 1100,

  addOptions() {
    return { notes: null, tags: null, renderer: null };
  },

  addProseMirrorPlugins() {
    const { notes, tags, renderer } = this.options;
    const plugins = [];
    if (notes) {
      for (const trigger of NOTE_LINK_TRIGGERS) {
        plugins.push(
          Suggestion<AnyItem, AnyItem>({
            editor: this.editor,
            pluginKey: trigger.key,
            char: trigger.char,
            allowSpaces: true,
            allowedPrefixes: null,
            items: ({ query }) => noteItems(notes, query),
            command: ({ editor, range, props }) => {
              if (props.kind === "tag") return;
              const noteId = props.kind === "create" ? notes.create(props.title) : props.id;
              // ein von Hand getipptes „]]“ bzw. „))“ mit entfernen
              const after = editor.state.doc.textBetween(
                range.to,
                Math.min(range.to + 2, editor.state.doc.content.size),
              );
              const to = after === trigger.close ? range.to + 2 : range.to;
              editor
                .chain()
                .focus()
                .insertContentAt({ from: range.from, to }, [
                  { type: NOTE_LINK, attrs: { noteId } },
                  { type: "text", text: " " },
                ])
                .run();
            },
            render: renderer ? () => renderer("note") : undefined,
          }),
        );
      }
    }
    if (tags) {
      plugins.push(
        Suggestion<AnyItem, AnyItem>({
          editor: this.editor,
          pluginKey: TAG_SUGGESTION,
          char: "#",
          items: ({ query }) => tagItems(tags, query),
          command: ({ editor, range, props }) => {
            if (props.kind !== "tag") return;
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: TAG, attrs: { name: props.name } },
                { type: "text", text: " " },
              ])
              .run();
          },
          render: renderer ? () => renderer("tag") : undefined,
        }),
      );
    }
    return plugins;
  },
});
