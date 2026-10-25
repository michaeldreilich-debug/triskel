/**
 * Rückmeldungen vom 22.10.2026 abends (#86–#88) gegen das Testprojekt, Desktop 1440 px und
 * Mobil 390 px. Jeder Test legt eigene Daten mit E2E-Präfix an.
 */
import { expect, test } from "@playwright/test";
import { expectSaved } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedNotes, seedProject, seedTasks } from "./support/seed";
import { createTask, showProperties, taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

test("Checkliste: letzter Punkt abgehakt → Aufgabe erledigt, Haken weg → wieder offen (#86)", async ({
  page,
}) => {
  const title = uniqueName("Checkliste-fertig");
  const panel = await createTask(page, title);
  await panel.getByRole("button", { name: "Checklisten-Punkt hinzufügen" }).click();
  await page.keyboard.type("Leiter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Schlauch");
  await panel.getByRole("checkbox", { name: "Punkt „Leiter“ offen" }).click();
  await showProperties(panel);
  const status = panel.getByRole("combobox", { name: "Status", exact: true });
  await expect(status).toContainText("Offen");

  await panel.getByRole("checkbox", { name: "Punkt „Schlauch“ offen" }).click();
  await expect(page.getByText(`„${title}“ erledigt · alle Punkte abgehakt`)).toBeVisible();
  await expect(status).toContainText("Erledigt");
  await expectSaved(page);

  // Haken wieder weg → offen, mit Meldung
  await panel.getByRole("checkbox", { name: "Punkt „Schlauch“ erledigt" }).click();
  await expect(page.getByText(`„${title}“ wieder offen · ein Punkt ist offen`)).toBeVisible();
  await expect(status).toContainText("Offen");
  await expectSaved(page);
  await page.reload();
  await showProperties(taskPanel(page));
  await expect(
    taskPanel(page).getByRole("combobox", { name: "Status", exact: true }),
  ).toContainText("Offen");
});

test("Notizen-Datenbank: Notiz öffnet rechts als Panel, die Liste bleibt (#88)", async ({
  page,
}, info) => {
  const title = uniqueName("Notiz-Panel");
  await page.goto("/notizen");
  await page.getByRole("button", { name: "Neue Notiz" }).click();
  if (info.project.name === "mobile") {
    // am Handy ist neben der Liste kein Platz: wie bisher im Wissen
    await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
    return;
  }
  await expect(page).toHaveURL(/\/notizen\?notiz=[0-9a-f-]{36}$/);
  const panel = page.getByRole("complementary", { name: "Notiz" });
  const titleField = panel.getByRole("textbox", { name: "Titel", exact: true });
  await titleField.fill(title);
  await expectSaved(page);
  await expect(page.getByRole("heading", { level: 1, name: "Notizen" })).toBeVisible();
  const row = page.getByRole("main").getByRole("link", { name: title });
  await expect(row).toHaveAttribute("aria-current", "true");

  // schließen (Knopf und Escape) und aus der Liste wieder öffnen
  await panel.getByRole("button", { name: "Notiz schließen" }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/notizen$/);
  await row.click();
  await expect(titleField).toHaveValue(title);
  await titleField.press("Escape");
  await expect(panel).toBeHidden();
  await row.click();
  await expect(titleField).toHaveValue(title);

  // einklappen zum Reiter, nach dem Neuladen noch da, wieder aufklappen
  await panel.getByRole("button", { name: "Notiz einklappen" }).click();
  const rail = page.getByRole("button", { name: "Notiz wieder einblenden" });
  await expect(rail).toBeVisible();
  await expect(panel).toBeHidden();
  await page.reload();
  await rail.click();
  await expect(titleField).toHaveValue(title);

  // Rechtsklick: „Öffnen“ und „Im Wissen öffnen“; der Knopf im Panel führt ins Wissen
  await row.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Im Wissen öffnen" })).toBeVisible();
  await page.keyboard.press("Escape");
  await panel.getByRole("link", { name: "Im Wissen öffnen" }).click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("main").getByRole("textbox", { name: "Titel", exact: true }),
  ).toHaveValue(title);
});

