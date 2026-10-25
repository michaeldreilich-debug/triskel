/**
 * #77 „Zuständig: Ich / KI“, Desktop 1440 px und Mobil 390 px: Arbeitsschritte der KI stehen nur
 * dezent im Projekt (gedämpft, Kürzel „KI“); Heute und die Aufgaben-Datenbank (Standardfilter
 * „Zuständig: Ich“) zeigen sie nicht. Umstellen im Aufgaben-Panel. #78: „Alle auswählen / abwählen“.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, berlinToday, seedDb, seedProject, seedTasks } from "./support/seed";
import { chooseOption, closePanel, taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const search = (page: Page) => page.getByRole("textbox", { name: "Aufgaben durchsuchen" });

test("Zuständig KI: nur im Projekt (dezent), nicht auf Heute und nicht im Standardfilter der Datenbank", async ({
  page,
}) => {
  const prefix = uniqueName("Zust");
  const { beruf } = await areaIds();
  const today = berlinToday();
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "aktiv",
  });
  const ids = await seedTasks([
    { title: `${prefix} Meins`, area_id: beruf, project_id: project, due_date: today },
    {
      title: `${prefix} Bauschritt`,
      area_id: beruf,
      project_id: project,
      due_date: today,
      assignee: "ai",
    },
  ]);
  try {
    // Heute: nur Aufgabe des Nutzers
    await page.goto("/heute");
    const due = page.getByRole("region", { name: "Fällig & überfällig", exact: true });
    await expect(due.getByRole("link", { name: `${prefix} Meins` })).toBeVisible();
    await expect(due.getByRole("link", { name: `${prefix} Bauschritt` })).toHaveCount(0);

    // Aufgaben-Datenbank: Standard „Zuständig: Ich“, per Filter einblendbar
    await page.goto("/aufgaben");
    await search(page).fill(prefix);
    const mine = page.getByRole("link", { name: `${prefix} Meins` });
    const step = page.getByRole("link", { name: `${prefix} Bauschritt` });
    await expect(mine).toBeVisible();
    await expect(step).toHaveCount(0);
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("menuitem", { name: /^Zuständig/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "KI" }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(step).toBeVisible();
    // #78: alle Häkchen auf einmal ab- und wieder anwählen
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("menuitem", { name: /^Zuständig/ }).click();
    await page.getByRole("menuitem", { name: "Alle abwählen" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Ich" })).not.toBeChecked();
    await expect(page.getByRole("menuitemcheckbox", { name: "KI" })).not.toBeChecked();
    await expect(page.getByRole("menuitem", { name: "Alle abwählen" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(mine).toHaveCount(0);
    await expect(step).toHaveCount(0);
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("menuitem", { name: /^Zuständig/ }).click();
    await page.getByRole("menuitem", { name: "Alle auswählen" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Ich" })).toBeChecked();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(mine).toBeVisible();
    await expect(step).toBeVisible();
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("menuitem", { name: "Standardfilter" }).click();
    await expect(step).toHaveCount(0);

    // Projekt: beide, der Arbeitsschritt dezent mit „KI“ (Reiter als Tabelle, #91)
    await page.goto(`/projekte/${project}?reiter=aufgaben`);
    const projectRow = (title: string) =>
      page.getByRole("row").filter({ has: page.getByRole("link", { name: title }) });
    const row = projectRow(`${prefix} Bauschritt`);
    await expect(row).toBeVisible();
    await expect(row.getByText("KI", { exact: true })).toBeVisible();
    await expect(projectRow(`${prefix} Meins`).getByText("KI", { exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // Panel: eigene Aufgabe der KI geben → verschwindet von Heute
    await page.getByRole("link", { name: `${prefix} Meins` }).click();
    const panel = taskPanel(page);
    await chooseOption(panel, "Zuständig", /^KI/);
    await expect(panel.getByRole("combobox", { name: "Zuständig", exact: true })).toContainText(
      "KI",
    );
    // am Handy liegt das Sheet über der Liste – erst schließen
    await closePanel(page);
    await expect(projectRow(`${prefix} Meins`).getByText("KI", { exact: true })).toBeVisible();
    await page.goto("/heute");
    await expect(
      page.getByRole("region", { name: "Fällig & überfällig", exact: true }).getByRole("link", {
        name: `${prefix} Meins`,
      }),
    ).toHaveCount(0);
  } finally {
    const db = await seedDb();
    await db.from("tasks").delete().in("id", ids);
    await db.from("projects").delete().eq("id", project);
  }
});
