import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";

test.describe("Login", () => {
  test("Formular mit Beschriftungen, Pflichtfeldern, ohne Überlauf, ohne a11y-Verstöße", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
    const email = page.getByLabel("E-Mail");
    const password = page.getByLabel("Passwort");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("required", "");
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
    // Triskel-Symbol (O7) lädt ohne Anmeldung (keine Umleitung auf /login statt Bild)
    const mark = page.locator("main img").first();
    await expect(mark).toHaveAttribute("src", "/triskel.png");
    await expect
      .poll(() => mark.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
    for (const path of ["/triskel.png", "/icon.png", "/apple-icon.png"]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toContain("image/png");
    }
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
  });

  test("geschützte Seiten leiten ohne Anmeldung auf /login mit Rücksprungziel", async ({
    page,
  }) => {
    await page.goto("/heute");
    await expect(page).toHaveURL(/\/login\?next=%2Fheute$/);
    await page.goto("/wissen");
    await expect(page).toHaveURL(/\/login\?next=%2Fwissen$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("Datenschutzerklärung ohne Anmeldung erreichbar (Google-Anmeldeseite, #64)", async ({
    page,
  }) => {
    await page.goto("/datenschutz");
    await expect(page).toHaveURL(/\/datenschutz$/);
    await expect(page.getByRole("heading", { name: "Datenschutz", level: 1 })).toBeVisible();
    await expect(page.getByText("calendar.events")).toBeVisible();
    await expect(page.getByText("calendar.calendarlist.readonly")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Google API Services User Data Policy" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
  });

  test("Theme aus dem Cookie rendert der Server direkt (kein Aufblitzen)", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: "sz-theme", value: "paper", url: baseURL as string }]);
    const response = await page.goto("/login");
    expect(await response?.text()).toMatch(/<html[^>]*data-theme="paper"/);
    await expectNoA11yViolations(page);
  });
});
