import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { toEventLink } from "@/features/calendar/links";
import type { BlockRow } from "@/features/outliner/model/serializer";
import type { MilestoneRow, ProjectRow } from "@/features/projects/types";
import { toRecap } from "@/features/recaps/model";
import { task } from "@/features/tasks/fixtures";
import { buildVault, createNamer, type ExportInput, frontmatter, safeName } from "./vault";
import { exportAge, zipVault } from "./zip";

const T = "2026-10-12T08:00:00Z";

const project: ProjectRow = {
  id: "p1",
  area_id: "fw",
  title: "Herbstübung",
  status: "aktiv",
  priority: 1,
  start_date: "2026-10-01",
  target_date: "2026-11-30",
  why: "Alle sicher am Gerät",
  outcome: [
    { id: "o1", text: "Übung durchgeführt", done: false },
    { id: "o2", text: "", done: false },
  ],
  links: [
    { id: "l1", name: "Übungsplan", url: "https://www.notion.so/uebung" },
    { id: "l2", name: "", url: "https://kreis.de/termine" },
    { id: "l3", name: "Böse", url: "javascript:alert(1)" },
  ],
  // Freitext (#44): Absatz und Checkliste wie in der Aufgaben-Notiz
  body: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Absprache mit der Teamleitung" }] },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Termin steht" }] }],
          },
        ],
      },
    ],
  },
  body_text: "Absprache mit der Teamleitung\nTermin steht",
  next_task_id: "t1",
  last_activity_at: T,
  closing_reflection: null,
  sort: "a0",
  created_at: T,
  updated_at: T,
  deleted_at: null,
};

const milestone = (id: string, title: string, sort: string, done_at: string | null = null) =>
  ({
    id,
    project_id: "p1",
    title,
    due_date: null,
    done_at,
    sort,
    created_at: T,
    updated_at: T,
    deleted_at: null,
  }) satisfies MilestoneRow;

const block = (
  id: string,
  note_id: string,
  sort: string,
  content: BlockRow["content"],
  extra: Partial<BlockRow> = {},
): BlockRow & { note_id: string } => ({
  id,
  note_id,
  parent_id: null,
  sort,
  content,
  content_text: "",
  collapsed: false,
  task_id: null,
  deleted_at: null,
  ...extra,
});

const text = (value: string) => ({ type: "text", text: value });

const note = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  type: "wissen" as const,
  area_id: "fw",
  topic_id: null,
  project_id: null,
  task_id: null,
  tags: [],
  reviewed_at: null,
  archived_at: null,
  created_at: T,
  updated_at: T,
  ...extra,
});

