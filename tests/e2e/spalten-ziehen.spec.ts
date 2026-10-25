/**
 * Rückmeldung #95: „Ich möchte überall die Fenster so ziehen, wie ich möchte.“ – Aufgaben-Panel,
 * Seitenleiste, rechte Spalte auf Heute und im Rückblick sowie die Nebenspalte der Tag-Ansicht
 * lassen sich am Rand breiter und schmaler ziehen, je Gerät gemerkt, Doppelklick bzw. Enter =
 * Standard. Rückmeldung #97: Das Aufgaben-Band über der Woche zeigt in hohen Fenstern mehr als 3.
 * Desktop 1440 px; am Handy gibt es keine Spalten.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, mondayWeeksAgo, seedRecap, seedTasks } from "./support/seed";

test.use({ storageState: AUTH_FILE });

const width = (column: Locator) => async () => Math.round((await column.boundingBox())?.width ?? 0);

async function drag(page: Page, handle: Locator, dx: number) {
  const box = await handle.boundingBox();
  if (!box) throw new Error("Griff nicht gefunden");
  // kurze Spalten (Tag-Ansicht): der Griff ist nur so hoch wie ihr Inhalt
  const y = box.y + Math.min(200, box.height / 2);
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 6 });
  await page.mouse.up();
}

test("Aufgaben-Panel und Seitenleiste breiter und schmaler ziehen, das Gerät merkt es sich (#95) @desktop", async ({
  page,
}) => {
  const { beruf } = await areaIds();
  const [taskId] = await seedTasks([{ title: `${uniqueName("Panel")} Aufgabe`, area_id: beruf }]);

  await page.goto(`/aufgaben?aufgabe=${taskId}`);
  const panel = page.getByRole("complementary", { name: "Aufgabe" });
  const panelHandle = page.getByRole("separator", { name: "Breite der Aufgabe" });
  const sidebar = page.getByRole("complementary", { name: "Seitenleiste" });
  const sidebarHandle = page.getByRole("separator", { name: "Breite der Seitenleiste" });
  await expect.poll(width(panel)).toBe(460);
  await expect.poll(width(sidebar)).toBe(248);

  // Panel: nach links ziehen macht es breiter, die Tabelle daneben schmaler
  await drag(page, panelHandle, -120);
  await expect.poll(width(panel)).toBe(580);
  await expect(panelHandle).toHaveAttribute("aria-valuenow", "580");
  // Seitenleiste: nach rechts ziehen macht sie breiter
  await drag(page, sidebarHandle, 60);
  await expect.poll(width(sidebar)).toBe(308);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await page.reload();
  await expect.poll(width(panel)).toBe(580);
  await expect.poll(width(sidebar)).toBe(308);

  // Tastatur: Grenzen, Enter bzw. Doppelklick = Standard
  await panelHandle.focus();
  await page.keyboard.press("Home");
  await expect.poll(width(panel)).toBe(360);
  await page.keyboard.press("Enter");
  await expect.poll(width(panel)).toBe(460);
  await sidebarHandle.focus();
  await page.keyboard.press("End");
  await expect.poll(width(sidebar)).toBe(420);
  await sidebarHandle.dblclick();
  await expect.poll(width(sidebar)).toBe(248);
  await page.reload();
  await expect.poll(width(sidebar)).toBe(248);

  // eingeklappte Seitenleiste hat keinen Griff
  await page.keyboard.press("ControlOrMeta+\\");
  await expect(sidebarHandle).toBeHidden();
  await page.keyboard.press("ControlOrMeta+\\");
  await expect(sidebarHandle).toBeVisible();
});

test("Rechte Spalten auf Heute, im Rückblick und in der Tag-Ansicht ziehen (#95) @desktop", async ({
  page,
}) => {
  const check = async (column: Locator, initial: number, max: number) => {
    const handle = page.getByRole("separator", {
      name: /^Breite der (rechten Spalte|Nebenspalte)$/,
    });
    await expect.poll(width(column)).toBe(initial);
    // Spalte am rechten Rand: nach links ziehen macht sie breiter
    await drag(page, handle, -80);
    await expect.poll(width(column)).toBe(initial + 80);
    await expectNoHorizontalOverflow(page);
    await page.reload();
    await expect.poll(width(column)).toBe(initial + 80);
    await handle.focus();
    await page.keyboard.press("End");
    await expect.poll(width(column)).toBe(max);
    await page.keyboard.press("Enter");
    await expect.poll(width(column)).toBe(initial);
  };

  // Heute: rechte Spalte mit Tagesablauf (360 px, Rand-Abstand pl-8 gehört zur Spalte)
  await page.goto("/heute");
  const todaySide = page
    .getByRole("separator", { name: "Breite der rechten Spalte" })
    .locator("..");
  await check(todaySide, 360, 640);

  // Rückblick: Zahlen, Tage, Projekte (380 px)
  const recapId = await seedRecap({ period_start: mondayWeeksAgo(61) });
  await page.goto(`/rueckblicke/${recapId}`);
  const recapSide = page
    .getByRole("separator", { name: "Breite der rechten Spalte" })
    .locator("..");
  await check(recapSide, 380, 640);

  // Kalender › Tag: Nebenspalte mit Tageslast und Aufgaben (320 px)
  await page.goto("/kalender?ansicht=tag");
  const daySide = page.getByRole("separator", { name: "Breite der Nebenspalte" }).locator("..");
  await check(daySide, 320, 640);
});

test("Woche: im hohen Fenster zeigt das Aufgaben-Band mehr als 3 Aufgaben je Tag (#97) @desktop", async ({
  page,
}) => {
  const prefix = uniqueName("Band");
  const { beruf } = await areaIds();
  // ein eigener Tag weit in der Zukunft – dort liegen keine Aufgaben anderer Tests
  const day = "2027-03-10";
  await seedTasks(
    [1, 2, 3, 4, 5, 6].map((i) => ({
      title: `${prefix} ${i}`,
      area_id: beruf,
      due_date: day,
    })),
  );
  const band = page.getByRole("region", { name: `Aufgaben am ${day}` });
  const visible = band.getByRole("listitem").filter({ hasText: prefix });

  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(`/kalender?ansicht=woche&tag=${day}`);
  await expect(visible).toHaveCount(3);
  await expect(band.getByRole("button", { name: /^\+ \d+ weitere$/ })).toBeVisible();

  // 1100 px: drei Zeilenhöhen (75 px) je weiterer Aufgabe → 7, alle sechs ohne „weitere“
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect(visible).toHaveCount(6);
  await expect(band.getByRole("button", { name: /weitere$/ })).toHaveCount(0);
});
