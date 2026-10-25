/**
 * Kalender-Seite (S2b) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px: Woche mit
 * Google-Terminen (eigene ICS unter /dev/ics) und Aufgaben in fester Ordnung, Überfälliges heute,
 * Verschieben über das Menü mit Rückgängig, Ziehen mit der Maus (Desktop), Monat, Liste, Tasten.
 * Feste Uhr: Mittwoch, 21.10.2026 (die Test-ICS hat in dieser Woche feste Termine); eigene
 * Sitzung, weil das Datum in der Zukunft liegt. Desktop und Mobil laufen parallel mit demselben
 * Nutzer: jeder Test filtert auf seine Titel (Termine der Test-ICS können doppelt da sein).
 */
import { expect, type Page, test } from "@playwright/test";
import { berlinDateTime } from "@/lib/dates";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import {
  areaIds,
  deleteCalendarSource,
  seedCalendarSource,
  seedDb,
  seedTasks,
} from "./support/seed";
import { freshContext } from "./support/session";

test.use({ storageState: AUTH_FILE });
// vier Ansichten, zwei axe-Läufe und Verschieben in einem Lauf: mehr Zeit als die 30 s Standard
test.setTimeout(90_000);

const TODAY = "2026-10-21";
const NOW = berlinDateTime(TODAY, "10:00");

/** Einträge im Zeitraster, die links oder rechts über ihre Tagesspalte hinausragen. */
const blocksOutsideColumn = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const column of document.querySelectorAll<HTMLElement>("[data-calendar-day]")) {
      const c = column.getBoundingClientRect();
      for (const block of column.querySelectorAll<HTMLElement>("[data-calendar-item]")) {
        const b = block.getBoundingClientRect();
        if (b.right > c.right + 1 || b.left < c.left - 1) {
          out.push(`${block.textContent?.slice(0, 40)}: ${Math.round(b.right - c.right)} px`);
        }
      }
    }
    return out;
  });

/**
 * „＋ Aufgabe“/„＋ Termin“ eines Tages, die über ihre Tageszelle hinausragen (N4): Am Desktop
 * unsichtbar bis zum Drüberfahren, aber klickbar – ragten sie in den Nachbartag, fingen sie dort
 * Klicks auf Aufgaben ab (Rechtsklick auf „Alt“ landete auf „Termin für Dienstag anlegen“).
 */
const addButtonsOutsideDay = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const button of document.querySelectorAll<HTMLElement>("button[aria-label]")) {
      const label = button.getAttribute("aria-label") ?? "";
      if (!/^(Aufgabe|Termin) für \d{4}-\d{2}-\d{2} anlegen$/.test(label)) continue;
      const cell = button.closest<HTMLElement>("[data-drop-target]");
      if (!cell) continue;
      const c = cell.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      if (b.right > c.right + 1 || b.left < c.left - 1) {
        out.push(`${label}: ${Math.round(b.right - c.right)} px`);
      }
    }
    return out;
  });

/** Zeile einer Aufgabe (der Link-Name enthält auch die Meta-Zeile, deshalb „beginnt mit“). */
// ohne die Einplanen-Spalte: sie zeigt seit #62 auch fällige Aufgaben ohne Uhrzeit
const taskRow = (page: Page, title: string) =>
  page
    .locator("[data-calendar-item]:not(aside [data-calendar-item])")
    .filter({ has: page.getByRole("link", { name: new RegExp(`^${title}`) }) });

