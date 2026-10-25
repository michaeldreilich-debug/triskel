/**
 * T-15: Smoke-Test gegen den Produktions-Build (playwright.build.config.ts,
 * `npm run test:e2e:build`). Prüft, was nur im Build gilt:
 * - Der Build zeigt aufs Testprojekt: Kein Chunk nennt die Prod-Projekt-ID (`next build` lädt
 *   sonst `.env.local`, siehe Konfiguration).
 * - Die strenge Prod-CSP ohne 'unsafe-eval': Login, Heute, Wissen und Notizen mit
 *   Mermaid-Diagramm, PDF (pdf.js-Worker) und iPhone-Foto (heic-to, Blob-Worker) laufen ohne
 *   Konsolenfehler (CSP-Verstöße erscheinen dort als Fehler); /dev/* ist im Build aus.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { expectSaved } from "../e2e/support/app";
import { AUTH_FILE, uniqueName } from "../e2e/support/auth";
import { tinyPdf } from "../e2e/support/pdf";
import { projectRefFromUrl } from "../guard";
import { REPO_ROOT, readEnvFile } from "../support/env-file";
import { BUILD_DIST_DIR } from "./constants";

/** Konsolenfehler und Seitenfehler sammeln */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Alle .js-Dateien des Builds (Client-Chunks und Server), ohne den Compiler-Cache. */
function builtScripts(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "cache") files.push(...builtScripts(full));
    } else if (entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

test("Build zeigt aufs Testprojekt, kein Chunk nennt das Prod-Projekt", () => {
  const testRef = projectRefFromUrl(readEnvFile(".env.test.local").NEXT_PUBLIC_SUPABASE_URL);
  const prodRef = projectRefFromUrl(readEnvFile(".env.local").NEXT_PUBLIC_SUPABASE_URL);
  expect(testRef, "Test-URL ohne Projekt-ID").toBeTruthy();
  const files = builtScripts(path.join(REPO_ROOT, BUILD_DIST_DIR));
  expect(files.length).toBeGreaterThan(0);
  let withTest = 0;
  let withProd = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (testRef && text.includes(testRef)) withTest += 1;
    if (prodRef && text.includes(prodRef)) withProd += 1;
  }
  // nur Zählwerte in den Meldungen, keine Adressen
  expect(withTest, "Kein Chunk enthält die Adresse des Testprojekts").toBeGreaterThan(0);
  expect(withProd, "Chunks enthalten die Adresse des Prod-Projekts").toBe(0);
});

test("Login: Prod-CSP ohne 'unsafe-eval', Nonce, keine Konsolenfehler; /dev/* ist aus", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  const response = await page.goto("/login");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(/'nonce-[^']+'/.test(csp), "CSP ohne Nonce").toBe(true);
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeEnabled();
  expect(errors).toEqual([]);
  expect((await page.request.get("/dev/mfa")).status()).toBe(404);
});

test.describe("angemeldet (aal2)", () => {
  test.use({ storageState: AUTH_FILE });

  const editor = (page: Page) => page.locator(".outline-editor");

  async function newNote(page: Page, label: string) {
    await page.goto("/wissen");
    await page.getByRole("button", { name: "Neue Notiz" }).first().click();
    await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
    await expect(editor(page)).toBeVisible();
    await page.getByRole("textbox", { name: "Titel", exact: true }).fill(uniqueName(label));
  }

  async function chooseFromInsertMenu(
    page: Page,
    item: string,
    file: { name: string; mimeType: string; buffer: Buffer },
  ) {
    await page.getByRole("button", { name: "Einfügen: Bild, Datei oder Diagramm" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: item }).click();
    await (await chooser).setFiles(file);
  }

  test("Heute und Wissen unter der Prod-CSP ohne Konsolenfehler", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto("/heute");
    expect(response?.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
    await expect(page).toHaveURL(/\/heute$/);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.goto("/wissen");
    await expect(page.getByRole("region", { name: "Notizliste" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Mermaid-Diagramm wird im Build gezeichnet, keine Konsolenfehler", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await newNote(page, "Build Mermaid");
    await editor(page).click();
    await page.keyboard.type("```mermaid ");
    const code = page.getByRole("textbox", { name: "Mermaid-Code" });
    await expect(code).toBeFocused();
    await code.fill("graph TD\n  A[Alarm] --> B[Ausrücken]");
    await page.keyboard.press("Escape");
    const diagram = editor(page).locator(".ol-mermaid-view svg");
    await expect(diagram).toBeVisible({ timeout: 15_000 });
    await expect(diagram).toContainText("Alarm");
    await expectSaved(page);
    expect(errors).toEqual([]);
  });

  test("PDF ganz anzeigen (pdf.js-Worker) im Build, keine Konsolenfehler", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await newNote(page, "Build PDF");
    await chooseFromInsertMenu(page, "Datei einfügen …", {
      name: "Einsatzplan.pdf",
      mimeType: "application/pdf",
      buffer: tinyPdf(2),
    });
    const tile = editor(page).locator(".ol-file");
    await expect(tile).toContainText("Einsatzplan.pdf");
    await expect(tile).not.toContainText("wird hochgeladen", { timeout: 15_000 });
    await tile.getByRole("button", { name: "„Einsatzplan.pdf“ ganz anzeigen" }).click();
    await expect(tile.locator(".ol-pdf canvas")).toHaveCount(2, { timeout: 20_000 });
    await expectSaved(page);
    expect(errors).toEqual([]);
  });

  test("iPhone-Foto (HEIC, heic-to im Blob-Worker) im Build, keine Konsolenfehler", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await newNote(page, "Build HEIC");
    await chooseFromInsertMenu(page, "Bild einfügen …", {
      name: "IMG_4711.HEIC",
      mimeType: "",
      buffer: readFileSync(path.join(REPO_ROOT, "tests", "e2e", "fixtures", "foto.heic")),
    });
    const image = editor(page).locator(".ol-image img");
    await expect(image).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(240);
    await expectSaved(page);
    expect(errors).toEqual([]);
  });
});
