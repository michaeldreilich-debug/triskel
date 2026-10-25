/**
 * B13 gegen das Testprojekt, Desktop 1440 px und Mobil 390 px: Papierkorb (Wiederherstellen samt
 * Inhalt, endgültig löschen nur nach Rückfrage, Treffer der Suche leeren), ⌘Z für die letzte
 * Aktion, Archiv-Hinweis in der Projektliste und Wischgesten am Handy (Rückmeldung #22).
 * Desktop und Mobil laufen parallel mit demselben Nutzer: jeder Test grenzt per Suche auf seine
 * Daten ein und leert nie den ganzen Papierkorb.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, openNavigation } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedProject, seedTasks } from "./support/seed";
import { taskRow } from "./support/tasks";
import { swipe } from "./support/touch";

test.use({ storageState: AUTH_FILE });

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();
const trashSearch = (page: Page) => page.getByRole("textbox", { name: "Papierkorb durchsuchen" });
const trashRow = (page: Page, id: string) =>
  page.getByRole("list", { name: "Papierkorb" }).locator(`[data-trash-id="${id}"]`);

async function seedTrashedNote(title: string, areaId: string, text: string) {
  const db = await seedDb();
  const id = crypto.randomUUID();
  const note = await db
    .from("notes")
    .insert({ id, title, area_id: areaId, deleted_at: yesterday() });
  expect(note.error).toBeNull();
  const block = await db.from("note_blocks").insert({
    note_id: id,
    sort: "a0",
    content: { type: "paragraph", content: [{ type: "text", text }] },
    content_text: text,
  });
  expect(block.error).toBeNull();
  return id;
}

async function rowExists(table: "tasks" | "notes", id: string) {
  const { data, error } = await (await seedDb()).from(table).select("id").eq("id", id);
  expect(error).toBeNull();
  return (data ?? []).length > 0;
}

test("Papierkorb: Notiz samt Inhalt zurückholen (über die Navigation)", async ({ page }) => {
  const prefix = uniqueName("Papierkorb");
  const { beruf } = await areaIds();
  const noteId = await seedTrashedNote(`${prefix} Atemschutz`, beruf, "Flaschen prüfen");

  await page.goto("/heute");
  const nav = await openNavigation(page);
  await nav.getByRole("link", { name: "Papierkorb" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Papierkorb" })).toBeVisible();
  await trashSearch(page).fill(prefix);
  const row = trashRow(page, noteId);
  await expect(row).toContainText(`${prefix} Atemschutz`);
  await expect(row).toContainText(/Notiz · gelöscht \d\d\.\d\d\., \d\d:\d\d · Beruf/);
  await expect(page.getByText(/^1 von (1 Eintrag|\d+ Einträgen)$/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await row.getByRole("button", { name: `„${prefix} Atemschutz“ wiederherstellen` }).click();
  await expect(page.getByText(`„${prefix} Atemschutz“ ist wieder da`)).toBeVisible();
  await expect(row).toHaveCount(0);
  await expectSaved(page);

  await page.goto(`/wissen/${noteId}`);
  await expect(page.locator(".outline-editor")).toContainText("Flaschen prüfen");
});

test("Endgültig löschen nur nach Rückfrage; mit Suche nur die Treffer", async ({ page }) => {
  const prefix = uniqueName("Endgültig");
  const { privat } = await areaIds();
  const [taskId] = await seedTasks([
    { title: `${prefix} Altpapier`, area_id: privat, deleted_at: yesterday() },
  ]);
  const noteId = await seedTrashedNote(`${prefix} Rezept`, privat, "Zutaten");
  const otherId = await seedTrashedNote(`${prefix} Behalten`, privat, "bleibt");

  await page.goto("/papierkorb");
  await trashSearch(page).fill(prefix);
  const row = trashRow(page, taskId as string);
  await expect(row).toContainText(/Aufgabe · gelöscht .* · Privat/);

  // Rückfrage: Abbrechen hat den Fokus, Escape schließt
  await row.getByRole("button", { name: `„${prefix} Altpapier“ endgültig löschen` }).click();
  const confirm = row.getByRole("group", { name: `„${prefix} Altpapier“ endgültig löschen?` });
  await expect(confirm).toContainText("Lässt sich nicht rückgängig machen.");
  await expect(confirm.getByRole("button", { name: "Abbrechen" })).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);

  await row.getByRole("button", { name: `„${prefix} Altpapier“ endgültig löschen` }).click();
  await confirm.getByRole("button", { name: "Endgültig löschen" }).click();
  await expect(page.getByText(`„${prefix} Altpapier“ endgültig gelöscht`)).toBeVisible();
  await expect(row).toHaveCount(0);

  // Suche enger: nur „Rezept“ – „Behalten“ bleibt
  await trashSearch(page).fill(`${prefix} Rezept`);
  await page.getByRole("button", { name: "Treffer endgültig löschen" }).click();
  const all = page.getByRole("group", { name: "1 Eintrag endgültig löschen?" });
  await all.getByRole("button", { name: "Treffer löschen" }).click();
  await expect(page.getByText(`„${prefix} Rezept“ endgültig gelöscht`)).toBeVisible();
  await expect(page.getByText("Nichts gefunden")).toBeVisible();
  await trashSearch(page).fill(prefix);
  await expect(trashRow(page, otherId)).toBeVisible();
  await expectSaved(page);

  expect(await rowExists("tasks", taskId as string)).toBe(false);
  expect(await rowExists("notes", noteId)).toBe(false);
  expect(await rowExists("notes", otherId)).toBe(true);
});

test("⌘Z nimmt die letzte Aktion zurück, auch mehrmals; im Suchfeld nicht @desktop", async ({
  page,
}) => {
  const prefix = uniqueName("Undo");
  const { beruf } = await areaIds();
  const [first, second] = await seedTasks([
    { title: `${prefix} Schlauch`, area_id: beruf },
    { title: `${prefix} Kupplung`, area_id: beruf },
  ]);
  await page.goto("/aufgaben");
  const search = page.getByRole("textbox", { name: "Aufgaben durchsuchen" });
  await search.fill(prefix);
  const hose = taskRow(page, `${prefix} Schlauch`);
  const coupling = taskRow(page, `${prefix} Kupplung`);

  await hose.click({ button: "right" });
  await page.getByRole("menuitem", { name: "In den Papierkorb" }).click();
  await expect(hose).toHaveCount(0);
  await coupling.getByRole("checkbox").click();
  await expect(coupling).toHaveCount(0); // Standardfilter: ohne Erledigte

  // im Suchfeld gehört ⌘Z dem Feld
  await search.press("ControlOrMeta+z");
  await expect(hose).toHaveCount(0);

  await page.getByRole("heading", { level: 1, name: "Aufgaben" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(coupling).toBeVisible();
  await expect(page.getByText("Rückgängig gemacht").first()).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(hose).toBeVisible();
  await expectSaved(page);

  const { data } = await (await seedDb())
    .from("tasks")
    .select("id, status, deleted_at")
    .in("id", [first as string, second as string]);
  expect(data?.every((t) => t.status === "offen" && t.deleted_at === null)).toBe(true);
});

test("⌘Z nach endgültigem Löschen holt kein Phantom zurück, kein Dauerfehler (D-9) @desktop", async ({
  page,
}) => {
  const prefix = uniqueName("Phantom");
  const { privat } = await areaIds();
  const [taskId] = await seedTasks([{ title: `${prefix} Weg damit`, area_id: privat }]);
  await page.goto("/aufgaben");
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill(prefix);
  const row = taskRow(page, `${prefix} Weg damit`);
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "In den Papierkorb" }).click();
  await expect(row).toHaveCount(0);
  await expectSaved(page);

  // ohne Neuladen in den Papierkorb (der Rückgängig-Stapel bleibt) und endgültig löschen
  const nav = await openNavigation(page);
  // exakt: „Zuletzt bearbeitet“ kann eine Notiz „… Papierkorb“ anderer Tests zeigen
  await nav.getByRole("link", { name: "Papierkorb", exact: true }).click();
  await trashSearch(page).fill(prefix);
  const trashed = trashRow(page, taskId as string);
  await trashed.getByRole("button", { name: `„${prefix} Weg damit“ endgültig löschen` }).click();
  await trashed.getByRole("button", { name: "Endgültig löschen" }).click();
  await expect(trashed).toHaveCount(0);
  await expectSaved(page);

  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.getByText("Nicht zurückgeholt – das wurde schon endgültig gelöscht."),
  ).toBeVisible();
  await expectSaved(page);
  expect(await rowExists("tasks", taskId as string)).toBe(false);
});

test("Projekte: Archiv wird erwähnt und lässt sich zeigen", async ({ page }) => {
  const prefix = uniqueName("Archiv");
  const { privat } = await areaIds();
  await seedProject({ title: `${prefix} Umzug 2024`, area_id: privat, status: "archiv" });
  await seedProject({ title: `${prefix} Garten`, area_id: privat, status: "aktiv" });
  await page.goto("/projekte");
  await page.getByRole("textbox", { name: "Projekte durchsuchen" }).fill(prefix);
  // nur die Liste (aktive Projekte stehen auch in der Seitenleiste)
  const main = page.getByRole("main");
  const archived = main.getByRole("link", { name: new RegExp(`${prefix} Umzug 2024`) });
  const active = main.getByRole("link", { name: new RegExp(`${prefix} Garten`) });
  await expect(active).toBeVisible();
  await expect(archived).toHaveCount(0);
  await expect(page.getByText("1 Projekt im Archiv.")).toBeVisible();

  await page.getByRole("button", { name: "Archiv zeigen" }).click();
  await expect(archived).toBeVisible();
  await expect(active).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Archiv ausblenden" }).click();
  await expect(active).toBeVisible();
  await expect(archived).toHaveCount(0);
});

test("Wischen: links Papierkorb mit Rückgängig, rechts erledigt, senkrecht und kurz nichts @mobile", async ({
  page,
}) => {
  const prefix = uniqueName("Wischen");
  const { beruf } = await areaIds();
  const [ladder, pump, radio] = await seedTasks([
    { title: `${prefix} Leiter`, area_id: beruf },
    { title: `${prefix} Pumpe`, area_id: beruf },
    { title: `${prefix} Funk`, area_id: beruf },
  ]);
  await page.goto("/aufgaben");
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill(prefix);
  const rowLadder = taskRow(page, `${prefix} Leiter`);
  const rowPump = taskRow(page, `${prefix} Pumpe`);
  const rowRadio = taskRow(page, `${prefix} Funk`);
  await expect(rowRadio).toBeVisible();

  // senkrecht (scrollen) und kurz-langsam: nichts passiert, kein Öffnen
  await swipe(page, rowRadio, { dy: -160 });
  await swipe(page, rowRadio, { dx: -0.2, stepMs: 60, holdMs: 150 });
  await expect(rowRadio).toBeVisible();
  await expect(page).not.toHaveURL(/aufgabe=/);

  await swipe(page, rowLadder, { dx: -0.6 });
  await expect(page.getByText(`„${prefix} Leiter“ liegt im Papierkorb`)).toBeVisible();
  await expect(rowLadder).toHaveCount(0);
  // Klick ohne Trefferprüfung: Die „Compiling …“-Anzeige des Dev-Servers liegt bei 390 px
  // manchmal über dem Toast (gibt es in Produktion nicht)
  await page.getByRole("button", { name: "Rückgängig" }).dispatchEvent("click");
  await expect(rowLadder).toBeVisible();

  await swipe(page, rowPump, { dx: 0.6 });
  await expect(page.getByText(`„${prefix} Pumpe“ erledigt`)).toBeVisible();
  await expect(rowPump).toHaveCount(0);
  await expect(page).not.toHaveURL(/aufgabe=/);
  await expectNoHorizontalOverflow(page);
  await expectSaved(page);

  const { data } = await (await seedDb())
    .from("tasks")
    .select("id, status, deleted_at")
    .in("id", [ladder as string, pump as string, radio as string]);
  const byId = new Map((data ?? []).map((t) => [t.id, t]));
  expect(byId.get(ladder as string)).toMatchObject({ status: "offen", deleted_at: null });
  expect(byId.get(pump as string)).toMatchObject({ status: "erledigt" });
  expect(byId.get(radio as string)).toMatchObject({ status: "offen", deleted_at: null });
});

test("Wischen schräg wie am iPhone: hält das Scrollen an und löst aus (#24) @mobile", async ({
  page,
}) => {
  const prefix = uniqueName("Schräg");
  const { beruf } = await areaIds();
  await seedTasks([{ title: `${prefix} Schlauch`, area_id: beruf }]);
  await page.goto("/aufgaben");
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill(prefix);
  const row = taskRow(page, `${prefix} Schlauch`);
  await expect(row).toBeVisible();
  // zählt, ob die Zeile das Scrollen anhält (Safari scrollt sonst und bricht die Geste ab)
  await page.evaluate(() => {
    const w = window as unknown as { held: number; free: number };
    w.held = 0;
    w.free = 0;
    document.addEventListener("touchmove", (event) => {
      if (event.defaultPrevented) w.held++;
      else w.free++;
    });
  });

  // senkrecht: Browser darf scrollen, nichts angehalten
  await swipe(page, row, { dy: -120 });
  const vertical = await page.evaluate(() => (window as unknown as { held: number }).held);
  expect(vertical).toBe(0);

  // schräg (waagrecht überwiegt, 24 px Abdrift nach unten): angehalten und erledigt
  await swipe(page, row, { dx: 0.6, dy: 24 });
  await expect(page.getByText(`„${prefix} Schlauch“ erledigt`)).toBeVisible();
  const held = await page.evaluate(() => (window as unknown as { held: number }).held);
  expect(held).toBeGreaterThan(5);
  await expectSaved(page);
});

test("Wischen in Wissen und Inbox: Notiz in den Papierkorb, Inbox-Eintrag erledigt @mobile", async ({
  page,
}) => {
  const prefix = uniqueName("Wisch-Notiz");
  const { privat } = await areaIds();
  const db = await seedDb();
  const noteId = crypto.randomUUID();
  expect(
    (
      await db
        .from("notes")
        .insert({ id: noteId, title: `${prefix} Grillen`, area_id: privat, type: "wissen" })
    ).error,
  ).toBeNull();
  await seedTasks([{ title: `${prefix} Idee Inbox`, in_inbox: true }]);

  await page.goto("/wissen");
  await page.getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  const note = page
    .getByRole("list", { name: "Notizen" })
    .getByRole("listitem")
    .filter({
      hasText: `${prefix} Grillen`,
    });
  await expect(note).toBeVisible();
  // nach rechts gibt es bei Notizen keine Aktion
  await swipe(page, note, { dx: 0.6 });
  await expect(note).toBeVisible();
  await expect(page).toHaveURL(/\/wissen$/);
  await swipe(page, note, { dx: -0.6 });
  await expect(page.getByText(`„${prefix} Grillen“ liegt im Papierkorb`)).toBeVisible();
  await expect(note).toHaveCount(0);
  await expectSaved(page);
  const { data } = await db.from("notes").select("deleted_at").eq("id", noteId).single();
  expect(data?.deleted_at).not.toBeNull();

  await page.goto("/inbox");
  const item = taskRow(page, `${prefix} Idee Inbox`);
  await swipe(page, item, { dx: 0.6 });
  await expect(page.getByText(`„${prefix} Idee Inbox“ erledigt`)).toBeVisible();
  await expect(item).toHaveCount(0);
});
