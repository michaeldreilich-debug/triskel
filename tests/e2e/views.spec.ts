/**
 * Datenbank-Ansichten (B6) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px:
 * Liste, Tabelle, Board mit Filtern, Sortieren und Gruppieren; Board-Drag (Maus und Touch)
 * ändert den Status (Erledigt über complete_task); gespeicherte Ansicht stellt Filter wieder her
 * (höchstens 5 je Bereich, Hinweis); Tabelle scrollt bei 390 px in sich.
 * Daten kommen per API (E2E-Präfix); jeder Test grenzt per Suchfeld auf seine eigenen ein.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow, openNavigation } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import {
  areaIds,
  berlinAddDays,
  berlinToday,
  seedDb,
  seedProject,
  seedTasks,
} from "./support/seed";
import { taskList, taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const search = (page: Page) => page.getByRole("textbox", { name: "Aufgaben durchsuchen" });

async function openTasks(page: Page, prefix: string) {
  await page.goto("/aufgaben");
  await search(page).fill(prefix);
}

async function chooseMenu(
  page: Page,
  button: RegExp,
  item: string | RegExp,
  role: "menuitemradio" | "menuitemcheckbox" = "menuitemradio",
) {
  await page.getByRole("button", { name: button }).click();
  await page.getByRole(role, { name: item }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** Welche der Namen stehen (in dieser Reihenfolge) in den Links mit Präfix? */
const titlesIn = (scope: Locator, prefix: string, names = ["Alpha", "Beta", "Gamma", "Delta"]) =>
  scope.getByRole("link").evaluateAll(
    (links, [p, words]) =>
      links
        .map((l) => l.textContent?.trim() ?? "")
        .filter((t) => t.startsWith(p as string))
        .map(
          (t) =>
            (words as string[]).find((w) =>
              t
                .slice((p as string).length)
                .trim()
                .startsWith(w),
            ) ?? "?",
        ),
    [prefix, names] as const,
  );

test("Liste, Tabelle, Board: Filter, Sortieren, Gruppieren; Wahl bleibt nach Reload", async ({
  page,
}) => {
  const prefix = uniqueName("Ansicht");
  const { beruf, privat } = await areaIds();
  const today = berlinToday();
  await seedTasks([
    { title: `${prefix} Alpha`, area_id: beruf, priority: 1, due_date: today },
    { title: `${prefix} Beta`, area_id: privat, priority: 3, status: "wartet" },
    { title: `${prefix} Gamma`, area_id: beruf, status: "erledigt" },
    {
      title: `${prefix} Delta`,
      area_id: privat,
      priority: 2,
      status: "in_arbeit",
      due_date: berlinAddDays(today, -1),
    },
  ]);
  await openTasks(page, prefix);
  const list = taskList(page);
  // Standard: ohne Erledigte
  await expect
    .poll(() => titlesIn(list, prefix).then((t) => t.sort()))
    .toEqual(["Alpha", "Beta", "Delta"]);

  // Filter: Priorität „Niedrig“ ausblenden
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitem", { name: /^Priorität/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Niedrig" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect.poll(() => titlesIn(list, prefix).then((t) => t.sort())).toEqual(["Alpha", "Delta"]);

  // Sortieren nach Fälligkeit: gestern vor heute
  await chooseMenu(page, /^Sortieren/, "Fällig");
  await expect.poll(() => titlesIn(list, prefix)).toEqual(["Delta", "Alpha"]);

  // Gruppieren nach Bereich
  await chooseMenu(page, /^Grupp/, "Bereich");
  await expect(page.getByRole("region", { name: /^Beruf \(/ })).toContainText(`${prefix} Alpha`);
  await expect(page.getByRole("region", { name: /^Privat \(/ })).toContainText(`${prefix} Delta`);

  // Tabelle mit Gruppenzeilen, nach Reload weiter Tabelle mit denselben Einstellungen
  await page.getByRole("radio", { name: "Tabelle" }).click();
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Fällig" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: /^Beruf/ })).toBeVisible();
  await page.reload();
  await search(page).fill(prefix);
  await expect(page.getByRole("radio", { name: "Tabelle" })).toBeChecked();
  // Status, Zuständig: Ich (#77) und Priorität
  await expect(page.getByRole("button", { name: /^Filter: Status ≠ Erledigt \+2/ })).toBeVisible();
  await expect(
    page.getByRole("table").getByRole("link", { name: `${prefix} Delta` }),
  ).toBeVisible();
  await expect(page.getByRole("table").getByRole("link", { name: `${prefix} Beta` })).toHaveCount(
    0,
  );

  // Board: Spalten nach Status (der Status-Filter leert keine Spalte)
  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page.getByRole("region", { name: /^In Arbeit \(/ })).toContainText(
    `${prefix} Delta`,
  );
  await expect(page.getByRole("region", { name: /^Offen \(/ })).toContainText(`${prefix} Alpha`);
  await expectNoHorizontalOverflow(page);
});

/** Karte mit der Maus (Desktop) bzw. per Finger (Mobil, langes Drücken) in eine Spalte ziehen. */
async function dragCard(page: Page, card: Locator, column: Locator) {
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const to = await column.boundingBox();
  if (!from || !to) throw new Error("Karte oder Spalte nicht sichtbar");
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const start = { x: from.x + from.width / 2, y: from.y + Math.min(20, from.height / 2) };
  const end = {
    x: Math.min(to.x + 24, viewport.width - 40),
    y: Math.min(to.y + 40, viewport.height - 40),
  };
  if (!isNarrow(page)) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y + 10, { steps: 3 });
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x?: number, y?: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: x === undefined ? [] : [{ x, y: y as number }],
    } as never);
  await touch("touchStart", start.x, start.y);
  await page.waitForTimeout(350); // langes Drücken (200 ms) aktiviert das Ziehen
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await touch(
      "touchMove",
      start.x + ((end.x - start.x) * i) / steps,
      start.y + ((end.y - start.y) * i) / steps,
    );
    await page.waitForTimeout(16);
  }
  await touch("touchEnd");
  await cdp.detach();
}

