/**
 * Bilder und Mermaid-Diagramme in Notizen (E24) gegen das Testprojekt, Desktop 1440 px und
 * Mobil 390 px: Bild über „Einfügen“ wählen (verkleinert auf höchstens 2000 px, privater Bucket,
 * nach Neuladen über die eigene Sitzung geladen), Diagramm per ```mermaid tippen, gezeichnet,
 * nach Neuladen wieder da und über die Suche zu finden.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow, trackUploads } from "./support/app";
import { AUTH_FILE, E2E_PREFIX, uniqueName } from "./support/auth";
import { areaIds, seedTasks } from "./support/seed";
import { taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const editor = (page: Page) => page.locator(".outline-editor");

async function newNote(page: Page, title: string) {
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(editor(page)).toBeVisible();
  await page.getByRole("textbox", { name: "Titel", exact: true }).fill(title);
}

/**
 * Bild auswählen: Klick öffnet die Großansicht (#59) – am Handy „Bearbeiten“ (wählt das Bild aus,
 * Werkzeuge erscheinen), am Desktop Esc (der Klick hat das Bild schon ausgewählt).
 */
async function selectImage(page: Page, image: Locator) {
  await image.click();
  const viewer = page.getByTestId("image-viewer");
  await expect(viewer).toBeVisible();
  if (isNarrow(page)) await viewer.getByRole("button", { name: "Bearbeiten" }).click();
  else await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  // der Editor holt den Fokus nach dem Schließen zurück und wählt das Bild aus
  await expect(image.locator("xpath=..")).toHaveClass(/is-selected/);
  await expect(editor(page)).toBeFocused();
}

/** Großes PNG im Browser erzeugen (3000 × 1200 px). */
async function bigPng(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 1200;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, 3000, 1200);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(100, 100, 800, 400);
    }
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  });
  return Buffer.from(data, "base64");
}

