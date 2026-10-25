/**
 * Wochenrückblick (B12) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px: schreiben,
 * abschließen (Zahlen bleiben stabil), durchsuchbar, Verlauf mit Lücken und „Nachholen“,
 * Tagesverlauf je Tag, „An diesem Tag“, Papierkorb; „Erledigt heute“ auf Heute.
 * Rückblicke haben keinen Titel – jeder Test nimmt eigene Wochen, Desktop und Mobil verschiedene.
 */
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  addDays,
  berlinDateTime,
  endOfMonth,
  formatMonth,
  formatRange,
  isoWeekNumber,
  isoWeekRange,
} from "@/lib/dates";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow } from "./support/app";
import { AUTH_FILE, E2E_PREFIX, uniqueName } from "./support/auth";
import {
  areaIds,
  berlinAddDays,
  berlinToday,
  mondayWeeksAgo,
  monthStartMonthsAgo,
  seedDb,
  seedMonthRecap,
  seedRecap,
  seedTasks,
  weekName,
} from "./support/seed";

test.use({ storageState: AUTH_FILE });

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
/** Zeile genau dieser Woche (nicht „KW 10/2019“, wenn „KW 10“ gemeint ist) */
const weekLink = (start: string) => new RegExp(`^${weekName(start)}(?![/\\d])`);

/** eigene Wochen je Viewport, damit parallele Läufe sich nicht stören */
const weeks = (info: TestInfo, desktop: number) =>
  info.project.name === "mobile" ? desktop + 6 : desktop;