test("Board: Ziehen ändert den Status, nach „Erledigt“ über complete_task (Maus und Touch)", async ({
  page,
}) => {
  const prefix = uniqueName("Board");
  const { beruf } = await areaIds();
  const today = berlinToday();
  await seedTasks([
    { title: `${prefix} Schieben`, area_id: beruf },
    {
      title: `${prefix} Täglich`,
      area_id: beruf,
      status: "wartet",
      recurrence: "FREQ=DAILY",
      due_date: today,
    },
  ]);
  await openTasks(page, prefix);
  await page.getByRole("radio", { name: "Board" }).click();
  const column = (name: string) => page.getByRole("region", { name: new RegExp(`^${name} \\(`) });
  const card = (title: string) =>
    page.locator("[data-card-id]").filter({ hasText: `${prefix} ${title}` });

  await dragCard(page, card("Schieben"), column("In Arbeit"));
  await expect(column("In Arbeit")).toContainText(`${prefix} Schieben`);

  // wiederkehrende Aufgabe nach „Erledigt“ → erledigt + Folgeinstanz (fällig morgen) in „Offen“
  await dragCard(page, card("Täglich"), column("Erledigt"));
  await expect(column("Erledigt")).toContainText(`${prefix} Täglich`);
  await expect(column("Offen")).toContainText(`${prefix} Täglich`);
  await expect(
    column("Offen")
      .locator("[data-card-id]")
      .filter({ hasText: `${prefix} Täglich` }),
  ).toContainText("morgen");
  await expectSaved(page);

  await page.reload();
  await search(page).fill(prefix);
  await expect(column("In Arbeit")).toContainText(`${prefix} Schieben`);
  await expect(column("Erledigt")).toContainText(`${prefix} Täglich`);
  await expect(column("Offen")).toContainText(`${prefix} Täglich`);
  await expect(column("Wartet")).not.toContainText(`${prefix} Täglich`);
});