test("Tabelle: Eigenschaften direkt in der Zelle ändern – Aufgaben und Notizen (#87)", async ({
  page,
}) => {
  const prefix = uniqueName("Zelle");
  const { beruf } = await areaIds();
  await seedProject({ title: `${prefix} Projekt`, area_id: beruf, status: "aktiv" });
  await seedTasks([{ title: `${prefix} Aufgabe`, area_id: beruf }]);
  await seedNotes([{ title: `${prefix} Notiz`, area_id: beruf, type: "idee" }]);

  // Aufgaben: Status, Priorität, Fällig, Projekt
  await page.goto("/aufgaben");
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill(prefix);
  await page.getByRole("radio", { name: "Tabelle" }).click();
  const task = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: `${prefix} Aufgabe` }) });
  await task.getByRole("button", { name: "Status: Offen" }).click();
  await page.getByRole("menuitemradio", { name: "In Arbeit" }).click();
  await expect(task.getByRole("button", { name: "Status: In Arbeit" })).toBeVisible();
  await task.getByRole("button", { name: "Priorität: Keine" }).click();
  await page.getByRole("menuitemradio", { name: "Hoch" }).click();
  await expect(task.getByRole("button", { name: "Priorität: Hoch" })).toBeVisible();
  await task.getByRole("button", { name: "Fällig: kein Datum" }).click();
  await page.getByRole("button", { name: "Heute", exact: true }).click();
  await expect(task.getByRole("button", { name: /^Fällig: \d\d\.\d\d\./ })).toBeVisible();
  // U-3: ein Klick auf den schon gesetzten Tag löscht das Datum nicht
  await task.getByRole("button", { name: /^Fällig: \d\d\.\d\d\./ }).click();
  await page.locator('td[aria-selected="true"] button').first().click();
  await expect(task.getByRole("button", { name: /^Fällig: \d\d\.\d\d\./ })).toBeVisible();
  await task.getByRole("button", { name: "Projekt" }).click();
  await page.getByRole("combobox", { name: "Projekt suchen" }).fill(`${prefix} Projekt`);
  await page.getByRole("option", { name: new RegExp(`^${prefix} Projekt`) }).click();
  await expect(task.getByRole("button", { name: "Projekt" })).toContainText(`${prefix} Projekt`);
  await expectSaved(page);
  await page.reload();
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill(prefix);
  await expect(task.getByRole("button", { name: "Status: In Arbeit" })).toBeVisible();
  await expect(task.getByRole("button", { name: "Priorität: Hoch" })).toBeVisible();
  await expect(task.getByRole("button", { name: "Projekt" })).toContainText(`${prefix} Projekt`);

  // Notizen: Typ und Tags
  await page.goto("/notizen");
  await page.getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  await page.getByRole("radio", { name: "Tabelle" }).click();
  const note = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: `${prefix} Notiz` }) });
  await note.getByRole("button", { name: "Typ: Idee" }).click();
  await page.getByRole("option", { name: "Wissen", exact: true }).click();
  await expect(note.getByRole("button", { name: "Typ: Wissen" })).toBeVisible();
  await note.getByRole("button", { name: "Tags: keine" }).click();
  const tag = page.getByRole("textbox", { name: "Tag hinzufügen" });
  await tag.fill("zelle");
  await tag.press("Enter");
  await page.keyboard.press("Escape");
  await expect(note.getByRole("button", { name: "Tags: zelle" })).toContainText("#zelle");
  await expectSaved(page);
  await page.reload();
  await page.getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  await expect(note.getByRole("button", { name: "Typ: Wissen" })).toBeVisible();
  await expect(note.getByRole("button", { name: "Tags: zelle" })).toBeVisible();
});