async function openPalette(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
  await expect(async () => {
    if (isNarrow(page)) await page.getByRole("button", { name: "Suche öffnen" }).click();
    else await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

test("@desktop Wochenrückblick schreiben, speichern, abschließen und finden", async ({ page }) => {
  // mit Buchstaben vorn: „5e1b56“ liest die Volltextsuche sonst als Zahl (5e1) und findet nichts
  const token = `t${crypto.randomUUID().slice(0, 6)}`;
  const db = await seedDb();
  // laufende Woche frei machen (Rest eines abgebrochenen Laufs)
  await db.from("recaps").delete().eq("period_start", mondayWeeksAgo(0));

  await page.goto("/rueckblicke");
  const current = region(page, "Diese Woche");
  await expect(current).toContainText(`KW ${isoWeekNumber(berlinToday())}`);
  await current.getByRole("button", { name: "Wochenrückblick schreiben" }).click();
  await expect(page).toHaveURL(/\/rueckblicke\/[0-9a-f-]{36}$/);

  const reflection = region(page, "Reflexion");
  await reflection
    .getByRole("group", { name: "Wie ging es mir (1–5)?" })
    .getByText("4", { exact: true })
    .click();
  await reflection.getByLabel("Was lief gut?").fill(`Übung ${E2E_PREFIX}${token} lief rund`);
  await reflection.getByLabel("Fokus nächste Woche (3 Punkte), Punkt 1").fill("Bericht schreiben");
  await reflection.getByLabel("Tag hinzufügen").fill("schlaf");
  await reflection.getByLabel("Tag hinzufügen").press("Enter");
  await expect(reflection).toContainText(/3 von \d+/);
  await expectSaved(page);

  await page.reload();
  await expect(reflection.getByLabel("Was lief gut?")).toHaveValue(
    `Übung ${E2E_PREFIX}${token} lief rund`,
  );
  await expect(
    reflection
      .getByRole("group", { name: "Wie ging es mir (1–5)?" })
      .getByRole("radio", { name: "4 von 5" }),
  ).toBeChecked();
  await expect(reflection.getByRole("list", { name: "Tags" })).toContainText("schlaf");

  await page.getByRole("button", { name: "Rückblick abschließen" }).click();
  await expect(page.getByTestId("recap-closed")).toBeVisible();
  await expect(page.getByText("Export erstellt?")).toBeVisible();
  await expectSaved(page);
  await page.reload();
  await expect(page.getByTestId("recap-closed")).toBeVisible();
  await expect(region(page, "Zahlen")).toContainText("Festgehalten beim Abschließen");
  await expect(page.getByTestId("recap-summary")).toContainText("abgeschlossen");

  // durchsuchbar: Antworttext findet den Rückblick, Treffer öffnet ihn
  const url = page.url();
  await page.goto("/heute");
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill(token);
  const hit = palette.getByRole("option", { name: /Wochenrückblick/ });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(url);
});

test("Verlauf zeigt Lücken; Nachholen legt an, Papierkorb holt zurück", async ({ page }, info) => {
  const base = weeks(info, 30);
  const seeded = mondayWeeksAgo(base + 2);
  const gap = mondayWeeksAgo(base + 1);
  await seedRecap({ period_start: seeded, mood: 3 });
  // Nachbarwoche belegt: die Lücke steht einzeln (längere Lücken sind zusammengefasst)
  await seedRecap({ period_start: mondayWeeksAgo(base) });
  await (await seedDb()).from("recaps").delete().eq("period_start", gap);

  await page.goto("/rueckblicke");
  const history = region(page, "Frühere Wochen");
  const seededRow = history.getByRole("link", { name: weekLink(seeded) });
  await expect(seededRow).toContainText("Stimmung 3");
  await expect(page.getByTestId("recaps-summary")).toContainText(/Lücke/);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  const gapWeek = isoWeekNumber(gap);
  await history.getByRole("button", { name: `${weekName(gap)} nachholen` }).click();
  await expect(page).toHaveURL(/\/rueckblicke\/[0-9a-f-]{36}$/);
  await expect(page.getByText(`Wochenrückblick · KW ${gapWeek}`)).toBeVisible();
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);

  // in den Papierkorb: Woche ist wieder eine Lücke; zurückholen
  await page.getByRole("button", { name: "Rückblick-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "In den Papierkorb" }).click();
  await expect(page).toHaveURL(/\/rueckblicke$/);
  await expect(history.getByRole("button", { name: `${weekName(gap)} nachholen` })).toBeVisible();
  await expectSaved(page);
  await page.goto("/papierkorb");
  await page.getByRole("textbox", { name: "Papierkorb durchsuchen" }).fill(`KW ${gapWeek}`);
  await page
    .getByRole("list", { name: "Papierkorb" })
    .getByRole("button", { name: `„Wochenrückblick KW ${gapWeek}“ wiederherstellen` })
    .first()
    .click();
  await expectSaved(page);
  await page.goto("/rueckblicke");
  await expect(history.getByRole("link", { name: weekLink(gap) })).toBeVisible();
});

test("Zahlen und Tagesverlauf stimmen mit festen Testdaten und bleiben nach dem Abschließen stabil", async ({
  page,
}, info) => {
  const prefix = uniqueName("Woche");
  const monday = mondayWeeksAgo(weeks(info, 20));
  const tuesday = berlinAddDays(monday, 1);
  const { beruf } = await areaIds();
  await seedTasks([
    {
      title: `${prefix} Schläuche`,
      area_id: beruf,
      status: "erledigt",
      completed_at: berlinDateTime(tuesday, "09:15"),
    },
    {
      title: `${prefix} Bericht`,
      area_id: beruf,
      status: "erledigt",
      completed_at: berlinDateTime(tuesday, "16:40"),
    },
  ]);
  // „An diesem Tag“: eine Notiz vom selben Dienstag einen Monat früher
  const db = await seedDb();
  const monthBefore = new Date(`${tuesday}T12:00:00Z`);
  monthBefore.setUTCMonth(monthBefore.getUTCMonth() - 1);
  const note = await db.from("notes").insert({
    title: `${prefix} Notiz von damals`,
    area_id: beruf,
    created_at: monthBefore.toISOString(),
  });
  expect(note.error).toBeNull();
  const recapId = await seedRecap({ period_start: monday });

  await page.goto(`/rueckblicke/${recapId}`);
  const stats = region(page, "Zahlen");
  await expect(stats.getByRole("definition").first()).toHaveText("2");
  const activity = page.getByRole("list", { name: "Tagesverlauf der Woche" });
  const day = activity.getByRole("listitem").filter({ hasText: "2 erledigt" });
  await day.locator("summary").click();
  await expect(day.getByRole("link", { name: `${prefix} Schläuche` })).toBeVisible();
  await expect(day).toContainText("09:15");
  await expect(region(page, "An diesem Tag")).toContainText(`${prefix} Notiz von damals`);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Rückblick abschließen" }).click();
  await expectSaved(page);
  // später erledigt (nachgetragen) – der Snapshot ändert sich nicht
  await seedTasks([
    {
      title: `${prefix} Nachzügler`,
      area_id: beruf,
      status: "erledigt",
      completed_at: berlinDateTime(tuesday, "18:00"),
    },
  ]);
  await page.reload();
  await expect(stats).toContainText("Festgehalten beim Abschließen");
  await expect(stats.getByRole("definition").first()).toHaveText("2");
});

/** eigene Monate je Viewport (Monatsrückblicke haben auch keinen Titel) */
const months = (info: TestInfo, desktop: number) =>
  info.project.name === "mobile" ? desktop + 6 : desktop;

test("Monatsrückblick: aus dem Zeitraum schreiben, Wochen des Monats, abschließen, im Reiter Monate", async ({
  page,
}, info) => {
  const prefix = uniqueName("Monat");
  const start = monthStartMonthsAgo(months(info, 30));
  const end = endOfMonth(start);
  const label = formatMonth(start);
  const db = await seedDb();
  await db.from("recaps").delete().eq("kind", "monat").eq("period_start", start);
  // zwei Wochen des Monats mit Rückblick (Donnerstag im Monat), eine erledigte Aufgabe
  const firstMonday = (() => {
    const monday = isoWeekRange(start).start;
    return addDays(monday, 3) < start ? addDays(monday, 7) : monday;
  })();
  const second = addDays(firstMonday, 7);
  await seedRecap({
    period_start: firstMonday,
    mood: 3,
    themes: ["schlaf"],
    answers: { good: `${prefix} Übung lief` },
  });
  await seedRecap({ period_start: second, mood: 5, themes: ["schlaf", "dienst"] });
  await (await seedDb())
    .from("recaps")
    .delete()
    .eq("kind", "woche")
    .eq("period_start", addDays(second, 7));
  const { beruf } = await areaIds();
  await seedTasks([
    {
      title: `${prefix} Schläuche`,
      area_id: beruf,
      status: "erledigt",
      completed_at: berlinDateTime(addDays(start, 9), "10:00"),
    },
  ]);

  // Link auf den Zeitraum (wie aus dem Kalender): noch nicht geschrieben → anlegen
  await page.goto(`/rueckblicke/monat-${start.slice(0, 7)}`);
  await expect(page.getByText(`Monatsrückblick ${label}`)).toBeVisible();
  await page.getByRole("button", { name: "Monatsrückblick schreiben" }).click();
  await expect(page).toHaveURL(/\/rueckblicke\/[0-9a-f-]{36}$/);
  // der Seitentitel kommt nach dem Wechsel der Adresse (sonst meldet axe „document-title“)
  await expect(page).toHaveTitle(/Rückblick/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
  await expect(page.getByText(`Monatsrückblick · ${formatRange(start, end)}`)).toBeVisible();

  const weeksBlock = region(page, "Wochen des Monats");
  await expect(weeksBlock.getByTestId("month-week-values")).toContainText("Ø Stimmung 4");
  await expect(weeksBlock.getByRole("list", { name: "Wiederkehrende Themen" })).toContainText(
    "#schlaf · 2×",
  );
  const firstRow = weeksBlock
    .getByRole("listitem")
    .filter({ hasText: `KW ${isoWeekNumber(firstMonday)}` });
  await firstRow.locator("summary").click();
  await expect(firstRow).toContainText(`${prefix} Übung lief`);
  await expect(
    weeksBlock.getByRole("button", { name: `KW ${isoWeekNumber(addDays(second, 7))} nachholen` }),
  ).toBeVisible();
  await expect(region(page, "Zahlen").getByRole("definition").first()).toHaveText("1");
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  const reflection = region(page, "Reflexion");
  await reflection.getByLabel("Fokus nächster Monat (3 Punkte), Punkt 1").fill("Steuer abgeben");
  await reflection
    .getByRole("group", { name: "Wie ging es mir (1–5)?" })
    .getByText("4", { exact: true })
    .click();
  await expectSaved(page);
  await page.reload();
  await expect(reflection.getByLabel("Fokus nächster Monat (3 Punkte), Punkt 1")).toHaveValue(
    "Steuer abgeben",
  );
  await page.getByRole("button", { name: "Rückblick abschließen" }).click();
  await expect(page.getByTestId("recap-closed")).toBeVisible();
  await expectSaved(page);

  // Reiter Monate: der Monat steht im Verlauf, abgeschlossen mit Stimmung
  await page.goto("/rueckblicke");
  await page.getByRole("radio", { name: "Monate" }).click();
  await expect(page).toHaveURL(/ansicht=monate/);
  await expect(page.getByRole("region", { name: /Dieser Monat|Voriger Monat/ })).toBeVisible();
  // axe erst nach dem Farbwechsel der Pillen (docs/stand.md: 300 ms)
  await page.waitForTimeout(300);
  const row = region(page, "Frühere Monate").getByRole("link", { name: new RegExp(label) });
  await expect(row).toContainText("Stimmung 4");
  await expect(row).toContainText("abgeschlossen");
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
});

test("Monatsrückblick: vorhandener Zeitraum öffnet den Rückblick, Lücken im Reiter Monate", async ({
  page,
}, info) => {
  const base = months(info, 40);
  const seeded = monthStartMonthsAgo(base + 2);
  const gap = monthStartMonthsAgo(base + 1);
  const id = await seedMonthRecap({ period_start: seeded, mood: 2 });
  await seedMonthRecap({ period_start: monthStartMonthsAgo(base) });
  await (await seedDb()).from("recaps").delete().eq("kind", "monat").eq("period_start", gap);

  await page.goto(`/rueckblicke/monat-${seeded.slice(0, 7)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(formatMonth(seeded));
  await expect(page.getByTestId("recap-summary")).toBeVisible();

  await page.goto("/rueckblicke?ansicht=monate");
  const history = region(page, "Frühere Monate");
  await expect(history.getByRole("link", { name: new RegExp(formatMonth(seeded)) })).toContainText(
    "Stimmung 2",
  );
  await history.getByRole("button", { name: `${formatMonth(gap)} nachholen` }).click();
  await expect(page).toHaveURL(/\/rueckblicke\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(formatMonth(gap));
  await expect(page).not.toHaveURL(new RegExp(id));
  await expectSaved(page);
});

test("Verlauf: Werte je Woche eines Jahres, Lücken, wiederkehrende Themen filtern, Art wechseln", async ({
  page,
}, info) => {
  // ein Jahr weit zurück, je Viewport ein anderes (kein anderer Test schreibt dorthin)
  const year = info.project.name === "mobile" ? 2018 : 2019;
  const kw10 = isoWeekRange(`${year}-03-07`).start;
  const kw11 = addDays(kw10, 7);
  const kw13 = addDays(kw10, 21);
  const db = await seedDb();
  await db
    .from("recaps")
    .delete()
    .eq("kind", "woche")
    .gte("period_start", `${year - 1}-12-25`)
    .lte("period_start", `${year}-12-31`);
  await seedRecap({ period_start: kw10, mood: 2, energy: 3, themes: ["schlaf"] });
  await seedRecap({ period_start: kw11, mood: 4, energy: 4, themes: ["schlaf", "dienst"] });
  await seedRecap({ period_start: kw13, mood: 5, themes: ["dienst"] });

  await page.goto(`/rueckblicke?ansicht=verlauf&jahr=${year}`);
  const values = region(page, "Werte");
  await expect(values).toContainText(`Wochen ${year} · 3 mit Rückblick`);
  const mood = values.getByRole("list", { name: "Stimmung je Zeitraum" });
  await expect(mood).toContainText(`KW 11 · ${formatRange(kw11, addDays(kw11, 6))}: 4 von 5`);
  await expect(mood).toContainText(
    `KW 12 · ${formatRange(addDays(kw11, 7), addDays(kw11, 13))}: kein Rückblick`,
  );
  await expect(values).toContainText("Ø 3,7");
  await expect(values.getByRole("list", { name: "Energie je Zeitraum" })).toContainText(
    `KW 13 · ${formatRange(kw13, addDays(kw13, 6))}: nicht eingetragen`,
  );
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  // wiederkehrendes Thema filtert die Liste
  const list = region(page, "Rückblicke im Zeitraum").getByRole("list", { name: "Rückblicke" });
  await expect(list.getByRole("link")).toHaveCount(3);
  const schlaf = region(page, "Wiederkehrende Themen").getByRole("button", {
    name: "#schlaf · 2×",
  });
  await schlaf.click();
  await expect(schlaf).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/thema=schlaf/);
  await expect(list.getByRole("link")).toHaveCount(2);
  await expect(list.getByRole("link").first()).toContainText("KW 11");

  // Art wechseln: Monate, letzte 12
  await page
    .getByRole("radiogroup", { name: "Art" })
    .getByRole("radio", { name: "Monate" })
    .click();
  await expect(page).toHaveURL(/art=monat/);
  await expect(page).not.toHaveURL(/jahr=/);
  await expect(values).toContainText("letzte 12 Monate");
  await expectNoHorizontalOverflow(page);
});

test("Erledigt heute: Zeitleiste auf Heute, einklappbar", async ({ page }) => {
  const prefix = uniqueName("Heute erledigt");
  const { beruf } = await areaIds();
  await seedTasks([{ title: `${prefix} Aufgabe`, area_id: beruf, status: "erledigt" }]);

  await page.goto("/heute");
  const done = region(page, "Erledigt heute");
  await expect(done.getByRole("link", { name: `${prefix} Aufgabe` })).toBeVisible();
  await done.getByRole("button", { name: "Erledigt heute einklappen" }).click();
  await expect(done.getByRole("link", { name: `${prefix} Aufgabe` })).toHaveCount(0);
  await page.reload();
  await expect(done.getByRole("button", { name: "Erledigt heute ausklappen" })).toBeVisible();
  await done.getByRole("button", { name: "Erledigt heute ausklappen" }).click();
  await expect(done.getByRole("link", { name: `${prefix} Aufgabe` })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
