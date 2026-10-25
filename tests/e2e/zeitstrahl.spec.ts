/**
 * Zeitstrahl `/projekte/zeitstrahl` (#55, N2) gegen das Testprojekt, Desktop 1440 px und Mobil
 * 390 px: Projekte und Meilensteine an der richtigen Stelle (Reihenfolge, Heute-Linie, Zustand),
 * Filter Status/Zeitraum/Bereich wirken und bleiben nach dem Neuladen, Klick öffnet das Projekt,
 * Karten „Nächster Schritt“, 390 px ohne Seiten-Überlauf, axe. Desktop und Mobil laufen parallel
 * mit demselben Nutzer: jeder Test legt eigene Projekte an und prüft nur sie.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { isNarrow, openNavigation } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import {
  areaIds,
  berlinAddDays,
  berlinToday,
  seedDb,
  seedProject,
  seedTasks,
} from "./support/seed";

test.use({ storageState: AUTH_FILE });
test.setTimeout(60_000);

const today = berlinToday();
const day = (offset: number) => berlinAddDays(today, offset);

async function seedMilestone(
  projectId: string,
  title: string,
  due: string | null,
  done = false,
  sort = "a0",
) {
  const db = await seedDb();
  const { data, error } = await db
    .from("milestones")
    .insert({
      project_id: projectId,
      title,
      due_date: due,
      done_at: done ? new Date().toISOString() : null,
      sort,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Meilenstein: ${error.message}`);
  return data.id;
}

const row = (page: Page, id: string) => page.locator(`[data-timeline-row="${id}"]`);
const center = async (locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("kein Rahmen");
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    left: box.x,
    right: box.x + box.width,
  };
};

test("Achse: Reihenfolge, Heute-Linie und Meilensteine an der richtigen Stelle", async ({
  page,
}) => {
  const { beruf, privat } = await areaIds();
  const early = await seedProject({
    title: uniqueName("Früh"),
    area_id: beruf,
    status: "aktiv",
    start_date: day(-20),
    target_date: day(40),
  });
  const late = await seedProject({
    title: uniqueName("Spät"),
    area_id: privat,
    status: "geplant",
    start_date: day(10),
    target_date: day(70),
  });
  const done = await seedMilestone(early, "Erster Schritt", day(-10), true, "a0");
  const over = await seedMilestone(early, "Zweiter Schritt", day(-3), false, "a1");
  const open = await seedMilestone(early, "Dritter Schritt", day(15), false, "a2");
  await page.goto("/projekte/zeitstrahl");
  await expect(page.getByRole("heading", { name: "Zeitstrahl", level: 1 })).toBeVisible();
  await expect(row(page, early)).toBeVisible();
  await expect(row(page, late)).toBeVisible();

  // Reihenfolge nach Ziel: „Früh“ (Ziel in 40 Tagen) steht über „Spät“ (70 Tage)
  const a = await center(row(page, early));
  const b = await center(row(page, late));
  expect(a.y).toBeLessThan(b.y);

  // Heute-Linie liegt innerhalb des Balkens von „Früh“, links vom Balken von „Spät“
  const today_ = await center(page.getByTestId("timeline-today"));
  const barEarly = await center(page.locator(`[data-timeline-bar="${early}"]`));
  const barLate = await center(page.locator(`[data-timeline-bar="${late}"]`));
  expect(barEarly.left).toBeLessThan(today_.x);
  expect(barEarly.right).toBeGreaterThan(today_.x);
  expect(barLate.left).toBeGreaterThan(today_.x);

  // Meilensteine: Zustand und Lage (erreicht und überfällig links, offen rechts von heute)
  const mDone = page.locator(`[data-milestone="${done}"]`);
  const mOver = page.locator(`[data-milestone="${over}"]`);
  const mOpen = page.locator(`[data-milestone="${open}"]`);
  await expect(mDone).toHaveAttribute("data-state", "done");
  await expect(mOver).toHaveAttribute("data-state", "overdue");
  await expect(mOpen).toHaveAttribute("data-state", "open");
  const xs = [await center(mDone), await center(mOver), today_, await center(mOpen)].map(
    (p) => p.x,
  );
  expect(xs).toEqual([...xs].sort((p, q) => p - q));
  await expect(row(page, early)).toContainText("1 überfällig");
  await expect(page.getByTestId("timeline-stat-overdue")).not.toHaveText("0");

  // Karte „Nächster Schritt“: nächster offener Meilenstein = der überfällige
  const card = page.locator(`[data-timeline-card="${early}"]`);
  await expect(card).toContainText("Zweiter Schritt");
  await expect(card).toContainText("Nächster Schritt");
  await expect(page.locator(`[data-timeline-card="${late}"]`)).toHaveCount(0); // nicht aktiv
});

test("Filter Status und Zeitraum wirken und bleiben nach dem Neuladen", async ({ page }) => {
  const { beruf } = await areaIds();
  const paused = await seedProject({
    title: uniqueName("Pausiert"),
    area_id: beruf,
    status: "pausiert",
    start_date: day(-5),
    target_date: day(30),
  });
  const old = await seedProject({
    title: uniqueName("Alt"),
    area_id: beruf,
    status: "aktiv",
    start_date: day(-300),
    target_date: day(-250),
  });
  // eigenes Projekt im Zeitraum: die Achse steht auch, wenn sonst nichts im Testprojekt liegt
  await seedProject({
    title: uniqueName("Laufend"),
    area_id: beruf,
    status: "aktiv",
    start_date: day(-5),
    target_date: day(20),
  });
  await page.goto("/projekte/zeitstrahl");
  const status = page.getByRole("group", { name: "Status" });
  await expect(status.getByRole("button", { name: "Aktiv" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(status.getByRole("button", { name: "Geplant" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(status.getByRole("button", { name: "Pausiert" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByTestId("timeline-axis")).toBeVisible();
  await expect(row(page, paused)).toHaveCount(0);
  await expect(row(page, old)).toHaveCount(0); // außerhalb des Zeitraums (6 Monate)

  // Status: Pausiert dazu
  await status.getByRole("button", { name: "Pausiert" }).click();
  await expect(row(page, paused)).toBeVisible();

  // Zeitraum: Alles zeigt auch das alte Projekt
  await page
    .getByRole("radiogroup", { name: "Zeitraum" })
    .getByRole("radio", { name: "Alles" })
    .click();
  await expect(row(page, old)).toBeVisible();
  await expect(row(page, paused)).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("group", { name: "Status" }).getByRole("button", { name: "Pausiert" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("radiogroup", { name: "Zeitraum" }).getByRole("radio", { name: "Alles" }),
  ).toBeChecked();
  await expect(row(page, old)).toBeVisible();

  // zurück auf 3 Monate: ‹ › verschieben, „Heute“ holt zurück
  await page
    .getByRole("radiogroup", { name: "Zeitraum" })
    .getByRole("radio", { name: "3 Monate" })
    .click();
  await expect(row(page, old)).toHaveCount(0);
  const meta = page
    .getByRole("heading", { name: "Zeitstrahl", level: 1 })
    .locator("xpath=preceding-sibling::p");
  const first = await meta.textContent();
  await page.getByRole("button", { name: "Zeitraum weiter" }).click();
  await expect(meta).not.toHaveText(first ?? "");
  // im Inhalt – ein Reiter „Heute“ (#63) heißt sonst genauso
  await page.getByRole("main").getByRole("button", { name: "Heute", exact: true }).click();
  await expect(meta).toHaveText(first ?? "");
});

test("Bereichs-Schalter filtert; Hinweis „weitere in anderen Bereichen“", async ({ page }) => {
  const { beruf, privat } = await areaIds();
  const fw = await seedProject({
    title: uniqueName("Wache"),
    area_id: beruf,
    status: "aktiv",
    start_date: day(-5),
    target_date: day(20),
  });
  // in Privat nur „geplant“: aktive Projekte erscheinen in der Seitenleiste, und app-shell
  // prüft parallel im Bereich Privat, dass sie ohne Scrollen passt
  const pr = await seedProject({
    title: uniqueName("Garten"),
    area_id: privat,
    status: "geplant",
    start_date: day(-5),
    target_date: day(25),
  });
  // Bereich nicht in user_settings speichern (gemeinsamer Testnutzer, andere Tests laufen parallel)
  await page.route("**/rest/v1/user_settings?*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/projekte/zeitstrahl");
  await expect(row(page, fw)).toBeVisible();
  await expect(row(page, pr)).toBeVisible();
  const nav = await openNavigation(page);
  await nav.getByRole("radio", { name: "Privat" }).click();
  if (isNarrow(page)) await page.keyboard.press("Escape");
  await expect(row(page, pr)).toBeVisible();
  await expect(row(page, fw)).toHaveCount(0);
  await expect(page.getByText(/weitere Projekte? in anderen Bereichen/)).toBeVisible();
  await page.getByRole("button", { name: "Alle Bereiche zeigen" }).click();
  await expect(row(page, fw)).toBeVisible();
});

