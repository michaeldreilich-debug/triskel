/**
 * Vorlagen und Einstellungen (B11) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px:
 * Ein neues Protokoll startet mit den Vorlagen-Blöcken (auch nach Reload), Vorlage per Knopf auf
 * einer leeren Notiz, Projekt-Vorlage mit Meilensteinen und Aufgaben, Abendzeit und Leitfragen.
 * Abendzeit und Leitfragen sind gemeinsamer Zustand des Testnutzers (Heute- und Rückblick-Tests
 * laufen parallel): Deren Speicheranfragen werden abgefangen und nur geprüft, nicht gespeichert.
 */
import { expect, type Page, type Route, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, openNavigation, outlineTree } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { mondayWeeksAgo, seedDb, seedRecap, weekName } from "./support/seed";

test.use({ storageState: AUTH_FILE });

const editor = (page: Page) => page.locator(".outline-editor");

async function newNote(page: Page, title: string) {
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(editor(page)).toBeVisible();
  await page.getByRole("textbox", { name: "Titel", exact: true }).fill(title);
}

/** PATCH auf eine Tabelle abfangen: Werte merken, Erfolg melden, nichts speichern. */
async function interceptPatch(page: Page, table: string) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route(`**/rest/v1/${table}?*`, async (route: Route) => {
    const request = route.request();
    if (request.method() !== "PATCH") return route.fallback();
    bodies.push(request.postDataJSON() as Record<string, unknown>);
    const id = /id=eq\.([0-9a-f-]+)/.exec(request.url())?.[1] ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id }]),
    });
  });
  return bodies;
}

test("Neues Protokoll startet mit den Vorlagen-Blöcken und behält sie nach Reload", async ({
  page,
}) => {
  await newNote(page, uniqueName("Protokoll Dienstbesprechung"));
  await page.getByRole("button", { name: "Typ", exact: true }).click();
  await page.getByRole("option", { name: "Protokoll", exact: true }).click();
  await expect(editor(page)).toContainText("Anlass/Datum");
  expect(await outlineTree(page)).toBe(
    [
      "Anlass/Datum",
      "Teilnehmende",
      "Themen",
      "Beschlüsse",
      "Offene Punkte (→ Aufgabe)",
      "Nächster Termin",
    ].join("\n"),
  );
  await expectSaved(page);
  await page.reload();
  await expect(editor(page)).toContainText("Nächster Termin");
  await expect(page.getByRole("group", { name: "Vorlagen" })).toHaveCount(0);
});

test("Leere Notiz: Vorlage per Knopf, danach verschwinden die Knöpfe", async ({ page }) => {
  await newNote(page, uniqueName("Vorlage per Knopf"));
  const chips = page.getByRole("group", { name: "Vorlagen" });
  await expect(chips).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await chips.getByRole("button", { name: "Vorlage „Protokoll“ anwenden" }).click();
  await expect(editor(page)).toContainText("Teilnehmende");
  await expect(chips).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Typ", exact: true })).toHaveText(/Protokoll/);
  await expectSaved(page);
});