test("Woche: Termine, feste Ordnung, Überfälliges heute, Verschieben mit Rückgängig, Monat, Liste, Tasten", async ({
  page,
  browser,
  baseURL,
}) => {
  const prefix = uniqueName("Kal");
  const { beruf } = await areaIds();
  const t = (name: string) => `${prefix} ${name}`;
  const ids = await seedTasks([
    { title: t("Heute fällig"), area_id: beruf, due_date: TODAY },
    { title: t("Alt"), area_id: beruf, due_date: "2026-10-15" },
    {
      title: t("Block"),
      area_id: beruf,
      scheduled_at: berlinDateTime("2026-10-23", "09:00"),
      duration_min: 60,
      due_date: "2026-10-23",
    },
    { title: t("Morgen"), area_id: beruf, due_date: "2026-10-22" },
    {
      title: t("Fertig"),
      area_id: beruf,
      due_date: TODAY,
      status: "erledigt",
      completed_at: NOW,
    },
    { title: t("Lose"), area_id: beruf },
    // viele Aufgaben ohne Datum: die Einplanen-Spalte muss in sich scrollen, nicht die Seite
    ...Array.from({ length: 14 }, (_, i) => ({ title: t(`Lose ${i + 1}`), area_id: beruf })),
    {
      title: t("Wiederholt"),
      area_id: beruf,
      due_date: TODAY,
      recurrence: "FREQ=WEEKLY;BYDAY=WE",
    },
  ]);
  const source = await seedCalendarSource({
    name: t("Quelle"),
    url: `${baseURL}/dev/ics?name=probe`,
  });

  const context = await freshContext(browser, baseURL as string, {
    // Desktop bewusst 1440×800 (typischer Laptop): die ganze Woche muss ohne Seiten-Scrollen passen
    viewport: isNarrow(page) ? (page.viewportSize() ?? undefined) : { width: 1440, height: 800 },
    hasTouch: isNarrow(page),
    clockUntil: new Date("2026-11-30T00:00:00Z"),
  });
  try {
    const p = await context.newPage();
    await p.clock.setFixedTime(new Date(NOW));
    await p.goto("/kalender?ansicht=woche");
    await expect(p.getByRole("heading", { level: 1, name: /20\d\d/ })).toBeVisible();
    await expect(p.getByText("KW 43 · 19.–25.10.2026")).toBeVisible();
    // #67: Monat und Jahr groß als einzige h1, „Kalender“ klein darüber
    await expect(p.getByRole("heading", { level: 1 })).toHaveText("Oktober 2026");
    await expect(p.getByRole("heading", { level: 1 })).toHaveCount(1);
    const main = p.getByRole("main");
    // axe erst nach den Einblend-Animationen (Regel aus docs/stand.md: 300 ms)
    await p.waitForTimeout(500);
    await expectNoA11yViolations(p);

    // Termine aus der Test-ICS (Mi 21.10. 09:00 Online-Schulung) und Aufgaben in fester Ordnung
    await expect(
      main.getByRole("button", { name: /^Online-Schulung, 09:00–/ }).first(),
    ).toBeVisible();
    const old = taskRow(p, t("Alt"));
    await expect(old).toContainText(/überfällig/);
    await expect(p.getByTestId("calendar-summary")).toContainText(/\d überfällig/);
    // Zeitblock am Freitag mit Uhrzeit
    await expect(taskRow(p, t("Block"))).toContainText("09:00");
    if (!isNarrow(page)) {
      // Aufgaben ohne Uhrzeit als Band über dem Raster: Überfälliges bei 1440×800 ohne Scrollen
      // im Bild, höchstens 3 je Tag – der Rest hinter „N weitere“ (der parallele Mobil-Test legt
      // dieselben Aufgaben an, deshalb erst aufklappen, dann die übrigen prüfen); das Raster
      // scrollt in sich, die Seite nicht
      const band = p.getByRole("region", { name: `Aufgaben am ${TODAY}` });
      const grid = p.locator("[data-calendar-grid]");
      await expect(old).toBeInViewport();
      const [bandBox, gridBox] = await Promise.all([band.boundingBox(), grid.boundingBox()]);
      expect(bandBox && gridBox && bandBox.y + bandBox.height <= gridBox.y + 1).toBe(true);
      expect(
        await p.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
      ).toBeLessThanOrEqual(0);
      // die erledigte sortiert zuletzt und steckt hinter „weitere“
      await expect(taskRow(p, t("Fertig"))).toHaveCount(0);
      await band.getByRole("button", { name: /weitere$/ }).click();
    }
    await expect(taskRow(p, t("Heute fällig"))).toBeVisible();
    // erledigte Aufgabe gedämpft, aber da
    await expect(taskRow(p, t("Fertig"))).toBeVisible();
    // Zeitraster (Desktop): Zeitblock mit Griff für die Dauer, Jetzt-Linie heute
    if (!isNarrow(page)) {
      await expect(
        p.getByRole("button", { name: new RegExp(`Dauer von „${prefix} Block“`) }),
      ).toBeVisible();
      await expect(main.locator("[data-now-line]")).toHaveCount(1);
      // Blöcke bleiben in ihrer Tagesspalte – auch mit langem Ort („Online-Schulung“ in der
      // Landesberufschule): Text wird gekürzt statt die Spalte zu sprengen
      expect(await blocksOutsideColumn(p)).toEqual([]);
      expect(await addButtonsOutsideDay(p)).toEqual([]);
    }
    await expectNoHorizontalOverflow(p);

    // Termin-Detail
    // force: der parallele Mobil-Test bindet dieselbe Test-ICS ein, die Blöcke liegen dann nebeneinander
    await main
      .getByRole("button", { name: /^Online-Schulung, 09:00–/ })
      .first()
      .click({ force: true });
    await expect(p.getByRole("dialog")).toContainText("Online-Schulung");
    await p.keyboard.press("Escape");

    // Verschieben über das Menü (Handy ⋯, Desktop Rechtsklick): morgen → Rückgängig → zurück
    const alt = taskRow(p, t("Alt"));
    if (isNarrow(page)) {
      // ⋯-Menü: Ziele flach (Untermenüs sind am Handy unzuverlässig)
      await alt.getByRole("button", { name: `Mehr zu „${t("Alt")}“` }).click();
    } else {
      await alt.getByRole("link", { name: new RegExp(`^${t("Alt")}`) }).click({ button: "right" });
      await p.getByRole("menuitem", { name: "Verschieben auf …" }).click();
    }
    await p.getByRole("menuitem", { name: "Morgen" }).click();
    await expect(p.getByText(`„${t("Alt")}“ → morgen`)).toBeVisible();
    await expect(taskRow(p, t("Alt"))).not.toContainText(/überfällig/);
    await p.getByRole("button", { name: "Rückgängig" }).click();
    await expect(taskRow(p, t("Alt"))).toContainText(/überfällig/);
    await expectSaved(p);

    // Tasten: → nächste Woche, T zurück
    await p.keyboard.press("ArrowRight");
    await expect(p.getByText("KW 44 · 26.10.–01.11.2026")).toBeVisible();
    await expect(p.getByRole("heading", { level: 1 })).toHaveText("Okt – Nov 2026");
    // vorausberechnete Wiederholung (blass) am Dienstag der nächsten Woche
    await expect(
      main.getByRole("link", { name: new RegExp(`^${prefix} Wiederholt`) }).first(),
    ).toBeVisible();
    await p.keyboard.press("t");
    await expect(p.getByText("KW 43 · 19.–25.10.2026")).toBeVisible();
    await expect(p.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 12_000 });
    if (!isNarrow(page)) await expectNoA11yViolations(p);

    // Monat: Chips bzw. Punkte, Feiertag am 1.11. (Allerheiligen) im Raster
    await p.keyboard.press("m");
    await expect(p.getByRole("heading", { level: 1, name: "Oktober 2026" })).toBeVisible();
    // #85: der Monat scrollt durch, die Tage tragen den Monat im Namen
    await expect(
      main.getByRole("button", { name: /Sonntag, 1\. November Allerheiligen/ }),
    ).toBeVisible();
    if (isNarrow(page)) {
      await main.getByRole("button", { name: /^Mittwoch, 21\./ }).click();
      await expect(main.getByRole("region", { name: "Mittwoch 21." })).toContainText(
        t("Heute fällig"),
      );
    } else {
      // Überfälliges steht in der Zelle zuerst (bei vielen Einträgen zeigt sie „+ N weitere“)
      await expect(
        main.getByRole("link", { name: new RegExp(`${t("Alt")}`) }).first(),
      ).toBeVisible();
    }
    await expectNoHorizontalOverflow(p);

    // Liste: 14 Tage ab heute
    await p.keyboard.press("l");
    await expect(p.getByText("21.10.–03.11.2026 · 14 Tage")).toBeVisible();
    await expect(main.getByRole("region", { name: "Freitag 23." })).toContainText(t("Block"));

    // Tag
    await p.keyboard.press("d");
    await expect(p.getByText(/Mittwoch, 21\. Oktober 2026 · KW 43/)).toBeVisible();
    await expect(main.getByRole("region", { name: "Tageslast" })).toBeVisible();
    await expectNoHorizontalOverflow(p);
    await p.waitForTimeout(500);
    await expectNoA11yViolations(p);
  } finally {
    await context.close();
    await deleteCalendarSource(source);
    await (await seedDb()).from("tasks").delete().in("id", ids);
  }
});

