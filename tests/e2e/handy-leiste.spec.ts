/**
 * Handy-Paket H2 (E44): Leiste unten am Handy – Heute · Woche · ＋ · Wissen · Menü. Nur unter
 * 768 px, Platz im Inhalt, Meldungen darüber, beim Schreiben ausgeblendet.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedTasks } from "./support/seed";
import { taskList, taskRow } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const bar = (page: Page) => page.getByTestId("mobile-tab-bar");
const slot = (page: Page, name: string) => bar(page).getByRole("link", { name });

test("Leiste: fünf Plätze, Heute aktiv, kein Überlauf, keine a11y-Verstöße @mobile", async ({
  page,
}) => {
  await page.goto("/heute");
  await expect(bar(page)).toBeVisible();
  await expect(slot(page, "Heute")).toHaveAttribute("aria-current", "page");
  await expect(slot(page, "Woche")).not.toHaveAttribute("aria-current", "page");
  await expect(slot(page, "Wissen")).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Schnell erfassen" })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Menü öffnen" })).toContainText("Menü");
  // Touch-Ziele ≥ 44 px
  for (const el of [
    slot(page, "Heute"),
    slot(page, "Woche"),
    slot(page, "Wissen"),
    bar(page).getByRole("button", { name: "Schnell erfassen" }),
    bar(page).getByRole("button", { name: "Menü öffnen" }),
  ]) {
    const box = await el.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
  // der Menü-Knopf oben ist weg (nur der in der Leiste ist sichtbar)
  await expect(page.getByRole("button", { name: "Menü öffnen" })).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});

test("Leiste: Woche, Wissen, Menü und ＋ führen an die richtigen Orte @mobile", async ({
  page,
}) => {
  await page.goto("/heute");
  await slot(page, "Woche").click();
  await expect(page).toHaveURL(/\/kalender\?ansicht=woche/);
  await expect(slot(page, "Woche")).toHaveAttribute("aria-current", "page");
  await expect(slot(page, "Heute")).not.toHaveAttribute("aria-current", "page");

  await slot(page, "Wissen").click();
  await expect(page).toHaveURL(/\/wissen$/);
  await expect(slot(page, "Wissen")).toHaveAttribute("aria-current", "page");

  await bar(page).getByRole("button", { name: "Menü öffnen" }).click();
  const nav = page.getByRole("dialog", { name: "Navigation" });
  await expect(nav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();

  await bar(page).getByRole("button", { name: "Schnell erfassen" }).click();
  const sheet = page.getByRole("dialog", { name: "Festhalten" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Was willst du festhalten?" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("Leiste: beim Schreiben weg, danach wieder da @mobile", async ({ page }) => {
  await page.goto("/heute");
  await expect(bar(page)).toBeVisible();
  const field = page.getByRole("textbox", { name: "Schnellerfassung" });
  await field.focus();
  await expect(bar(page)).toBeHidden();
  await field.blur();
  await expect(bar(page)).toBeVisible();
});

test("Leiste: letzte Aufgabe bleibt frei, Meldung liegt darüber @mobile", async ({ page }) => {
  const tag = uniqueName("Leiste");
  const { privat } = await areaIds();
  await seedTasks(
    Array.from({ length: 30 }, (_, i) => ({ title: `${tag} ${i + 1}`, area_id: privat })),
  );
  await page.goto("/aufgaben");
  const rows = taskRow(taskList(page), tag);
  await expect(rows).toHaveCount(30);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const barTop = (await bar(page).boundingBox())?.y ?? 0;
  const lastBottom = await page.evaluate(() => {
    const main = document.getElementById("inhalt") as HTMLElement;
    return (
      main.getBoundingClientRect().bottom - Number.parseFloat(getComputedStyle(main).paddingBottom)
    );
  });
  expect(lastBottom).toBeLessThanOrEqual(barTop + 1);
  await expectNoHorizontalOverflow(page);

  // Meldung nach dem Abhaken sitzt über der Leiste
  await rows.last().getByRole("checkbox").click();
  const toast = page.locator("[data-sonner-toast]").first();
  await expect(toast).toBeVisible();
  await page.waitForTimeout(400);
  const toastBottom = (await toast.boundingBox())?.y ?? 0;
  const toastHeight = (await toast.boundingBox())?.height ?? 0;
  expect(toastBottom + toastHeight).toBeLessThanOrEqual(barTop);
});

test("Desktop: keine Leiste unten @desktop", async ({ page }) => {
  await page.goto("/heute");
  await expect(page.getByRole("heading", { name: "Heute" })).toBeVisible();
  await expect(bar(page)).toBeHidden();
});

test("Tablet 800 px: keine Leiste, Menü-Knopf oben @desktop", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/heute");
  await expect(bar(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Menü öffnen" })).toBeVisible();
});
