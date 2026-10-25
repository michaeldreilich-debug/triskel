import { expect, type Page, test } from "@playwright/test";
import { cssVar, expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";

const NAV = ["Heute", "Inbox", "Wissen", "Rückblicke", "Projekte", "Aufgaben", "Notizen"];

/** unter 1024 px ist die Sidebar ein Sheet */
const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

async function openNavigation(page: Page) {
  if (isNarrow(page)) {
    await page.getByRole("button", { name: "Menü öffnen" }).click();
    return page.getByRole("dialog", { name: "Navigation" });
  }
  return page.getByRole("complementary", { name: "Seitenleiste" });
}

test.describe("Shell (/dev/ui)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { name: "UI-Kit" })).toBeVisible();
  });

  test("Sidebar 248 px mit Navigation, einklappbar, Zustand bleibt nach Reload @desktop", async ({
    page,
  }) => {
    const sidebar = page.getByRole("complementary", { name: "Seitenleiste" });
    expect((await sidebar.boundingBox())?.width).toBe(248);
    for (const label of NAV) await expect(sidebar.getByRole("link", { name: label })).toBeVisible();

    await page.getByRole("button", { name: "Seitenleiste einklappen" }).click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
    await expect(page.getByRole("button", { name: "Triskel wieder einblenden" })).toBeVisible();

    // Tooltip nennt das Kürzel mit genau einem Backslash (M3-1: JSX-Attribute kennen keine Escapes)
    await expect(page.getByRole("button", { name: "Triskel wieder einblenden" })).toHaveAttribute(
      "title",
      "Seitenleiste ausklappen (⌘\\)",
    );

    await page.reload();
    await expect(page.getByRole("button", { name: "Triskel wieder einblenden" })).toBeVisible();
    await page.getByRole("button", { name: "Triskel wieder einblenden" }).click();
    await expect(page.getByRole("button", { name: "Seitenleiste einklappen" })).toBeVisible();

    await page.keyboard.press("ControlOrMeta+\\");
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
    await page.keyboard.press("ControlOrMeta+\\");
    await expect(sidebar).not.toHaveAttribute("data-collapsed", "true");
  });

  test("Mobil: Kopfzeile, Sidebar als Sheet, Touch-Ziele ≥ 44 px @mobile", async ({ page }) => {
    await expect(page.getByRole("complementary", { name: "Seitenleiste" })).toBeHidden();
    const menu = page.getByRole("button", { name: "Menü öffnen" });
    expect((await menu.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    const sheet = await openNavigation(page);
    await expect(sheet).toBeVisible();
    for (const label of NAV) {
      const link = sheet.getByRole("link", { name: label });
      await expect(link).toBeVisible();
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("Bereichs-Schalter bleibt nach Reload erhalten", async ({ page }) => {
    let nav = await openNavigation(page);
    await nav.getByRole("radio", { name: "Beruf" }).click();
    await expect(nav.getByRole("radio", { name: "Beruf" })).toBeChecked();

    await page.reload();
    nav = await openNavigation(page);
    await expect(nav.getByRole("radio", { name: "Beruf" })).toBeChecked();
    await nav.getByRole("radio", { name: "Alles" }).click();
    await expect(nav.getByRole("radio", { name: "Alles" })).toBeChecked();
  });

  test("Theme Dunkel/Papier wechselt ohne Neuladen und bleibt nach Reload (über ⌘K, #29)", async ({
    page,
  }) => {
    const theme = async (name: string) => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.keyboard.type(`Theme: ${name}`);
      await page.keyboard.press("Enter");
    };
    await theme("Papier");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
    expect(await cssVar(page, "--bg")).toBe("#f6f4ef");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
    // nicht mehr in der Seitenleiste (Einstellungen › Darstellung)
    const nav = await openNavigation(page);
    await expect(nav.getByRole("radio", { name: "Papier" })).toHaveCount(0);
    if (isNarrow(page)) await page.keyboard.press("Escape");
    await theme("Dunkel");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("Befehlspalette per ⌘K, Befehl per Tastatur ausführen", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Befehlspalette" });
    await expect(palette).toBeVisible();
    // „Papier“ allein träfe auch „Papierkorb“ (Gehe zu, steht weiter oben)
    await page.keyboard.type("Theme: Papier");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  });

  test("kein horizontales Scrollen und keine a11y-Verstöße (beide Themes)", async ({ page }) => {
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
  });
});