test("Einplanen: Aufgabe ohne Datum auf einen Tag ziehen, zurückziehen entfernt das Datum @desktop", async ({
  page,
  browser,
  baseURL,
}) => {
  const prefix = uniqueName("KalDnd");
  const { beruf } = await areaIds();
  const title = `${prefix} Lose`;
  const ids = await seedTasks([{ title, area_id: beruf }]);
  const context = await freshContext(browser, baseURL as string, {
    viewport: page.viewportSize() ?? undefined,
    clockUntil: new Date("2026-11-30T00:00:00Z"),
  });
  try {
    const p = await context.newPage();
    // hohes Fenster: Quelle und Ziel liegen nie im unteren Rand, in dem dnd-kit beim Ziehen die
    // Seite weiterscrollt (sonst trifft der Zeiger einen anderen Slot)
    await p.setViewportSize({ width: 1440, height: 1400 });
    await p.clock.setFixedTime(new Date(NOW));
    await p.goto("/kalender?ansicht=woche");
    const plan = p.getByRole("complementary", { name: "Einplanen" });
    // die Spalte ist lang (alle Aufgaben ohne Uhrzeit): per Suche nach vorn holen
    await plan.getByRole("searchbox", { name: "Aufgaben zum Einplanen suchen" }).fill(title);
    await expect(plan.getByRole("link", { name: title, exact: true })).toBeVisible();
    await expect(p.getByRole("region", { name: "Aufgaben am 2026-10-22" })).toBeVisible();
    // Seite zur Ruhe kommen lassen (Schriften, Raster), bevor der erste Zug startet
    await p.waitForTimeout(800);

    // Ziehen mit der Maus (dnd-kit: ab 6 px) – unter Last langsam, und wenn der Griff nicht
    // ansprang, noch einmal ansetzen (wie ein Mensch)
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await p.mouse.move(from.x, from.y);
      await p.mouse.down();
      await p.waitForTimeout(80);
      await p.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
      await p.waitForTimeout(80);
      await p.mouse.move(to.x, to.y, { steps: 20 });
      await p.waitForTimeout(120);
      await p.mouse.up();
    };
    const center = async (locator: ReturnType<Page["locator"]>) => {
      const box = await locator.boundingBox({ timeout: 5_000 });
      if (!box) throw new Error("Element nicht sichtbar");
      // knapp unter der Oberkante: bei den 20 px hohen Halbstunden-Feldern zählt der Zeiger, nicht
      // die Mitte des gezogenen Kastens
      return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 6) };
    };
    const dragUntil = async (
      source: ReturnType<Page["locator"]>,
      target: ReturnType<Page["locator"]>,
      arrived: ReturnType<Page["locator"]>,
    ) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await drag(await center(source), await center(target));
        // unter Last braucht das Ziel einen Moment; ohne Warten zöge der nächste Versuch an
        // einem Element, das es schon nicht mehr gibt
        const ok = await expect(arrived)
          .toBeVisible({ timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        if (ok) return;
        // Quelle weg, Ziel (noch) nicht da: nur noch warten statt neu ziehen
        if (!(await source.isVisible())) break;
        await p.waitForTimeout(500);
      }
      await expect(arrived).toBeVisible({ timeout: 10_000 });
    };

    // auf Donnerstag ziehen → Fälligkeit 22.10. (Toast mit Rückgängig)
    const source = plan.locator(`[data-drag-task="${ids[0]}"]`);
    const thursday = p.getByRole("region", { name: "Aufgaben am 2026-10-22" });
    await dragUntil(source, thursday, thursday.getByRole("link", { name: title, exact: true }));
    await expect(p.getByText(`„${title}“ → morgen`)).toBeVisible();
    await expectSaved(p);

    // auf 14:00 am Freitag ziehen → Zeitblock (1 h ohne Dauer), Griff für die Dauer
    const slot = p.locator('[data-drop-target="slot:2026-10-23:840"]');
    await dragUntil(
      thursday.locator(`[data-drag-task="${ids[0]}"]`),
      slot,
      p.getByRole("button", { name: `Dauer von „${title}“ ändern (1 h)` }),
    );
    await expect(p.getByRole("main").locator(`[data-drag-task="${ids[0]}"]`)).toContainText(
      "14:00–15:00",
    );
    await expectSaved(p);

    // zurück in die Spalte → ohne Datum
    const block = p.getByRole("main").locator(`[data-drag-task="${ids[0]}"]`);
    await dragUntil(
      block,
      plan.getByRole("region", { name: "Einplanen: Aufgaben ohne Datum" }),
      plan.getByRole("link", { name: title, exact: true }),
    );
    await expect(p.getByText(`„${title}“ ohne Datum`)).toBeVisible();
    await expectSaved(p);
  } finally {
    await context.close();
    await (await seedDb()).from("tasks").delete().in("id", ids);
  }
});

