/**
 * Nächtliche Sicherung in der App (E32, Migration 27), Desktop 1440 px und Mobil 390 px: Hinweis
 * auf „Heute“, wenn die letzte Sicherung älter als 36 Stunden ist, und Einstellungen › Sicherung.
 * Den Stand setzt sonst nur das Skript auf dem Mac – hier wird die Antwort von user_settings
 * abgefangen (gemeinsamer Testnutzer, nichts wird gespeichert).
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE } from "./support/auth";

test.use({ storageState: AUTH_FILE });

const SUMMARY = {
  stand: "2026-10-18-0307",
  zeilen: 1234,
  dateien: 41,
  dateien_bytes: 11 * 1024 * 1024,
  db_bytes: 150_000,
  drive: true,
  dauer_s: 70,
};

/** user_settings so beantworten, als hätte die Sicherung vor `hours` Stunden geklappt. */
async function backupAgo(page: Page, hours: number | null) {
  await page.route("**/rest/v1/user_settings?*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    const patch = {
      last_backup_at:
        hours === null ? null : new Date(Date.now() - hours * 3_600_000).toISOString(),
      last_backup_summary: hours === null ? null : SUMMARY,
    };
    const next = Array.isArray(body)
      ? body.map((row) => ({ ...row, ...patch }))
      : { ...body, ...patch };
    await route.fulfill({ response, json: next });
  });
}

test("überfällige Sicherung: Hinweis auf Heute führt zu Einstellungen › Sicherung", async ({
  page,
}) => {
  await backupAgo(page, 80);
  await page.goto("/heute");
  const hint = page.getByTestId("backup-hint");
  await expect(hint).toContainText("Nächtliche Sicherung überfällig – zuletzt vor 3 Tagen");
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await hint.getByRole("link", { name: "Details" }).click();
  await expect(page).toHaveURL(/\/einstellungen#sicherung$/);
  const section = page.getByRole("region", { name: "Sicherung" });
  await expect(section.getByTestId("last-backup")).toContainText(
    "Überfällig – letzte Sicherung vor 3 Tagen",
  );
  await expect(section.getByTestId("last-backup-summary")).toHaveText(
    "1.234 Zeilen · 41 Dateien (11 MB) · auf Google Drive",
  );
  await expectNoHorizontalOverflow(page);
  // die Seitenleiste blendet den aktiven Eintrag über (axe erst danach)
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});

test("frische Sicherung: kein Hinweis auf Heute, Einstellungen nennen die Uhrzeit", async ({
  page,
}) => {
  await backupAgo(page, 2);
  await page.goto("/heute");
  await expect(page.getByRole("heading", { name: "Heute", level: 1 })).toBeVisible();
  await expect(page.getByTestId("today-summary")).toBeVisible();
  // erst wenn die Einstellungen geladen und geprüft sind, sagt „kein Hinweis“ etwas (T-14)
  await expect(page.getByTestId("backup-ok")).toBeAttached();
  await expect(page.getByTestId("backup-hint")).toHaveCount(0);

  await page.goto("/einstellungen#sicherung");
  const line = page.getByRole("region", { name: "Sicherung" }).getByTestId("last-backup");
  await expect(line).toContainText(/Letzte Sicherung (heute|gestern) um \d\d:\d\d/);
});

test("noch nie gesichert: Hinweis auf Heute", async ({ page }) => {
  await backupAgo(page, null);
  await page.goto("/heute");
  await expect(page.getByTestId("backup-hint")).toContainText("Noch keine nächtliche Sicherung");
  await page.goto("/einstellungen#sicherung");
  await expect(page.getByTestId("last-backup")).toHaveText("Noch keine nächtliche Sicherung.");
  await expect(page.getByTestId("last-backup-summary")).toHaveCount(0);
});
