/**
 * Rückmeldung #80: Jede Spalte am Rand lässt sich oben mit einem kleinen Knopf zum senkrechten
 * Reiter zusammenschieben – Wissen (Themen, Notizliste), Projekt (Steckbrief) und die offene
 * Aufgabe. Desktop 1440 px; am Handy gibt es keine Spalten, dort bleibt alles sichtbar.
 * Rückmeldung #83: Die Spalten im Wissen lassen sich am Rand breiter und schmaler ziehen.
 */
import { expect, type Locator, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedNotes, seedProject, seedTasks } from "./support/seed";

test.use({ storageState: AUTH_FILE });

test("Wissen: Themen und Notizliste einzeln einklappen, das Gerät merkt es sich (#80) @desktop", async ({
  page,
}) => {
  const prefix = uniqueName("Einklappen");
  const { beruf } = await areaIds();
  const [noteId] = await seedNotes([{ title: `${prefix} Notiz`, area_id: beruf, type: "wissen" }]);

  await page.goto(`/wissen/${noteId}`);
  const topics = page.getByRole("navigation", { name: "Themen" });
  const list = page.getByRole("region", { name: "Notizliste" });
  await expect(topics).toBeVisible();
  await expect(list).toBeVisible();

  await topics.getByRole("button", { name: "Themen einklappen" }).click();
  await expect(topics).toBeHidden();
  const topicsRail = page.getByRole("button", { name: "Themen wieder einblenden" });
  await expect(topicsRail).toBeVisible();
  await expect(list).toBeVisible();

  await list.getByRole("button", { name: "Notizliste einklappen" }).click();
  await expect(list).toBeHidden();
  const listRail = page.getByRole("button", { name: "Alles Wissen wieder einblenden" });
  await expect(listRail).toBeVisible();
  // Reiter in der Reihenfolge der Spalten: Themen links, dann die Liste
  const topicsBox = await topicsRail.boundingBox();
  const listBox = await listRail.boundingBox();
  expect(topicsBox?.x ?? 0).toBeLessThan(listBox?.x ?? 0);
  // die Notiz bleibt offen und bekommt den Platz
  await expect(page.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} Notiz`,
  );
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  // je Gerät gemerkt
  await page.reload();
  await expect(topicsRail).toBeVisible();
  await expect(listRail).toBeVisible();
  await expect(list).toBeHidden();

  await listRail.click();
  await expect(list).toBeVisible();
  await expect(listRail).toHaveCount(0);
  await expect(topics).toBeHidden();
  await topicsRail.click();
  await expect(topics).toBeVisible();
  await expect(topicsRail).toHaveCount(0);
});

test("Wissen: Themen, Notizliste und Verknüpfungen breiter ziehen, das Gerät merkt es sich (#83) @desktop", async ({
  page,
}) => {
  const prefix = uniqueName("Breite");
  const { beruf } = await areaIds();
  const [noteId] = await seedNotes([{ title: `${prefix} Notiz`, area_id: beruf, type: "wissen" }]);

  await page.goto(`/wissen/${noteId}`);
  const topics = page.getByRole("navigation", { name: "Themen" });
  const list = page.getByRole("region", { name: "Notizliste" });
  const topicsHandle = page.getByRole("separator", { name: "Breite der Themen" });
  const listHandle = page.getByRole("separator", { name: "Breite der Notizliste" });
  const width = (column: Locator) => async () =>
    Math.round((await column.boundingBox())?.width ?? 0);
  const drag = async (handle: Locator, dx: number) => {
    const box = await handle.boundingBox();
    if (!box) throw new Error("Griff nicht gefunden");
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + 200, { steps: 6 });
    await page.mouse.up();
  };
  await expect.poll(width(topics)).toBe(240);
  await expect.poll(width(list)).toBe(320);

  await drag(topicsHandle, 80);
  await expect.poll(width(topics)).toBe(320);
  await drag(listHandle, 160);
  await expect.poll(width(list)).toBe(480);
  await expect(listHandle).toHaveAttribute("aria-valuenow", "480");
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  // je Gerät gemerkt
  await page.reload();
  await expect.poll(width(topics)).toBe(320);
  await expect.poll(width(list)).toBe(480);

  // Tastatur: Grenzen 256–640, Enter bzw. Doppelklick = Standard
  await listHandle.focus();
  await page.keyboard.press("Home");
  await expect.poll(width(list)).toBe(256);
  await page.keyboard.press("End");
  await expect.poll(width(list)).toBe(640);
  await page.keyboard.press("Enter");
  await expect.poll(width(list)).toBe(320);
  await topicsHandle.dblclick();
  await expect.poll(width(topics)).toBe(240);

  // eingeklappt kein Griff
  await topics.getByRole("button", { name: "Themen einklappen" }).click();
  await expect(topicsHandle).toBeHidden();
  await page.getByRole("button", { name: "Themen wieder einblenden" }).click();
  await expect(topicsHandle).toBeVisible();

  // Verknüpfungen stehen erst ab 2200 px neben der Notiz, der Griff sitzt an ihrem linken Rand
  await page.setViewportSize({ width: 2400, height: 900 });
  const links = page.getByRole("complementary", { name: "Verknüpfungen" });
  const linksHandle = page.getByRole("separator", { name: "Breite der Verknüpfungen" });
  await expect.poll(width(links)).toBe(288);
  await drag(linksHandle, -96);
  await expect.poll(width(links)).toBe(384);
  await page.reload();
  await expect.poll(width(links)).toBe(384);
  await linksHandle.dblclick();
  await expect.poll(width(links)).toBe(288);
});

test("Projekt: Steckbrief zum Reiter einklappen und wieder aufklappen (#80) @desktop", async ({
  page,
}) => {
  const prefix = uniqueName("Einklappen");
  const { beruf } = await areaIds();
  const projectId = await seedProject({ title: `${prefix} Projekt`, area_id: beruf });

  await page.goto(`/projekte/${projectId}`);
  const steckbrief = page.getByRole("complementary", { name: "Steckbrief" });
  const tabs = page.getByRole("tablist", { name: "Projekt-Reiter" });
  await expect(steckbrief).toBeVisible();
  const before = (await tabs.boundingBox())?.x ?? 0;

  await steckbrief.getByRole("button", { name: "Steckbrief einklappen" }).click();
  await expect(steckbrief).toBeHidden();
  const rail = page.getByRole("button", { name: "Steckbrief wieder einblenden" });
  await expect(rail).toBeVisible();
  // die Reiter des Projekts rücken nach links
  expect((await tabs.boundingBox())?.x ?? 0).toBeLessThan(before - 200);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await page.reload();
  await expect(rail).toBeVisible();
  await rail.click();
  await expect(steckbrief).toBeVisible();
  await expect(rail).toHaveCount(0);
});

test("Aufgabe: Panel nach rechts einklappen, Öffnen klappt wieder auf (#80) @desktop", async ({
  page,
}) => {
  const prefix = uniqueName("Einklappen");
  const { beruf } = await areaIds();
  const [taskId] = await seedTasks([{ title: `${prefix} Aufgabe`, area_id: beruf }]);

  await page.goto(`/aufgaben?aufgabe=${taskId}`);
  const panel = page.getByRole("complementary", { name: "Aufgabe" });
  await expect(panel.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} Aufgabe`,
  );

  await panel.getByRole("button", { name: "Aufgabe einklappen" }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/eingeklappt=1/);
  const rail = page.getByRole("button", { name: "Aufgabe wieder einblenden" });
  await expect(rail).toBeVisible();
  const viewport = page.viewportSize()?.width ?? 1440;
  const box = await rail.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(viewport - 2);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  // Reiter klappt auf
  await rail.click();
  await expect(panel).toBeVisible();
  await expect(page).not.toHaveURL(/eingeklappt/);

  // eingeklappt aus „Ganze Breite“: die Seite dahinter kommt zurück
  await panel.getByRole("button", { name: "Ganze Breite" }).click();
  await expect(page.getByRole("button", { name: "Aufgaben wieder einblenden" })).toBeVisible();
  await panel.getByRole("button", { name: "Aufgabe einklappen" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Aufgaben wieder einblenden" })).toHaveCount(0);
  await expect(page.getByRole("main")).toBeVisible();

  // dieselbe Aufgabe in der Liste erneut öffnen zeigt sie wieder
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill(prefix);
  await page
    .getByRole("main")
    .getByRole("link", { name: `${prefix} Aufgabe` })
    .click();
  await expect(panel).toBeVisible();
  await expect(rail).toHaveCount(0);
});

test("Handy: gemerkte eingeklappte Spalten bleiben sichtbar, kein Einklapp-Knopf und Griff (#80, #83) @mobile", async ({
  page,
}) => {
  const prefix = uniqueName("Einklappen");
  const { beruf } = await areaIds();
  const projectId = await seedProject({ title: `${prefix} Projekt`, area_id: beruf });
  // Stand vom Laptop desselben Browsers: alles eingeklappt
  await page.addInitScript(() => {
    for (const key of ["sz:wissen-themen-zu", "sz:wissen-liste-zu", "sz:steckbrief-zu"]) {
      window.localStorage.setItem(key, "1");
    }
    window.localStorage.setItem("sz:wissen-liste-breite", "640");
  });

  await page.goto("/wissen");
  const list = page.getByRole("region", { name: "Notizliste" });
  await expect(list).toBeVisible();
  await expect(page.getByRole("button", { name: "Notizliste einklappen" })).toBeHidden();
  await expect(page.getByRole("button", { name: /wieder einblenden$/ })).toHaveCount(0);
  // gezogene Breite vom Laptop gilt am Handy nicht (#83), kein Griff
  expect(Math.round((await list.boundingBox())?.width ?? 0)).toBe(390);
  await expect(page.getByRole("separator", { name: /^Breite der/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto(`/projekte/${projectId}`);
  const steckbrief = page.getByRole("complementary", { name: "Steckbrief" });
  await expect(steckbrief).toBeVisible();
  await expect(steckbrief.getByRole("button", { name: "Steckbrief einklappen" })).toBeHidden();
  // „Ganze Breite“ gibt es erst am Laptop (vorher stand der Knopf auch am Handy)
  await expect(steckbrief.getByRole("button", { name: "Ganze Breite" })).toBeHidden();
  await expectNoHorizontalOverflow(page);
});
