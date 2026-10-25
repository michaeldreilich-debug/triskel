/**
 * Rückblicke (S1a, S4): Wochen- und Monatsrückblicke auflisten, anlegen (Migration 32) und ändern
 * (Migration 34, Rückmeldung: „KI darf auf jeden Fall Wochenrückblicke anlegen und auch ändern“).
 * Ändern betrifft nur Antworten, Werte, Fokus und Themen – nie Art oder Zeitraum; Texte werden
 * angehängt, überschrieben nur mit modus „ersetzen“. Abschließen und löschen bleiben in der App.
 * Die ID ist dieselbe feste ID wie in der App (je Nutzer, Art und Zeitraum, D-3): App und KI
 * treffen sich auf derselben Zeile.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { normalizeTags } from "@/features/notes/types";
import {
  answerOf,
  DEFAULT_QUESTIONS,
  monthQuestions,
  periodOf,
  questionsOf,
  recapId,
  recapLabel,
  recapRange,
  recapTitle,
  toRecap,
} from "@/features/recaps/model";
import type { RecapRow, RecapWrite } from "@/features/recaps/types";
import { berlinDate, isoWeekYear } from "@/lib/dates";
import { type AiContext, appUrl, check, logActivity, ref } from "../context";
import { ToolInputError } from "../resolve";
import { CHANGES, CREATES, defineTool, READ_ONLY } from "./define";
import { id, isoDate, tags } from "./schema";

const RECAP_COLUMNS =
  "id, kind, period_start, period_end, mood, energy, sport, relations, learning, answers, focus_next, themes, questions, stats, review, closed_at, created_at, updated_at, deleted_at";

/**
 * Gesprächsfelder (#66): deutsche Namen als Eingabe-Schlüssel der Werkzeuge → feste Schlüssel der
 * Antworten (`recaps.answers`).
 */
const CONVERSATION_INPUTS = {
  gespraech: "conversation",
  hypothese: "hypothesis",
  gegenhypothese: "counter_hypothesis",
  klartext: "plain_talk",
  bezug_vorwoche: "last_week",
} as const;

const conversationShape = {
  gespraech: z.string().trim().max(10_000).optional().describe("Abschnitt „Gespräch“: Gespräch"),
  hypothese: z.string().trim().max(10_000).optional().describe("Abschnitt „Gespräch“: Hypothese"),
  gegenhypothese: z
    .string()
    .trim()
    .max(10_000)
    .optional()
    .describe("Abschnitt „Gespräch“: Gegenhypothese"),
  klartext: z.string().trim().max(10_000).optional().describe("Abschnitt „Gespräch“: Klartext"),
  bezug_vorwoche: z
    .string()
    .trim()
    .max(10_000)
    .optional()
    .describe("Abschnitt „Gespräch“: Bezug zur Vorwoche (beim Monat: zum Vormonat)"),
};

const conversationTexts = (input: Partial<Record<keyof typeof CONVERSATION_INPUTS, string>>) =>
  Object.fromEntries(
    (Object.entries(CONVERSATION_INPUTS) as [keyof typeof CONVERSATION_INPUTS, string][])
      .filter(([field]) => input[field] !== undefined)
      .map(([field, key]) => [key, input[field] as string]),
  );

const scale = z.number().int().min(1).max(5);
const text = z.string().trim().max(10_000);

/** Eine Zeile je Rückblick: Titel, Zeitraum, Werte, Themen, Status – mit Link und ID. */
export function recapLine(recap: RecapRow, origin: string): string {
  const values = [
    recap.mood !== null ? `Stimmung ${recap.mood}` : null,
    recap.energy !== null ? `Energie ${recap.energy}` : null,
    recap.sport !== null ? `Sport ${recap.sport}` : null,
    recap.relations !== null ? `Beziehungen ${recap.relations}` : null,
    recap.learning !== null ? `Lernen ${recap.learning}` : null,
  ].filter(Boolean);
  const parts = [
    recapRange(recap),
    ...values,
    recap.themes.length ? recap.themes.map((t) => `#${t}`).join(" ") : null,
    recap.closed_at ? "abgeschlossen" : "offen",
  ].filter(Boolean);
  return `- ${ref(recapTitle(recap), appUrl.recap(origin, recap.id), recap.id)} · ${parts.join(" · ")}`;
}

