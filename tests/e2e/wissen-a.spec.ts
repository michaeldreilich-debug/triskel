/**
 * Wissen Variante A (#56, Migration 39, Nachtlauf N3), Desktop 1440 px und Mobil 390 px:
 * Wissen zeigt nur Notizen von Typen, die als Wissen zählen (mit und ohne Projekt); „Noch
 * einordnen“ zeigt die übrigen ohne Projekt mit schnellem Typ-Wechsel; der Schalter je Typ in den
 * Einstellungen wirkt; die Notizen-Datenbank gruppiert nach Typ; jede Notiz geht per Direkt-Link.
 * Jeder Test legt eigene Notizen/Typen mit E2E-Präfix an (Desktop und Mobil laufen parallel mit
 * demselben Nutzer: nichts Gemeinsames ändern, Zahlen nie exakt prüfen).
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedNotes, seedNoteType, seedProject } from "./support/seed";

test.use({ storageState: AUTH_FILE });

const list = (page: Page) => page.getByRole("region", { name: "Notizliste" });
const card = (page: Page, title: string) => list(page).getByRole("link", { name: title });

test("Wissen zeigt Wissen und Anleitung – auch mit Projekt –, keine Idee und kein Protokoll; Direkt-Link auf eine Idee öffnet", async ({
  page,
}) => {
  const prefix = uniqueName("WA");
  const { beruf, privat } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Prüfung`,
    area_id: beruf,
    status: "aktiv",
  });
  const [, , idee, , protokoll] = await seedNotes([
    { title: `${prefix} Fahrzeuge`, area_id: privat, type: "wissen" },
    {
      title: `${prefix} Ablauf mit Projekt`,
      area_id: beruf,
      type: "anleitung",
      project_id: project,
    },
    { title: `${prefix} Nur eine Idee`, area_id: privat, type: "idee" },
    { title: `${prefix} Idee am Projekt`, area_id: beruf, type: "idee", project_id: project },
    {
      title: `${prefix} Protokoll am Projekt`,
      area_id: beruf,
      type: "protokoll",
      project_id: project,
    },
  ]);

  await page.goto("/wissen");
  await list(page).getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  await expect(card(page, `${prefix} Fahrzeuge`)).toBeVisible();
  await expect(card(page, `${prefix} Ablauf mit Projekt`)).toBeVisible();
  await expect(card(page, `${prefix} Nur eine Idee`)).toHaveCount(0);
  await expect(card(page, `${prefix} Idee am Projekt`)).toHaveCount(0);
  await expect(card(page, `${prefix} Protokoll am Projekt`)).toHaveCount(0);
  // leiser Hinweis: nichts „verschwunden“, Weg zur Datenbank
  await expect(list(page)).toContainText("nicht als Wissen");
  await expect(list(page).getByRole("link", { name: "Alle Notizen" })).toHaveAttribute(
    "href",
    "/notizen",
  );
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);

  // Direkt-Link geht für jede Notiz, auch für eine Idee
  await page.goto(`/wissen/${idee}`);
  await expect(page.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} Nur eine Idee`,
  );
  await expect(page.getByRole("button", { name: "Typ", exact: true })).toHaveText("Idee");
  // Desktop zeigt daneben die Liste „Alles Wissen“ ohne die Idee: Hinweis mit Weg dorthin (N4)
  if (!isNarrow(page)) {
    const hint = list(page).getByTestId("open-note-hint");
    await expect(hint).toContainText(
      `„${prefix} Nur eine Idee“ (Typ Idee) zählt nicht als Wissen.`,
    );
    await hint.getByRole("link", { name: "Noch einordnen" }).click();
    await expect(page).toHaveURL(new RegExp(`/wissen/${idee}\\?einordnen=1$`));
    await expect(card(page, `${prefix} Nur eine Idee`)).toBeVisible();
    await expect(list(page).getByTestId("open-note-hint")).toHaveCount(0);
    // Protokoll am Projekt: eingeordnet, aber kein Wissen → Weg zur Datenbank
    await page.goto(`/wissen/${protokoll}`);
    await expect(list(page).getByTestId("open-note-hint")).toContainText(
      "hängt an einem Projekt und zählt nicht als Wissen.",
    );
    await expect(
      list(page).getByTestId("open-note-hint").getByRole("link", { name: "Alle Notizen" }),
    ).toHaveAttribute("href", "/notizen");
  }
});

test("Noch einordnen: Chip in der Kopfzeile, Typ auf Wissen stellen, die Notiz erscheint im Wissen", async ({
  page,
}) => {
  const prefix = uniqueName("NE");
  const { beruf, privat } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "aktiv",
  });
  await seedNotes([
    { title: `${prefix} Lose Idee`, area_id: privat, type: "idee" },
    { title: `${prefix} Idee im Projekt`, area_id: beruf, type: "idee", project_id: project },
  ]);

  await page.goto("/wissen");
  const chip = list(page).getByRole("link", { name: /^Noch einordnen · \d+$/ });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/\?einordnen=1/);
  await expect(page.getByRole("heading", { name: "Noch einordnen" })).toBeAttached();
  await list(page).getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  await expect(card(page, `${prefix} Lose Idee`)).toBeVisible();
  // Projektnotizen sind eingeordnet
  await expect(card(page, `${prefix} Idee im Projekt`)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);

  // Typ umstellen: die Notiz rutscht ins Wissen
  await list(page)
    .getByRole("listitem")
    .filter({ hasText: `${prefix} Lose Idee` })
    .getByRole("button", { name: "Typ ändern" })
    .click();
  await page.getByRole("option", { name: "Wissen", exact: true }).click();
  await expect(card(page, `${prefix} Lose Idee`)).toHaveCount(0);
  await expectSaved(page);
  await list(page).getByRole("link", { name: "← Zurück zum Wissen" }).click();
  await expect(page).not.toHaveURL(/einordnen/);
  await list(page).getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  await expect(card(page, `${prefix} Lose Idee`)).toBeVisible();

  // gespeichert: nach Neuladen weiter im Wissen
  const db = await seedDb();
  await expect
    .poll(
      async () =>
        (await db.from("notes").select("type").eq("title", `${prefix} Lose Idee`).single()).data
          ?.type,
    )
    .toBe("wissen");
});

test("Neue Notiz im Wissen bleibt Idee und öffnet in „Noch einordnen“", async ({ page }) => {
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}\?einordnen=1/);
  await expect(page.getByRole("button", { name: "Typ", exact: true })).toHaveText("Idee");
  const title = uniqueName("Neu");
  await page.getByRole("textbox", { name: "Titel", exact: true }).fill(title);
  await expectSaved(page);
  // Mobil zeigt eine offene Notiz statt der Liste, Desktop beides
  if (!isNarrow(page)) await expect(card(page, title)).toBeVisible();
});

test("Einstellungen › Notiz-Typen: Schalter „zählt als Wissen“ wirkt auf Wissen und bleibt gespeichert", async ({
  page,
}) => {
  const prefix = uniqueName("SW");
  const { privat } = await areaIds();
  const name = `${prefix} Fahrzeugkunde`;
  const key = await seedNoteType(name);
  await seedNotes([{ title: `${prefix} Drehleiter`, area_id: privat, type: key }]);

  // zählt zunächst nicht: nicht im Wissen
  await page.goto("/wissen");
  await list(page).getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  await expect(list(page).getByRole("link", { name: "Noch einordnen" })).toBeVisible();
  await expect(card(page, `${prefix} Drehleiter`)).toHaveCount(0);

  await page.goto("/einstellungen#notiz-typen");
  const section = page.getByRole("region", { name: "Notiz-Typen" });
  const toggle = section.getByRole("checkbox", { name: `Typ „${name}“ zählt als Wissen` });
  await expect(toggle).not.toBeChecked();
  // mitgelieferte Wissens-Typen stehen an
  await expect(
    section.getByRole("checkbox", { name: "Typ „Wissen“ zählt als Wissen" }),
  ).toBeChecked();
  await expect(
    section.getByRole("checkbox", { name: "Typ „Idee“ zählt als Wissen" }),
  ).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);

  const db = await seedDb();
  await expect
    .poll(
      async () =>
        (await db.from("note_types").select("counts_as_knowledge").eq("key", key).single()).data
          ?.counts_as_knowledge,
    )
    .toBe(true);

  await page.goto("/wissen");
  await list(page).getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  await expect(card(page, `${prefix} Drehleiter`)).toBeVisible();
});

test("Notizen-Datenbank: nach Typ gruppieren (Projekt bleibt Standard), bleibt nach Neuladen, Gruppenkopf führt ins Wissen", async ({
  page,
}) => {
  const prefix = uniqueName("DB");
  const { privat } = await areaIds();
  await seedNotes([
    { title: `${prefix} Wissen`, area_id: privat, type: "wissen" },
    { title: `${prefix} Idee`, area_id: privat, type: "idee" },
  ]);
  await page.goto("/notizen");
  await page.getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  // Standard: nach Projekt („Ohne Projekt“)
  await expect(page.getByRole("region", { name: /^Ohne Projekt \(/ })).toContainText(
    `${prefix} Wissen`,
  );

  await page.getByRole("button", { name: /^Grupp/ }).click();
  await page.getByRole("menuitemradio", { name: "Typ" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: /^Wissen \(/ })).toContainText(`${prefix} Wissen`);
  await expect(page.getByRole("region", { name: /^Idee \(/ })).toContainText(`${prefix} Idee`);
  await expect(page.getByRole("link", { name: "„Wissen“ im Wissen ansehen" })).toHaveAttribute(
    "href",
    "/wissen",
  );
  await expect(page.getByRole("link", { name: "„Idee“ im Wissen ansehen" })).toHaveCount(0);

  await page.reload();
  await page.getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  await expect(page.getByRole("region", { name: /^Idee \(/ })).toContainText(`${prefix} Idee`);
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});
