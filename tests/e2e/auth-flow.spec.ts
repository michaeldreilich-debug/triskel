/**
 * Login/Logout gegen das Testprojekt (B2) mit zweitem Faktor (B16). Zugangsdaten werden per
 * evaluate ins Formular geschrieben und direkt nach dem Absenden wieder geleert (das Formular
 * liest die Werte synchron beim Absenden). So erscheinen sie weder in Step-Titeln noch in
 * Screenshots oder im Fehlerkontext; Traces sind ohnehin aus. Der TOTP-Code entsteht in Node
 * aus dem Geheimnis in .env.test.local und läuft ebenfalls per evaluate ins Feld.
 */
import { expect, type Page, test } from "@playwright/test";
import { assertTestBackend } from "../guard";
import { totpCode } from "../support/totp";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { fillQuietly, openNavigation, typeQuietly } from "./support/app";

test.use({ screenshot: "off" });

async function submitLogin(page: Page, email: string, password: string) {
  const emailField = page.getByLabel("E-Mail");
  const passwordField = page.getByLabel("Passwort");
  await fillQuietly(emailField, email);
  await fillQuietly(passwordField, password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await fillQuietly(emailField, "");
  await fillQuietly(passwordField, "");
}

test.describe("Anmeldung (Testprojekt)", () => {
  test("falsches Passwort: verständliche Meldung, keine Weiterleitung", async ({ page }) => {
    const env = assertTestBackend();
    await page.goto("/login");
    await submitLogin(page, env.userA.email, "sicher-falsch-123");
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "E-Mail oder Passwort stimmt nicht.",
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  // Nur einmal je Lauf (@desktop) und die 390-px-Prüfung per Viewport im selben Test: Supabase
  // beendet nach einer erfolgreichen TOTP-Bestätigung alle anderen aal1-Sitzungen des Nutzers.
  // Liefen Desktop und Mobil parallel, verlöre der langsamere Lauf seine Sitzung.
  test("Passwort allein reicht nicht: TOTP-Abfrage (1440 + 390 px), dann Rücksprungziel; Abmelden zurück auf /login @desktop", async ({
    page,
  }, testInfo) => {
    const env = assertTestBackend();
    await page.goto("/wissen");
    await expect(page).toHaveURL(/\/login\?next=%2Fwissen$/);
    await submitLogin(page, env.userA.email, env.userA.password);

    // aal1: Abfrage des zweiten Faktors, die App bleibt zu
    await expect(page).toHaveURL(/\/mfa\?next=%2Fwissen$/);
    await expect(page.getByRole("heading", { name: "Zweiter Faktor" })).toBeVisible();
    const code = page.getByLabel("Code aus der App");
    await expect(code).toBeEnabled();
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await expect(code).toHaveAttribute("inputmode", "numeric");
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
      await expectNoA11yViolations(page);
      await testInfo.attach(`mfa-abfrage-${viewport.width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
    await page.goto("/heute");
    await expect(page).toHaveURL(/\/mfa\?next=%2Fheute$/);
    await page.goto("/mfa/einrichten?next=%2Fwissen");
    await expect(page).toHaveURL(/\/mfa\?next=%2Fwissen$/);

    // falscher Code: Meldung, Feld leer, weiter auf der Abfrage (das Feld ist bereit, sobald
    // der Faktor geladen ist; der Route-Announcer von Next.js ist auch ein „alert“)
    await expect(code).toBeEnabled();
    await typeQuietly(code, "000000");
    await expect(page.locator("form").getByRole("alert")).toHaveText(/Code stimmt nicht/);
    await expect(code).toHaveValue("");
    await expect(page).toHaveURL(/\/mfa\?next=%2Fwissen$/);
    await expectNoA11yViolations(page);

    // richtiger Code (6 Ziffern bestätigen sofort) → Rücksprungziel
    await typeQuietly(code, totpCode(env.userA.totpSecret));
    await expect(page).toHaveURL(/\/wissen$/);
    await expect(page.getByRole("region", { name: "Notizliste" })).toBeVisible();
    await page.goto("/mfa");
    await expect(page).toHaveURL(/\/heute$/);

    const nav = await openNavigation(page);
    await nav.getByRole("button", { name: "Abmelden" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/heute");
    await expect(page).toHaveURL(/\/login\?next=%2Fheute$/);
    await page.goto("/mfa");
    await expect(page).toHaveURL(/\/login$/);
  });
});
