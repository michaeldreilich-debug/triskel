/**
 * Rückmeldungen #73 (Gruppen der Datenbank-Ansicht zuklappen), #74 (aktive Projekte oben) und
 * #79/#81 (Aufgaben- und Notizen-Übersicht: Projekte immer zu, ohne Projekt oben) gegen das
 * Testprojekt, Desktop 1440 px und Mobil 390 px. Jeder Test legt eigene Daten an.
 */
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedNotes, seedProject, seedTasks } from "./support/seed";

test.use({ storageState: AUTH_FILE });

test("Aufgaben-Übersicht: Projekte beim Öffnen immer zu, „Ohne Projekt“ oben und offen (#79)", async ({
  page,
}) => {
  const prefix = uniqueName("Klappen");
  const { beruf } = await areaIds();
  const projectTitle = `${prefix} Projekt`;
  const projectId = await seedProject({ title: projectTitle, area_id: beruf, status: "aktiv" });
  await seedTasks([
    { title: `${prefix} eins`, area_id: beruf, project_id: projectId },
    { title: `${prefix} zwei`, area_id: beruf, project_id: projectId },
    { title: `${prefix} lose`, area_id: beruf },
  ]);

  // Standard: Liste nach Projekt gruppiert, „Ohne Projekt“ als erste Gruppe offen, Projekte zu
  await page.goto("/aufgaben");
  const groups = page.getByRole("region", { name: /\(\d+\)$/ });
  await expect(groups.first()).toHaveAccessibleName(/^Ohne Projekt \(\d+\)$/);
  const loose = page.getByRole("region", { name: /^Ohne Projekt \(/ });
  await expect(loose).toContainText(`${prefix} lose`);
  await expect(loose.getByRole("heading", { level: 2 }).getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const group = page.getByRole("region", { name: new RegExp(`^${projectTitle} \\(2\\)`) });
  const fold = group.getByRole("heading", { level: 2 }).getByRole("button");
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(group).not.toContainText(`${prefix} eins`);
  // der Pfeil ins Projekt bleibt im Kopf
  await expect(group.getByRole("link", { name: `Projekt „${projectTitle}“ öffnen` })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // aufklappen gilt bis zum Verlassen – nach dem Neuladen ist das Projekt wieder zu
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(group).toContainText(`${prefix} eins`);
  await page.reload();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(group).not.toContainText(`${prefix} eins`);

  // in der Tabelle ebenso
  await page.getByRole("radio", { name: "Tabelle" }).click();
  const table = page.getByRole("table");
  const tableFold = table
    .getByRole("columnheader", { name: new RegExp(`^${projectTitle}`) })
    .getByRole("button");
  await expect(tableFold).toHaveAttribute("aria-expanded", "false");
  await expect(table).not.toContainText(`${prefix} eins`);

  // beim Suchen ist alles offen
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill(prefix);
  await expect(table).toContainText(`${prefix} eins`);
  await expect(tableFold).toBeDisabled();
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill("");
  await expect(table).not.toContainText(`${prefix} eins`);

  // aufklappen
  await tableFold.click();
  await expect(tableFold).toHaveAttribute("aria-expanded", "true");
  await expect(table).toContainText(`${prefix} zwei`);
});

test("Notizen-Übersicht: Projekte beim Öffnen immer zu, „Ohne Projekt“ oben und offen (#81)", async ({
  page,
}) => {
  const prefix = uniqueName("Klappen");
  const { beruf } = await areaIds();
  const projectTitle = `${prefix} Projekt`;
  const projectId = await seedProject({ title: projectTitle, area_id: beruf, status: "aktiv" });
  await seedNotes([
    { title: `${prefix} Notiz eins`, area_id: beruf, project_id: projectId },
    { title: `${prefix} Notiz zwei`, area_id: beruf, project_id: projectId },
    { title: `${prefix} Notiz lose`, area_id: beruf },
  ]);

  // Standard: Liste nach Projekt gruppiert, „Ohne Projekt“ als erste Gruppe offen, Projekte zu
  await page.goto("/notizen");
  const groups = page.getByRole("region", { name: /\(\d+\)$/ });
  await expect(groups.first()).toHaveAccessibleName(/^Ohne Projekt \(\d+\)$/);
  const loose = page.getByRole("region", { name: /^Ohne Projekt \(/ });
  await expect(loose).toContainText(`${prefix} Notiz lose`);
  await expect(loose.getByRole("heading", { level: 2 }).getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const group = page.getByRole("region", { name: new RegExp(`^${projectTitle} \\(2\\)`) });
  const fold = group.getByRole("heading", { level: 2 }).getByRole("button");
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(group).not.toContainText(`${prefix} Notiz eins`);
  await expect(group.getByRole("link", { name: `Projekt „${projectTitle}“ öffnen` })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // aufklappen gilt bis zum Verlassen – nach dem Neuladen ist das Projekt wieder zu
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(group).toContainText(`${prefix} Notiz eins`);
  await page.reload();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(group).not.toContainText(`${prefix} Notiz eins`);
});

test("Projekt-Gruppen nach Status lassen sich zuklappen, das Gerät merkt es sich (#73)", async ({
  page,
}) => {
  const prefix = uniqueName("Klappen");
  const { beruf } = await areaIds();
  const projectTitle = `${prefix} pausiert`;
  await seedProject({ title: projectTitle, area_id: beruf, status: "pausiert" });

  // Projekte: alle Gruppen offen, bis der Nutzer eine zuklappt
  await page.goto("/projekte");
  const group = page.getByRole("region", { name: /^Pausiert \(\d+\)$/ });
  const fold = group.getByRole("heading", { level: 2 }).getByRole("button");
  await expect(group).toContainText(projectTitle);
  await expect(fold).toHaveAttribute("aria-expanded", "true");

  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(group).not.toContainText(projectTitle);

  // bleibt nach dem Neuladen zu
  await page.reload();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(group).not.toContainText(projectTitle);
  await expectNoHorizontalOverflow(page);
});

test("Projekte: aktive stehen in der Liste oben (#74)", async ({ page }) => {
  const prefix = uniqueName("Reihenfolge");
  const { beruf } = await areaIds();
  for (const status of ["idee", "geplant", "aktiv", "pausiert"] as const) {
    await seedProject({ title: `${prefix} ${status}`, area_id: beruf, status });
  }

  await page.goto("/projekte");
  await page.getByRole("textbox", { name: "Projekte durchsuchen" }).fill(prefix);
  const groups = page.getByRole("region", { name: /^(Idee|Geplant|Aktiv|Pausiert) \(1\)$/ });
  await expect(groups).toHaveCount(4);
  const names = await groups.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(names).toEqual(["Aktiv (1)", "Geplant (1)", "Pausiert (1)", "Idee (1)"]);
  await expectNoHorizontalOverflow(page);
});