test("Klick auf Balken und Meilenstein öffnet das Projekt; ohne Termin als Liste", async ({
  page,
}) => {
  const { beruf } = await areaIds();
  const dated = await seedProject({
    title: uniqueName("Mit Datum"),
    area_id: beruf,
    status: "aktiv",
    start_date: day(-5),
    target_date: day(25),
  });
  const bare = await seedProject({
    title: uniqueName("Ohne Datum"),
    area_id: beruf,
    status: "aktiv",
  });
  const ms = await seedMilestone(dated, "Etappe", day(5));
  await page.goto("/projekte/zeitstrahl");
  const undated = page.getByTestId("timeline-undated");
  await expect(undated.locator(`a[href="/projekte/${bare}"]`)).toBeVisible();
  await expect(row(page, bare)).toHaveCount(0);

  // am linken Ende klicken: in der Mitte kann ein Meilenstein über dem Balken liegen
  await page.locator(`[data-timeline-bar="${dated}"]`).click({ position: { x: 6, y: 16 } });
  await expect(page).toHaveURL(new RegExp(`/projekte/${dated}$`));
  await page.goBack();
  await page.locator(`[data-milestone="${ms}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/projekte/${dated}$`));
});

test("Einstieg aus der Projekte-Datenbank, Hover-Kärtchen am Meilenstein @desktop", async ({
  page,
}) => {
  const { beruf } = await areaIds();
  const id = await seedProject({
    title: uniqueName("Hover"),
    area_id: beruf,
    status: "aktiv",
    start_date: day(-5),
    target_date: day(25),
  });
  const ms = await seedMilestone(id, "Abnahme Halle", day(7));
  await seedTasks([
    {
      title: uniqueName("Abnahme vorbereiten"),
      area_id: beruf,
      project_id: id,
      milestone_id: ms,
    },
  ]);
  await page.goto("/projekte");
  await page.getByRole("link", { name: "Zeitstrahl" }).first().click();
  await expect(page).toHaveURL(/\/projekte\/zeitstrahl$/);
  await page.locator(`[data-milestone="${ms}"]`).hover();
  const hover = page.getByTestId("milestone-hover");
  await expect(hover).toContainText("Abnahme Halle");
  await expect(hover).toContainText("fällig");
  await expect(hover).toContainText("0 von 1 Aufgaben");
});

