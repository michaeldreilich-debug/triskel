import { expect, test } from "@playwright/test";
import { cssVar } from "./helpers";

test.describe("UI-Kit (/dev/ui)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/ui");
  });

  test("zeigt alle Komponenten in beiden Themes", async ({ page }) => {
    expect(await cssVar(page, "--bg", '[data-testid="panel-dark"]')).toBe("#0a0a0b");
    expect(await cssVar(page, "--bg", '[data-testid="panel-paper"]')).toBe("#f6f4ef");
    for (const panel of ["panel-dark", "panel-paper"]) {
      const p = page.getByTestId(panel);
      for (const title of [
        "Buttons",
        "Eingaben",
        "Pillen, Tags, Status",
        "Menü und Kontextmenü",
        "Überlagerungen",
        "Skeleton",
        "Leerer Zustand",
        "Tabelle",
        "Karten",
        "Fortschritt",
      ]) {
        await expect(p.getByRole("heading", { name: title, exact: true })).toBeVisible();
      }
      await expect(p.getByRole("button", { name: "Speichern" })).toBeVisible();
      await expect(p.getByRole("table")).toBeVisible();
    }
  });

  test("Toast mit Rückgängig", async ({ page }) => {
    const panel = page.getByTestId("panel-dark");
    await panel.getByRole("button", { name: "Toast mit Rückgängig" }).click();
    await expect(page.getByText("Aufgabe erledigt")).toBeVisible();
    await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
    await expect(page.getByText("Rückgängig gemacht")).toBeVisible();
  });

  test("Datepicker, Select, Menü und Sheet bedienbar", async ({ page }) => {
    const panel = page.getByTestId("panel-dark");

    await panel.getByLabel("Fällig").click();
    await page.getByRole("button", { name: /20\. Oktober 2026/ }).click();
    await expect(panel.getByLabel("Fällig")).toContainText("20.10.2026");

    await panel.getByLabel("Status").click();
    await page.getByRole("option", { name: "Wartet" }).click();
    await expect(panel.getByLabel("Status")).toContainText("Wartet");

    await panel.getByRole("button", { name: "Aktionen" }).click();
    await expect(page.getByRole("menuitem", { name: /Bearbeiten/ })).toBeVisible();
    await page.keyboard.press("Escape");

    await panel.getByRole("button", { name: "Sheet unten" }).click();
    const sheet = page.getByRole("dialog", { name: "Details" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Schließen" }).click();
    await expect(sheet).toBeHidden();
  });
});
