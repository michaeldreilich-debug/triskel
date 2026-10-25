/**
 * Projekte (B7) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px: Steckbrief mit
 * Ergebnis, nächstem Schritt und Meilensteinen; Fortschritt = erledigte ÷ alle Aufgaben;
 * Hinweise „festgefahren“, „> 3 aktive je Bereich“ und „14 Tage still“ (gemockte Uhr);
 * Abschluss-Ritual speichert 3 Antworten und archiviert.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedProject, seedTasks } from "./support/seed";
import { freshContext } from "./support/session";
import { closePanel, showProperties as showTaskProperties, taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const hints = (page: Page) => page.getByRole("list", { name: "Hinweise" });

/** Handy: Eigenschaften im Steckbrief sind zugeklappt – aufklappen. */
async function showProperties(page: Page) {
  await expect(page.getByRole("textbox", { name: "Projekttitel" })).toBeVisible();
  const toggle = page
    .getByRole("complementary", { name: "Steckbrief" })
    .getByRole("button", { name: /^Eigenschaften/ });
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
}
const progress = (page: Page) => page.getByTestId("project-progress");

test("Projekt anlegen: festgefahren bis Ergebnis und nächster Schritt da sind; bleibt nach Reload", async ({
  page,
}) => {
  const title = uniqueName("Werkstatt digitalisieren");
  const nextStep = uniqueName("Datenschutzfrage klären");
  await page.goto("/projekte");
  await page.getByRole("button", { name: "Neues Projekt" }).click();
  await expect(page).toHaveURL(/\/projekte\/[0-9a-f-]{36}$/);
  await page.getByRole("textbox", { name: "Projekttitel" }).fill(title);
  await showProperties(page);
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Aktiv" }).click();
  await expect(hints(page)).toContainText("kein Ergebnis");
  await expect(hints(page)).toContainText("kein offener nächster Schritt");

  // Ergebnis-Checkliste
  await page.getByRole("button", { name: "Punkt hinzufügen", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Ergebnis 1" })).toBeFocused();
  await page.keyboard.type("Anmeldung läuft digital");
  await expect(hints(page)).not.toContainText("kein Ergebnis");

  // nächster Schritt: neue Aufgabe direkt aus der Auswahl
  await page.getByRole("button", { name: "Nächsten Schritt festlegen" }).click();
  await page.getByRole("combobox", { name: "Aufgabe des Projekts suchen" }).fill(nextStep);
  await page.getByRole("option", { name: `Neue Aufgabe „${nextStep}“` }).click();
  const box = page.getByRole("region", { name: "Nächster Schritt" });
  await expect(box.getByRole("link", { name: nextStep })).toBeVisible();
  // (der Hinweis „> 3 aktive“ kann durch parallele Tests im selben Bereich erscheinen)
  await expect(page.getByText(/^Festgefahren/)).toHaveCount(0);

  // Meilenstein
  await page.getByRole("textbox", { name: "Neuer Meilenstein" }).fill("MVP lokal");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Meilenstein", exact: true })).toHaveValue(
    "MVP lokal",
  );
  await page.getByRole("checkbox", { name: "Meilenstein „MVP lokal“ erreicht" }).click();
  await expectSaved(page);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Projekttitel" })).toHaveValue(title);
  await showProperties(page);
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toContainText("Aktiv");
  await expect(page.getByRole("textbox", { name: "Ergebnis 1" })).toHaveValue(
    "Anmeldung läuft digital",
  );
  await expect(page.getByRole("region", { name: "Nächster Schritt" })).toContainText(nextStep);
  await expect(
    page.getByRole("checkbox", { name: "Meilenstein „MVP lokal“ erreicht" }),
  ).toBeChecked();
  await expect(page.getByText(/^Festgefahren/)).toHaveCount(0);
  await expect(progress(page)).toContainText("0 %");
});

test("Fortschritt = erledigte ÷ alle Aufgaben (Aufgaben-Reiter)", async ({ page }) => {
  const prefix = uniqueName("Fortschritt");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "geplant",
  });
  await seedTasks([
    { title: `${prefix} eins`, area_id: beruf, project_id: project, status: "erledigt" },
    { title: `${prefix} zwei`, area_id: beruf, project_id: project },
    { title: `${prefix} drei`, area_id: beruf, project_id: project },
  ]);
  await page.goto(`/projekte/${project}`);
  await expect(progress(page)).toContainText("33 %");
  await expect(progress(page)).toContainText("1 von 3");

  await page.getByRole("tab", { name: /^Aufgaben/ }).click();
  await expect(page).toHaveURL(/reiter=aufgaben/);
  const add = page.getByRole("textbox", { name: "Neue Aufgabe im Projekt" });
  await add.fill(`${prefix} vier`);
  await add.press("Enter");
  // #75: Enter öffnet die neue Aufgabe
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} vier`,
  );
  await closePanel(page);
  await expect(progress(page)).toContainText("25 %");
  await page.getByRole("checkbox", { name: `„${prefix} zwei“ erledigt` }).click();
  await expect(progress(page)).toContainText("50 %");
  await expectSaved(page);
  await page.reload();
  await expect(progress(page)).toContainText("50 %");
  await expect(progress(page)).toContainText("2 von 4");
});

test("Mehr als 3 aktive Projekte im Bereich: Hinweis auf Projektseite und in der Liste", async ({
  page,
}) => {
  const prefix = uniqueName("Viele");
  const { privat } = await areaIds();
  const ids: string[] = [];
  for (const n of [1, 2, 3, 4]) {
    ids.push(await seedProject({ title: `${prefix} ${n}`, area_id: privat, status: "aktiv" }));
  }
  await page.goto(`/projekte/${ids[0]}`);
  await expect(hints(page)).toContainText(
    /\d+ aktive Projekte in Privat – Fokus-Regel: höchstens 3/,
  );
  await page.goto("/projekte");
  await expect(
    page.getByRole("status").filter({ hasText: /^Privat: \d+ aktive Projekte/ }),
  ).toBeVisible();
});

test("„14 Tage still“ erscheint mit gemockter Uhr 15 Tage später", async ({
  page,
  browser,
  baseURL,
}) => {
  const prefix = uniqueName("Still");
  const { beruf } = await areaIds();
  const [next] = await seedTasks([{ title: `${prefix} Schritt`, area_id: beruf }]);
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "aktiv",
    outcome: [{ id: "1", text: "Fertig", done: false }],
    next_task_id: next,
  });
  await page.goto(`/projekte/${project}`);
  await expect(page.getByRole("textbox", { name: "Projekttitel" })).toHaveValue(
    `${prefix} Projekt`,
  );
  await expect(page.getByText(/^14 Tage still/)).toHaveCount(0);
  await expect(page.getByText(/^Festgefahren/)).toHaveCount(0);

  // eigene Sitzung: Der Browser hält das Token in 15 Tagen für abgelaufen und erneuert es
  const later15 = new Date(Date.now() + 15 * 86_400_000);
  const context = await freshContext(browser, baseURL as string, {
    viewport: page.viewportSize() ?? undefined,
    hasTouch: isNarrow(page),
    clockUntil: later15,
  });
  try {
    const later = await context.newPage();
    await later.clock.setFixedTime(later15);
    await later.goto(`/projekte/${project}`);
    await expect(later.getByRole("list", { name: "Hinweise" })).toContainText("14 Tage still");
    await expect(later.getByRole("list", { name: "Hinweise" })).not.toContainText("Festgefahren");
  } finally {
    await context.close();
  }
});

test("Abschluss-Ritual speichert 3 Antworten und archiviert", async ({ page }) => {
  const prefix = uniqueName("Abschluss");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "aktiv",
  });
  await page.goto(`/projekte/${project}?reiter=abschluss`);
  const close = page.getByRole("button", { name: "Abschließen und archivieren" });
  await expect(close).toBeDisabled();
  await page.getByRole("textbox", { name: "Was hat geklappt?" }).fill("Kleine Schritte");
  await page.getByRole("textbox", { name: "Was nehme ich mit?" }).fill("Früher testen");
  await expect(close).toBeDisabled();
  await page.getByRole("textbox", { name: "Was blieb offen?" }).fill("Druckvorlagen");
  await close.click();
  await expect(page.getByText("Abgeschlossen und archiviert")).toBeVisible();
  await showProperties(page);
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toContainText("Archiv");
  await expectSaved(page);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Was hat geklappt?" })).toHaveValue(
    "Kleine Schritte",
  );
  await expect(page.getByRole("textbox", { name: "Was nehme ich mit?" })).toHaveValue(
    "Früher testen",
  );
  await expect(page.getByRole("textbox", { name: "Was blieb offen?" })).toHaveValue(
    "Druckvorlagen",
  );
  await showProperties(page);
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toContainText("Archiv");
  if (!isNarrow(page)) {
    // nicht mehr unter „Aktive Projekte“ (unter „Zuletzt bearbeitet“ darf es stehen, #30)
    await expect(
      page
        .getByRole("complementary", { name: "Seitenleiste" })
        .getByRole("group", { name: /^Aktive Projekte/ })
        .getByRole("link", { name: `${prefix} Projekt` }),
    ).toHaveCount(0);
  }
});

test("Notiz und Aufgabe zeigen ihr Projekt, auch archiviert, und öffnen es (#26)", async ({
  page,
}) => {
  const prefix = uniqueName("Zuordnung");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Altprojekt`,
    area_id: beruf,
    status: "archiv",
  });
  const db = await seedDb();
  const note = await db
    .from("notes")
    .insert({ title: `${prefix} Notiz`, area_id: beruf, project_id: project })
    .select("id")
    .single();
  expect(note.error).toBeNull();
  const [task] = await seedTasks([
    { title: `${prefix} Aufgabe`, area_id: beruf, project_id: project },
  ]);

  await page.goto(`/wissen/${note.data?.id}`);
  const projectField = page.getByRole("button", { name: "Projekt", exact: true });
  await expect(projectField).toContainText(`${prefix} Altprojekt`);
  await expect(page.getByTestId("project-closed")).toHaveText("Archiv");
  await page.getByRole("link", { name: `Projekt „${prefix} Altprojekt“ öffnen` }).click();
  await expect(page).toHaveURL(new RegExp(`/projekte/${project}`));
  await expect(page.getByRole("textbox", { name: "Projekttitel" })).toHaveValue(
    `${prefix} Altprojekt`,
  );

  await page.goto(`/aufgaben?aufgabe=${task}`);
  const panel = taskPanel(page);
  await showTaskProperties(panel);
  await expect(panel.getByRole("button", { name: "Projekt", exact: true })).toContainText(
    `${prefix} Altprojekt`,
  );
  await panel.getByRole("link", { name: `Projekt „${prefix} Altprojekt“ öffnen` }).click();
  await expect(page).toHaveURL(new RegExp(`/projekte/${project}`));
});

