/**
 * Startbild (#102): erscheint einmal am Tag beim ersten Öffnen von Heute; „Überspringen“,
 * „Los geht’s“ und Escape führen in die Seite darunter. Je Gerät abschaltbar, „Jetzt abspielen“
 * in den Einstellungen. Mit „Bewegung reduzieren“: Standbild und alle Zeilen sofort (das Chromium
 * der Tests spielt kein H.264). Automatisierte Browser sehen es nur mit Test-Freigabe.
 * Desktop 1440 px und Mobil 390 px.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE } from "./support/auth";

test.use({ storageState: AUTH_FILE });

const intro = (page: Page) => page.getByRole("dialog", { name: "Ein neuer Tag beginnt." });

/** Nach dem Laden kurz warten: Das Startbild entscheidet erst im Browser, ob es erscheint. */
async function expectNoIntro(page: Page) {
  await expect(page.getByRole("main")).toBeVisible();
  await page.waitForTimeout(600);
  await expect(intro(page)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => window.localStorage.setItem("sz:startbild-test", "1"));
});

test("erscheint einmal am Tag auf Heute, „Überspringen“ führt in Heute", async ({ page }) => {
  await page.goto("/heute");
  await expect(intro(page)).toBeVisible();
  await expect(intro(page).getByText("Gelassenheit")).toBeVisible();
  await expect(intro(page).getByText("Neugier")).toBeVisible();
  await expect(intro(page).getByRole("button", { name: "Los geht’s" })).toBeVisible();
  await expect(intro(page).getByText("ESA/Hubble")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(700);
  await expectNoA11yViolations(page);
  await test
    .info()
    .attach("startbild", { body: await page.screenshot(), contentType: "image/png" });

  await intro(page).getByRole("button", { name: "Überspringen" }).click();
  await expect(intro(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/heute$/);

  // am selben Tag nicht noch einmal
  await page.reload();
  await expectNoIntro(page);
});

test("„Los geht’s“ führt weiter", async ({ page }) => {
  await page.goto("/heute");
  await intro(page).getByRole("button", { name: "Los geht’s" }).click();
  await expect(intro(page)).toHaveCount(0);
  await expect(page.getByRole("main")).toBeVisible();
});

test("Einstellungen: „Jetzt abspielen“, Escape schließt; aus → kein Startbild auf Heute", async ({
  page,
}) => {
  await page.goto("/einstellungen#startbild");
  const section = page.getByRole("region", { name: "Startbild" });
  await section.getByRole("button", { name: "Jetzt abspielen" }).click();
  await expect(intro(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(intro(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/einstellungen/);

  await section.getByRole("radio", { name: "Aus" }).click();
  await expect(section.getByRole("radio", { name: "Aus" })).toBeChecked();
  await page.goto("/heute");
  await expectNoIntro(page);
});
