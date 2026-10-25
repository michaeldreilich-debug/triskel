/**
 * Suche in der Befehlspalette (B10, Rückmeldung #19) gegen das Testprojekt, Desktop 1440 px und
 * Mobil 390 px: findet Projekte, Aufgaben und Notizen auch über ihren Inhalt; öffnen per Tastatur.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations } from "./helpers";
import { isNarrow } from "./support/app";
import { AUTH_FILE, E2E_PREFIX, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedProject, seedTasks } from "./support/seed";

test.use({ storageState: AUTH_FILE });

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

test("Suche findet Projekt, Aufgabe und Notiz-Inhalt und öffnet per Tastatur", async ({ page }) => {
  const prefix = uniqueName("Digitale Werkstatt");
  const token = prefix.slice(E2E_PREFIX.length).split(" ")[0] ?? "";
  const { beruf } = await areaIds();
  const projectId = await seedProject({ title: prefix, area_id: beruf, status: "aktiv" });
  const [taskId] = await seedTasks([
    {
      title: `${E2E_PREFIX}${token} Demo software ablauf`,
      area_id: beruf,
      project_id: projectId,
    },
  ]);
  // Notiz, deren Titel das gesuchte Wort nicht enthält – nur ein Block im Inhalt
  const db = await seedDb();
  const noteId = crypto.randomUUID();
  const word = `kolben${token}`;
  const note = await db
    .from("notes")
    .insert({ id: noteId, title: `${E2E_PREFIX}${token} Gerätewartung`, area_id: beruf });
  expect(note.error).toBeNull();
  const block = await db.from("note_blocks").insert({
    note_id: noteId,
    content: { type: "paragraph" },
    content_text: `Jeden ${word} jährlich prüfen`,
    sort: "a0",
  });
  expect(block.error).toBeNull();

  await page.goto("/heute");
  const dialog = await openPalette(page);
  await page.keyboard.type(token);
  const project = dialog.getByRole("option", { name: new RegExp(`${prefix}.*Beruf`) });
  await expect(project).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: new RegExp(`${token} Demo software ablauf.*${prefix}`) }),
  ).toBeVisible();
  await expect(dialog.getByText("Projekte", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Aufgaben", { exact: true })).toBeVisible();
  // cmdk setzt aria-activedescendant einen Takt nach den Treffern (sonst kurz ungültig)
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  // Enter erfasst weiterhin (erste Zeile), ↓ springt zum ersten Treffer
  await page.keyboard.press("ArrowDown");
  await expect(project).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/projekte/${projectId}$`));

  await openPalette(page);
  await page.keyboard.type(word);
  const hit = dialog.getByRole("option", { name: /Gerätewartung/ });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText(`Jeden ${word} jährlich prüfen`);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/wissen/${noteId}$`));
  const noteTitle = page.getByRole("main").getByRole("textbox", { name: "Titel", exact: true });
  await expect(noteTitle).toHaveValue(/Gerätewartung/);

  await openPalette(page);
  await page.keyboard.type(`${word}zzz`);
  await expect(dialog.getByText(/Keine Treffer für/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // #96: eine Aufgabe aus der Suche ersetzt die offene Notiz (öffnet in „Aufgaben“), statt sich
  // als Panel daneben zu schieben
  await openPalette(page);
  await page.keyboard.type(`${token} Demo software`);
  await dialog.getByRole("option", { name: new RegExp(`${token} Demo software ablauf`) }).click();
  await expect(page).toHaveURL(new RegExp(`/aufgaben\\?(.*&)?aufgabe=${taskId}`));
  await expect(noteTitle).toHaveCount(0);
});

test("Viele Treffer: die beste Notiz steht oben unter „Beste Treffer“ (#84)", async ({ page }) => {
  const token = uniqueName("x").slice(E2E_PREFIX.length).split(" ")[0] ?? "";
  const word = `fehler${token}`;
  const { privat } = await areaIds();
  // sechs Aufgaben mit dem Wort, dazu eine Notiz, deren Titel genau das Wort ist (höchster Rang)
  await seedTasks(
    [1, 2, 3, 4, 5, 6].map((i) => ({
      title: `${E2E_PREFIX}${token} Schritt ${i}: ${word} im Ablauf prüfen`,
      area_id: privat,
    })),
  );
  const db = await seedDb();
  const noteId = crypto.randomUUID();
  const note = await db
    .from("notes")
    .insert({ id: noteId, title: `${E2E_PREFIX}${word}`, area_id: privat });
  expect(note.error).toBeNull();

  await page.goto("/heute");
  const dialog = await openPalette(page);
  await page.keyboard.type(word);
  await expect(dialog.getByText("Beste Treffer", { exact: true })).toBeVisible();
  // die Art steht für Screenreader im Namen, die Notiz nur einmal (nicht noch unter „Notizen“)
  const hit = dialog.getByRole("option", { name: new RegExp(`^Notiz: ${E2E_PREFIX}${word}`) });
  await expect(hit).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: new RegExp(`${E2E_PREFIX}${word}`) }),
  ).toHaveCount(1);
  await expect(dialog.getByText("Aufgaben", { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  // ↓ springt zum ersten Treffer – das ist jetzt die Notiz, nicht die erste Aufgabe
  await page.keyboard.press("ArrowDown");
  await expect(hit).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/wissen/${noteId}$`));
});