test("Meilensteine als nummerierter Fahrplan: Reihenfolge, Aufgaben im Meilenstein, erreicht mit der letzten Aufgabe (#60); kein Budget (Wert bleibt in der DB)", async ({
  page,
}) => {
  const prefix = uniqueName("Fahrplan");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "geplant",
    time_budget_weeks: 6,
  });
  await page.goto(`/projekte/${project}`);
  await expect(page.getByRole("textbox", { name: "Projekttitel" })).toHaveValue(
    `${prefix} Projekt`,
  );
  await showProperties(page);
  await expect(page.getByText("Budget", { exact: true })).toHaveCount(0);

  const add = page.getByRole("textbox", { name: "Neuer Meilenstein" });
  for (const name of ["Konzept", "Umsetzung", "Abnahme"]) {
    await add.fill(name);
    await add.press("Enter");
  }
  const plan = page.getByRole("list", { name: "Meilensteine" });
  const titles = plan.getByRole("textbox", { name: "Meilenstein", exact: true });
  await expect(titles).toHaveCount(3);
  await expect(plan.locator(":scope > li").nth(2)).toContainText("3");

  // „Abnahme“ eins nach oben
  await page.getByRole("button", { name: "Meilenstein „Abnahme“: Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Nach oben" }).click();
  await expect(titles.nth(1)).toHaveValue("Abnahme");
  await expect(titles.nth(2)).toHaveValue("Umsetzung");

  // Aufgabe direkt im Meilenstein anlegen und erledigen
  const task = `${prefix} Prototyp`;
  const newTask = page.getByRole("textbox", { name: "Neue Aufgabe in „Umsetzung“" });
  await newTask.fill(task);
  await newTask.press("Enter");
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    task,
  );
  await closePanel(page);
  const open = page.getByRole("list", { name: "Offene Aufgaben in „Umsetzung“" });
  await expect(open.getByRole("link", { name: task })).toBeVisible();
  const umsetzung = plan.locator(":scope > li").nth(2);
  await expect(umsetzung).toContainText("0 von 1 Aufgabe erledigt");
  await open.getByRole("checkbox", { name: `„${task}“ erledigt` }).click();
  await expect(umsetzung).toContainText("1 von 1 Aufgabe erledigt");
  // #60: letzte Aufgabe erledigt → Meilenstein erreicht (Meldung nennt ihn); Rückgängig öffnet beides
  const umsetzungCheck = plan.getByRole("checkbox", { name: "Meilenstein „Umsetzung“ erreicht" });
  await expect(umsetzungCheck).toBeChecked();
  await expect(
    page.getByText(`„${task}“ erledigt · Meilenstein „Umsetzung“ erreicht`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(umsetzungCheck).not.toBeChecked();
  await expect(umsetzung).toContainText("0 von 1 Aufgabe erledigt");
  await open.getByRole("checkbox", { name: `„${task}“ erledigt` }).click();
  await expect(umsetzungCheck).toBeChecked();
  await page.getByRole("checkbox", { name: "Meilenstein „Konzept“ erreicht" }).click();
  await expect(
    plan.getByRole("checkbox", { name: "Meilenstein „Konzept“ erreicht" }),
  ).toBeChecked();
  await expect(progress(page)).toContainText("100 %");
  await expectSaved(page);

  await page.reload();
  await expect(titles).toHaveCount(3);
  await expect(titles.nth(0)).toHaveValue("Konzept");
  await expect(titles.nth(1)).toHaveValue("Abnahme");
  await expect(titles.nth(2)).toHaveValue("Umsetzung");
  await expect(plan.locator(":scope > li").nth(2)).toContainText("1 von 1 Aufgabe erledigt");
  // gespeichert hat es der Trigger (Migration 35): Umsetzung erreicht, Konzept von Hand
  await expect(umsetzungCheck).toBeChecked();
  await expect(page.getByText("2 von 3 erreicht")).toBeVisible();
});

