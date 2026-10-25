/**
 * Reiter in der App (#63, E36 Variante 1) gegen das Testprojekt: Desktop 1440 px (Leiste oben,
 * ⌘-Klick = neuer Reiter, Seitenleiste im aktuellen Reiter, Scroll-Stelle und `?aufgabe=` beim
 * Zurückwechseln, schließen, Kürzel, Obergrenze, zwei Fenster) und Handy 390 px (Zähler, Liste).
 */
import { expect, type Page, test } from "@playwright/test";
import { generateNKeysBetween } from "fractional-indexing";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedNotes, seedTasks } from "./support/seed";
import { taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Reiter" });
const tabButtons = (page: Page) => tabBar(page).getByRole("listitem");
const activeTab = (page: Page) => tabBar(page).locator('button[aria-current="page"]');
const editor = (page: Page) => page.locator(".outline-editor");
const notePane = (page: Page) => page.locator('[data-tab-scroll="notiz"]');

/** Notiz mit vielen Zeilen (scrollt in ihrer Spalte). */
async function seedLongNote(title: string, lines = 70) {
  const { beruf } = await areaIds();
  const [noteId] = await seedNotes([{ title, area_id: beruf, type: "wissen" }]);
  const db = await seedDb();
  const keys = generateNKeysBetween(null, null, lines);
  const { error } = await db.from("note_blocks").insert(
    keys.map((sort, i) => ({
      id: crypto.randomUUID(),
      note_id: noteId as string,
      sort,
      content: { type: "paragraph", content: [{ type: "text", text: `Zeile ${i + 1}` }] },
      content_text: `Zeile ${i + 1}`,
    })),
  );
  expect(error).toBeNull();
  return noteId as string;
}

test("⌘-Klick öffnet einen neuen Reiter; zurück zur Notiz mit Scroll-Stelle und Aufgaben-Panel; Seitenleiste im aktuellen Reiter; schließen @desktop", async ({
  page,
  context,
}) => {
  const title = uniqueName("Reiter Notiz");
  const noteId = await seedLongNote(title);
  const { beruf } = await areaIds();
  const taskTitle = uniqueName("Reiter Aufgabe");
  const [taskId] = await seedTasks([{ title: taskTitle, area_id: beruf }]);

  await page.goto(`/wissen/${noteId}?aufgabe=${taskId}`);
  await expect(editor(page)).toContainText("Zeile 70");
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    taskTitle,
  );
  // ein Reiter, Titel der offenen Aufgabe
  await expect(tabButtons(page)).toHaveCount(1);
  await expect(activeTab(page)).toHaveText(taskTitle);

  // in der Notiz nach unten scrollen
  const before = await notePane(page).evaluate((el) => {
    el.scrollTop = 1200;
    return el.scrollTop;
  });
  expect(before).toBeGreaterThan(300);

  // ⌘-Klick auf „Kalender“ in der Seitenleiste: neuer App-Reiter, kein Browser-Tab
  const sidebar = page.getByRole("complementary", { name: "Seitenleiste" });
  await sidebar.getByRole("link", { name: "Kalender" }).click({ modifiers: ["ControlOrMeta"] });
  await expect(page).toHaveURL(/\/kalender/);
  await expect(tabButtons(page)).toHaveCount(2);
  await expect(activeTab(page)).toHaveText("Kalender");
  expect(context.pages()).toHaveLength(1);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);

  // zurück zur Notiz: Adresse samt ?aufgabe=, Panel offen, Scroll-Stelle wieder da
  await tabBar(page).getByRole("button", { name: taskTitle, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/wissen/${noteId}\\?aufgabe=${taskId}`));
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    taskTitle,
  );
  await expect
    .poll(() => notePane(page).evaluate((el) => el.scrollTop))
    .toBeGreaterThanOrEqual(before - 2);
  expect(await notePane(page).evaluate((el) => el.scrollTop)).toBeLessThanOrEqual(before + 2);

  // Klick in der Seitenleiste öffnet im aktuellen Reiter (Name mit Anzahl – Projekte anderer
  // Tests wie „… Inbox Zielprojekt“ stehen auch in der Seitenleiste)
  await sidebar.getByRole("link", { name: /^Inbox( \d+)?$/ }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(tabButtons(page)).toHaveCount(2);
  await expect(activeTab(page)).toHaveText("Inbox");
  await expect(tabBar(page).getByRole("button", { name: taskTitle })).toHaveCount(0);

  // ✕ am aktiven Reiter: der zuletzt benutzte (Kalender) wird aktiv
  await tabBar(page).getByRole("button", { name: "Reiter „Inbox“ schließen" }).click();
  await expect(page).toHaveURL(/\/kalender/);
  await expect(tabButtons(page)).toHaveCount(1);

  // ＋ öffnet Heute, Mittelklick schließt
  await tabBar(page).getByRole("button", { name: "Neuer Reiter" }).click();
  await expect(page).toHaveURL(/\/heute$/);
  await expect(tabButtons(page)).toHaveCount(2);
  await tabBar(page)
    .getByRole("button", { name: "Heute", exact: true })
    .click({ button: "middle" });
  await expect(tabButtons(page)).toHaveCount(1);
  await expect(page).toHaveURL(/\/kalender/);

  // eingeklappte Seitenleiste (⌘\) und Neuladen: die Leiste bleibt
  await page.keyboard.press("ControlOrMeta+\\");
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect(activeTab(page)).toHaveText("Kalender");
  await page.keyboard.press("ControlOrMeta+\\");
  await page.reload();
  await expect(tabButtons(page)).toHaveCount(1);
  await expect(activeTab(page)).toHaveText("Kalender");
});

test("Kürzel ⌃⌥←/→, Tippen direkt vor dem Wechsel bleibt, Umbenennen, Papierkorb, Obergrenze 8 @desktop", async ({
  page,
}) => {
  const title = uniqueName("Reiter Tippen");
  const { beruf } = await areaIds();
  const [noteId] = await seedNotes([{ title, area_id: beruf, type: "wissen" }]);
  await page.goto(`/wissen/${noteId}`);
  await expect(editor(page)).toBeVisible();
  await expect(activeTab(page)).toHaveText(title);

  // ＋ = Heute, ⌃⌥← zurück zur Notiz (im Kreis)
  await tabBar(page).getByRole("button", { name: "Neuer Reiter" }).click();
  await expect(page).toHaveURL(/\/heute$/);
  await page.keyboard.press("Control+Alt+ArrowLeft");
  await expect(page).toHaveURL(new RegExp(`/wissen/${noteId}$`));

  // Umbenennen: der Reiter zeigt den neuen Titel sofort
  const renamed = `${title} neu`;
  await page.getByRole("textbox", { name: "Titel", exact: true }).fill(renamed);
  await expect(activeTab(page)).toHaveText(renamed);

  // mitten im Tippen wechseln (Editor entprellt 400 ms) – nichts geht verloren
  await editor(page).click();
  await page.keyboard.type("Getippt vor dem Wechsel");
  await page.keyboard.press("Control+Alt+ArrowRight");
  await expect(page).toHaveURL(/\/heute$/);
  await page.keyboard.press("Control+Alt+ArrowRight");
  await expect(page).toHaveURL(new RegExp(`/wissen/${noteId}$`));
  await expect(editor(page)).toContainText("Getippt vor dem Wechsel");
  await expectSaved(page);
  await page.reload();
  await expect(editor(page)).toContainText("Getippt vor dem Wechsel");
  await expect(activeTab(page)).toHaveText(renamed);

  // Notiz liegt inzwischen im Papierkorb: der Reiter führt auf den normalen Hinweis
  await tabBar(page).getByRole("button", { name: "Heute", exact: true }).click();
  await expect(page).toHaveURL(/\/heute$/);
  const db = await seedDb();
  expect(
    (await db.from("notes").update({ deleted_at: new Date().toISOString() }).eq("id", noteId))
      .error,
  ).toBeNull();
  await page.reload();
  await tabBar(page).getByRole("button", { name: renamed, exact: true }).click();
  await expect(page.getByText("Notiz nicht gefunden")).toBeVisible();

  // Obergrenze: beim 9. Reiter weicht der am längsten unbenutzte, mit Hinweis
  for (let i = 0; i < 7; i++) {
    await tabBar(page).getByRole("button", { name: "Neuer Reiter" }).click();
  }
  await expect(tabButtons(page)).toHaveCount(8);
  await expect(page.getByText("Höchstens 8 Reiter")).toBeVisible();
  await expect(tabBar(page).getByRole("button", { name: renamed, exact: true })).toHaveCount(1);
  // acht Reiter laufen auch am kleinsten Desktop nicht über
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(tabButtons(page)).toHaveCount(8);
  await expectNoHorizontalOverflow(page);
});

test("Rechtsklick „In neuem Reiter öffnen“, ⌘K und Legende kennen die Reiter @desktop", async ({
  page,
}) => {
  const title = uniqueName("Reiter Menü");
  const { beruf } = await areaIds();
  const [noteId] = await seedNotes([{ title, area_id: beruf, type: "idee" }]);
  await page.goto("/notizen");
  await page.getByRole("textbox", { name: /durchsuchen/ }).fill(title);
  await page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(title) })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "In neuem Reiter öffnen" }).click();
  await expect(page).toHaveURL(new RegExp(`/wissen/${noteId}$`));
  await expect(tabButtons(page)).toHaveCount(2);
  await expect(activeTab(page)).toHaveText(title);

  // ⌘K: „Nächster Reiter“ (im Kreis zurück zur Notizen-Datenbank)
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Nächster Reiter");
  await page.getByRole("option", { name: "Nächster Reiter ⌃⌥→" }).click();
  await expect(page).toHaveURL(/\/notizen/);

  // Legende: Gruppe „Reiter“
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Legende");
  await page.getByRole("option", { name: "Legende: Farben und Symbole" }).click();
  const legend = page.getByRole("dialog", { name: "Legende" });
  await expect(legend.getByRole("region", { name: "Reiter" })).toContainText("Mittelklick");
});

test("zwei Fenster: jedes behält seine Reiter, kein Flackern; öffentliche Seiten ohne Leiste @desktop", async ({
  page,
  context,
}) => {
  await page.goto("/heute");
  await expect(tabButtons(page)).toHaveCount(1);
  await page
    .getByRole("complementary", { name: "Seitenleiste" })
    .getByRole("link", { name: "Kalender" })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(tabButtons(page)).toHaveCount(2);

  // zweites Fenster derselben App: startet mit dem letzten Stand und hängt seine Adresse an
  const other = await context.newPage();
  await other.goto("/inbox");
  await expect(tabButtons(other)).toHaveCount(3);
  await tabBar(other).getByRole("button", { name: "Reiter „Heute“ schließen" }).click();
  await tabBar(other).getByRole("button", { name: "Reiter „Kalender“ schließen" }).click();
  await expect(tabButtons(other)).toHaveCount(1);

  // das erste Fenster übernimmt das nicht (auch nicht nach dem Neuladen)
  await expect(tabButtons(page)).toHaveCount(2);
  await page.reload();
  await expect(tabButtons(page)).toHaveCount(2);
  await expect(activeTab(page)).toHaveText("Kalender");
  await other.close();

  await page.goto("/datenschutz");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(tabBar(page)).toHaveCount(0);
});

test("Handy: Zähler oben, Liste der offenen Seiten – wechseln, schließen, neu @mobile", async ({
  page,
}) => {
  const title = uniqueName("Reiter Handy");
  const noteId = await seedLongNote(title);
  await page.goto(`/wissen/${noteId}`);
  await expect(editor(page)).toContainText("Zeile 70");
  await expect(tabBar(page)).toBeHidden();
  // am Handy scrollt das Fenster: Stelle merken
  const before = await page.evaluate(() => {
    window.scrollTo(0, 900);
    return window.scrollY;
  });
  expect(before).toBeGreaterThan(300);

  const counter = page.getByRole("button", { name: "Offene Reiter (1)" });
  await expect(counter).toBeVisible();
  expect((await counter.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await counter.click();
  const sheet = page.getByRole("dialog", { name: "Offene Reiter" });
  await expect(sheet.getByRole("button", { name: title, exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Neuer Reiter" }).click();
  await expect(page).toHaveURL(/\/heute$/);

  await page.getByRole("button", { name: "Offene Reiter (2)" }).click();
  await expect(sheet).toBeVisible();
  const row = sheet.getByRole("button", { name: title, exact: true });
  expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/wissen/${noteId}$`));
  await expect(sheet).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(before - 2);

  await page.getByRole("button", { name: "Offene Reiter (2)" }).click();
  await sheet.getByRole("button", { name: "Reiter „Heute“ schließen" }).click();
  await expect(sheet.getByRole("listitem")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Offene Reiter (1)" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