test("Rechtsklick auf eine Zeile: Link kopieren @desktop", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { beruf } = await areaIds();
  const id = await seedProject({
    title: uniqueName("Menü"),
    area_id: beruf,
    status: "aktiv",
    start_date: day(-5),
    target_date: day(25),
  });
  await page.goto("/projekte/zeitstrahl");
  await row(page, id).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Link kopieren" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/projekte/${id}`);
});

test("390 px: Seite ohne Überlauf, Achse scrollt in sich; axe", async ({ page }) => {
  const { beruf } = await areaIds();
  const id = await seedProject({
    title: uniqueName("Handy"),
    area_id: beruf,
    status: "aktiv",
    start_date: day(-30),
    target_date: day(60),
  });
  await seedMilestone(id, "Mitte", day(-2));
  await seedMilestone(id, "Ende", day(55));
  await page.goto("/projekte/zeitstrahl");
  await expect(row(page, id)).toBeVisible();
  await expect(page.locator(`[data-timeline-card="${id}"]`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (isNarrow(page)) {
    const axis = page.getByTestId("timeline-axis");
    expect(await axis.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    // Heute-Linie ist beim Öffnen im Bild
    const line = await center(page.getByTestId("timeline-today"));
    const viewport = page.viewportSize()?.width ?? 0;
    expect(line.x).toBeGreaterThan(0);
    expect(line.x).toBeLessThan(viewport);
  }
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});
