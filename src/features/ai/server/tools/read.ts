/** Lesende Werkzeuge (#33): Überblick, Suche, ein Eintrag, Listen. Ändern nichts. */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fetchBacklinks } from "@/features/notes/queries";
import { isOpenProject, PROJECT_STATUSES } from "@/features/projects/types";
import { toRecap } from "@/features/recaps/model";
import { TASK_STATUSES, type TaskRow } from "@/features/tasks/types";
import { berlinDate, formatDateShort } from "@/lib/dates";
import { type AiContext, appUrl, check, ref } from "../context";
import {
  loadNoteBlocks,
  loadSnapshot,
  noteLine,
  projectLine,
  renderer,
  renderTask,
  type Snapshot,
  toExportNote,
} from "../data";
import { collectMedia, MAX_RESULT_IMAGES } from "../media";
import { resolveNamedLoose, resolveNoteType, ToolInputError, valueHelp } from "../resolve";
import { isNoteShared, SHARED_NOTE_HINT } from "../shares";
import { fetchMedia } from "./attachments";
import { defineTool, READ_ONLY } from "./define";
import { id, isoDate, noteType, reference } from "./schema";

const byDue = (a: TaskRow, b: TaskRow) =>
  (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
  (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);

const cut = <T>(items: T[], limit: number) => ({
  shown: items.slice(0, limit),
  more: Math.max(0, items.length - limit),
});

const moreLine = (more: number) => (more > 0 ? `\n_… ${more} weitere (limit erhöhen)._` : "");

export function area(snapshot: Snapshot, value: string | undefined) {
  return value ? resolveNamedLoose(value, snapshot.areas, (a) => a.name, "Bereich") : null;
}

export function registerReadTools(server: McpServer, ctx: AiContext) {
  /* ---------------- overview ---------------- */
  defineTool(
    server,
    "overview",
    {
      title: "Überblick",
      description:
        "Zuerst aufrufen: Aufbau von Triskel, Bereiche, Themen, offene Projekte, heutiger Fokus, Fälliges, Inbox und erlaubte Werte – jeweils mit IDs für die anderen Werkzeuge.",
      input: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const snapshot = await loadSnapshot(ctx.db);
      const today = berlinDate(ctx.now());
      const render = renderer(snapshot, ctx.origin, { place: true });
      const open = snapshot.tasks.filter((t) => t.status !== "erledigt");
      const parts = [
        `# Triskel · Überblick (Stand ${formatDateShort(today)})`,
        "Aufbau: Bereiche → Projekte (befristet, mit Meilensteinen und Aufgaben) und Themen (dauerhaftes Wissen mit Notizen). Notizen sind Gliederungen (verschachtelte Listen). Ungeordnetes liegt in der Inbox.",
        "## Bereiche",
        snapshot.areas.map((a) => `- ${a.name} (id: ${a.id})`).join("\n"),
      ];
      const topics = snapshot.areas
        .map((a) => {
          const own = snapshot.topics.filter((t) => t.area_id === a.id && !t.archived_at);
          if (!own.length) return "";
          const lines = own.map((t) => {
            const count = snapshot.notes.filter((n) => n.topic_id === t.id).length;
            return `- ${t.name} (id: ${t.id}) · ${count} Notizen`;
          });
          return `### ${a.name}\n${lines.join("\n")}`;
        })
        .filter(Boolean);
      parts.push("## Themen", topics.length ? topics.join("\n\n") : "_Keine Themen._");
      const projects = snapshot.projects.filter(isOpenProject);
      parts.push(
        "## Offene Projekte",
        projects.length
          ? projects.map((p) => projectLine(snapshot, p, ctx.origin)).join("\n")
          : "_Keine offenen Projekte._",
      );
      const focus = open.filter((t) => t.focus_date === today);
      const due = open.filter((t) => t.due_date && t.due_date <= today).sort(byDue);
      const inbox = open.filter((t) => t.in_inbox);
      parts.push(
        `## Heute (${formatDateShort(today)})`,
        `### Fokus\n${focus.length ? focus.map(render.taskLine).join("\n") : "_Kein Fokus gesetzt._"}`,
        `### Überfällig und heute fällig\n${due.length ? due.map((t) => render.taskLine({ ...t, body_text: "" })).join("\n") : "_Nichts._"}`,
        `### Inbox (${inbox.length})\n${
          inbox.length
            ? inbox
                .slice(0, 10)
                .map((t) => render.taskLine({ ...t, body_text: "" }))
                .join("\n") + moreLine(inbox.length - 10)
            : "_Leer._"
        }`,
        "## Erlaubte Werte",
        valueHelp(snapshot.noteTypes),
      );
      return { text: parts.join("\n\n") };
    },
  );

  /* ---------------- search ---------------- */
  defineTool(
    server,
    "search",
    {
      title: "Suchen",
      description:
        "Volltextsuche über Projekte, Aufgaben, Notizen (auch Inhalt) und Rückblicke, wie ⌘K in der App. Ein Wort reicht; Treffer mit allen Wörtern stehen oben. Liefert IDs für „fetch“.",
      input: z.object({
        query: z.string().trim().min(1).max(200).describe("Suchbegriffe"),
        bereich: reference("Bereich").optional().describe("nur in diesem Bereich (ID oder Name)"),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      annotations: READ_ONLY,
    },
    async ({ query, bereich, limit }) => {
      const areaId = bereich
        ? resolveNamedLoose(
            bereich,
            check(
              "Bereiche laden",
              await ctx.db.from("areas").select("id, name").is("deleted_at", null),
            ),
            (a) => a.name,
            "Bereich",
          ).id
        : null;
      const hits = check(
        "Suche",
        await ctx.db.rpc("search_all", {
          p_query: query,
          ...(areaId ? { p_area_id: areaId } : {}),
        }),
      ).slice(0, limit);
      const urlOf = (kind: string, hitId: string) =>
        kind === "projekt"
          ? appUrl.project(ctx.origin, hitId)
          : kind === "notiz"
            ? appUrl.note(ctx.origin, hitId)
            : kind === "aufgabe"
              ? appUrl.task(ctx.origin, hitId)
              : appUrl.recap(ctx.origin, hitId);
      const results = hits.map((hit) => ({
        id: hit.id,
        kind: hit.kind,
        title: hit.title?.trim() || "Ohne Titel",
        snippet: hit.snippet ?? "",
        url: urlOf(hit.kind, hit.id),
      }));
      const text = results.length
        ? results
            .map(
              (r) =>
                `- ${r.kind}: ${ref(r.title, r.url, r.id)}${r.snippet.trim() ? `\n  ${r.snippet.trim()}` : ""}`,
            )
            .join("\n")
        : `Keine Treffer für „${query}“.`;
      return { text, structured: { results } };
    },
  );

  /* ---------------- fetch ---------------- */
  defineTool(
    server,
    "fetch",
    {
      title: "Eintrag lesen",
      description:
        "Liest ein Projekt (Steckbrief, Fahrplan mit Meilensteinen und Aufgaben, Notizen), eine Aufgabe (Eigenschaften, Notiz/Checkliste), eine Notiz (Eigenschaften und Inhalt als verschachtelte Liste, Rückverweise) oder einen Rückblick als Markdown – per ID aus Suche, Überblick oder Listen. " +
        `Bilder (im Text ![[…]]) kommen als Bildinhalt mit, höchstens ${MAX_RESULT_IMAGES} je Antwort; weitere Bilder und den Inhalt von Dateien ([[…]], z. B. PDF-Text) liefert „get_attachment“. ` +
        `Nimmt auch einen kopierten Link aus der App (${new URL(ctx.origin).host}/…): Solche Links immer hiermit lesen, nie im Browser – dort ist eine Anmeldung nötig.`,
      input: z.object({
        id,
        bilder: z
          .boolean()
          .default(true)
          .describe("false = nur Text, Bilder später einzeln mit „get_attachment“"),
      }),
      annotations: READ_ONLY,
    },
    async ({ id: target, bilder }) => {
      const snapshot = await loadSnapshot(ctx.db);
      const project = snapshot.projects.find((p) => p.id === target);
      if (project) {
        const text = renderer(snapshot, ctx.origin).project(project);
        const url = appUrl.project(ctx.origin, project.id);
        const media = await fetchMedia(ctx, project.id, collectMedia([project.body]), text, {
          images: bilder,
        });
        return {
          text: `${text}${media.section}\n[In der App öffnen](${url})`,
          content: media.content,
          structured: {
            id: project.id,
            title: project.title,
            text,
            url,
            metadata: { kind: "projekt" },
          },
        };
      }
      const task = snapshot.tasks.find((t) => t.id === target);
      if (task) {
        const text = renderTask(snapshot, task, ctx.origin);
        const url = appUrl.task(ctx.origin, task.id);
        const media = await fetchMedia(ctx, task.id, collectMedia([task.body]), text, {
          images: bilder,
        });
        return {
          text: `${text}${media.section}\n[In der App öffnen](${url})`,
          content: media.content,
          structured: { id: task.id, title: task.title, text, url, metadata: { kind: "aufgabe" } },
        };
      }
      const note = snapshot.notes.find((n) => n.id === target);
      if (note) {
        const [blocks, backlinks, shared] = await Promise.all([
          loadNoteBlocks(ctx, note.id),
          fetchBacklinks(ctx.db, note.id),
          isNoteShared(ctx, note.id),
        ]);
        let text = renderer(snapshot, ctx.origin, { blocks }).note(toExportNote(note));
        // öffentlich freigegeben (#94): sagen, dass jeder mit dem Link mitliest und die KI nichts ändert
        if (shared) text = `${SHARED_NOTE_HINT}\n\n${text}`;
        const sources = backlinks
          .map((b) => snapshot.notes.find((n) => n.id === b.noteId))
          .filter((n): n is NonNullable<typeof n> => Boolean(n));
        if (sources.length) {
          text += `\n## Rückverweise\n\n${sources
            .map((n) => `- ${ref(n.title, appUrl.note(ctx.origin, n.id), n.id)}`)
            .join("\n")}\n`;
        }
        const url = appUrl.note(ctx.origin, note.id);
        const media = await fetchMedia(
          ctx,
          note.id,
          collectMedia(blocks.map((b) => b.content)),
          text,
          { images: bilder },
        );
        return {
          text: `${text}${media.section}\n[In der App öffnen](${url})`,
          content: media.content,
          structured: {
            id: note.id,
            title: note.title,
            text,
            url,
            metadata: { kind: "notiz", ...(shared ? { oeffentlich: true } : {}) },
          },
        };
      }
      const { data: recapRow } = await ctx.db
        .from("recaps")
        .select("*")
        .eq("id", target)
        .is("deleted_at", null)
        .maybeSingle();
      if (recapRow) {
        const recap = toRecap(recapRow as unknown as Record<string, unknown> & { id: string });
        const text = renderer(snapshot, ctx.origin).recap(recap);
        const url = appUrl.recap(ctx.origin, recap.id);
        return {
          text: `${text}\n[In der App öffnen](${url})`,
          structured: {
            id: recap.id,
            title: recap.kind,
            text,
            url,
            metadata: { kind: "rueckblick" },
          },
        };
      }
      throw new ToolInputError(
        `Kein Projekt, keine Aufgabe, Notiz oder Rückblick mit der ID ${target} (auch nicht im Papierkorb sichtbar).`,
      );
    },
  );

  /* ---------------- list_tasks ---------------- */
  defineTool(
    server,
    "list_tasks",
    {
      title: "Aufgaben auflisten",
      description:
        "Aufgaben mit Filtern, sortiert nach Fälligkeit. Ohne Status: alle nicht erledigten. Mehrere Filter gelten zusammen.",
      input: z.object({
        status: z.enum([...TASK_STATUSES, "nicht_erledigt", "alle"]).default("nicht_erledigt"),
        bereich: reference("Bereich").optional(),
        projekt: reference("Projekt").optional(),
        faellig_bis: isoDate.optional().describe("fällig an oder vor diesem Tag"),
        fokus_am: isoDate.optional().describe("Fokus-Aufgaben dieses Tages"),
        inbox: z.boolean().optional().describe("true = nur Inbox"),
        ohne_projekt: z.boolean().optional().describe("true = nur Aufgaben ohne Projekt"),
        zustaendig: z
          .enum(["ich", "ki"])
          .optional()
          .describe("nur Aufgaben des Nutzers („ich“) bzw. nur Arbeitsschritte der KI („ki“)"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const areaRow = area(snapshot, input.bereich);
      const project = input.projekt
        ? resolveNamedLoose(input.projekt, snapshot.projects, (p) => p.title, "Projekt")
        : null;
      const rows = snapshot.tasks
        .filter((t) =>
          input.status === "alle"
            ? true
            : input.status === "nicht_erledigt"
              ? t.status !== "erledigt"
              : t.status === input.status,
        )
        .filter((t) => !areaRow || (t.area_id === areaRow.id && !t.in_inbox))
        .filter((t) => !project || t.project_id === project.id)
        .filter(
          (t) => !input.faellig_bis || (t.due_date !== null && t.due_date <= input.faellig_bis),
        )
        .filter((t) => !input.fokus_am || t.focus_date === input.fokus_am)
        .filter((t) => input.inbox === undefined || t.in_inbox === input.inbox)
        .filter((t) => !input.ohne_projekt || !t.project_id)
        .filter((t) => !input.zustaendig || (t.assignee === "ai") === (input.zustaendig === "ki"))
        .sort(byDue);
      const { shown, more } = cut(rows, input.limit);
      const render = renderer(snapshot, ctx.origin, { place: true });
      return {
        text: shown.length
          ? `${rows.length} Aufgaben\n\n${shown.map((t) => render.taskLine({ ...t, body_text: "" })).join("\n")}${moreLine(more)}`
          : "Keine passenden Aufgaben.",
      };
    },
  );

  /* ---------------- list_notes ---------------- */
  defineTool(
    server,
    "list_notes",
    {
      title: "Notizen auflisten",
      description:
        "Notizen mit Filtern, zuletzt bearbeitete zuerst, mit Vorschau der ersten Zeile. Ohne Filter alle Notizen (auch Ideen und Projektnotizen); „nur_wissen“ zeigt nur das Wissen. Für den Inhalt „fetch“ benutzen.",
      input: z.object({
        bereich: reference("Bereich").optional(),
        thema: reference("Thema").optional(),
        projekt: reference("Projekt").optional(),
        typ: noteType.optional(),
        nur_wissen: z
          .boolean()
          .optional()
          .describe(
            "true = nur Notizen von Typen, die als Wissen zählen (wie die Ansicht „Wissen“ in der App, Typen siehe Überblick)",
          ),
        tag: z.string().trim().min(1).max(50).optional(),
        geaendert_seit: isoDate.optional(),
        limit: z.number().int().min(1).max(200).default(30),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const areaRow = area(snapshot, input.bereich);
      const topic = input.thema
        ? resolveNamedLoose(input.thema, snapshot.topics, (t) => t.name, "Thema")
        : null;
      const project = input.projekt
        ? resolveNamedLoose(input.projekt, snapshot.projects, (p) => p.title, "Projekt")
        : null;
      const tag = input.tag?.replace(/^#/, "").toLocaleLowerCase("de");
      const type = input.typ ? resolveNoteType(input.typ, snapshot.noteTypes) : null;
      const knowledge = new Set(
        snapshot.noteTypes.filter((t) => t.counts_as_knowledge).map((t) => t.key),
      );
      const rows = snapshot.notes
        .filter((n) => !input.nur_wissen || knowledge.has(n.type))
        .filter((n) => !areaRow || n.area_id === areaRow.id)
        .filter((n) => !topic || n.topic_id === topic.id)
        .filter((n) => !project || n.project_id === project.id)
        .filter((n) => !type || n.type === type)
        .filter((n) => !tag || n.tags.some((t) => t.toLocaleLowerCase("de") === tag))
        .filter((n) => !input.geaendert_seit || berlinDate(n.edited_at) >= input.geaendert_seit)
        .sort((a, b) => Date.parse(b.edited_at) - Date.parse(a.edited_at));
      const { shown, more } = cut(rows, input.limit);
      return {
        text: shown.length
          ? `${rows.length} Notizen\n\n${shown.map((n) => noteLine(snapshot, n, ctx.origin)).join("\n")}${moreLine(more)}`
          : "Keine passenden Notizen.",
      };
    },
  );

  /* ---------------- list_projects ---------------- */
  defineTool(
    server,
    "list_projects",
    {
      title: "Projekte auflisten",
      description:
        "Projekte mit Status, Bereich, Fortschritt und nächstem Meilenstein. Ohne Status: alle offenen (nicht abgeschlossen, nicht im Archiv).",
      input: z.object({
        status: z.array(z.enum(PROJECT_STATUSES)).optional(),
        bereich: reference("Bereich").optional(),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      const snapshot = await loadSnapshot(ctx.db);
      const areaRow = area(snapshot, input.bereich);
      const rows = snapshot.projects
        .filter((p) => (input.status?.length ? input.status.includes(p.status) : isOpenProject(p)))
        .filter((p) => !areaRow || p.area_id === areaRow.id);
      return {
        text: rows.length
          ? rows.map((p) => projectLine(snapshot, p, ctx.origin)).join("\n")
          : "Keine passenden Projekte.",
      };
    },
  );
}
