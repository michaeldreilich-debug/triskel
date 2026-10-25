/**
 * Nachtlauf J – Oberfläche Teil 1 (Rückmeldungen #35, #41–#43, #45, #47, Links-Feld) gegen das
 * Testprojekt, Desktop 1440 px und Mobil 390 px. Jeder Test legt eigene Daten mit E2E-Präfix an.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectSaved, openNavigation } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { createTask } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

async function newNote(page: Page, title: string) {
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await page.getByRole("textbox", { name: "Titel", exact: true }).fill(title);
}

async function newProject(page: Page, title: string) {
  await page.goto("/projekte");
  await page.getByRole("button", { name: "Neues Projekt" }).click();
  await expect(page).toHaveURL(/\/projekte\/[0-9a-f-]{36}$/);
  await page.getByRole("textbox", { name: "Projekttitel" }).fill(title);
}

test("Zuletzt geändert steht leise unter dem Titel von Notiz, Aufgabe und Projekt (#41)", async ({
  page,
}) => {
  await newNote(page, uniqueName("Geändert-Notiz"));
  await expect(
    page.getByRole("main").getByText(/^Zuletzt geändert heute um \d\d:\d\d$/),
  ).toBeVisible();
  await expectSaved(page);
  await page.reload();
  await expect(
    page.getByRole("main").getByText(/^Zuletzt geändert heute um \d\d:\d\d$/),
  ).toBeVisible();

  const panel = await createTask(page, uniqueName("Geändert-Aufgabe"));
  await expect(panel.getByText(/^Zuletzt geändert heute um \d\d:\d\d$/)).toBeVisible();

  await newProject(page, uniqueName("Geändert-Projekt"));
  await expect(
    page.getByRole("complementary", { name: "Steckbrief" }).getByText(/^Zuletzt geändert heute/),
  ).toBeVisible();
});

test("Checkliste einer Aufgabe: Balken in der Aufgabe, „2/3“ in der Liste (#42)", async ({
  page,
}) => {
  const title = uniqueName("Checkliste");
  const panel = await createTask(page, title);
  const progress = panel.getByRole("region", { name: "Checkliste" });
  await expect(progress).toHaveCount(0);
  await panel.getByRole("button", { name: "Checklisten-Punkt hinzufügen" }).click();
  await page.keyboard.type("Atemschutz prüfen");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Masken zählen");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Liste abgeben");
  await expect(progress.getByTestId("checklist-progress")).toHaveText("0 von 3");
  await panel.getByRole("checkbox", { name: "Punkt „Atemschutz prüfen“ offen" }).click();
  await panel.getByRole("checkbox", { name: "Punkt „Masken zählen“ offen" }).click();
  await expect(progress.getByTestId("checklist-progress")).toHaveText("2 von 3");
  await expect(progress.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
  await expectSaved(page);

  // in der Liste: „2/3“ (Screenreader: „Checkliste: 2/3 erledigt“)
  await panel.getByRole("button", { name: "Aufgabe schließen" }).click();
  const row = page
    .locator("[data-task-id]")
    .filter({ has: page.getByRole("link", { name: title }) });
  await expect(row).toContainText("2/3");
  await expect(row.getByTitle("Checkliste: 2 von 3 erledigt")).toBeVisible();
});

test("Rahmen in der Bereichsfarbe, solange nicht „Alles“ gewählt ist (#45)", async ({ page }) => {
  // Bereich nicht in user_settings speichern (gemeinsamer Testnutzer, andere Tests laufen parallel)
  await page.route("**/rest/v1/user_settings?*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/heute");
  const frame = page.getByTestId("area-frame");
  let nav = await openNavigation(page);
  await nav.getByRole("radio", { name: "Alles" }).click();
  await expect(frame).toHaveCount(0);
  await nav.getByRole("radio", { name: "Beruf" }).click();
  await expect(frame).toHaveAttribute("data-area", "orange");
  const border = await frame.evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(border).toBe("1px");
  await nav.getByRole("radio", { name: "Privat" }).click();
  await expect(frame).toHaveAttribute("data-area", "blue");
  // nur der Rahmen: kein Text-Hinweis, Klicks gehen durch
  await expect(frame).toHaveText("");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(frame).toHaveAttribute("data-area", "blue");
  nav = await openNavigation(page);
  await nav.getByRole("radio", { name: "Alles" }).click();
  await expect(frame).toHaveCount(0);
});

