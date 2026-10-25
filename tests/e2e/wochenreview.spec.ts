/**
 * Geführtes Wochenreview (S1c) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px:
 * sonntags der Hinweis auf Heute, dann Schritt für Schritt Inbox → Projekte → Fälliges der
 * nächsten Woche (Kalender-Bausteine) → Wochenrückblick → Fokus; der Stand überlebt ein Neuladen,
 * Abschließen hält den Rückblick fest und der Hinweis verschwindet.
 * Die Uhr steht auf einem Sonntag weit zurück, je Viewport ein anderer (eigene Wochen).
 */
import { expect, type Page, test } from "@playwright/test";
import { addDays, berlinDateTime, formatRange, isoWeekNumber, isoWeekRange } from "@/lib/dates";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedProject, seedTasks } from "./support/seed";

test.use({ storageState: AUTH_FILE });

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const SUNDAYS = { desktop: "2021-03-21", mobile: "2020-03-22" };

test("Wochenreview: Hinweis am Sonntag, fünf Schritte, Stand bleibt, Abschließen", async ({
  page,
}, info) => {
  const sunday = info.project.name === "mobile" ? SUNDAYS.mobile : SUNDAYS.desktop;
  const week = isoWeekRange(sunday);
  const nextMonday = addDays(week.start, 7);
  const wednesday = addDays(nextMonday, 2);
  const prefix = uniqueName("Review");
  const { beruf } = await areaIds();
  const db = await seedDb();
  await db.from("recaps").delete().eq("kind", "woche").eq("period_start", week.start);
  const project = await seedProject({
    title: `${prefix} Werkstatt`,
    area_id: beruf,
    status: "aktiv",
  });
  await seedTasks([
    { title: `${prefix} Zettel`, area_id: null, in_inbox: true },
    { title: `${prefix} Bericht`, area_id: beruf, due_date: wednesday, priority: 1 },
  ]);

  await page.clock.setFixedTime(new Date(berlinDateTime(sunday, "10:00")));
  await page.goto("/heute");
  const hint = page.getByTestId("review-hint-woche");
  await expect(hint).toContainText(
    `Sonntag: Zeit fürs Wochenreview (KW ${isoWeekNumber(week.start)})`,
  );
  await hint.getByRole("link", { name: "Starten" }).click();
  await expect(page).toHaveURL(/\/wochenreview$/);
  await expect(
    page.getByText(`KW ${isoWeekNumber(week.start)} · ${formatRange(week.start, week.end)}`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Wochenreview starten" }).click();

  // 1 · Inbox leeren: zuordnen nimmt den Eintrag heraus
  const inbox = region(page, "Inbox leeren");
  await inbox.getByRole("button", { name: `„${prefix} Zettel“ zuordnen` }).click();
  await page
    .getByRole("dialog", { name: `„${prefix} Zettel“ zuordnen` })
    .getByRole("button", { name: "Beruf" })
    .click();
  await expect(inbox.getByText(`${prefix} Zettel`)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Weiter" }).click();

  // 2 · Projekte: festgefahren oben, „durchgesehen“ bleibt nach dem Neuladen
  const projects = region(page, "Projekte durchgehen");
  const row = projects.locator(`[data-review-project="${project}"]`);
  await expect(row).toContainText("Festgefahren");
  await row.getByRole("checkbox", { name: `„${prefix} Werkstatt“ durchgesehen` }).click();
  await expectSaved(page);
  await page.reload();
  await expect(region(page, "Projekte durchgehen")).toBeVisible();
  await expect(
    region(page, "Projekte durchgehen").getByRole("checkbox", {
      name: `„${prefix} Werkstatt“ durchgesehen`,
    }),
  ).toBeChecked();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Weiter" }).click();

  // 3 · Fälliges der nächsten Woche: dieselbe Wochenzeile wie im Kalender, mit Tageslast
  const due = region(page, "Fälliges der nächsten Woche");
  await expect(due).toContainText(
    `KW ${isoWeekNumber(nextMonday)} · ${formatRange(nextMonday, addDays(nextMonday, 6))}`,
  );
  await expect(due.locator("[data-load]").first()).toBeVisible();
  if (isNarrow(page)) await due.getByRole("button", { name: /^Mittwoch, 2\d\./ }).click();
  await expect(due.getByText(`${prefix} Bericht`).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Weiter" }).click();

  // 4 · Wochenrückblick schreiben
  const recap = region(page, "Wochenrückblick schreiben");
  await recap.getByLabel("Was lief gut?").fill(`${prefix} Übung lief`);
  await page.getByRole("button", { name: "Weiter" }).click();

  // 5 · Fokus: Vorschlag übernehmen, abschließen
  const focus = region(page, "Fokus nächste Woche");
  await focus.getByRole("button", { name: `„${prefix} Bericht“ als Fokus übernehmen` }).click();
  await expect(focus.getByLabel("Fokus nächste Woche (3 Punkte), Punkt 1")).toHaveValue(
    `${prefix} Bericht`,
  );
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Wochenreview abschließen" }).click();
  const done = region(page, "Wochenreview abgeschlossen");
  await expect(done).toContainText(`${prefix} Bericht`);
  await expectSaved(page);

  const { data } = await db
    .from("recaps")
    .select("closed_at, answers, review")
    .eq("kind", "woche")
    .eq("period_start", week.start)
    .single();
  expect(data?.closed_at).not.toBeNull();
  expect(data?.answers).toMatchObject({ good: `${prefix} Übung lief` });
  expect(data?.review).toMatchObject({ projects: [project] });
  expect((data?.review as { finished_at?: string } | undefined)?.finished_at).toBeTruthy();

  // fertig: der Hinweis auf Heute ist weg
  await page.goto("/heute");
  await expect(page.getByTestId("today-summary")).toBeVisible();
  await expect(page.getByTestId("backup-ok").or(page.getByTestId("backup-hint"))).toHaveCount(1);
  await expect(page.getByTestId("review-hint-woche")).toHaveCount(0);
});
