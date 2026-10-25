/**
 * Inbox + Schnellerfassung (B8) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px:
 * Kürzel ordnen zu („Lebenslauf #privat @Bewerbung“), ohne Kürzel in die Inbox, Zuordnen
 * (Bereich, Projekt, als Notiz), mehrere Treffer per Klick auflösen, Erfassen über ⌘K,
 * Wiederholung in der Inbox (E24), „Öffnen“ in der Meldung (#75).
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow, openNavigation } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, berlinToday, seedDb, seedProject } from "./support/seed";
import { taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const field = (page: Page) => page.getByRole("textbox", { name: "Schnellerfassung" });
const inboxList = (page: Page) => page.getByRole("list", { name: "Inbox", exact: true });

async function capture(page: Page, text: string) {
  await field(page).fill(text);
  await field(page).press("Enter");
  await expect(field(page)).toHaveValue("");
}

test("„Lebenslauf #privat @Bewerbung“ landet zugeordnet (Abnahme) @desktop", async ({ page }) => {
  const prefix = uniqueName("Bewerbung");
  const { privat } = await areaIds();
  // „@Bewerbung“ muss eindeutig sein: nur dieser Test legt ein Projekt mit „Bewerbung“ an
  const project = await seedProject({
    title: `${prefix} Musterfirma`,
    area_id: privat,
    status: "aktiv",
  });
  await page.goto("/inbox");
  await field(page).fill("Lebenslauf #privat @Bewerbung");
  await expect(page.getByTestId("capture-target")).toContainText(
    `→ Privat · ${prefix} Musterfirma`,
  );
  await field(page).press("Enter");
  await expect(page.getByText(`„Lebenslauf“ → Privat · ${prefix} Musterfirma`)).toBeVisible();
  await expect(inboxList(page).getByText("Lebenslauf")).toHaveCount(0);
  await expectSaved(page);

  await page.goto(`/projekte/${project}?reiter=aufgaben`);
  await page.getByRole("radio", { name: "Liste" }).click();
  await expect(page.getByRole("link", { name: /^Lebenslauf/ })).toBeVisible();
});

test("Kürzel ordnen zu (mobil, eindeutiges Projekt-Kürzel)", async ({ page }) => {
  const prefix = uniqueName("Umzug");
  const { privat } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Kartons`,
    area_id: privat,
    status: "aktiv",
  });
  const token = prefix.split(" ")[0] as string; // z. B. „E2E-ab12cd“
  await page.goto("/inbox");
  await capture(page, `${prefix} packen #privat @${token}`);
  await expect(page.getByText(`„${prefix} packen“ → Privat · ${prefix} Kartons`)).toBeVisible();
  // #75: Erfassen öffnet nichts, „Öffnen“ in der Meldung zeigt die Aufgabe hier als Panel
  await expect(taskPanel(page)).toBeHidden();
  await page.getByRole("button", { name: "Öffnen", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox\?aufgabe=/);
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} packen`,
  );
  await expectSaved(page);
  await page.goto(`/projekte/${project}?reiter=aufgaben`);
  await page.getByRole("radio", { name: "Liste" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${prefix} packen`) })).toBeVisible();
});

test("Ohne Kürzel in die Inbox; Zuordnen nach Bereich, Projekt oder als Notiz", async ({
  page,
}) => {
  const prefix = uniqueName("Inbox");
  const { beruf } = await areaIds();
  await seedProject({ title: `${prefix} Zielprojekt`, area_id: beruf, status: "aktiv" });
  await page.goto("/inbox");
  await expect(field(page)).toBeFocused();
  await expect(page.getByText("ohne Kürzel: Inbox")).toBeVisible();
  for (const name of ["Bereich", "Projekt", "Notiz"]) {
    await field(page).fill(`${prefix} ${name}`);
    await expect(page.getByTestId("capture-target")).toContainText("→ Inbox");
    await field(page).press("Enter");
  }
  for (const name of ["Bereich", "Projekt", "Notiz"]) {
    await expect(inboxList(page).getByRole("link", { name: `${prefix} ${name}` })).toBeVisible();
  }

  // Bereich
  await page.getByRole("button", { name: `„${prefix} Bereich“ zuordnen` }).click();
  await page
    .getByRole("dialog", { name: `„${prefix} Bereich“ zuordnen` })
    .getByRole("button", { name: "Beruf" })
    .click();
  await expect(inboxList(page).getByRole("link", { name: `${prefix} Bereich` })).toHaveCount(0);

  // Projekt per Suche
  await page.getByRole("button", { name: `„${prefix} Projekt“ zuordnen` }).click();
  await page.getByRole("button", { name: "Projekt wählen …" }).click();
  await page.getByRole("combobox", { name: "Projekt suchen" }).fill(prefix);
  await page.getByRole("option", { name: new RegExp(`${prefix} Zielprojekt`) }).click();
  await expect(inboxList(page).getByRole("link", { name: `${prefix} Projekt` })).toHaveCount(0);

  // als Notiz
  await page.getByRole("button", { name: `„${prefix} Notiz“ zuordnen` }).click();
  await page
    .getByRole("dialog", { name: `„${prefix} Notiz“ zuordnen` })
    .getByRole("button", { name: "Als Notiz anlegen" })
    .click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(page.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} Notiz`,
  );
  await expectSaved(page);

  // nach dem Reload: nichts mehr davon in der Inbox; Aufgabe im Bereich Beruf
  await page.goto("/inbox");
  await expect(inboxList(page).getByText(prefix)).toHaveCount(0);
  await page.goto("/aufgaben");
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill(prefix);
  await page.getByRole("button", { name: /^Grupp/ }).click();
  await page.getByRole("menuitemradio", { name: "Bereich" }).click();
  await page.keyboard.press("Escape");
  const group = page.getByRole("region", { name: /^Beruf \(/ });
  await expect(group.getByRole("link", { name: new RegExp(`^${prefix} Bereich`) })).toBeVisible();
  await expect(group.getByRole("link", { name: new RegExp(`^${prefix} Projekt`) })).toContainText(
    `${prefix} Zielprojekt`,
  );
});

test("#notiz legt direkt eine Notiz an; „→ Notiz“ wandelt einen Inbox-Eintrag mit einem Klick um", async ({
  page,
}) => {
  const prefix = uniqueName("Notizfang");
  await page.goto("/inbox");
  await expect(page.getByText("#notiz", { exact: true })).toBeVisible();
  await field(page).fill(`${prefix} Idee Funkübung #notiz #job`);
  await expect(page.getByTestId("capture-target")).toContainText("→ Notiz in Beruf");
  await field(page).press("Enter");
  await expect(page.getByText(`„${prefix} Idee Funkübung“ → Notiz in Beruf`)).toBeVisible();
  // keine Aufgabe in der Inbox
  await expect(inboxList(page).getByText(prefix)).toHaveCount(0);

  // ohne Kürzel in die Inbox, dann mit einem Klick zur Notiz
  await field(page).fill(`${prefix} Gedanke`);
  await field(page).press("Enter");
  await page.getByRole("button", { name: `„${prefix} Gedanke“ als Notiz anlegen` }).click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(page.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} Gedanke`,
  );
  await expectSaved(page);

  // beide Notizen liegen in der Notizen-Datenbank, die Inbox ist leer
  await page.goto("/notizen");
  await page.getByRole("textbox", { name: /durchsuchen/ }).fill(prefix);
  // im Inhalt (dieselben Notizen stehen auch unter „Zuletzt bearbeitet“ in der Seitenleiste)
  const main = page.getByRole("main");
  await expect(
    main.getByRole("link", { name: new RegExp(`${prefix} Idee Funkübung`) }),
  ).toBeVisible();
  await expect(main.getByRole("link", { name: new RegExp(`${prefix} Gedanke`) })).toBeVisible();
  await page.goto("/inbox");
  await expect(inboxList(page).getByText(prefix)).toHaveCount(0);
});

test("Mehrere passende Projekte: Auswahl per Klick", async ({ page }) => {
  const prefix = uniqueName("Doppelt");
  const token = prefix.split(" ")[0] as string;
  const { beruf } = await areaIds();
  await seedProject({ title: `${prefix} Werkstatt Nord`, area_id: beruf, status: "aktiv" });
  await seedProject({ title: `${prefix} Werkstatt Süd`, area_id: beruf, status: "aktiv" });
  await page.goto("/inbox");
  await field(page).fill(`${prefix} Schrauben @${token}`);
  await expect(page.getByText(`@${token} passt zu 2 Projekten:`)).toBeVisible();
  await page.getByRole("button", { name: `${prefix} Werkstatt Süd` }).click();
  await expect(page.getByTestId("capture-target")).toContainText(`${prefix} Werkstatt Süd`);
  await field(page).press("Enter");
  await expect(
    page.getByText(`„${prefix} Schrauben“ → Beruf · ${prefix} Werkstatt Süd`),
  ).toBeVisible();
});

async function openPalette(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
  // bis die Seite hydriert ist, kann der erste Tastendruck verpuffen
  await expect(async () => {
    if (isNarrow(page)) await page.getByRole("button", { name: "Suche öffnen" }).click();
    else await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

test("Erfassen über ⌘K (Befehlspalette)", async ({ page }) => {
  const prefix = uniqueName("Palette");
  await page.goto("/heute");
  const dialog = await openPalette(page);
  await dialog.getByRole("combobox").fill(`${prefix} anrufen #job`);
  const option = dialog.getByRole("option", {
    name: new RegExp(`${prefix} anrufen #job“ erfassen → Beruf`),
  });
  await expect(option).toBeVisible();
  await option.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`„${prefix} anrufen“ → Beruf`)).toBeVisible();
  await expectSaved(page);
  // ohne Kürzel: Inbox, Zähler in der Navigation
  await openPalette(page);
  await dialog.getByRole("combobox").fill(`${prefix} später`);
  await dialog.getByRole("option", { name: /später“ erfassen → Inbox/ }).click();
  const nav = await openNavigation(page);
  await expect(nav.getByRole("link", { name: /^Inbox \d+/ })).toBeVisible();
});

test("Inbox: kein horizontales Scrollen, keine a11y-Verstöße (auch mit offenem Zuordnen)", async ({
  page,
}) => {
  const prefix = uniqueName("Barriere");
  await page.goto("/inbox");
  await capture(page, `${prefix} Eintrag`);
  await expectNoHorizontalOverflow(page);
  // Kontrast erst messen, wenn der Toast fertig eingeblendet ist
  await expect(page.getByRole("button", { name: "Rückgängig" })).toBeVisible();
  await page.waitForTimeout(800);
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: `„${prefix} Eintrag“ zuordnen` }).click();
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});

test("Wiederkehrende Aufgabe in der Inbox: die nächste landet wieder in der Inbox (E24)", async ({
  page,
}) => {
  const title = uniqueName("Pflanzen gießen");
  const db = await seedDb();
  const id = crypto.randomUUID();
  const seeded = await db.from("tasks").insert({
    id,
    title,
    area_id: null,
    in_inbox: true,
    sort: "a0",
    due_date: berlinToday(),
    recurrence: "FREQ=WEEKLY",
  });
  expect(seeded.error).toBeNull();

  await page.goto("/inbox");
  const rows = inboxList(page).getByRole("listitem").filter({ hasText: title });
  await expect(rows).toHaveCount(1);
  await rows.getByRole("checkbox", { name: `„${title}“ erledigt` }).click();
  await expect(page.getByText(new RegExp(`„${title}“ erledigt · nächste am`))).toBeVisible();
  await expectSaved(page);
  await page.reload();
  // die erledigte verschwindet, die Folgeinstanz steht offen in der Inbox
  await expect(rows).toHaveCount(1);
  const next = await db
    .from("tasks")
    .select("id, in_inbox, area_id, status")
    .eq("recurrence_source_id", id)
    .single();
  expect(next.data).toMatchObject({ in_inbox: true, area_id: null, status: "offen" });
});