test("Bild einfügen: verkleinert, gespeichert, nach Neuladen wieder da", async ({ page }) => {
  await newNote(page, uniqueName("Notiz mit Bild"));
  const uploads = trackUploads(page);
  const png = await bigPng(page);
  await page.getByRole("button", { name: "Einfügen: Bild, Datei oder Diagramm" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Bild einfügen …" }).click();
  await (await chooser).setFiles({ name: "skizze.png", mimeType: "image/png", buffer: png });

  const image = editor(page).locator(".ol-image img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "skizze");
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2000);
  await expectSaved(page);
  // Hochladen läuft neben der Warteschlange: warten, bis die Datei im Bucket liegt
  await expect(page.getByText(/konnte nicht hochgeladen werden/)).toHaveCount(0);
  await uploads.until(1);

  await page.reload();
  await expect(image).toBeVisible({ timeout: 15_000 });
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2000);
  await expectNoHorizontalOverflow(page);
});

test("iPhone-Foto (HEIC) erscheint als Bild, gespeichert als JPEG (#39)", async ({ page }) => {
  await newNote(page, uniqueName("Notiz mit iPhone-Foto"));
  await page.getByRole("button", { name: "Einfügen: Bild, Datei oder Diagramm" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Bild einfügen …" }).click();
  // Chrome kennt HEIC nicht: Typ leer, nur die Endung – wie beim Ziehen aus dem Finder
  await (await chooser).setFiles({
    name: "IMG_4711.HEIC",
    mimeType: "",
    buffer: readFileSync(path.join(__dirname, "fixtures", "foto.heic")),
  });

  const image = editor(page).locator(".ol-image img");
  await expect(image).toBeVisible({ timeout: 15_000 });
  await expect(image).toHaveAttribute("alt", "IMG_4711");
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(240);
  await expect(editor(page).locator(".ol-file")).toHaveCount(0);
  await expectSaved(page);
  await expect(page.getByText(/konnte nicht hochgeladen werden/)).toHaveCount(0);
});

test("Mermaid: ```mermaid tippen, Code eingeben, Diagramm wird gezeichnet und gefunden", async ({
  page,
}) => {
  const token = crypto.randomUUID().slice(0, 6);
  await newNote(page, uniqueName("Ablauf"));
  await editor(page).click();
  await page.keyboard.type("```mermaid ");
  const code = page.getByRole("textbox", { name: "Mermaid-Code" });
  await expect(code).toBeFocused();
  await code.fill(`graph TD\n  A[Alarm${token}] --> B[Ausrücken]`);
  await page.keyboard.press("Escape");
  const diagram = editor(page).locator(".ol-mermaid-view svg");
  await expect(diagram).toBeVisible({ timeout: 15_000 });
  await expect(diagram).toContainText(`Alarm${token}`);
  await expectSaved(page);

  await page.reload();
  await expect(diagram).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);

  // durchsuchbar: der Code steht im Suchtext des Blocks
  const dialog = page.getByRole("dialog", { name: "Befehlspalette" });
  await expect(async () => {
    if (isNarrow(page)) await page.getByRole("button", { name: "Suche öffnen" }).click();
    else await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.keyboard.type(`alarm${token}`);
  await expect(
    dialog.getByRole("option", { name: new RegExp(`${E2E_PREFIX}.*Ablauf`) }),
  ).toBeVisible();
});

test("Bild skalieren und zuschneiden: Knöpfe, Ziehen an der Ecke, Zuschnitt bleibt nach Neuladen (#28)", async ({
  page,
}) => {
  await newNote(page, uniqueName("Bild bearbeiten"));
  const uploads = trackUploads(page);
  const png = await bigPng(page);
  await page.getByRole("button", { name: "Einfügen: Bild, Datei oder Diagramm" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Bild einfügen …" }).click();
  await (await chooser).setFiles({ name: "lageplan.png", mimeType: "image/png", buffer: png });
  const box = editor(page).locator(".ol-image");
  const image = box.locator("img");
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2000);
  await expect(page.getByText(/konnte nicht hochgeladen werden/)).toHaveCount(0);
  await uploads.until(1);

  // auswählen (am Handy erscheinen die Werkzeuge erst dann), kleiner per Knopf
  await selectImage(page, image);
  await box.getByRole("button", { name: "Bild kleiner" }).click();
  await expect(box).toHaveAttribute("style", /width: 75%/);

  // Ziehen an der Ecke (Maus bzw. Finger): auf etwa die Hälfte
  const line = await box.evaluate((el) => el.parentElement?.clientWidth ?? 0);
  const handle = await box.locator(".ol-image-handle").boundingBox();
  if (!handle) throw new Error("kein Griff");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - line * 0.25, handle.y + 4, { steps: 8 });
  await page.mouse.up();
  const width = await box.evaluate((el) => Number.parseFloat(el.style.width));
  expect(width).toBeGreaterThan(40);
  expect(width).toBeLessThan(60);

  // zuschneiden: Ecke unten rechts in die Mitte → halbe Breite, halbe Höhe
  await selectImage(page, image);
  await box.getByRole("button", { name: "Bild zuschneiden" }).click();
  const dialog = page.getByRole("dialog", { name: "Bild zuschneiden" });
  await expect(dialog).toBeVisible();
  const frame = await dialog.getByTestId("crop-frame").boundingBox();
  const corner = await dialog.getByRole("button", { name: "Ecke unten rechts" }).boundingBox();
  if (!frame || !corner) throw new Error("kein Rahmen");
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Zuschneiden", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
    .toBeLessThan(1100);
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(900);
  await expectSaved(page);
  // der Zuschnitt ist ein neues Bild
  await uploads.until(2);

  await page.reload();
  await expect(image).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeLessThan(1100);
  const kept = await box.evaluate((el) => Number.parseFloat(el.style.width));
  expect(kept).toBeCloseTo(width, 0);
  await expectNoHorizontalOverflow(page);
});

test("Bild anklicken: Großansicht im Fenster – zoomen, verschieben, blättern, wegklicken (#59)", async ({
  page,
}) => {
  await newNote(page, uniqueName("Bild groß"));
  const uploads = trackUploads(page);
  for (const name of ["erstes.png", "zweites.png"]) {
    await page.getByRole("button", { name: "Einfügen: Bild, Datei oder Diagramm" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Bild einfügen …" }).click();
    await (await chooser).setFiles({ name, mimeType: "image/png", buffer: await bigPng(page) });
  }
  const images = editor(page).locator(".ol-image img");
  await expect(images).toHaveCount(2);
  await uploads.until(2);
  await expectSaved(page);

  // Klick öffnet die Großansicht im selben Fenster (kein neuer Tab)
  await images.first().click();
  const viewer = page.getByTestId("image-viewer");
  await expect(viewer).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  await expect(viewer.getByRole("heading")).toContainText("1 von 2");
  const zoom = viewer.getByRole("button", { name: /^Zoom \d+ %/ });
  await expect(zoom).toHaveText("100 %");
  await expect
    .poll(() =>
      viewer.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBe(2000);

  // Knöpfe, Tasten und Mausrad zoomen; eingepasst mit „0“
  await viewer.getByRole("button", { name: "Vergrößern" }).click();
  await expect(zoom).toHaveText("125 %");
  await page.keyboard.press("+");
  await expect(zoom).toHaveText("156 %");
  const stage = viewer.getByTestId("image-viewer-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("keine Bühne");
  if (!isNarrow(page)) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect
      .poll(async () => Number.parseInt((await zoom.textContent()) ?? "0", 10))
      .toBeGreaterThan(156);
    // vergrößert verschieben: Ziehen bewegt das Bild
    const before = await viewer.locator("img").getAttribute("style");
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => viewer.locator("img").getAttribute("style")).not.toBe(before);
    await expect(viewer).toBeVisible();
  }
  await page.keyboard.press("0");
  await expect(zoom).toHaveText("100 %");

  // blättern
  await viewer.getByRole("button", { name: "Nächstes Bild" }).click();
  await expect(viewer.getByRole("heading")).toContainText("2 von 2");
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("heading")).toContainText("1 von 2");
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  await expectNoHorizontalOverflow(page);

  // Klick neben das Bild schließt; Esc ebenso
  await page.mouse.click(box.x + 8, box.y + box.height - 8);
  await expect(viewer).toBeHidden();
  await images.nth(1).click();
  await expect(viewer.getByRole("heading")).toContainText("2 von 2");
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});

test("Handy: Großansicht „Bearbeiten“ wählt das Bild aus, Werkzeuge erscheinen (#59) @mobile", async ({
  page,
}) => {
  await newNote(page, uniqueName("Bild Handy"));
  await page.getByRole("button", { name: "Einfügen: Bild, Datei oder Diagramm" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Bild einfügen …" }).click();
  await (await chooser).setFiles({
    name: "handy.png",
    mimeType: "image/png",
    buffer: await bigPng(page),
  });
  const image = editor(page).locator(".ol-image img");
  await expect(image).toBeVisible();
  await image.click();
  const viewer = page.getByTestId("image-viewer");
  await expect(viewer).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await viewer.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(viewer).toBeHidden();
  await expect(editor(page).locator(".ol-image")).toHaveClass(/is-selected/);
  await expect(editor(page).getByRole("button", { name: "Bild kleiner" })).toBeVisible();
});

test("Bild antippen und Return: Bild bleibt, darunter ein neuer Punkt (O-1)", async ({ page }) => {
  await newNote(page, uniqueName("Bild bleibt"));
  await editor(page).click();
  await page.keyboard.type("Vorher");
  await page.getByRole("button", { name: "Einfügen: Bild, Datei oder Diagramm" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Bild einfügen …" }).click();
  await (await chooser).setFiles({
    name: "bleibt.png",
    mimeType: "image/png",
    buffer: await bigPng(page),
  });
  const image = editor(page).locator(".ol-image img");
  await expect(image).toBeVisible();

  // Bild auswählen (Werkzeuge erscheinen), Return schreibt darunter weiter
  await selectImage(page, image);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Danach");
  await expect(image).toBeVisible();
  await expect(editor(page).locator(".ol-block")).toHaveCount(2);
  await expect(editor(page).locator(".ol-block").nth(1)).toHaveText("Danach");
  await expectSaved(page);
});

test("Handy: Foto aufnehmen (Kamera) und mehrere Fotos wählen in Notiz und Aufgabe (F2, #54) @mobile", async ({
  page,
}) => {
  await newNote(page, uniqueName("Notiz mit Kamera"));
  const png = await bigPng(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Foto aufnehmen" }).click();
  const camera = await chooser;
  // die Kamera-Eingabe trägt capture="environment" (öffnet am iPhone direkt die Kamera)
  expect(await camera.element().getAttribute("capture")).toBe("environment");
  await camera.setFiles({ name: "kamera.png", mimeType: "image/png", buffer: png });
  await expect(editor(page).locator(".ol-image img")).toBeVisible();
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);

  // Aufgabe: „Fotos wählen“ ohne capture, mehrere auf einmal
  const { beruf } = await areaIds();
  const [task] = await seedTasks([{ title: uniqueName("Aufgabe mit Fotos"), area_id: beruf }]);
  await page.goto(`/aufgaben?aufgabe=${task}`);
  const panel = taskPanel(page);
  const second = page.waitForEvent("filechooser");
  await panel.getByRole("button", { name: "Fotos wählen" }).click();
  const library = await second;
  expect(await library.element().getAttribute("capture")).toBeNull();
  expect(library.isMultiple()).toBe(true);
  await library.setFiles([
    { name: "a.png", mimeType: "image/png", buffer: png },
    { name: "b.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(panel.getByTestId("task-body").locator(".ol-image img")).toHaveCount(2);
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);
});