test("Projekt-Vorlage: unter Einstellungen anlegen, beim neuen Projekt anwenden", async ({
  page,
}) => {
  const name = uniqueName("Übung");
  const prefix = name.split(" ")[0];
  await page.goto("/einstellungen#vorlagen");
  const projects = page.getByRole("list", { name: "Projekt-Vorlagen" });
  await page.getByRole("button", { name: "Neue Projekt-Vorlage" }).click();
  // neue Vorlagen stehen unten (mitgelieferte zuerst, dann nach Anlagedatum)
  const item = projects.getByRole("listitem").last();
  await expect(item).toContainText("Neue Projekt-Vorlage");
  await item.getByRole("button", { name: /^Neue Projekt-Vorlage/ }).click();
  await item.getByLabel("Name").fill(name);
  await item.getByLabel("Meilensteine").fill("Planen\nDurchführen");
  await item.getByLabel("Aufgaben").fill(`${prefix} Raum buchen`);
  await expect(projects.getByRole("listitem").filter({ hasText: name })).toContainText(
    "2 Meilensteine · 1 Aufgaben",
  );
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await page.goto("/projekte");
  await page.getByRole("button", { name: "Neues Projekt" }).click();
  await expect(page).toHaveURL(/\/projekte\/[0-9a-f-]{36}$/);
  const projectId = new URL(page.url()).pathname.split("/").pop() as string;
  await page.getByRole("textbox", { name: "Projekttitel" }).fill(`${prefix} Herbstübung`);
  await page.getByRole("button", { name: `Vorlage „${name}“ anwenden` }).click();
  await expect(page.getByRole("group", { name: "Vorlagen" })).toHaveCount(0);
  await expectSaved(page);
  const db = await seedDb();
  const milestones = await db
    .from("milestones")
    .select("title")
    .eq("project_id", projectId)
    .order("sort");
  expect(milestones.data?.map((m) => m.title)).toEqual(["Planen", "Durchführen"]);
  const tasks = await db.from("tasks").select("title").eq("project_id", projectId);
  expect(tasks.data?.map((t) => t.title)).toEqual([`${prefix} Raum buchen`]);

  // Vorlage wieder in den Papierkorb
  await page.goto("/einstellungen#vorlagen");
  await page.getByRole("button", { name: `Vorlage „${name}“ in den Papierkorb` }).click();
  await expect(projects.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
  await expectSaved(page);
});

test("Abendzeit einstellen: Heute zeigt sie (Speichern abgefangen)", async ({ page }) => {
  await page.goto("/einstellungen#abendplanung");
  const saved = await interceptPatch(page, "user_settings");
  const field = page.getByLabel("Abendzeit");
  await expect(field).toHaveValue("20:00");
  await field.fill("21:30");
  await expect(page.getByText(/ab 20:30 oben/)).toBeVisible();
  await expect.poll(() => saved.at(-1)?.evening_time).toBe("21:30");
  // ohne Neuladen nach Heute: der Cache trägt die neue Zeit
  const nav = await openNavigation(page);
  await nav.getByRole("link", { name: "Heute" }).click();
  await expect(
    page.getByRole("list", { name: "Tagesablauf" }).getByRole("listitem").filter({
      hasText: "Abendplanung",
    }),
  ).toContainText("21:30");
});

test("Leitfragen bearbeiten: neue Frage erscheint im nächsten Rückblick (Speichern abgefangen)", async ({
  page,
}, info) => {
  const base = info.project.name === "mobile" ? 46 : 40;
  await seedRecap({ period_start: mondayWeeksAgo(base) });
  await seedRecap({ period_start: mondayWeeksAgo(base + 2) });
  const gap = mondayWeeksAgo(base + 1);
  await (await seedDb()).from("recaps").delete().eq("period_start", gap);

  await page.goto("/einstellungen#vorlagen");
  const saved = await interceptPatch(page, "templates");
  const questions = page.getByRole("list", { name: "Leitfragen" });
  await expect(questions.getByRole("listitem")).toHaveCount(14);
  await page.getByRole("button", { name: "Frage hinzufügen" }).click();
  await questions.getByLabel("Leitfrage 15", { exact: true }).fill("Was hat mich überrascht?");
  await expect.poll(() => JSON.stringify(saved.at(-1) ?? {})).toContain("überrascht");
  await expectNoHorizontalOverflow(page);

  const nav = await openNavigation(page);
  await nav.getByRole("link", { name: "Rückblicke" }).click();
  await page.getByRole("button", { name: `${weekName(gap)} nachholen` }).click();
  const reflection = page.getByRole("region", { name: "Reflexion" });
  await expect(reflection.getByLabel("Was hat mich überrascht?")).toBeVisible();
  await expect(reflection).toContainText("0 von 15");
});
