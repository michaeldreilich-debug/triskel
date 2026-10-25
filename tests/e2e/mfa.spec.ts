/**
 * B16: MFA-Seiten und Sicherheits-Header.
 * - Einrichtung und Abfrage über die Vorschau /dev/mfa (gespielte Anbindung, Code 123456): Die
 *   echte Einrichtung braucht einen Nutzer ohne Faktor, und beide Testnutzer haben einen.
 *   Die echte Abfrage prüft auth-flow.spec.ts mit Testnutzer A.
 * - Header: CSP mit Nonce (Skripte tragen sie), kein Einbetten, nosniff usw.; keine
 *   CSP-Verstöße in der Konsole auf Login, MFA und in der App.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { typeQuietly } from "./support/app";
import { AUTH_FILE } from "./support/auth";

/** Konsolenfehler sammeln (CSP-Verstöße erscheinen dort als Fehler) */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("MFA-Seiten (Vorschau ohne Backend)", () => {
  test("Einrichtung: QR-Code, Schlüssel zum Abtippen, Code bestätigen; axe, kein Überlauf", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/dev/mfa");
    await expect(page.getByRole("heading", { name: "Zweiten Faktor einrichten" })).toBeVisible();
    const qr = page.getByRole("img", { name: "QR-Code für die Authenticator-App" });
    await expect(qr).toBeVisible();
    expect(await qr.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByTestId("totp-secret")).toHaveText(
      "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP",
    );
    await expect(page.getByRole("button", { name: "Schlüssel kopieren" })).toBeVisible();
    const code = page.getByLabel("Code aus der App");
    await expect(code).toBeEnabled();
    await expect(code).not.toBeFocused();
    await expect(page.getByRole("button", { name: "Einrichten" })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
    await testInfo.attach("mfa-einrichtung", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    // Leerzeichen und Buchstaben fallen weg; falscher Code → Meldung, Feld wieder leer
    await code.fill("12 3a4");
    await expect(code).toHaveValue("1234");
    await typeQuietly(code, "654321");
    // im Formular suchen: Der Route-Announcer von Next.js ist auch ein „alert“
    await expect(page.locator("form").getByRole("alert")).toHaveText(/Code stimmt nicht/);
    await expect(code).toHaveValue("");
    await expect(code).toBeFocused();
    await expectNoA11yViolations(page);

    // Enter bzw. Knopf: richtiger Code → weiter
    await code.fill("123456");
    await expect(page).toHaveURL(/\/dev\/mfa\?ansicht=einrichten&bestaetigt=1$/);
    await expect(page.getByRole("heading", { name: "Bestätigt" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Abfrage: Feld, Hinweis zur Wiederherstellung, Abmelden; axe, kein Überlauf", async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await page.goto("/dev/mfa?ansicht=abfrage");
    await expect(page.getByRole("heading", { name: "Zweiter Faktor" })).toBeVisible();
    await expect(page.getByLabel("Code aus der App")).toBeEnabled();
    // Tastatur zuerst: Cursor steht im Feld (bei der Einrichtung nicht, dort zählt der QR-Code)
    await expect(page.getByLabel("Code aus der App")).toBeFocused();
    await expect(page.getByText("Wiederherstellung steht im README")).toBeVisible();
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
    await testInfo.attach("mfa-abfrage-vorschau", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await page.getByLabel("Code aus der App").fill("123456");
    await expect(page.getByRole("heading", { name: "Bestätigt" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Papier-Theme: Einrichtung ohne a11y-Verstöße @desktop", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: "sz-theme", value: "paper", url: baseURL as string }]);
    await page.goto("/dev/mfa");
    await expect(
      page.getByRole("img", { name: "QR-Code für die Authenticator-App" }),
    ).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe("Sicherheits-Header (B16)", () => {
  test("Login: CSP mit Nonce, Skripte tragen sie; feste Header gesetzt; keine Konsolenfehler", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto("/login");
    const headers = response?.headers() ?? {};
    const csp = headers["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce, "CSP ohne Nonce").toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("same-origin");
    expect(headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["x-powered-by"]).toBeUndefined();

    // jedes ausgelieferte Skript trägt die Nonce dieser Antwort (Next.js setzt sie selbst);
    // später nachgeladene Chunks erlaubt 'strict-dynamic'
    const scriptTags = ((await response?.text()) ?? "").match(/<script\b[^>]*>/g) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of scriptTags) expect(tag).toContain(`nonce="${nonce}"`);

    // neue Nonce je Anfrage
    const again = await page.request.get("/login");
    expect(again.headers()["content-security-policy"]).not.toContain(`'nonce-${nonce}'`);
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test.describe("angemeldet (aal2)", () => {
    test.use({ storageState: AUTH_FILE });

    test("App lädt unter der CSP ohne Konsolenfehler", async ({ page }) => {
      const errors = collectConsoleErrors(page);
      const response = await page.goto("/heute");
      expect(response?.headers()["content-security-policy"]).toContain("'strict-dynamic'");
      await expect(page).toHaveURL(/\/heute$/);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.goto("/wissen");
      await expect(page.getByRole("region", { name: "Notizliste" })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});