test("Handy: Steckbrief schlank, Eigenschaften zum Aufklappen @mobile", async ({ page }) => {
  const prefix = uniqueName("Schlank");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "aktiv",
    priority: 1,
    target_date: "2027-03-01",
  });
  await page.goto(`/projekte/${project}`);
  const toggle = page.getByRole("button", { name: /^Eigenschaften/ });
  await expect(toggle).toContainText("Beruf · Aktiv · Hoch · Ziel 01.03.2027");
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toBeHidden();
  // die Reiter kommen ohne Scrollen in Sicht
  await expect(page.getByRole("tab", { name: "Übersicht" })).toBeInViewport();
  await toggle.click();
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toBeVisible();
  // Ergebnis und Warum stehen am Handy in der Übersicht
  await expect(
    page.getByRole("tabpanel", { name: "Übersicht" }).getByText("Fertig ist es, wenn …"),
  ).toBeVisible();
});

test("Projektseite: kein horizontales Scrollen, keine a11y-Verstöße (alle Reiter)", async ({
  page,
}) => {
  const prefix = uniqueName("Barrierefrei");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "aktiv",
    outcome: [{ id: "1", text: "Erreicht", done: true }],
  });
  await seedTasks([
    { title: `${prefix} Aufgabe`, area_id: beruf, project_id: project, priority: 1 },
  ]);
  for (const tab of ["", "?reiter=aufgaben", "?reiter=notizen", "?reiter=abschluss"]) {
    await page.goto(`/projekte/${project}${tab}`);
    await expect(page.getByRole("textbox", { name: "Projekttitel" })).toHaveValue(
      `${prefix} Projekt`,
    );
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(300);
    await expectNoA11yViolations(page);
  }
});
