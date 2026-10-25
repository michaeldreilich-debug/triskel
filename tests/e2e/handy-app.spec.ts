/**
 * Handy-Paket H1 (E44): Triskel auf dem Home-Bildschirm. Manifest ohne Anmeldung, Hinweis auf
 * Heute nur auf dem iPhone im Browser (einmal „Verstanden“ bleibt je Gerät), Einstellungen ›
 * Auf dem Handy mit Anleitung und Status.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE } from "./support/auth";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const hint = (page: Page) => page.getByTestId("install-hint");

/** `navigator.standalone` wie Safari: im Browser false, in der App true. */
const standalone = (page: Page, value: boolean) =>
  page.addInitScript((v) => {
    Object.defineProperty(navigator, "standalone", { value: v, configurable: true });
  }, value);

test.describe("Manifest ohne Anmeldung", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/manifest.webmanifest antwortet 200 mit Name und Start auf Heute", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.name).toBe("Triskel");
    expect(manifest.start_url).toBe("/heute");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test("Symbole des Manifests sind ohne Anmeldung erreichbar", async ({ request }) => {
    for (const path of ["/icon.png", "/apple-icon.png"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
    }
  });
});

test.describe("iPhone im Browser", () => {
  test.use({ storageState: AUTH_FILE, userAgent: IPHONE });

  test("@mobile Hinweis auf Heute: sichtbar, „Verstanden“ blendet ihn dauerhaft aus", async ({
    page,
  }) => {
    await standalone(page, false);
    await page.goto("/heute");
    await expect(hint(page)).toBeVisible();
    await expect(hint(page).getByRole("heading", { name: /Home-Bildschirm/ })).toBeVisible();
    await expect(
      hint(page).getByRole("list", { name: "So geht es" }).getByRole("listitem"),
    ).toHaveCount(3);
    await expect(hint(page)).toContainText("einmal neu anmelden");
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);

    await hint(page).getByRole("button", { name: "Verstanden" }).click();
    await expect(hint(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Heute", level: 1 })).toBeVisible();
    await expect(hint(page)).toHaveCount(0);
  });

  test("@mobile „Später“ blendet nur für diesen Besuch aus", async ({ page }) => {
    await standalone(page, false);
    await page.goto("/heute");
    await expect(hint(page)).toBeVisible();
    await hint(page).getByRole("button", { name: "Später" }).click();
    await expect(hint(page)).toHaveCount(0);
    await page.reload();
    await expect(hint(page)).toBeVisible();
  });

  test("@mobile in der App vom Home-Bildschirm kein Hinweis, Status in den Einstellungen", async ({
    page,
  }) => {
    await standalone(page, true);
    await page.goto("/heute");
    await expect(page.getByRole("heading", { name: "Heute", level: 1 })).toBeVisible();
    await expect(hint(page)).toHaveCount(0);

    await page.goto("/einstellungen#handy");
    await expect(page.getByTestId("install-status")).toHaveText(
      "Läuft gerade als App vom Home-Bildschirm",
    );
  });
});

test.describe("Einstellungen › Auf dem Handy", () => {
  test.use({ storageState: AUTH_FILE });

  test("#handy öffnet den Abschnitt mit Anleitung und Status „Läuft im Browser“", async ({
    page,
  }) => {
    await page.goto("/einstellungen#handy");
    const head = page.getByRole("region", { name: "Auf dem Handy" }).getByRole("button").first();
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("install-status")).toHaveText("Läuft im Browser");
    await expect(page.getByText("In Safari unten auf „Teilen“ tippen")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
  });

  test("@desktop am Desktop kein Hinweis auf Heute", async ({ page }) => {
    await page.goto("/heute");
    await expect(page.getByRole("heading", { name: "Heute", level: 1 })).toBeVisible();
    await expect(hint(page)).toHaveCount(0);
  });
});
