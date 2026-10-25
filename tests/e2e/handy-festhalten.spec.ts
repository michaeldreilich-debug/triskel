/**
 * Handy-Paket H3 (E44): das ＋ in der Leiste öffnet das Sheet „Festhalten“ – Art, Text mit
 * Zielvorschau, Wann (auch aus Datumswörtern), Bereich; Anlegen oben, Enter legt ebenfalls an.
 * Prüfung H4: Doppeltipp legt nur einmal an, Tipp daneben behält den Text, mehrdeutiges @-Kürzel
 * wird über die Projekt-Auswahl aufgelöst, die Leiste kommt nach dem Schließen zurück.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, berlinAddDays, berlinToday, seedDb, seedProject } from "./support/seed";

test.use({ storageState: AUTH_FILE });

const sheet = (page: Page) => page.getByRole("dialog", { name: "Festhalten" });
const textField = (page: Page) =>
  sheet(page).getByRole("textbox", { name: "Was willst du festhalten?" });
const create = (page: Page) => sheet(page).getByRole("button", { name: "Anlegen", exact: true });
const wann = (page: Page, name: string) => sheet(page).getByRole("button", { name, exact: true });

async function openSheet(page: Page) {
  await page.goto("/heute");
  await expect(page.getByRole("button", { name: "Schnell erfassen" })).toBeVisible();
  await page.getByRole("button", { name: "Schnell erfassen" }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(textField(page)).toBeFocused();
  // bis die Bereiche da sind (Knöpfe) – sonst würde Anlegen noch warten
  await expect(sheet(page).getByRole("button", { name: "Privat" })).toBeVisible();
}

async function taskRowFor(title: string) {
  const db = await seedDb();
  const { data } = await db
    .from("tasks")
    .select("title,due_date,area_id,in_inbox")
    .eq("title", title)
    .is("deleted_at", null);
  return data ?? [];
}

test("＋ öffnet das Sheet, Feld fokussiert, kein Überlauf, keine a11y-Verstöße @mobile", async ({
  page,
}) => {
  await openSheet(page);
  await expect(create(page)).toBeDisabled();
  await expect(sheet(page).getByRole("radio", { name: "Aufgabe" })).toBeChecked();
  for (const el of [create(page), sheet(page).getByRole("button", { name: "Abbrechen" })]) {
    expect((await el.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});

test("Datumswort „morgen“ setzt Wann, der Titel bleibt; Anlegen mit Meldung @mobile", async ({
  page,
}) => {
  const title = `${uniqueName("Fest")} morgen anrufen`;
  await openSheet(page);
  await textField(page).fill(title);
  await expect(sheet(page).getByTestId("festhalten-datum")).toHaveText(
    /„morgen“ erkannt – fällig [A-Z][a-z] \d\d\.\d\d\./,
  );
  await expect(wann(page, "Morgen")).toHaveAttribute("aria-pressed", "true");
  await expect(wann(page, "Ohne Datum")).toHaveAttribute("aria-pressed", "false");
  await expect(textField(page)).toHaveValue(title);
  // Doppeltipp: der zweite Tipp trifft das Sheet noch während es zugleitet – nur einmal anlegen
  await create(page).dblclick();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Öffnen", exact: true })).toBeVisible();
  await expectSaved(page);
  await expect
    .poll(async () => (await taskRowFor(title)).map((t) => t.due_date))
    .toEqual([berlinAddDays(berlinToday(), 1)]);
});

test("Wann-Knopf „Heute“ überschreibt das Datumswort @mobile", async ({ page }) => {
  const title = `${uniqueName("Fest")} morgen prüfen`;
  await openSheet(page);
  await textField(page).fill(title);
  await expect(wann(page, "Morgen")).toHaveAttribute("aria-pressed", "true");
  await wann(page, "Heute").click();
  await expect(wann(page, "Heute")).toHaveAttribute("aria-pressed", "true");
  await expect(sheet(page).getByTestId("festhalten-datum")).toBeHidden();
  await create(page).click();
  await expect(sheet(page)).toBeHidden();
  await expectSaved(page);
  await expect
    .poll(async () => (await taskRowFor(title)).map((t) => t.due_date))
    .toEqual([berlinToday()]);
});

test("Bereich-Knopf setzt den Bereich, Enter legt an @mobile", async ({ page }) => {
  const title = uniqueName("Fest Bereich");
  const { privat } = await areaIds();
  await openSheet(page);
  await textField(page).fill(title);
  await expect(sheet(page).getByTestId("festhalten-ziel")).toHaveText(/→ Inbox|→ \w/);
  await sheet(page).getByRole("button", { name: "Privat" }).click();
  await expect(sheet(page).getByRole("button", { name: "Privat" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sheet(page).getByTestId("festhalten-ziel")).toContainText("→ Privat");
  await textField(page).press("Enter");
  await expect(sheet(page)).toBeHidden();
  // das Feld mit dem Fokus ist weg – die Leiste kommt zurück
  await expect(page.getByTestId("mobile-tab-bar")).toBeVisible();
  await expectSaved(page);
  await expect
    .poll(async () => (await taskRowFor(title)).map((t) => [t.area_id, t.in_inbox]))
    .toEqual([[privat, false]]);
});

test("Mehrdeutiges @-Kürzel: die Auswahl unten löst es auf @mobile", async ({ page }) => {
  const prefix = uniqueName("Fest Doppelt");
  const token = prefix.split(" ")[0] as string;
  const { beruf } = await areaIds();
  await seedProject({ title: `${prefix} Werkstatt Nord`, area_id: beruf, status: "aktiv" });
  await seedProject({ title: `${prefix} Werkstatt Süd`, area_id: beruf, status: "aktiv" });
  await openSheet(page);
  await textField(page).fill(`${prefix} Schrauben @${token}`);
  await expect(sheet(page).getByText(`@${token} passt zu 2 Projekten`)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Projekt" }).click();
  await page.getByRole("option", { name: new RegExp(`${prefix} Werkstatt Süd`) }).click();
  // das Kürzel steht jetzt eindeutig im Text und fällt aus dem Titel, der Hinweis ist weg
  await expect(textField(page)).toHaveValue(`${prefix} Schrauben @"${prefix} Werkstatt Süd"`);
  await expect(sheet(page).getByText(`@${token} passt zu 2 Projekten`)).toBeHidden();
  await expect(sheet(page).getByTestId("festhalten-ziel")).toContainText(
    `Beruf · ${prefix} Werkstatt Süd`,
  );
  await create(page).click();
  await expect(
    page.getByText(`„${prefix} Schrauben“ → Beruf · ${prefix} Werkstatt Süd`),
  ).toBeVisible();
  await expectSaved(page);
});

test("Art „Notiz“ legt eine Notiz an @mobile", async ({ page }) => {
  const title = uniqueName("Fest Notiz");
  await openSheet(page);
  await sheet(page).getByRole("radio", { name: "Notiz" }).click();
  // Wann gibt es nur bei Aufgaben
  await expect(wann(page, "Heute")).toBeHidden();
  await textField(page).fill(title);
  await expect(sheet(page).getByTestId("festhalten-ziel")).toContainText("→ Notiz in");
  await create(page).click();
  await expect(sheet(page)).toBeHidden();
  await expectSaved(page);
  await expect
    .poll(async () => {
      const db = await seedDb();
      const { data } = await db.from("notes").select("id").eq("title", title);
      return data?.length ?? 0;
    })
    .toBe(1);
  expect(await taskRowFor(title)).toHaveLength(0);
});

test("Tipp daneben behält den Text, „Abbrechen“ verwirft ihn, beides legt nichts an @mobile", async ({
  page,
}) => {
  const title = uniqueName("Fest Abbruch");
  const plus = page.getByRole("button", { name: "Schnell erfassen" });
  await openSheet(page);
  await textField(page).fill(title);
  // oben auf die Abdunklung tippen (Sheet ist höchstens 92 dvh hoch)
  await page.mouse.click(195, 20);
  await expect(sheet(page)).toBeHidden();
  await plus.click();
  await expect(textField(page)).toHaveValue(title);
  await sheet(page).getByRole("button", { name: "Abbrechen" }).click();
  await expect(sheet(page)).toBeHidden();
  await plus.click();
  await expect(textField(page)).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expectSaved(page);
  expect(await taskRowFor(title)).toHaveLength(0);
});

test("Entwurf übersteht ein Neuladen samt Art, Wann und Bereich (Review Teil B, U-6) @mobile", async ({
  page,
}) => {
  const title = uniqueName("Fest Entwurf");
  await openSheet(page);
  await textField(page).fill(title);
  await wann(page, "Morgen").click();
  await sheet(page).getByRole("button", { name: "Privat" }).click();
  await expect(sheet(page).getByRole("button", { name: "Morgen" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // iOS räumt die App ab → Seite neu geladen: der ganze Entwurf steht wieder da
  await page.reload();
  await expect(page.getByRole("button", { name: "Schnell erfassen" })).toBeVisible();
  await page.getByRole("button", { name: "Schnell erfassen" }).click();
  await expect(textField(page)).toHaveValue(title);
  await expect(wann(page, "Morgen")).toHaveAttribute("aria-pressed", "true");
  await expect(sheet(page).getByRole("button", { name: "Privat" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await sheet(page).getByRole("button", { name: "Abbrechen" }).click();
  await expect(sheet(page)).toBeHidden();
  await page.getByRole("button", { name: "Schnell erfassen" }).click();
  await expect(textField(page)).toHaveValue("");
  await page.keyboard.press("Escape");
  await expectSaved(page);
  expect(await taskRowFor(title)).toHaveLength(0);
});

test("ab 768 px schließt das Sheet, statt die Seite modal zu sperren (Review Teil B, U-1) @mobile", async ({
  page,
}) => {
  const title = uniqueName("Fest quer");
  await openSheet(page);
  await textField(page).fill(title);
  // iPhone quer (932 px): Overlay und Inhalt wären weg, der Dialog bliebe sonst offen
  await page.setViewportSize({ width: 932, height: 430 });
  await expect(sheet(page)).toBeHidden();
  // die Seite ist bedienbar (kein modaler Dialog mehr, kein aria-hidden am Rest)
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // zurück ins Hochformat: der Entwurf ist noch da
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Schnell erfassen" }).click();
  await expect(textField(page)).toHaveValue(title);
  await sheet(page).getByRole("button", { name: "Abbrechen" }).click();
  await expectSaved(page);
  expect(await taskRowFor(title)).toHaveLength(0);
});