/** #61: Projekt mit Meilenstein und einer Aufgabe mit langem Titel ohne Datum. */
async function seedPlanTask(prefix: string) {
  const { beruf } = await areaIds();
  const db = await seedDb();
  const project = `${prefix} Rezeptbuch`;
  const projectId = crypto.randomUUID();
  const milestoneId = crypto.randomUUID();
  const title = `${prefix} Datenbank-Schema für Rezepte und Zutaten anlegen und die erste Migration schreiben`;
  const p = await db
    .from("projects")
    .insert({ id: projectId, area_id: beruf, title: project, sort: "zz" });
  if (p.error) throw new Error(p.error.message);
  const m = await db
    .from("milestones")
    .insert({ id: milestoneId, project_id: projectId, title: "Grundgerüst", sort: "a0" });
  if (m.error) throw new Error(m.error.message);
  const [taskId] = await seedTasks([
    { title, area_id: beruf, milestone_id: milestoneId, body_text: "Tabellen rezepte, zutaten" },
  ]);
  const cleanup = async () => {
    await db
      .from("tasks")
      .delete()
      .eq("id", taskId as string);
    await db.from("milestones").delete().eq("id", milestoneId);
    await db.from("projects").delete().eq("id", projectId);
  };
  return { project, title, cleanup };
}

