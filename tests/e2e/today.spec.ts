/**
 * Heute + Abendplanung (B9) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px:
 * blockierte Aufgaben fehlen; ab 19:00 ist die Abendplanung hervorgehoben; die Wahl steht am
 * nächsten Tag oben unter „Fokus heute“ – mit page.clock auch über die Zeitumstellung am
 * 25.10.2026 (eigene Sitzung, weil das Datum in der Zukunft liegt). `setFixedTime` statt `install`:
 * nur die Uhrzeit ist fest, Timer und Animationen laufen echt (sonst warten Klicks unter Last ewig).
 */
import { expect, type Page, test } from "@playwright/test";
import { berlinDateTime } from "@/lib/dates";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import {
  areaIds,
  berlinAddDays,
  berlinToday,
  deleteCalendarSource,
  seedCalendarSource,
  seedDependency,
  seedTasks,
} from "./support/seed";
import { freshContext } from "./support/session";
import { taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const evening = (page: Page) => card(page, "Abendplanung");

test("Heute ohne blockierte Aufgaben: Fokus, Fällig & überfällig, Tagesablauf mit Google-Terminen", async ({
  page,
  baseURL,
}) => {
  const prefix = uniqueName("Heute");
  const { beruf } = await areaIds();
  const today = berlinToday();
  const [blocker, blocked, , , focusBlocked] = await seedTasks([
    { title: `${prefix} Blocker`, area_id: beruf, due_date: today },
    { title: `${prefix} Wartet`, area_id: beruf, due_date: today },
    { title: `${prefix} Gestern`, area_id: beruf, due_date: berlinAddDays(today, -1) },
    { title: `${prefix} Fokus`, area_id: beruf, focus_date: today },
    { title: `${prefix} Fokus blockiert`, area_id: beruf, focus_date: today },
    { title: `${prefix} Termin`, area_id: beruf, scheduled_at: berlinDateTime(today, "09:00") },
  ]);
  await seedDependency(blocked as string, blocker as string);
  await seedDependency(focusBlocked as string, blocker as string);
  // Google-Termine (S2c): tägliche Test-ICS – „Lagebesprechung“ 09:30 und ganztägig „Rufbereitschaft“
  const source = await seedCalendarSource({
    name: `${prefix} Kalender`,
    url: `${baseURL}/dev/ics?name=heute`,
  });

  try {
    await page.goto("/heute");
    await heuteTest(page, prefix);
  } finally {
    await deleteCalendarSource(source);
  }
});

async function heuteTest(page: Page, prefix: string) {
  const due = card(page, "Fällig & überfällig");
  await expect(due.getByRole("link", { name: `${prefix} Gestern` })).toBeVisible();
  await expect(due.getByRole("link", { name: `${prefix} Blocker` })).toBeVisible();
  await expect(due.getByRole("link", { name: `${prefix} Wartet` })).toHaveCount(0);
  await expect(due).toContainText(/\d+ blockierte Aufgaben? ausgeblendet/);
  const focus = card(page, "Fokus heute");
  await expect(focus.getByRole("link", { name: `${prefix} Fokus` }).first()).toBeVisible();
  await expect(focus.getByRole("link", { name: `${prefix} Fokus blockiert` })).toHaveCount(0);
  const schedule = card(page, "Tagesablauf");
  await expect(
    schedule.getByRole("listitem").filter({ hasText: `${prefix} Termin` }),
  ).toContainText("09:00");
  // Google-Termin in derselben Zeitleiste (der parallele Mobil-Test bindet dieselbe ICS ein → first),
  // ganztägiger Termin oben, Klick öffnet das Detail
  const meeting = schedule.getByRole("listitem").filter({ hasText: "Lagebesprechung" }).first();
  await expect(meeting).toContainText("09:30");
  await expect(meeting).toContainText("Leitstelle");
  await expect(schedule.getByRole("list", { name: "Ganztägig und Fristen" })).toContainText(
    "Rufbereitschaft",
  );
  await meeting.getByRole("button", { name: /^Lagebesprechung, 09:30–10:00/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Lagebesprechung");
  await page.keyboard.press("Escape");

  // Blocker erledigt → die wartenden Aufgaben erscheinen
  await due.getByRole("link", { name: `${prefix} Blocker` }).click();
  await taskPanel(page).getByRole("checkbox", { name: "Erledigt" }).click();
  await taskPanel(page).getByRole("button", { name: "Aufgabe schließen" }).click();
  await expect(due.getByRole("link", { name: `${prefix} Wartet` })).toBeVisible();
  await expect(focus.getByRole("link", { name: `${prefix} Fokus blockiert` })).toBeVisible();
  await expect(due.getByRole("link", { name: `${prefix} Blocker` })).toHaveCount(0);
}

/**
 * Desktop und Mobil laufen parallel mit demselben Testnutzer: Jeder Durchlauf plant für einen
 * anderen Tag, sonst sähe der eine die drei Fokus-Aufgaben des anderen („Morgen steht.“).
 * Beide liegen an der Zeitumstellung: Desktop plant am 24.10. (Sommerzeit) für den 25.10.,
 * Mobil am 25.10. (schon Winterzeit) für den 26.10.
 */
const EVENINGS = {
  desktop: {
    before: "2026-10-24T18:59:00+02:00",
    at: "2026-10-24T19:00:00+02:00",
    day: "Samstag, 24. Oktober 2026",
    tomorrowShort: "So, 25.10.",
    nextMorning: "2026-10-25T09:00:00+01:00",
    nextDay: "Sonntag, 25. Oktober 2026",
  },
  mobile: {
    before: "2026-10-25T18:59:00+01:00",
    at: "2026-10-25T19:00:00+01:00",
    day: "Sonntag, 25. Oktober 2026",
    tomorrowShort: "Mo, 26.10.",
    nextMorning: "2026-10-26T09:00:00+01:00",
    nextDay: "Montag, 26. Oktober 2026",
  },
} as const;

test("Abendplanung ab 19:00 hervorgehoben, Wahl steht am nächsten Tag oben (Zeitumstellung 25.10.2026)", async ({
  page,
  browser,
  baseURL,
}, info) => {
  const plan = EVENINGS[info.project.name === "mobile" ? "mobile" : "desktop"];
  const prefix = uniqueName("Abend");
  const { beruf } = await areaIds();
  const titles = ["Eins", "Zwei", "Drei"].map((n) => `${prefix} ${n}`);
  await seedTasks(titles.map((title) => ({ title, area_id: beruf })));

  const context = await freshContext(browser, baseURL as string, {
    viewport: page.viewportSize() ?? undefined,
    hasTouch: isNarrow(page),
    clockUntil: new Date(plan.nextMorning),
  });
  try {
    const p = await context.newPage();
    await p.clock.setFixedTime(new Date(plan.before));
    await p.goto("/heute");
    await expect(p.getByText(plan.day)).toBeVisible();
    await expect(evening(p)).toHaveAttribute("data-highlighted", "false");

    await p.clock.setFixedTime(new Date(plan.at));
    await p.reload();
    await expect(evening(p)).toHaveAttribute("data-highlighted", "true");
    // hervorgehoben steht sie vor „Fokus heute“
    const order = await p
      .getByRole("region")
      .evaluateAll((sections) => sections.map((s) => s.getAttribute("aria-label")));
    expect(order.indexOf("Abendplanung")).toBeLessThan(order.indexOf("Fokus heute"));
    await expect(evening(p)).toContainText(plan.tomorrowShort);

    for (const title of titles) {
      if (isNarrow(p)) {
        await evening(p).getByRole("button", { name: "Aufgabe für morgen wählen" }).click();
        await p.getByRole("combobox", { name: "Aufgabe suchen" }).fill(title);
        await p.getByRole("option", { name: new RegExp(title) }).click();
      } else {
        // ab 1280 px öffnet der Knopf die Aufgabenspalte rechts (#90); sie bleibt offen
        const column = p.getByRole("complementary", { name: "Aufgaben wählen" });
        if (!(await column.isVisible())) {
          await evening(p).getByRole("button", { name: "Aufgabe für morgen wählen" }).click();
        }
        await column.getByRole("searchbox", { name: "Aufgaben zum Wählen suchen" }).fill(title);
        await column.getByRole("button", { name: `„${title}“ für morgen wählen` }).click();
      }
      await expect(evening(p).getByRole("list", { name: "Fokus für morgen" })).toContainText(title);
    }
    await expect(evening(p)).toContainText("Morgen steht.");
    await expectSaved(p);

    // am nächsten Morgen: die Wahl ist der Fokus von heute, ganz oben
    await p.clock.setFixedTime(new Date(plan.nextMorning));
    await p.reload();
    await expect(p.getByText(plan.nextDay)).toBeVisible();
    const focus = card(p, "Fokus heute");
    for (const title of titles)
      await expect(focus.getByRole("link", { name: title })).toBeVisible();
    await expect(evening(p)).toHaveAttribute("data-highlighted", "false");
    const sections = await p
      .getByRole("region")
      .evaluateAll((list) => list.map((s) => s.getAttribute("aria-label")));
    expect(sections.indexOf("Fokus heute")).toBeLessThan(sections.indexOf("Abendplanung"));
  } finally {
    await context.close();
  }
});

test("Heute: kein horizontales Scrollen, keine a11y-Verstöße (Tag und Abend)", async ({ page }) => {
  const prefix = uniqueName("Ansicht");
  const { beruf } = await areaIds();
  await seedTasks([
    {
      title: `${prefix} mit einem recht langen Titel, der abgeschnitten werden muss`,
      area_id: beruf,
      due_date: berlinToday(),
    },
  ]);
  await page.goto("/heute");
  await expect(card(page, "Fällig & überfällig")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);

  // gestern 20:15 (Vergangenheit: die Sitzung bleibt gültig) – Abendplanung hervorgehoben
  const yesterday = berlinAddDays(berlinToday(), -1);
  await page.clock.setFixedTime(new Date(berlinDateTime(yesterday, "20:15")));
  await page.reload();
  await expect(evening(page)).toHaveAttribute("data-highlighted", "true");
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});
