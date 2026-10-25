/**
 * #69 „Angelegt von“ in der Aufgaben-Datenbank, Desktop 1440 px und Mobil 390 px: Filter
 * „Angelegt von: Ich / KI“ wie die übrigen Filter, Standard alle, gemerkt je Gerät; im
 * Aufgaben-Panel dezent „von KI angelegt“. „ai“ setzt der Trigger (Migration 40) nur bei einem
 * KI-Token – hier markiert ein abgefangener Abruf die Testaufgabe (der Trigger selbst: Migrations-
 * und Integrationstests).
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedTasks } from "./support/seed";
import { taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const search = (page: Page) => page.getByRole("textbox", { name: "Aufgaben durchsuchen" });

test("Aufgaben-Datenbank: Filter „Angelegt von“ blendet KI-Aufgaben aus und zeigt nur sie; Panel nennt es", async ({
  page,
}) => {
  const prefix = uniqueName("Von");
  const { beruf } = await areaIds();
  const ids = await seedTasks([
    { title: `${prefix} Selbst`, area_id: beruf },
    { title: `${prefix} Assistent`, area_id: beruf },
  ]);
  await page.route("**/rest/v1/tasks?*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    try {
      const response = await route.fetch();
      const rows = (await response.json()) as Array<{ title?: string; created_by?: string }>;
      if (Array.isArray(rows)) {
        for (const row of rows) if (row.title === `${prefix} Assistent`) row.created_by = "ai";
      }
      await route.fulfill({ response, json: rows });
    } catch {
      // Seite wurde währenddessen verlassen (Neuladen): Abruf ist hinfällig
      await route.abort().catch(() => {});
    }
  });
  try {
    await page.goto("/aufgaben");
    await search(page).fill(prefix);
    const own = page.getByRole("link", { name: `${prefix} Selbst` });
    const ai = page.getByRole("link", { name: `${prefix} Assistent` });
    // Standard: alle
    await expect(own).toBeVisible();
    await expect(ai).toBeVisible();

    // KI ausblenden
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("menuitem", { name: /^Angelegt von/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "KI" }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(ai).toHaveCount(0);
    await expect(own).toBeVisible();

    // nur KI: „Ich“ aus, „KI“ an – bleibt nach dem Neuladen
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("menuitem", { name: /^Angelegt von/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "KI" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Ich" }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(own).toHaveCount(0);
    await expect(ai).toBeVisible();
    await page.reload();
    await search(page).fill(prefix);
    await expect(ai).toBeVisible();
    await expect(own).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // Panel: dezent „von KI angelegt“, bei der eigenen Aufgabe nicht
    await ai.click();
    const panel = taskPanel(page);
    await expect(panel.getByText(/von KI angelegt/)).toBeVisible();

    // Standardfilter holt alles zurück
    await page.keyboard.press("Escape");
    await page.goto("/aufgaben");
    await search(page).fill(prefix);
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("menuitem", { name: "Standardfilter" }).click();
    await expect(own).toBeVisible();
    await expect(ai).toBeVisible();
    await own.click();
    await expect(taskPanel(page).getByText(/von KI angelegt/)).toHaveCount(0);
  } finally {
    await (await seedDb()).from("tasks").delete().in("id", ids);
  }
});
