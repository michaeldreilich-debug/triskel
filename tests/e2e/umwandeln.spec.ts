/**
 * Aufgabe ↔ Notiz umwandeln (#65, E36) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px:
 * Aufgabe → Notiz (Inhalt, Checkliste, Meldung, Rückgängig), Notiz → Aufgabe mit Bild (gleicher
 * Speicherpfad, Bild nach dem Neuladen noch da), Inbox „→ Notiz“ nimmt den Inhalt mit,
 * Rechtsklick-Menüs in Listen und Datenbank (Desktop).
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, trackUploads } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedNotes, seedTasks } from "./support/seed";
import { taskPanel, taskRow } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const editor = (page: Page) => page.locator(".outline-editor");
const titleField = (page: Page) => page.getByRole("textbox", { name: "Titel", exact: true });

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const taskBody = {
  type: "doc",
  content: [
    paragraph("Samstag vor dem Markt"),
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [paragraph("Milch")],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [paragraph("Brot")],
        },
      ],
    },
  ],
};

async function smallPng(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, 300, 200);
    }
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  });
  return Buffer.from(data, "base64");
}

test("Aufgabe → Notiz: Inhalt und Checkliste gehen mit, Meldung nennt Verlorenes, Rückgängig holt die Aufgabe zurück", async ({
  page,
}) => {
  const title = uniqueName("Umwandeln Einkauf");
  const { beruf } = await areaIds();
  const [taskId] = await seedTasks([
    {
      title,
      area_id: beruf,
      due_date: "2030-05-01",
      priority: 1,
      body: taskBody as never,
      body_text: "Samstag vor dem Markt\nMilch\nBrot",
    },
  ]);
  await page.goto(`/aufgaben?aufgabe=${taskId}`);
  const panel = taskPanel(page);
  await expect(panel.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(title);
  await panel.getByRole("button", { name: "Aufgaben-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "In Notiz umwandeln" }).click();

  // zur Notiz gesprungen: Titel, Text und Checklisten-Zeilen
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(titleField(page)).toHaveValue(title);
  await expect(editor(page)).toContainText("Samstag vor dem Markt");
  await expect(editor(page)).toContainText("☑ Milch");
  await expect(editor(page)).toContainText("☐ Brot");
  // die Meldung nennt, was nicht mitgeht
  const message = page.getByText(`„${title}“ ist jetzt eine Notiz`);
  await expect(message).toBeVisible();
  await expect(message).toContainText("Priorität Hoch");
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);

  // Rückgängig: Aufgabe zurück (Panel offen), die Notiz liegt im Papierkorb
  await page.getByRole("button", { name: "Rückgängig" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/aufgaben\\?aufgabe=${taskId}`));
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    title,
  );
  await expectSaved(page);
  await page.goto("/notizen");
  await page.getByRole("textbox", { name: /durchsuchen/ }).fill(title);
  await expect(page.getByRole("main").getByRole("link", { name: new RegExp(title) })).toHaveCount(
    0,
  );

  // noch einmal umwandeln, diesmal bleiben: nach dem Neuladen Notiz da, Aufgabe weg
  await page.goto(`/aufgaben?aufgabe=${taskId}`);
  await taskPanel(page).getByRole("button", { name: "Aufgaben-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "In Notiz umwandeln" }).click();
  await expect(editor(page)).toContainText("☑ Milch");
  await expectSaved(page);
  await page.reload();
  await expect(titleField(page)).toHaveValue(title);
  await expect(editor(page)).toContainText("☑ Milch");
  await page.goto("/aufgaben");
  await expect(taskRow(page, title)).toHaveCount(0);
});

test("Notiz → Aufgabe mit Bild: gleicher Speicherpfad, Bild nach dem Neuladen noch da", async ({
  page,
}) => {
  const title = uniqueName("Umwandeln Notiz");
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(editor(page)).toBeVisible();
  await titleField(page).fill(title);
  await editor(page).click();
  await page.keyboard.type("Erste Zeile");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Unterpunkt");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");

  const uploads = trackUploads(page);
  const png = await smallPng(page);
  await page.getByRole("button", { name: "Einfügen: Bild, Datei oder Diagramm" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Bild einfügen …" }).click();
  await (await chooser).setFiles({ name: "skizze.png", mimeType: "image/png", buffer: png });
  await expect(editor(page).locator(".ol-image img")).toBeVisible();
  await uploads.until(1);
  await expectSaved(page);

  await page.getByRole("button", { name: "Notiz-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "In Aufgabe umwandeln" }).click();

  await expect(page).toHaveURL(/\/aufgaben\?aufgabe=[0-9a-f-]{36}/);
  const panel = taskPanel(page);
  await expect(panel.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(title);
  const body = panel.getByTestId("task-body");
  await expect(body).toContainText("Erste Zeile");
  await expect(body).toContainText("Unterpunkt");
  const image = body.locator(".ol-image img");
  await expect(image).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`„${title}“ ist jetzt eine Aufgabe`)).toBeVisible();
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);

  // gespeichert: nach dem Neuladen Inhalt und Bild (derselbe Pfad, nichts neu hochgeladen)
  await page.reload();
  const reloaded = taskPanel(page).getByTestId("task-body");
  await expect(reloaded).toContainText("Unterpunkt");
  const again = reloaded.locator(".ol-image img");
  await expect(again).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => again.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(300);

  // Rückgängig (⌘Z-Weg: Knopf in der Meldung gibt es nach dem Neuladen nicht mehr) – die
  // Notiz liegt im Papierkorb, die Aufgabe in der Liste
  await page.goto("/notizen");
  await page.getByRole("textbox", { name: /durchsuchen/ }).fill(title);
  await expect(page.getByRole("main").getByRole("link", { name: new RegExp(title) })).toHaveCount(
    0,
  );
});

test("Inbox „→ Notiz“ nimmt den Inhalt der Aufgabe mit", async ({ page }) => {
  const title = uniqueName("Umwandeln Inbox");
  await seedTasks([
    {
      title,
      in_inbox: true,
      body: taskBody as never,
      body_text: "Samstag vor dem Markt\nMilch\nBrot",
    },
  ]);
  await page.goto("/inbox");
  await page.getByRole("button", { name: `„${title}“ als Notiz anlegen` }).click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(titleField(page)).toHaveValue(title);
  await expect(editor(page)).toContainText("Samstag vor dem Markt");
  await expect(editor(page)).toContainText("☑ Milch");
  await expectSaved(page);
  await page.goto("/inbox");
  await expect(page.getByRole("list", { name: "Inbox", exact: true }).getByText(title)).toHaveCount(
    0,
  );
});

test("Rechtsklick in Aufgabenliste und Notizen-Datenbank bietet das Umwandeln an @desktop", async ({
  page,
}) => {
  const { beruf } = await areaIds();
  const taskTitle = uniqueName("Umwandeln Liste");
  const noteTitle = uniqueName("Umwandeln Datenbank");
  await seedTasks([{ title: taskTitle, area_id: beruf }]);
  await seedNotes([{ title: noteTitle, area_id: beruf }]);

  await page.goto("/aufgaben");
  const row = taskRow(page, taskTitle);
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "In Notiz umwandeln" }).click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(titleField(page)).toHaveValue(taskTitle);
  await expectSaved(page);

  await page.goto("/notizen");
  await page.getByRole("textbox", { name: /durchsuchen/ }).fill(noteTitle);
  await page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(noteTitle) })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "In Aufgabe umwandeln" }).click();
  await expect(page).toHaveURL(/\/aufgaben\?aufgabe=[0-9a-f-]{36}/);
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    noteTitle,
  );
  await expectSaved(page);
});
