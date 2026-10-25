/**
 * Monat zum Durchscrollen (#85, wie Notion Kalender), Desktop 1440 px und Mobil 390 px: Das
 * Wochenraster scrollt in sich, die Überschrift zeigt den Monat im Bild, die Adresse merkt ihn
 * (Neuladen bleibt dort), ←/→ und „Heute“ scrollen hin, ein Link springt in einen fernen Monat.
 * Beim Hochscrollen hängt die Seite Monate vorn an – die Stelle bleibt (kein Sprung).
 * Feste Uhr: Mittwoch, 21.10.2026; eigene Sitzung, weil das Datum in der Zukunft liegt.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";
import { berlinDateTime } from "@/lib/dates";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { isNarrow } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedTasks } from "./support/seed";
import { freshContext } from "./support/session";

test.use({ storageState: AUTH_FILE });
test.setTimeout(90_000);

const NOW = berlinDateTime("2026-10-21", "10:00");
const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** „Oktober 2026“ → fortlaufende Monatsnummer */
const monthNumber = (title: string) => {
  const [name, year] = title.trim().split(" ");
  return Number(year) * 12 + MONTHS.indexOf(name ?? "");
};

/** Tageszelle im Raster, z. B. „Donnerstag, 10. Dezember“ */
const cell = (page: Page, label: string) =>
  page
    .getByRole("region", { name: "Monate" })
    .getByRole("button", { name: new RegExp(`^${label}`) });

/** halbe Bildhöhe weiter (−1 hoch, 1 runter) und kurz warten, bis Überschrift/Adresse folgen */
async function scrollHalf(months: Locator, direction: -1 | 1) {
  await months.evaluate((el, d) => el.scrollBy(0, (d * el.clientHeight) / 2), direction);
  await months.page().waitForTimeout(250);
}

test("Monat durchscrollen (#85): Überschrift folgt, Adresse merkt den Monat, Heute und ←/→ scrollen hin", async ({
  page,
  browser,
  baseURL,
}) => {
  const prefix = uniqueName("KalMonat");
  const { beruf } = await areaIds();
  // Sonntag: dort stehen höchstens der Wochenrückblick und Termine anderer Tests – die Aufgabe
  // bleibt in der Zelle sichtbar (ab 4 Einträgen stünde sie hinter „+ N weitere“)
  const ids = await seedTasks([
    { title: `${prefix} Dezember`, area_id: beruf, due_date: "2026-12-13" },
    { title: `${prefix} Mai`, area_id: beruf, due_date: "2026-05-12", status: "erledigt" },
  ]);
  const context = await freshContext(browser, baseURL as string, {
    viewport: page.viewportSize() ?? undefined,
    clockUntil: new Date("2026-11-30T00:00:00Z"),
  });
  try {
    const p = await context.newPage();
    await p.clock.setFixedTime(new Date(NOW));
    await p.goto("/kalender?ansicht=monat");
    const heading = p.getByRole("heading", { level: 1 });
    const months = p.getByRole("region", { name: "Monate" });
    await expect(heading).toHaveText("Oktober 2026");
    // beim Öffnen: Woche mit dem 1. oben, heute im Bild; der 1. des Folgemonats trägt den Monat
    await expect(cell(p, "Donnerstag, 1\\. Oktober")).toBeInViewport();
    await expect(cell(p, "Mittwoch, 21\\. Oktober")).toBeInViewport();
    await expect(cell(p, "Sonntag, 1\\. November Allerheiligen")).toContainText("Nov");
    await expectNoHorizontalOverflow(p);

    // runter bis Dezember: Überschrift und Adresse folgen, der Dezember ist im Bild
    for (let i = 0; i < 30 && (await heading.textContent()) !== "Dezember 2026"; i++) {
      await scrollHalf(months, 1);
    }
    await expect(heading).toHaveText("Dezember 2026");
    await expect(p).toHaveURL(/tag=2026-12-01/);
    await expect(cell(p, "Sonntag, 13\\. Dezember")).toBeInViewport();
    if (isNarrow(page)) {
      await cell(p, "Sonntag, 13\\. Dezember").click();
      await expect(p.getByRole("region", { name: "Sonntag 13." })).toContainText(
        `${prefix} Dezember`,
      );
    } else {
      await expect(
        months.getByRole("link", { name: new RegExp(`^${prefix} Dezember`) }),
      ).toBeInViewport();
    }

    // Neuladen bleibt im Dezember
    await p.reload();
    await expect(heading).toHaveText("Dezember 2026");
    await expect(cell(p, "Sonntag, 13\\. Dezember")).toBeInViewport();

    // T = heute, → = nächster Monat (scrollt jeweils hin)
    await p.keyboard.press("t");
    await expect(heading).toHaveText("Oktober 2026");
    await expect(p).not.toHaveURL(/tag=/);
    await expect(cell(p, "Mittwoch, 21\\. Oktober")).toBeInViewport();
    await p.keyboard.press("ArrowRight");
    await expect(heading).toHaveText("November 2026");
    await expect(cell(p, "Montag, 16\\. November")).toBeInViewport();
    await p.getByRole("button", { name: "Heute", exact: true }).click();
    await expect(heading).toHaveText("Oktober 2026");

    // hoch bis Mai 2026: vorn kommen Monate dazu, die Überschrift springt dabei nie
    const seen: number[] = [monthNumber("Oktober 2026")];
    for (let i = 0; i < 40 && seen.at(-1) !== monthNumber("Mai 2026"); i++) {
      await scrollHalf(months, -1);
      seen.push(monthNumber((await heading.textContent()) ?? ""));
    }
    expect(seen.at(-1)).toBe(monthNumber("Mai 2026"));
    // höchstens ein Monat je halbe Bildhöhe – ohne gehaltene Stelle sprängen es drei
    const jumps = seen.slice(1).map((value, i) => (seen[i] ?? value) - value);
    expect(Math.max(...jumps), `Monate: ${seen.join(",")}`).toBeLessThanOrEqual(1);
    await expect(p).toHaveURL(/tag=2026-05-01/);
    const first = await months.locator("[data-week]").first().getAttribute("data-week");
    expect(first ?? "").not.toBe("");
    expect((first ?? "") < "2026-06-29").toBe(true);
    await p.waitForTimeout(500);
    await expect(heading).toHaveText("Mai 2026");

    // Link in einen fernen Monat: springt hin
    await p.goto("/kalender?ansicht=monat&tag=2027-03-15");
    await expect(heading).toHaveText("März 2027");
    await expect(cell(p, "Montag, 15\\. März")).toBeInViewport();
    if (!isNarrow(page)) {
      await p.waitForTimeout(300);
      await expectNoA11yViolations(p);
    }
  } finally {
    await context.close();
    await (await seedDb()).from("tasks").delete().in("id", ids);
  }
});
