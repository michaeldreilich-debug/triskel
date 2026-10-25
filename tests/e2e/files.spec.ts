/**
 * Dateien in Notizen und Aufgaben (#27) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px:
 * PDF über „＋ › Datei einfügen“ als Kachel, „Ganz anzeigen“ zeichnet alle Seiten (pdf.js) in
 * ein Fenster in Seitenhöhe mit „Seite 1 von 2“ (#36),
 * bleibt nach Neuladen, Herunterladen unter dem Originalnamen; Ablegen irgendwo auf der Notiz;
 * Datei an eine Aufgabe hängen.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, trackUploads } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { tinyPdf } from "./support/pdf";
import { areaIds, seedTasks } from "./support/seed";
import { showProperties, taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const editor = (page: Page) => page.locator(".outline-editor");

async function newNote(page: Page, title: string) {
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(editor(page)).toBeVisible();
  await page.getByRole("textbox", { name: "Titel", exact: true }).fill(title);
}

async function chooseFile(
  page: Page,
  open: () => Promise<void>,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const chooser = page.waitForEvent("filechooser");
  await open();
  await (await chooser).setFiles(file);
}

/** Datei per Ziehen auf ein Element fallen lassen (DataTransfer im Browser gebaut). */
async function dropFile(target: Locator, name: string, type: string, text: string) {
  const transfer = await target.page().evaluateHandle(
    ([fileName, fileType, content]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], fileName, { type: fileType }));
      return dt;
    },
    [name, type, text] as const,
  );
  for (const event of ["dragenter", "dragover", "drop"]) {
    await target.dispatchEvent(event, { dataTransfer: transfer });
  }
}

test("PDF in der Notiz: Kachel, ganz anzeigen, bleibt nach Neuladen, herunterladen (#27)", async ({
  page,
}) => {
  await newNote(page, uniqueName("Notiz mit PDF"));
  await chooseFile(
    page,
    async () => {
      await page.getByRole("button", { name: "Einfügen: Bild, Datei oder Diagramm" }).click();
      await page.getByRole("menuitem", { name: "Datei einfügen …" }).click();
    },
    { name: "Einsatzplan.pdf", mimeType: "application/pdf", buffer: tinyPdf(2) },
  );

  const tile = editor(page).locator(".ol-file");
  await expect(tile).toContainText("Einsatzplan.pdf");
  await expect(tile).toContainText(/PDF · \d+ B/);
  await expect(tile).not.toContainText("wird hochgeladen", { timeout: 15_000 });

  await tile.getByRole("button", { name: "„Einsatzplan.pdf“ ganz anzeigen" }).click();
  const pages = tile.locator(".ol-pdf canvas");
  await expect(pages).toHaveCount(2, { timeout: 20_000 });
  await expect
    .poll(() => pages.first().evaluate((c: HTMLCanvasElement) => c.width))
    .toBeGreaterThan(0);
  await expect(pages.first()).toHaveAttribute("aria-label", "Seite 1 von 2");

  // #36: Fenster in Seitenhöhe – eine Seite passt ganz hinein, darin wird geblättert
  const window = tile.getByRole("region", { name: "PDF „Einsatzplan.pdf“" });
  await expect(tile.getByText("Seite 1 von 2")).toBeVisible();
  const box = await window.evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollHeight,
    page: (el.querySelector("canvas") as HTMLCanvasElement).getBoundingClientRect().height,
  }));
  expect(box.scroll).toBeGreaterThan(box.height);
  expect(box.page).toBeLessThanOrEqual(box.height);
  await window.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(tile.getByText("Seite 2 von 2")).toBeVisible();
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await page.reload();
  await expect(tile.locator(".ol-pdf canvas")).toHaveCount(2, { timeout: 20_000 });

  const download = page.waitForEvent("download");
  await tile.getByRole("button", { name: "„Einsatzplan.pdf“ herunterladen" }).click();
  expect((await download).suggestedFilename()).toBe("Einsatzplan.pdf");

  // Öffnen: neuer Tab für das PDF (headless Chromium hat keinen PDF-Betrachter, der Tab bleibt
  // dort leer – geprüft wird, dass er sofort aufgeht und nicht vom Pop-up-Blocker abhängt)
  const popup = page.waitForEvent("popup");
  await tile.getByRole("button", { name: "„Einsatzplan.pdf“ öffnen" }).click();
  await (await popup).close();

  await tile.getByRole("button", { name: "„Einsatzplan.pdf“ als Kachel zeigen" }).click();
  await expect(tile.locator(".ol-pdf canvas")).toHaveCount(0);
  await expect(tile.getByText(/^Seite \d von 2$/)).toHaveCount(0);
  await expectSaved(page);
});

test("Datei irgendwo auf die Notiz ziehen: landet am Ende des Inhalts (#27)", async ({ page }) => {
  await newNote(page, uniqueName("Notiz zum Ablegen"));
  await editor(page).click();
  await page.keyboard.type("Erster Punkt");
  // auf den Titel fallen lassen (neben dem Editor)
  await dropFile(
    page.getByRole("textbox", { name: "Titel", exact: true }),
    "liste.txt",
    "text/plain",
    "Atemschutz\nPrüfung",
  );
  const tile = editor(page).locator(".ol-file");
  await expect(tile).toContainText("liste.txt");
  await expect(tile).toContainText("TXT");
  // Textdateien werden nie im Browser geöffnet, nur heruntergeladen
  await expect(tile.getByRole("button", { name: "„liste.txt“ ganz anzeigen" })).toBeHidden();
  const download = page.waitForEvent("download");
  await tile.getByRole("button", { name: "„liste.txt“ herunterladen" }).first().click();
  expect((await download).suggestedFilename()).toBe("liste.txt");
  await expectSaved(page);
});

test("Datei an eine Aufgabe hängen: Knopf und Ablegen auf dem Panel (#27)", async ({ page }) => {
  const title = uniqueName("Aufgabe mit Datei");
  const { beruf } = await areaIds();
  const [task] = await seedTasks([{ title, area_id: beruf }]);
  await page.goto(`/aufgaben?aufgabe=${task}`);
  const uploads = trackUploads(page);
  const panel = taskPanel(page);
  await showProperties(panel);
  await chooseFile(page, () => panel.getByRole("button", { name: "Datei anhängen" }).click(), {
    name: "Angebot.pdf",
    mimeType: "application/pdf",
    buffer: tinyPdf(1),
  });
  const body = panel.getByTestId("task-body");
  await expect(body.locator(".ol-file")).toContainText("Angebot.pdf");
  await dropFile(
    panel.getByRole("textbox", { name: "Titel", exact: true }),
    "notiz.txt",
    "text/plain",
    "x",
  );
  await expect(body.locator(".ol-file")).toHaveCount(2);
  await expect(body.locator(".ol-file").nth(1)).toContainText("notiz.txt");
  await expectSaved(page);
  await uploads.until(2);

  await page.reload();
  await expect(taskPanel(page).getByTestId("task-body").locator(".ol-file")).toHaveCount(2);
});