test("Rechtsklick auf Notizen: Liste, Tabelle und Wissen – Typ, Bereich, Papierkorb (#35) @desktop", async ({
  page,
}) => {
  const title = uniqueName("Rechtsklick-Notiz");
  await newNote(page, title);
  await expectSaved(page);
  const menu = page.getByRole("menu", { name: `Notiz „${title}“` });

  // Notizen-Datenbank, Liste
  await page.goto("/notizen");
  await page.getByRole("radio", { name: "Liste" }).click();
  const link = page.getByRole("main").getByRole("link", { name: new RegExp(title) });
  await link.click({ button: "right" });
  // #88: „Öffnen“ zeigt die Notiz als Panel, „Im Wissen öffnen“ ganz
  await expect(menu.getByRole("menuitem", { name: "Öffnen", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Im Wissen öffnen" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Typ" }).hover();
  await page.getByRole("menuitemradio", { name: "Protokoll" }).click();
  await expect(link).toContainText("Protokoll");

  // Tabelle: Bereich wechseln
  await page.getByRole("radio", { name: "Tabelle" }).click();
  const row = page.getByRole("row").filter({ hasText: title });
  await row.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Bereich" }).hover();
  await page.getByRole("menuitemradio", { name: "Privat" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  // (die Tabelle zeigt den Bereich nicht als Spalte): im Menü steht jetzt Privat
  await row.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Bereich" }).hover();
  await expect(page.getByRole("menuitemradio", { name: "Privat" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Liste" }).click();

  // Wissen: Papierkorb mit Rückgängig (#56: ein Protokoll ohne Projekt steht unter „Noch einordnen“)
  await page.goto("/wissen?einordnen=1");
  await page
    .getByRole("list", { name: "Notizen" })
    .getByRole("link", { name: new RegExp(title) })
    .click({ button: "right" });
  await menu.getByRole("menuitem", { name: "In den Papierkorb" }).click();
  await expect(page.getByText(`„${title}“ liegt im Papierkorb`)).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Notizen" }).getByRole("link", { name: new RegExp(title) }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(
    page.getByRole("list", { name: "Notizen" }).getByRole("link", { name: new RegExp(title) }),
  ).toBeVisible();
});

test("Links im Steckbrief: anlegen, öffnen im neuen Tab, bearbeiten, entfernen mit Rückgängig", async ({
  page,
}) => {
  await newProject(page, uniqueName("Links-Projekt"));
  const links = page.getByRole("region", { name: "Links" });
  await links.getByRole("button", { name: "Link hinzufügen" }).click();
  const form = links.getByRole("form", { name: "Neuer Link" });
  await expect(form.getByRole("textbox", { name: "Name" })).toBeFocused();
  await form.getByRole("textbox", { name: "Name" }).fill("Elster");
  // nur Web- und E-Mail-Adressen
  await form.getByRole("textbox", { name: "Adresse" }).fill("javascript:alert(1)");
  await form.getByRole("textbox", { name: "Adresse" }).press("Enter");
  await expect(form.getByText("Bitte eine Web- oder E-Mail-Adresse eingeben.")).toBeVisible();
  await form.getByRole("textbox", { name: "Adresse" }).fill("elster.de");
  await form.getByRole("textbox", { name: "Adresse" }).press("Enter");
  const link = links.getByRole("link", { name: /Elster/ });
  await expect(link).toHaveAttribute("href", "https://elster.de/");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");

  // zweiter Link ohne Namen: zeigt die Kurzform der Adresse
  await links.getByRole("button", { name: "Link hinzufügen" }).click();
  await links.getByRole("textbox", { name: "Adresse" }).fill("https://www.notion.so/Steuer");
  await links.getByRole("button", { name: "Speichern" }).click();
  await expect(links.getByRole("link", { name: "notion.so" })).toBeVisible();

  // bearbeiten
  await links.getByRole("button", { name: "Link „Elster“ bearbeiten" }).click();
  await links.getByRole("textbox", { name: "Name" }).fill("Elster-Portal");
  await links.getByRole("button", { name: "Speichern" }).click();
  await expect(links.getByRole("link", { name: /Elster-Portal/ })).toBeVisible();
  await expectSaved(page);
  await page.reload();
  await expect(links.getByRole("link", { name: /Elster-Portal/ })).toBeVisible();

  // entfernen mit Rückgängig
  await links.getByRole("button", { name: "Link „notion.so“ entfernen" }).click();
  await expect(links.getByRole("link", { name: "notion.so" })).toHaveCount(0);
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(links.getByRole("link", { name: "notion.so" })).toBeVisible();
});

test("Steckbrief-Spalte breiter und schmaler ziehen, Breite bleibt je Gerät (#43) @desktop", async ({
  page,
}) => {
  await newProject(page, uniqueName("Breite-Projekt"));
  const aside = page.getByRole("complementary", { name: "Steckbrief" });
  const handle = page.getByRole("separator", { name: "Breite des Steckbriefs" });
  const width = async () => Math.round((await aside.boundingBox())?.width ?? 0);
  await handle.dblclick();
  await expect.poll(width).toBe(344);

  const box = await handle.boundingBox();
  if (!box) throw new Error("Griff nicht gefunden");
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(width).toBe(464);
  await expect(handle).toHaveAttribute("aria-valuenow", "464");

  await page.reload();
  await expect.poll(width).toBe(464);

  // Tastatur: Pfeil links 16 px schmaler, Grenzen 280–640
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(width).toBe(448);
  await page.keyboard.press("Home");
  await expect.poll(width).toBe(280);
  await page.keyboard.press("End");
  await expect.poll(width).toBe(640);
  await page.keyboard.press("Enter");
  await expect.poll(width).toBe(344);
});

test("Handy: kein Griff, Steckbrief über die ganze Breite (#43) @mobile", async ({ page }) => {
  await newProject(page, uniqueName("Breite-Handy"));
  await expect(page.getByRole("separator", { name: "Breite des Steckbriefs" })).toBeHidden();
  const box = await page.getByRole("complementary", { name: "Steckbrief" }).boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(390);
});

test("Link kopieren an Notiz, Aufgabe und Projekt – die volle Adresse für die KI (#47) @desktop", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  await newNote(page, uniqueName("Link-Notiz"));
  const noteId = new URL(page.url()).pathname.split("/").pop();
  await page.getByRole("button", { name: "Notiz-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Link kopieren" }).click();
  await expect(page.getByText("Link kopiert")).toBeVisible();
  expect(await clipboard()).toBe(`${baseURL}/wissen/${noteId}`);

  const title = uniqueName("Link-Aufgabe");
  const panel = await createTask(page, title);
  const taskId = new URL(page.url()).searchParams.get("aufgabe");
  await panel.getByRole("button", { name: "Aufgaben-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Link kopieren" }).click();
  expect(await clipboard()).toBe(`${baseURL}/aufgaben?aufgabe=${taskId}`);
  // auch per Rechtsklick in der Liste
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .locator("[data-task-id]")
    .filter({ has: page.getByRole("link", { name: title }) })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Link kopieren" }).click();
  await expect.poll(clipboard).toBe(`${baseURL}/aufgaben?aufgabe=${taskId}`);

  await newProject(page, uniqueName("Link-Projekt"));
  const projectId = new URL(page.url()).pathname.split("/").pop();
  await page.getByRole("button", { name: "Projekt-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Link kopieren" }).click();
  expect(await clipboard()).toBe(`${baseURL}/projekte/${projectId}`);
});