const yearOf = (recap: RecapRow) =>
  recap.kind === "woche" ? isoWeekYear(recap.period_start) : Number(recap.period_start.slice(0, 4));

export function registerRecapTools(server: McpServer, ctx: AiContext) {
  /* ---------------- list_recaps ---------------- */
  defineTool(
    server,
    "list_recaps",
    {
      title: "Rückblicke auflisten",
      description:
        "Wochen- und Monatsrückblicke, neueste zuerst, mit Werten (Stimmung, Energie, Sport, Beziehungen, Lernen 1–5), Themen und Status – z. B. „alle Monatsrückblicke 2027“. Für Antworten und Zahlen „fetch“ mit der ID.",
      input: z.object({
        art: z.enum(["woche", "monat", "alle"]).default("alle"),
        jahr: z
          .number()
          .int()
          .min(2000)
          .max(2100)
          .optional()
          .describe("nur dieses Jahr (Wochen: Jahr der Kalenderwoche)"),
        thema: z.string().trim().min(1).max(50).optional().describe("nur mit diesem Thema (#tag)"),
        limit: z.number().int().min(1).max(200).default(30),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      const rows = check(
        "Rückblicke laden",
        await ctx.db
          .from("recaps")
          .select(RECAP_COLUMNS)
          .is("deleted_at", null)
          .order("period_start", { ascending: false })
          .order("kind"),
      ).map((row) => toRecap(row as unknown as Record<string, unknown> & { id: string }));
      const theme = input.thema?.replace(/^#/, "").toLocaleLowerCase("de");
      const list = rows
        .filter((r) => input.art === "alle" || r.kind === input.art)
        .filter((r) => input.jahr === undefined || yearOf(r) === input.jahr)
        .filter((r) => !theme || r.themes.some((t) => t.toLocaleLowerCase("de") === theme));
      const shown = list.slice(0, input.limit);
      const more = list.length - shown.length;
      return {
        text: shown.length
          ? `${list.length} Rückblicke\n\n${shown.map((r) => recapLine(r, ctx.origin)).join("\n")}${
              more > 0 ? `\n_… ${more} weitere (limit erhöhen)._` : ""
            }`
          : "Keine passenden Rückblicke.",
      };
    },
  );

  /* ---------------- create_recap ---------------- */
  defineTool(
    server,
    "create_recap",
    {
      title: "Rückblick anlegen",
      description: [
        "Legt einen Wochenrückblick (ISO-Woche Mo–So) oder Monatsrückblick (Kalendermonat) an – z. B. nach einem Rückblick-Gespräch. Zeitraum über ein beliebiges Datum darin (ohne: heute).",
        "Antworten auf die Leitfragen: gut (Was lief gut?), schwer (Was war schwer?), mitnehmen (Was nehme ich mit?), Werte 1–5 (stimmung, energie, beziehungen, lernen), sport als Zahl, fokus (bis 3 Punkte für die nächste Woche bzw. den nächsten Monat), themen als Tags.",
        "Abschnitt „Gespräch“ (Rückblick-Gespräch): gespraech, hypothese, gegenhypothese, klartext, bezug_vorwoche (beim Monat: Bezug zum Vormonat) – lange Texte sind erwünscht.",
        "Nur neue Rückblicke: Gibt es für den Zeitraum schon einen, ändert ihn der Nutzer in der App (vorher mit list_recaps/fetch prüfen). Abschließen (Zahlen festhalten) geht in der App.",
      ].join(" "),
      input: z.object({
        art: z.enum(["woche", "monat"]),
        datum: isoDate.optional().describe("ein Tag im Zeitraum (JJJJ-MM-TT); ohne: heute"),
        stimmung: scale.optional().describe("Wie ging es mir (1–5)?"),
        energie: scale.optional(),
        beziehungen: scale.optional(),
        lernen: scale.optional(),
        sport: z.number().min(0).max(9999).optional().describe("Einheiten oder Stunden"),
        gut: text.optional().describe("Was lief gut?"),
        schwer: text.optional().describe("Was war schwer?"),
        mitnehmen: text.optional().describe("Was nehme ich mit?"),
        ...conversationShape,
        fokus: z.array(z.string().trim().min(1).max(500)).max(3).optional(),
        themen: tags.optional(),
      }),
      annotations: CREATES,
    },
    async (input) => {
      const { start, end } = periodOf(input.art, input.datum ?? berlinDate(ctx.now()));
      const id = recapId(ctx.userId, input.art, start);
      const title = recapTitle({ kind: input.art, period_start: start });
      const existing = check(
        "Rückblicke prüfen",
        await ctx.db
          .from("recaps")
          .select("id, deleted_at")
          .eq("kind", input.art)
          .eq("period_start", start),
      );
      const live = existing.find((r) => !r.deleted_at);
      if (live) {
        throw new ToolInputError(
          `${title} gibt es schon: ${ref(title, appUrl.recap(ctx.origin, live.id), live.id)}. Ändern geht nur in der App – der Nutzer kann die Antworten dort ergänzen.`,
        );
      }
      if (existing.some((r) => r.id === id)) {
        throw new ToolInputError(
          `${title} liegt im Papierkorb der App. Der Nutzer kann ihn dort wiederherstellen.`,
        );
      }
      const answers: Record<string, string> = {};
      if (input.gut) answers.good = input.gut;
      if (input.schwer) answers.hard = input.schwer;
      if (input.mitnehmen) answers.takeaway = input.mitnehmen;
      Object.assign(answers, conversationTexts(input));
      const row: Partial<RecapWrite> & { id: string } = {
        id,
        kind: input.art,
        period_start: start,
        period_end: end,
        questions: input.art === "monat" ? monthQuestions(DEFAULT_QUESTIONS) : DEFAULT_QUESTIONS,
        mood: input.stimmung ?? null,
        energy: input.energie ?? null,
        relations: input.beziehungen ?? null,
        learning: input.lernen ?? null,
        sport: input.sport ?? null,
        answers,
        focus_next: input.fokus ?? [],
        themes: normalizeTags(input.themen ?? []),
      };
      const inserted = await ctx.db
        .from("recaps")
        .insert(row as never)
        .select("id")
        .single();
      if (inserted.error?.code === "23505") {
        throw new ToolInputError(`${title} gibt es schon. Ändern geht nur in der App.`);
      }
      check("Rückblick anlegen", inserted);
      const filled = [
        ...Object.keys(answers),
        ...(["mood", "energy", "relations", "learning", "sport"] as const).filter(
          (key) => row[key] !== null,
        ),
        ...(row.focus_next?.length ? ["focus_next"] : []),
      ].length;
      await logActivity(ctx, {
        tool: "create_recap",
        entity: "rueckblick",
        entityId: id,
        summary: `${title} angelegt (${filled} Antworten${row.themes?.length ? `, ${row.themes.length} Themen` : ""})`,
      });
      const url = appUrl.recap(ctx.origin, id);
      return {
        text: `${input.art === "monat" ? "Monatsrückblick" : "Wochenrückblick"} ${recapLabel({ kind: input.art, period_start: start })} angelegt: ${ref(title, url, id)} · ${filled} Antworten. Abschließen und weitere Änderungen in der App.`,
        structured: { id, url },
      };
    },
  );

  /* ---------------- update_recap ---------------- */
  defineTool(
    server,
    "update_recap",
    {
      title: "Rückblick ändern",
      description: [
        "Ändert Antworten, Werte, Fokus und Themen eines Wochen- oder Monatsrückblicks (Migration 34). Art und Zeitraum bleiben; abschließen (Zahlen festhalten) und löschen gehen nur in der App.",
        "Texte (gut, schwer, mitnehmen, antworten) werden an Vorhandenes angehängt; modus „ersetzen“ überschreibt sie. Werte: null entfernt (stimmung, energie, beziehungen, lernen, sport). fokus und themen ersetzen die Liste.",
        "Abschnitt „Gespräch“: gespraech, hypothese, gegenhypothese, klartext, bezug_vorwoche (beim Monat: Bezug zum Vormonat) – gelten wie gut/schwer/mitnehmen (anhängen bzw. ersetzen).",
        "antworten: weitere Leitfragen der Vorlage nach ihrem Schlüssel (siehe fetch). Vorher mit „fetch“ lesen.",
      ].join(" "),
      input: z.object({
        id,
        stimmung: scale.nullable().optional(),
        energie: scale.nullable().optional(),
        beziehungen: scale.nullable().optional(),
        lernen: scale.nullable().optional(),
        sport: z.number().min(0).max(9999).nullable().optional(),
        gut: text.optional(),
        schwer: text.optional(),
        mitnehmen: text.optional(),
        ...conversationShape,
        antworten: z
          .record(z.string().trim().min(1).max(50), text)
          .optional()
          .describe("weitere Textfragen der Vorlage: Schlüssel → Text"),
        modus: z.enum(["anhaengen", "ersetzen"]).default("anhaengen"),
        fokus: z.array(z.string().trim().min(1).max(500)).max(3).optional(),
        themen: tags.optional(),
      }),
      annotations: CHANGES,
    },
    async (input) => {
      const row = check(
        "Rückblick laden",
        await ctx.db.from("recaps").select(RECAP_COLUMNS).eq("id", input.id).maybeSingle(),
      ) as (Record<string, unknown> & { id: string }) | null;
      if (!row || row.deleted_at) throw new ToolInputError(`Rückblick ${input.id} nicht gefunden.`);
      const recap = toRecap(row);
      const title = recapTitle(recap);
      const questions = questionsOf(recap);
      const patch: Partial<RecapWrite> = {};
      const scales = [
        ["stimmung", "mood"],
        ["energie", "energy"],
        ["beziehungen", "relations"],
        ["lernen", "learning"],
      ] as const;
      for (const [field, column] of scales) {
        if (input[field] !== undefined) patch[column] = input[field];
      }
      if (input.sport !== undefined) patch.sport = input.sport;

      // Texte: an die Leitfragen des Rückblicks gebunden; anhängen ist die Vorgabe (Regel 1)
      const texts: Record<string, string> = { ...(input.antworten ?? {}) };
      if (input.gut !== undefined) texts.good = input.gut;
      if (input.schwer !== undefined) texts.hard = input.schwer;
      if (input.mitnehmen !== undefined) texts.takeaway = input.mitnehmen;
      Object.assign(texts, conversationTexts(input));
      if (Object.keys(texts).length > 0) {
        const answers: Record<string, unknown> = { ...recap.answers };
        for (const [key, value] of Object.entries(texts)) {
          const question = questions.find((q) => q.key === key);
          if (!question || question.type !== "text") {
            throw new ToolInputError(
              `„${key}“ ist keine Textfrage dieses Rückblicks. Fragen: ${questions
                .filter((q) => q.type === "text")
                .map((q) => `${q.key} (${q.label})`)
                .join(", ")}.`,
            );
          }
          const current = String(answerOf(recap, question) ?? "").trim();
          answers[key] = input.modus === "ersetzen" || !current ? value : `${current}\n\n${value}`;
        }
        patch.answers = answers;
      }
      if (input.fokus !== undefined) patch.focus_next = input.fokus;
      if (input.themen !== undefined) patch.themes = normalizeTags(input.themen);

      const changed = Object.keys(patch) as Array<keyof RecapWrite>;
      if (changed.length === 0) throw new ToolInputError("Nichts zu ändern angegeben.");
      const before = Object.fromEntries(
        changed.map((key) => [key, (recap as unknown as Record<string, unknown>)[key]]),
      );
      check(
        "Rückblick ändern",
        await ctx.db
          .from("recaps")
          .update(patch as never)
          .eq("id", recap.id)
          .select("id"),
      );
      await logActivity(ctx, {
        tool: "update_recap",
        entity: "rueckblick",
        entityId: recap.id,
        summary: `${title} geändert (${changed.join(", ")})`,
        undo: { kind: "update", table: "recaps", id: recap.id, before, after: patch },
      });
      return {
        text: `${title} geändert (${changed.join(", ")}): ${ref(title, appUrl.recap(ctx.origin, recap.id), recap.id)}. Abschließen und Löschen in der App.`,
        structured: { id: recap.id, url: appUrl.recap(ctx.origin, recap.id) },
      };
    },
  );
}