const input: ExportInput = {
  areas: [
    { id: "fw", name: "Beruf", sort: "a0" },
    { id: "pr", name: "Privat", sort: "a1" },
  ],
  topics: [{ id: "top", area_id: "fw", name: "Atemschutz" }],
  projects: [project],
  milestones: [milestone("m2", "Durchführen", "a1"), milestone("m1", "Planen", "a0", T)],
  tasks: [
    task("t1", {
      title: "Raum buchen",
      project_id: "p1",
      milestone_id: "m1",
      due_date: "2026-10-20",
    }),
    task("t2", {
      title: "Einladung",
      project_id: "p1",
      milestone_id: "m1",
      status: "erledigt",
      completed_at: T,
    }),
    task("t3", { title: "Bericht", project_id: "p1", body_text: "Fotos anhängen" }),
    task("t4", { title: "Einkaufen", area_id: "pr", priority: 2 }),
    task("t4b", { title: "Vom Assistenten", area_id: "pr", created_by: "ai" }),
    task("t4c", { title: "Bauschritt", area_id: "pr", created_by: "ai", assignee: "ai" }),
    task("t5", { title: "Idee sortieren", area_id: null, in_inbox: true }),
  ],
  dependencies: [{ task_id: "t3", blocked_by_task_id: "t1" }],
  notes: [
    note("n1", "Flaschen prüfen", { topic_id: "top", tags: ["geräte"], project_id: "p1" }),
    note("n2", "Flaschen prüfen"),
    note("n3", "Leer"),
  ],
  blocks: [
    block("b1", "n1", "a0", { type: "paragraph", content: [text("Druck prüfen")] }),
    block(
      "b2",
      "n1",
      "a0",
      {
        type: "paragraph",
        content: [text("Siehe "), { type: "noteLink", attrs: { noteId: "n2" } }],
      },
      { parent_id: "b1" },
    ),
    block(
      "b3",
      "n1",
      "a1",
      { type: "paragraph", content: [text("Raum buchen")] },
      { task_id: "t2" },
    ),
  ],
  recaps: [
    toRecap({
      id: "r1",
      kind: "woche",
      period_start: "2026-10-12",
      period_end: "2026-10-18",
      mood: 4,
      answers: { good: "Übung geplant" },
      focus_next: ["Bericht", "", "Sport"],
      themes: ["schlaf"],
      closed_at: "2026-10-18T18:00:00Z",
      stats: {
        period: { start: "2026-10-12", end: "2026-10-18" },
        tasks_done: { total: 1, by_area: [{ area_id: "fw", name: "Beruf", count: 1 }] },
        milestones_done: 1,
        notes_created: 0,
        focus_days: { achieved: 1, planned: 2 },
        stuck_projects: [],
        stale_projects: [],
        activity: [
          {
            date: "2026-10-12",
            done: [{ id: "t2", title: "Einladung", at: T }],
            milestones: [],
            notes_created: [],
            notes_edited: [{ id: "n2", title: "Flaschen prüfen", at: T }],
          },
        ],
      },
    }),
  ],
  eventLinks: [
    toEventLink({
      id: "l1",
      google_calendar_id: "fw@group.calendar.google.com",
      event_id: "ev1",
      scope: "occurrence",
      note_id: "n1",
      event_title: "Übungsdienst",
      event_start: "2026-10-21T17:00:00.000Z",
      event_end: "2026-10-21T19:00:00.000Z",
    }),
    toEventLink({
      id: "l2",
      google_calendar_id: "fw@group.calendar.google.com",
      event_id: "ev2_a",
      recurring_event_id: "ev2",
      scope: "series",
      task_id: "t4",
      event_title: "Wochenmarkt",
      event_start: "2026-10-24T06:00:00.000Z",
      event_end: "2026-10-24T08:00:00.000Z",
    }),
  ],
  tables: { areas: [{ id: "fw", name: "Beruf" }], tasks: [{ id: "x", deleted_at: T }] },
  exportedAt: new Date("2026-10-18T19:00:00Z"),
};

const vault = buildVault(input);
const file = (path: string) => {
  const content = vault.find((f) => f.path === path)?.content;
  return typeof content === "string" ? content : undefined;
};

