/**
 * Schriftgröße je Gerät (F5, #57): Einstellungen › Darstellung › Schriftgröße (Klein · Normal ·
 * Groß · Sehr groß), gemerkt im Cookie, wirkt über rem auf die ganze App. Bei „Sehr groß“ darf keine
 * Hauptansicht bei 390 px seitlich überlaufen.
 */
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedProject, seedTasks } from "./support/seed";

test.use({ storageState: AUTH_FILE });
test.setTimeout(90_000);

const rootSize = (page: Page) =>
  page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));

test("Schriftgröße wählen: wirkt sofort, bleibt nach Neuladen, nur auf diesem Gerät @desktop", async ({
  page,
}) => {
  await page.goto("/einstellungen#darstellung");
  const group = page.getByRole("radiogroup", { name: "Schriftgröße" });
  expect(await rootSize(page)).toBe(16);
  const before = (await page.getByTestId("font-preview").boundingBox())?.height ?? 0;

  await group.getByRole("radio", { name: "Sehr groß" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-font", "sehr-gross");
  expect(await rootSize(page)).toBe(20);
  expect((await page.getByTestId("font-preview").boundingBox())?.height ?? 0).toBeGreaterThan(
    before,
  );

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-font", "sehr-gross");
  expect(await rootSize(page)).toBe(20);

  await page
    .getByRole("radiogroup", { name: "Schriftgröße" })
    .getByRole("radio", { name: "Klein" })
    .click();
  expect(await rootSize(page)).toBe(15);
  await page
    .getByRole("radiogroup", { name: "Schriftgröße" })
    .getByRole("radio", { name: "Normal" })
    .click();
  expect(await rootSize(page)).toBe(16);
});

test("Sehr groß: jede Hauptansicht bei 390 px ohne Überlauf @mobile", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "sz-font", value: "sehr-gross", url: baseURL ?? "http://localhost:3100" },
  ]);
  const { beruf } = await areaIds();
  const projectId = await seedProject({
    title: uniqueName("Sehr großes Projekt mit langem Titel"),
    area_id: beruf,
  });
  await seedTasks([
    {
      title: `${uniqueName("Aufgabe")} mit einem ziemlich langen Titel, der umbrechen muss`,
      area_id: beruf,
      due_date: new Date().toISOString().slice(0, 10),
    },
  ]);

  const views = [
    "/heute",
    "/kalender",
    "/wissen",
    "/projekte",
    `/projekte/${projectId}`,
    "/aufgaben",
    "/inbox",
    "/einstellungen",
    "/rueckblicke",
    "/papierkorb",
  ];
  for (const url of views) {
    await page.goto(url);
    await expect(page.locator("html")).toHaveAttribute("data-font", "sehr-gross");
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForTimeout(400);
    await expectNoHorizontalOverflow(page);
  }

  // Kalender: Monat (Woche ist die Vorgabe oben)
  await page.goto("/kalender");
  await page.keyboard.press("m");
  await page.waitForTimeout(400);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("w");
  await page.waitForTimeout(400);
  await expectNoHorizontalOverflow(page);

  // eine Notiz
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await page.waitForTimeout(400);
  await expectNoHorizontalOverflow(page);
});

/** Kalender-Woche am Desktop mit „Sehr groß“ öffnen. */
async function bigWeek(page: Page, context: BrowserContext, baseURL: string | undefined) {
  await context.addCookies([
    { name: "sz-font", value: "sehr-gross", url: baseURL ?? "http://localhost:3100" },
  ]);
  await page.goto("/kalender");
  await page.keyboard.press("w");
  await expect(page.locator("[data-calendar-grid] [data-calendar-day]")).toHaveCount(7);
}

test("Sehr groß: Uhrzeiten im Kalender ganz lesbar, Linie auf Heute durch die Punkte (M3-4) @desktop", async ({
  page,
  context,
  baseURL,
}) => {
  await bigWeek(page, context, baseURL);
  const labels = await page.evaluate(() => {
    const scroller = document.querySelector("[data-calendar-grid]");
    if (!scroller) return null;
    const left = scroller.getBoundingClientRect().left;
    const spans = [...scroller.querySelectorAll("section > div:first-child > span")];
    // links aus dem Raster ragende Beschriftung wird abgeschnitten („)7:00“)
    return {
      count: spans.length,
      clipped: spans.filter((l) => l.getBoundingClientRect().left < left - 0.5).length,
    };
  });
  expect(labels?.count).toBeGreaterThan(0);
  expect(labels?.clipped, "Uhrzeiten links abgeschnitten").toBe(0);

  // Tagesablauf auf Heute: die senkrechte Linie trifft die Punkte (Spalten wachsen mit)
  await page.goto("/heute");
  const schedule = page.getByRole("list", { name: "Tagesablauf" });
  await expect(schedule.getByRole("listitem").first()).toBeVisible();
  const miss = await schedule.evaluate((list) => {
    const line = list.querySelector(":scope > span[aria-hidden]")?.getBoundingClientRect();
    const dots = [...list.querySelectorAll(":scope > li > span:nth-child(2)")].map((d) =>
      d.getBoundingClientRect(),
    );
    if (!line || dots.length === 0) return 99;
    const x = line.left + line.width / 2;
    return Math.max(...dots.map((d) => Math.abs(d.left + d.width / 2 - x)));
  });
  expect(miss, "Linie neben den Punkten").toBeLessThanOrEqual(1);
});

test("Kalender-Woche: Tageskopf und Rasterspalte bündig, auch mit Bildlaufleiste (M3-5) @desktop", async ({
  page,
  context,
  baseURL,
}) => {
  await bigWeek(page, context, baseURL);
  const offset = await page.evaluate(() => {
    const view = document.querySelector('[data-calendar-view="woche"]');
    const head = [...(view?.children[0]?.children ?? [])].slice(1, 8);
    const columns = [...document.querySelectorAll("[data-calendar-grid] [data-calendar-day]")];
    // größter Versatz zwischen Tageskopf und Tagesspalte im Raster (px)
    return Math.max(
      ...columns.map((column, i) => {
        const a = column.getBoundingClientRect();
        const b = head[i]?.getBoundingClientRect();
        return b ? Math.max(Math.abs(a.left - b.left), Math.abs(a.right - b.right)) : 99;
      }),
    );
  });
  expect(offset, "Tageskopf und Rasterspalte versetzt").toBeLessThanOrEqual(1);
});