test("Einplanen (#61): Spalte ziehbar und zuklappbar, Titel umbrochen mit Projekt › Meilenstein, Kärtchen beim Drüberfahren @desktop", async ({
  page,
}) => {
  const seeded = await seedPlanTask(uniqueName("Plan61"));
  try {
    await page.goto("/kalender?ansicht=woche");
    const plan = page.getByRole("complementary", { name: "Einplanen" });
    const link = plan.getByRole("link", { name: new RegExp(`^${seeded.title}`) });
    await expect(link).toBeVisible();
    // Einplanen D (#62): Projekt und Meilenstein stehen im Gruppenkopf, nicht in jeder Zeile
    const group = plan.getByRole("region", { name: seeded.project });
    await expect(group).toContainText("Grundgerüst");
    await expect(group.getByRole("link", { name: new RegExp(`^${seeded.title}`) })).toBeVisible();

    // Drüberfahren: Kärtchen mit vollem Titel, Projekt › Meilenstein und Notizanfang
    await link.hover();
    const card = page.getByTestId("task-hover");
    await expect(card).toBeVisible();
    await expect(card).toContainText(seeded.title);
    await expect(card).toContainText(`${seeded.project} › Grundgerüst`);
    await expect(card).toContainText("Tabellen rezepte, zutaten");
    await page.mouse.move(10, 10);
    await expect(card).toBeHidden();

    // breiter ziehen (Tastatur am Griff), bleibt nach dem Neuladen
    const handle = plan.getByRole("separator", { name: "Breite der Einplanen-Spalte" });
    await expect(handle).toHaveAttribute("aria-valuenow", "320");
    await handle.focus();
    await handle.press("ArrowLeft");
    await handle.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "352");
    const width = (await plan.boundingBox())?.width ?? 0;
    expect(width).toBeGreaterThan(340);
    await page.reload();
    await expect(
      page
        .getByRole("complementary", { name: "Einplanen" })
        .getByRole("separator", { name: "Breite der Einplanen-Spalte" }),
    ).toHaveAttribute("aria-valuenow", "352");

    // einklappen → senkrechter Reiter „Einplanen“ mit Anzahl; Klick klappt wieder auf
    await page.getByRole("button", { name: "Einplanen einklappen" }).click();
    await expect(page.getByRole("complementary", { name: "Einplanen" })).toHaveCount(0);
    const rail = page.getByRole("button", { name: "Einplanen wieder einblenden" });
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute("title", /Einplanen aufklappen – \d+ Aufgabe/);
    await expectNoHorizontalOverflow(page);
    await rail.click();
    await expect(page.getByRole("complementary", { name: "Einplanen" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
  } finally {
    await seeded.cleanup();
  }
});

test("Einplanen (#61) am Handy: voller Titel und Projekt › Meilenstein im Sheet @mobile", async ({
  page,
}) => {
  const seeded = await seedPlanTask(uniqueName("Plan61m"));
  try {
    await page.goto("/kalender?ansicht=woche");
    await page.getByRole("button", { name: "Einplanen" }).click();
    const sheet = page.getByRole("dialog", { name: "Einplanen" });
    const link = sheet.getByRole("link", { name: new RegExp(`^${seeded.title}`) });
    await expect(link).toBeVisible();
    await expect(sheet.getByRole("region", { name: seeded.project })).toContainText("Grundgerüst");
    // ungekürzt: der Titel bricht um statt abgeschnitten zu werden
    const clipped = await link
      .locator("span")
      .first()
      .evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      );
    expect(clipped).toBe(false);
    await expectNoHorizontalOverflow(page);
  } finally {
    await seeded.cleanup();
  }
});