describe("Markdown-Export (B14)", () => {
  it("Dateien des Vaults: eindeutige Namen über den ganzen Vault", () => {
    expect(vault.map((f) => f.path).sort()).toEqual([
      "Aufgaben/Inbox.md",
      "Aufgaben/Privat.md",
      "Projekte/Beruf/Herbstübung.md",
      "README.md",
      "Rückblicke/2026/Wochenrückblick 2026-KW42.md",
      "Wissen/Beruf/Atemschutz/Flaschen prüfen.md",
      "Wissen/Beruf/Flaschen prüfen (2).md",
      "Wissen/Beruf/Leer.md",
      "export.json",
    ]);
  });

  it("Projekt mit Frontmatter, Ergebnis, Links (nur sichere), Freitext, nächstem Schritt und nummeriertem Fahrplan", () => {
    expect(file("Projekte/Beruf/Herbstübung.md")).toBe(
      [
        "---",
        "typ: projekt",
        "id: p1",
        "bereich: Beruf",
        "status: Aktiv",
        "prioritaet: Hoch",
        "start: 2026-10-01",
        "ziel: 2026-11-30",
        'fortschritt: "1/3"',
        "naechster_meilenstein: Durchführen",
        "erstellt: 2026-10-12",
        "geaendert: 2026-10-12",
        "---",
        "",
        "# Herbstübung",
        "",
        "## Warum",
        "",
        "Alle sicher am Gerät",
        "",
        "## Fertig ist es, wenn …",
        "",
        "- [ ] Übung durchgeführt",
        "",
        "## Links",
        "",
        "- [Übungsplan](https://www.notion.so/uebung)",
        "- [kreis.de](https://kreis.de/termine)",
        "",
        "## Freitext",
        "",
        "Absprache mit der Teamleitung",
        "- [x] Termin steht",
        "",
        "## Nächster Schritt",
        "",
        "- [ ] Raum buchen (fällig 2026-10-20)",
        "",
        "## Fahrplan",
        "",
        "Meilensteine in Reihenfolge. Abarbeiten: den ersten offenen Meilenstein zuerst, darin die offenen Aufgaben von oben nach unten.",
        "",
        "### 1. Planen · erreicht 2026-10-12",
        "",
        "- [ ] Raum buchen (fällig 2026-10-20)",
        "- [x] Einladung (erledigt 2026-10-12)",
        "",
        "### 2. Durchführen · offen",
        "",
        "_Noch keine Aufgaben._",
        "",
        "## Aufgaben ohne Meilenstein",
        "",
        "- [ ] Bericht (blockiert durch Raum buchen)",
        "    Fotos anhängen",
        "",
        "## Notizen",
        "",
        "- [[Flaschen prüfen]]",
        "",
      ].join("\n"),
    );
  });

  it("Notiz: Outliner als verschachtelte Liste, Link mit Alias auf den eindeutigen Namen, Aufgabe als Checkbox", () => {
    const content = file("Wissen/Beruf/Atemschutz/Flaschen prüfen.md") ?? "";
    expect(content).toContain("thema: Atemschutz");
    expect(content).toContain('projekt: "[[Herbstübung]]"');
    expect(content).toContain('tags: ["geräte"]');
    expect(content).toContain(
      "- Druck prüfen\n  - Siehe [[Flaschen prüfen (2)|Flaschen prüfen]]\n- [x] Raum buchen",
    );
    expect(file("Wissen/Beruf/Leer.md")).not.toMatch(/^- $/m);
    // #68: verknüpfter Termin aus dem Schnappschuss
    expect(content).toContain('termin: "Mi, 21.10. 19:00–21:00 · Übungsdienst"');
  });

  it("Aufgaben ohne Projekt je Bereich und Inbox", () => {
    expect(file("Aufgaben/Privat.md")).toContain(
      "- [ ] Einkaufen (Priorität mittel · Termin Sa, 24.10. 08:00–10:00 · Wochenmarkt (ganze Serie))",
    );
    expect(file("Aufgaben/Inbox.md")).toContain("- [ ] Idee sortieren");
    // #69: von der KI angelegte Aufgaben sind im Export erkennbar
    expect(file("Aufgaben/Privat.md")).toContain("- [ ] Vom Assistenten (von KI angelegt)");
    expect(file("Aufgaben/Privat.md")).toContain("- [ ] Bauschritt (von KI angelegt · für die KI)");
  });

  it("Rückblick: Antworten, Liste nummeriert, Zahlen und Tagesverlauf", () => {
    const content = file("Rückblicke/2026/Wochenrückblick 2026-KW42.md") ?? "";
    expect(content).toContain("kw: 42");
    expect(content).toContain("stimmung: 4");
    expect(content).toContain("## Wie ging es mir (1–5)?\n\n4 von 5");
    expect(content).toContain("## Was lief gut?\n\nÜbung geplant");
    expect(content).toContain("## Was war schwer?\n\n_offen_");
    expect(content).toContain("1. Bericht\n2. Sport");
    expect(content).toContain("- Erledigt: 1 (Beruf 1)");
    expect(content).toContain("- 10:00 Notiz bearbeitet: [[Flaschen prüfen (2)|Flaschen prüfen]]");
  });

  it("export.json enthält alle Zeilen (auch gelöschte); README erklärt den Fahrplan", () => {
    const json = JSON.parse(file("export.json") ?? "{}");
    expect(json).toMatchObject({ version: 1, exported_at: "2026-10-18T19:00:00.000Z" });
    expect(json.tables.tasks).toEqual([{ id: "x", deleted_at: T }]);
    expect(file("README.md")).toContain("## Fahrplan abarbeiten (für Claude)");
  });

  it("ZIP enthält alle Dateien unter einem Ordner, Umlaute in Namen bleiben", () => {
    const zip = unzipSync(zipVault(vault, "Export"));
    expect(Object.keys(zip)).toContain("Export/Rückblicke/2026/Wochenrückblick 2026-KW42.md");
    expect(strFromU8(zip["Export/README.md"] as Uint8Array)).toContain("Triskel");
  });

  it("Wochenrückblick im Ordner seines ISO-Wochenjahrs: KW 01/2026 beginnt 2025 (T-17)", () => {
    const [recap] = input.recaps;
    const files = buildVault({
      ...input,
      recaps: [
        {
          ...(recap as (typeof input.recaps)[number]),
          id: "r-kw1",
          period_start: "2025-12-29",
          period_end: "2026-01-04",
        },
      ],
    });
    expect(files.map((f) => f.path)).toContain("Rückblicke/2026/Wochenrückblick 2026-KW01.md");
  });

  it("Monatsrückblick (S1a): eigene Datei im Jahr, Fokus für den nächsten Monat", () => {
    const files = buildVault({
      ...input,
      recaps: [
        toRecap({
          id: "r-okt",
          kind: "monat",
          period_start: "2026-10-01",
          period_end: "2026-10-31",
          mood: 4,
          focus_next: ["Steuer abgeben"],
        }),
      ],
    });
    const month = files.find((f) => f.path === "Rückblicke/2026/Monatsrückblick 2026-10.md");
    const content = String(month?.content ?? "");
    expect(content).toContain("art: monat");
    expect(content).toContain("# Monatsrückblick 10/2026 · 01.–31.10.2026");
    expect(content).toContain("## Fokus nächster Monat (3 Punkte)\n\n1. Steuer abgeben");
    expect(content).not.toContain("kw:");
  });

  it("Bilder als Anhänge mit ![[datei]], Diagramme als ```mermaid-Block (E24)", () => {
    const files = buildVault({
      ...input,
      projects: [],
      tasks: [],
      recaps: [],
      notes: [note("n9", "Mit Bild")],
      blocks: [
        block("i1", "n9", "a0", {
          type: "paragraph",
          content: [
            text("Plan: "),
            { type: "noteImage", attrs: { path: "u/n9/abc.png", alt: "Plan" } },
          ],
        }),
        block("m1", "n9", "a1", {
          type: "paragraph",
          content: [{ type: "mermaid", attrs: { code: "graph TD\n  A --> B" } }],
        }),
      ],
      attachments: [{ name: "abc.png", data: new Uint8Array([1, 2, 3]) }],
    });
    const md = files.find((f) => f.path === "Wissen/Beruf/Mit Bild.md")?.content;
    expect(md).toContain("- Plan: ![[abc.png]]\n-\n  ```mermaid\n  graph TD\n    A --> B\n  ```");
    expect(files.find((f) => f.path === "Anhänge/abc.png")?.content).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    const zip = unzipSync(zipVault(files, "E"));
    expect(zip["E/Anhänge/abc.png"]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("Snapshot des ganzen Vaults (ohne export.json)", () => {
    expect(vault.filter((f) => f.path !== "export.json")).toMatchSnapshot();
  });
});

describe("Hilfen", () => {
  it("Dateinamen ohne störende Zeichen, Doppelte mit Zähler", () => {
    expect(safeName("A/B: [Test] #1?")).toBe("A-B- -Test- -1");
    expect(safeName("true")).toBe("true");
    expect(safeName("  ")).toBe("Ohne Titel");
    const name = createNamer();
    expect([name("Plan"), name("plan"), name("Plan")]).toEqual(["Plan", "plan (2)", "Plan (3)"]);
  });

  it("Frontmatter: leere Werte fallen weg, Texte in Anführungszeichen", () => {
    expect(frontmatter({ a: "x", b: null, c: [], d: 3, e: "2026-10-01", f: ['say "hi"'] })).toBe(
      '---\na: x\nd: 3\ne: 2026-10-01\nf: ["say \\"hi\\""]\n---',
    );
  });

  it("Alter des letzten Exports", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    expect(exportAge(null, now).label).toBe("Noch kein Export");
    expect(exportAge("2026-10-18T08:00:00Z", now).label).toBe("heute");
    expect(exportAge("2026-10-10T08:00:00Z", now)).toEqual({ days: 8, label: "vor 8 Tagen" });
  });
});
