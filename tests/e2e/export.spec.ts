/**
 * Markdown-Export (B14) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px: ZIP aus den
 * Einstellungen herunterladen und den Inhalt prüfen – Obsidian-Vault mit Frontmatter, Links als
 * [[…]], Projekt mit Fahrplan, export.json; „Letzter Export“ wird angezeigt.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, deleteCalendarSource, seedDb, seedProject, seedTasks } from "./support/seed";

test.use({ storageState: AUTH_FILE });

test("Export: ZIP als Obsidian-Vault mit Notiz, Link, Projekt-Fahrplan und export.json", async ({
  page,
}) => {
  const prefix = uniqueName("Export");
  const { beruf } = await areaIds();
  const db = await seedDb();
  const projectId = await seedProject({
    title: `${prefix} Übung`,
    area_id: beruf,
    status: "aktiv",
  });
  const milestone = await db
    .from("milestones")
    .insert({ project_id: projectId, title: "Planen", sort: "a0" })
    .select("id")
    .single();
  expect(milestone.error).toBeNull();
  await seedTasks([
    {
      title: `${prefix} Raum buchen`,
      area_id: beruf,
      project_id: projectId,
      milestone_id: milestone.data?.id,
    },
  ]);
  const target = crypto.randomUUID();
  const source = crypto.randomUUID();
  const notes = await db.from("notes").insert([
    { id: target, title: `${prefix} Ziel`, area_id: beruf, tags: [] },
    { id: source, title: `${prefix} Quelle`, area_id: beruf, tags: ["export"] },
  ]);
  expect(notes.error).toBeNull();
  const blocks = await db.from("note_blocks").insert({
    note_id: source,
    sort: "a0",
    content: {
      type: "paragraph",
      content: [
        { type: "text", text: "Siehe " },
        { type: "noteLink", attrs: { noteId: target } },
      ],
    },
    content_text: "Siehe",
  });
  expect(blocks.error).toBeNull();
  // Kalenderquelle (S2a): im Export ohne die geheime Adresse. Ausgeschaltet und am Ende wieder
  // weg: Eingeschaltet lüde jede Kalender-Ansicht paralleler Tests die erfundene Adresse bei
  // Google (404 → Quelle mit Fehler, echter Netzabruf bei jedem Laden; N4)
  const calendarId = crypto.randomUUID();
  const calendar = await db.from("calendar_sources").insert({
    id: calendarId,
    name: `${prefix} Kalender`,
    url: "https://calendar.google.com/calendar/ical/geheim/private-e2e/basic.ics",
    enabled: false,
    sort: "zz",
  });
  expect(calendar.error).toBeNull();
  try {
    await page.goto("/einstellungen#export");
    const section = page.getByRole("region", { name: "Export" });
    await expect(section).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await section.getByRole("button", { name: "Export herunterladen (ZIP)" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^Schaltzentrale-Export-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = unzipSync(new Uint8Array(readFileSync((await download.path()) as string)));
    const names = Object.keys(zip);
    const root = names[0]?.split("/")[0] as string;
    const read = (suffix: string) => {
      const name = names.find((n) => n.endsWith(suffix));
      expect(name, suffix).toBeDefined();
      return strFromU8(zip[name as string] as Uint8Array);
    };

    expect(names).toContain(`${root}/README.md`);
    expect(names).toContain(`${root}/export.json`);
    const sourceNote = read(`/Wissen/Beruf/${prefix} Quelle.md`);
    expect(sourceNote).toMatch(/^---\ntyp: notiz\n/);
    expect(sourceNote).toContain('tags: ["export"]');
    expect(sourceNote).toContain(`- Siehe [[${prefix} Ziel]]`);
    const projectFile = read(`/Projekte/Beruf/${prefix} Übung.md`);
    expect(projectFile).toContain("## Fahrplan");
    expect(projectFile).toContain(`### 1. Planen · offen\n\n- [ ] ${prefix} Raum buchen`);
    const json = JSON.parse(read("/export.json"));
    expect(json.version).toBe(1);
    expect(json.tables.notes.some((n: { id: string }) => n.id === source)).toBe(true);
    expect(json.tables.note_blocks[0]).not.toHaveProperty("search");
    const exportedCalendar = json.tables.calendar_sources.find(
      (c: { id: string }) => c.id === calendarId,
    );
    expect(exportedCalendar).toMatchObject({ name: `${prefix} Kalender`, color: "blau" });
    expect(exportedCalendar).not.toHaveProperty("url");
    expect(read("/export.json")).not.toContain("private-e2e");

    await expect(page.getByTestId("last-export")).toContainText("heute");
    await expectSaved(page);
    await expectNoHorizontalOverflow(page);
    // Meldung „Export erstellt …“ blendet noch ein (axe mäße die halbe Deckkraft, N4)
    await page.waitForTimeout(300);
    await expectNoA11yViolations(page);
  } finally {
    await deleteCalendarSource(calendarId);
  }
});