test("Gespeicherte Ansicht stellt Filter und Gruppierung wieder her", async ({ page }) => {
  const prefix = uniqueName("Gespeichert");
  const name = `${prefix} Hohe`;
  const { beruf } = await areaIds();
  await seedTasks([
    { title: `${prefix} Wichtig`, area_id: beruf, priority: 1 },
    { title: `${prefix} Unwichtig`, area_id: beruf, priority: 3 },
  ]);
  await openTasks(page, prefix);
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitem", { name: /^Priorität/ }).click();
  for (const level of ["Mittel", "Niedrig", "Keine"]) {
    await page.getByRole("menuitemcheckbox", { name: level }).click();
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await chooseMenu(page, /^Grupp/, "Status");
  await expect(page.getByRole("link", { name: `${prefix} Unwichtig` })).toHaveCount(0);

  await page.getByRole("button", { name: /^Ansichten/ }).click();
  await page.getByRole("menuitem", { name: /Als neue Ansicht speichern/ }).click();
  await page.getByRole("textbox", { name: /Ansicht speichern/ }).fill(name);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page).toHaveURL(/ansicht=/);
  const savedUrl = page.url();
  await expectSaved(page);

  // zurück zur Standardansicht: Filter weg
  await page.getByRole("button", { name: `Ansicht: ${name}` }).click();
  await page.getByRole("menuitemradio", { name: "Standardansicht" }).click();
  await expect(page).not.toHaveURL(/ansicht=/);
  await chooseMenu(page, /^Grupp/, "Keine");
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitem", { name: "Standardfilter" }).click();
  await expect(page.getByRole("link", { name: `${prefix} Unwichtig` })).toBeVisible();

  // gespeicherte Ansicht über die Seitenleiste (frischer Kontext = anderes Gerät) öffnen
  await page.goto("/heute");
  const nav = await openNavigation(page);
  await nav.getByRole("link", { name }).click();
  await expect(page).toHaveURL(savedUrl);
  await search(page).fill(prefix);
  // Status, Zuständig: Ich (#77) und Priorität
  await expect(page.getByRole("button", { name: /^Filter: Status ≠ Erledigt \+2/ })).toBeVisible();
  await expect(page.getByRole("link", { name: `${prefix} Wichtig` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${prefix} Unwichtig` })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Offen \(/ })).toBeVisible();

  // löschen
  await page.getByRole("button", { name: `Ansicht: ${name}` }).click();
  await page.getByRole("menuitem", { name: "Ansicht löschen" }).click();
  await expect(page).not.toHaveURL(/ansicht=/);
});

test("Kalender: gefilterte Aufgaben im Monatsraster, bleibt nach Reload, als Ansicht speicherbar (Migration 31)", async ({
  page,
}) => {
  const prefix = uniqueName("KalAnsicht");
  const name = `${prefix} Monat`;
  const { beruf } = await areaIds();
  const today = berlinToday();
  await seedTasks([
    { title: `${prefix} Heute`, area_id: beruf, due_date: today },
    {
      title: `${prefix} Fertig`,
      area_id: beruf,
      due_date: today,
      status: "erledigt",
      completed_at: new Date().toISOString(),
    },
  ]);
  await openTasks(page, prefix);
  await page.getByRole("radio", { name: "Kalender" }).click();
  const main = page.getByRole("main");
  await expect(main.locator("[data-calendar-view=monat]")).toBeVisible();
  // Sortieren und Gruppieren gibt es im Kalender nicht, Filter und Suche schon
  await expect(page.getByRole("button", { name: /^Sortieren/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Filter/ })).toBeVisible();
  const openToday = async () => {
    if (!isNarrow(page)) return main;
    // Handy: Punkte im Raster, Tipp auf den Tag zeigt seine Liste
    await main.locator(`[data-drop-target="day:${today}"]`).getByRole("button").click();
    return main.getByRole("region", { name: /\d+\.$/ }).last();
  };
  let scope = await openToday();
  await expect(scope.getByRole("link", { name: `${prefix} Heute` })).toBeVisible();
  // Standardfilter der Datenbank (ohne Erledigte) wirkt auch im Monat
  await expect(scope.getByRole("link", { name: `${prefix} Fertig` })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // Wahl bleibt nach Reload (je Gerät)
  await page.reload();
  await search(page).fill(prefix);
  await expect(page.getByRole("radio", { name: "Kalender" })).toBeChecked();
  await expect(main.locator("[data-calendar-view=monat]")).toBeVisible();

  // als Ansicht speichern: view_type „kalender“ braucht Migration 31
  await page.getByRole("button", { name: /^Ansichten/ }).click();
  await page.getByRole("menuitem", { name: /Als neue Ansicht speichern/ }).click();
  await page.getByRole("textbox", { name: /Ansicht speichern/ }).fill(name);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page).toHaveURL(/ansicht=/);
  await expectSaved(page);
  const savedUrl = page.url();
  // zurück zur Standardansicht, dann die gespeicherte neu laden: wieder Kalender
  await page.getByRole("button", { name: `Ansicht: ${name}` }).click();
  await page.getByRole("menuitemradio", { name: "Standardansicht" }).click();
  await page.getByRole("radio", { name: "Liste" }).click();
  await page.goto(savedUrl);
  await expect(page.getByRole("radio", { name: "Kalender" })).toBeChecked();
  await search(page).fill(prefix);
  scope = await openToday();
  await expect(scope.getByRole("link", { name: `${prefix} Heute` })).toBeVisible();
  await page.getByRole("button", { name: `Ansicht: ${name}` }).click();
  await page.getByRole("menuitem", { name: "Ansicht löschen" }).click();
  await expect(page).not.toHaveURL(/ansicht=/);
});

test("Höchstens 5 Ansichten je Bereich: Hinweis statt Speichern @desktop", async ({ page }) => {
  const db = await seedDb();
  const { privat } = await areaIds();
  // eigener Bereich (Privat), damit parallele Tests in „Alles“ nicht mitzählen
  const existing = await db
    .from("saved_views")
    .select("id")
    .eq("area_id", privat)
    .is("deleted_at", null);
  const missing = 5 - (existing.data?.length ?? 0);
  if (missing > 0) {
    const { error } = await db.from("saved_views").insert(
      Array.from({ length: missing }, (_, i) => ({
        entity: "tasks",
        area_id: privat,
        name: uniqueName(`Grenze ${i + 1}`),
        view_type: "liste",
        config: {},
        sort: `a${i}`,
      })),
    );
    expect(error).toBeNull();
  }
  await page.goto("/aufgaben");
  await page
    .getByRole("complementary", { name: "Seitenleiste" })
    .getByRole("radio", { name: "Privat" })
    .click();
  await page.getByRole("button", { name: /^Ansichten/ }).click();
  await expect(page.getByRole("menuitem", { name: /Als neue Ansicht speichern/ })).toBeDisabled();
  await expect(page.getByText(/Höchstens 5 Ansichten je Bereich \(Privat\)/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("complementary", { name: "Seitenleiste" })
    .getByRole("radio", { name: "Alles" })
    .click();
  await expectSaved(page);
});

test("Tabelle scrollt bei 390 px in sich, die Seite nicht; keine a11y-Verstöße @mobile", async ({
  page,
}) => {
  const prefix = uniqueName("Breit");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Projekt mit langem Namen`,
    area_id: beruf,
    status: "aktiv",
  });
  await seedTasks([
    {
      title: `${prefix} Aufgabe mit einem recht langen Titel`,
      area_id: beruf,
      project_id: project,
      priority: 2,
    },
  ]);
  await openTasks(page, prefix);
  await page.getByRole("radio", { name: "Tabelle" }).click();
  const scroller = page.getByRole("region", { name: "Tabelle: Aufgaben" });
  await expect(scroller.getByRole("link", { name: `${prefix} Aufgabe` })).toBeVisible();
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});

test("Projekte und Notizen als Datenbank: Liste, Board, Tabelle; kein Überlauf, keine a11y-Verstöße", async ({
  page,
}) => {
  const prefix = uniqueName("DB");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Werkstatt`,
    area_id: beruf,
    status: "aktiv",
  });
  await seedTasks([
    { title: `${prefix} erledigt`, area_id: beruf, project_id: project, status: "erledigt" },
    { title: `${prefix} offen`, area_id: beruf, project_id: project },
  ]);
  await page.goto("/projekte");
  await page.getByRole("textbox", { name: "Projekte durchsuchen" }).fill(prefix);
  const item = page.locator(`[data-project-id="${project}"]`);
  await expect(item).toContainText("50 %");
  await expect(item).toContainText("Festgefahren: Ergebnis, nächster Schritt fehlen");
  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page.getByRole("region", { name: /^Aktiv \(/ })).toContainText(
    `${prefix} Werkstatt`,
  );
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);

  const { error } = await (await seedDb())
    .from("notes")
    .insert({ title: `${prefix} Notiz`, area_id: beruf, type: "anleitung" });
  expect(error).toBeNull();
  await page.goto("/notizen");
  await page.getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  await expect(page.getByRole("heading", { level: 1, name: "Notizen" })).toBeVisible();
  await page.getByRole("radio", { name: "Tabelle" }).click();
  await expect(page.getByRole("columnheader", { name: "Typ" })).toBeVisible();
  await expect(
    page.getByRole("table").getByRole("link", { name: `${prefix} Notiz` }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);

  // Aufgaben-Board: Panel öffnen aus der Karte
  await page.goto("/aufgaben");
  await search(page).fill(prefix);
  await page.getByRole("radio", { name: "Board" }).click();
  await page.getByRole("link", { name: `${prefix} offen` }).click();
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} offen`,
  );
});
