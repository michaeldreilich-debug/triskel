/**
 * Rückmeldungen vom 23.10.2026 (#89–#94) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px.
 * Jeder Test legt eigene Daten mit E2E-Präfix an (der Teardown räumt sie weg – Freigaben gehen
 * mit ihrer Notiz, Bilder mit dem R2-Ordner von Testnutzer A).
 */
import { type Browser, expect, type Page, test } from "@playwright/test";
import { newShareToken } from "@/features/share/token";
import { putObject } from "@/features/storage/client";
import { objectKey } from "@/features/storage/paths";
import { berlinDateTime } from "@/lib/dates";
import type { Json } from "@/lib/supabase/database.types";
import { testR2Config } from "../support/media";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { dragTo, holdDrag, releaseDrag } from "./support/drag";
import { areaIds, seedDb, seedNotes, seedProject, seedTasks } from "./support/seed";
import { storedAccessToken } from "./support/session";
import { taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

test("Weblinks im Text der Aufgabe sind klickbar, ohne den Inhalt zu ändern (#93)", async ({
  page,
  context,
}) => {
  const { beruf } = await areaIds();
  const text = "Infos: https://example.com/e2e-formular und dwd.de, Datei Bericht.pdf";
  const [id] = await seedTasks([
    {
      title: uniqueName("Weblinks"),
      area_id: beruf,
      body: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
      body_text: text,
    },
  ]);
  const db = await seedDb();
  const stamp = async () =>
    (
      await db
        .from("tasks")
        .select("updated_at")
        .eq("id", id as string)
        .single()
    ).data?.updated_at;
  const before = await stamp();

  await page.goto(`/aufgaben?aufgabe=${id}`);
  const body = taskPanel(page).getByRole("textbox", { name: "Notiz oder Checkliste" });
  const links = body.locator("a");
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveAttribute("href", "https://example.com/e2e-formular");
  await expect(links.first()).toHaveAttribute("target", "_blank");
  await expect(links.nth(1)).toHaveAttribute("href", "https://dwd.de/");

  // Klick öffnet einen neuen Tab
  const popup = context.waitForEvent("page");
  await links.first().click();
  await (await popup).close();

  // Öffnen und Klicken schreibt nichts zurück
  await page.waitForTimeout(1200);
  expect(await stamp()).toBe(before);
});

test("Weblinks in Notiz: Adresse tippen, Enter – bleibt klickbar (#93)", async ({ page }) => {
  await page.goto("/notizen");
  await page.getByRole("button", { name: "Neue Notiz" }).click();
  const editor = page.locator(".outline-editor").first();
  await editor.click();
  await page.keyboard.type("Formular unter dwd.de");
  await page.keyboard.press("Enter");
  await page.keyboard.type("zweiter Punkt");
  await expectSaved(page);
  await expect(editor.locator("a")).toHaveCount(1);
  await expect(editor.locator("a")).toHaveAttribute("href", "https://dwd.de/");
  await page.reload();
  await expect(page.locator(".outline-editor").first().locator("a")).toHaveCount(1);
});

test("Projekt-Reiter Aufgaben und Notizen: Tabelle mit Eigenschaften, Notiz als Panel (#91, #92)", async ({
  page,
}, info) => {
  const prefix = uniqueName("Projekt-Reiter");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "aktiv",
  });
  await seedTasks([{ title: `${prefix} Aufgabe`, area_id: beruf, project_id: project }]);
  await seedNotes([
    { title: `${prefix} Notiz`, area_id: beruf, type: "idee", project_id: project },
  ]);
  const wide = info.project.name !== "mobile";

  // Aufgaben: Tabelle, ohne Projekt-Spalte, Zelle direkt ändern
  await page.goto(`/projekte/${project}?reiter=aufgaben`);
  await expect(page.getByRole("radio", { name: "Tabelle" })).toBeChecked();
  const task = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: `${prefix} Aufgabe` }) });
  await expect(task).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Projekt" })).toHaveCount(0);
  await task.getByRole("button", { name: "Status: Offen" }).click();
  await page.getByRole("menuitemradio", { name: "In Arbeit" }).click();
  await expect(task.getByRole("button", { name: "Status: In Arbeit" })).toBeVisible();

  // Notizen: Tabelle, Typ in der Zelle ändern, keine Projekt-Spalte
  await page.goto(`/projekte/${project}?reiter=notizen`);
  await expect(page.getByRole("radio", { name: "Tabelle" })).toBeChecked();
  await expect(page.getByRole("columnheader", { name: "Projekt" })).toHaveCount(0);
  const note = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: `${prefix} Notiz` }) });
  await note.getByRole("button", { name: "Typ: Idee" }).click();
  await page.getByRole("option", { name: "Wissen", exact: true }).click();
  await expect(note.getByRole("button", { name: "Typ: Wissen" })).toBeVisible();
  await expectSaved(page);

  if (!wide) {
    // am Handy ist neben der Tabelle kein Platz: wie bisher im Wissen
    await note.getByRole("link", { name: `${prefix} Notiz` }).click();
    await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}$/);
    return;
  }

  // Titel öffnet die Notiz als Panel, das Projekt bleibt offen
  await note.getByRole("link", { name: `${prefix} Notiz` }).click();
  await expect(page).toHaveURL(new RegExp(`/projekte/${project}\\?.*notiz=[0-9a-f-]{36}`));
  const panel = page.getByRole("complementary", { name: "Notiz" });
  await expect(panel.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} Notiz`,
  );
  await expect(page.getByRole("tab", { name: /^Notizen/ })).toBeVisible();
  // Rechtsklick: „Im Wissen öffnen“ dabei
  await note.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Im Wissen öffnen" })).toBeVisible();
  await page.keyboard.press("Escape");

  // „Neue Notiz“ im Projekt: Panel, Notiz gehört zum Projekt
  await panel.getByRole("button", { name: "Notiz schließen" }).click();
  await page.getByRole("button", { name: "Neue Notiz" }).click();
  await expect(page).toHaveURL(/notiz=[0-9a-f-]{36}/);
  await expect(panel).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Notizen/ })).toBeVisible();
  await expectSaved(page);
});

test("Projekt mit Steckbrief und Notiz-Panel läuft bei 1280 px nicht über (#92)", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile", "Panel gibt es erst ab 1280 px");
  const { beruf } = await areaIds();
  const project = await seedProject({
    title: uniqueName("Projekt-Breite"),
    area_id: beruf,
    status: "aktiv",
  });
  const [note] = await seedNotes([
    { title: uniqueName("Notiz-Breite"), area_id: beruf, project_id: project },
  ]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/projekte/${project}?reiter=notizen&notiz=${note}`);
  await expect(page.getByRole("complementary", { name: "Notiz" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Übersicht/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

// 1×1 PNG für das Bild in der freigegebenen Notiz
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const para = (content: Json[], kind?: string): NonNullable<Json> => ({
  type: "paragraph",
  ...(kind ? { attrs: { kind } } : {}),
  content,
});

/** Notiz mit Überschrift, Weblink, Verweis, Tag, Bild, erledigter Aufgabe und Eingeklapptem. */
async function seedSharedNote(prefix: string) {
  const { privat } = await areaIds();
  const [noteId, linkedId] = await seedNotes([
    { title: `${prefix} Freigabe`, area_id: privat, type: "wissen" },
    { title: `${prefix} Geheim verlinkt`, area_id: privat, type: "idee" },
  ]);
  const [taskId] = await seedTasks([
    { title: `${prefix} Punkt`, area_id: privat, status: "erledigt" },
  ]);
  const db = await seedDb();
  const tags = await db
    .from("notes")
    .update({ tags: ["e2e-geheimtag"] })
    .eq("id", noteId as string);
  if (tags.error) throw new Error(`Tags: ${tags.error.message}`);
  const { userId } = await storedAccessToken();
  const imagePath = `${userId}/${noteId}/${crypto.randomUUID()}.png`;
  const r2 = testR2Config();
  if (!r2) throw new Error("R2-Test-Bucket fehlt (.env.test.local)");
  await putObject(r2, objectKey("note-images", imagePath), PNG, "image/png");
  const parent = crypto.randomUUID();
  const t = (text: string) => ({ type: "text", text });
  const blocks = await db.from("note_blocks").insert(
    [
      { sort: "a0", content: para([t("Überblick")], "h1") },
      {
        sort: "a1",
        content: para([
          t("Formular unter dwd.de, siehe "),
          { type: "noteLink", attrs: { noteId: linkedId } },
          t(" "),
          { type: "tag", attrs: { name: "einsatz" } },
        ]),
      },
      {
        sort: "a2",
        content: para([{ type: "noteImage", attrs: { path: imagePath, alt: "Plan" } }]),
      },
      { sort: "a3", content: para([t("Erledigter Punkt")]), task_id: taskId },
      { id: parent, sort: "a4", content: para([t("Eingeklappt")]), collapsed: true },
      { sort: "a0", parent_id: parent, content: para([t("Versteckter Punkt")]) },
    ].map((row) => ({ note_id: noteId as string, content_text: "", ...row })),
    { defaultToNull: false },
  );
  if (blocks.error) throw new Error(`Blöcke: ${blocks.error.message}`);
  return { noteId: noteId as string, title: `${prefix} Freigabe`, imagePath };
}

/** Kontext ganz ohne Anmeldung (keine Cookies, kein localStorage). */
async function anonymousPage(browser: Browser, page: Page) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: page.viewportSize() ?? undefined,
  });
  return { anon: await context.newPage(), close: () => context.close() };
}

test("Notiz öffentlich freigeben: Seite ohne Anmeldung, ohne Eigenschaften, Bild lädt; beenden → 404 (#94)", async ({
  page,
  browser,
}) => {
  const prefix = uniqueName("Teilen");
  const { noteId, title } = await seedSharedNote(prefix);

  await page.goto(`/wissen/${noteId}`);
  await expect(page.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(title);
  await expect(page.getByRole("button", { name: "Öffentlich", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Notiz-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Öffentlich freigeben …" }).click();
  const dialog = page.getByRole("dialog", { name: "Öffentlich freigeben" });
  await expect(dialog).toContainText("ohne Eigenschaften");
  await dialog.getByRole("button", { name: "Freigabe erstellen" }).click();
  const link = dialog.getByRole("textbox", { name: "Öffentlicher Link" });
  await expect(link).toHaveValue(/\/freigabe\/[A-Za-z0-9_-]{43}$/);
  const url = new URL(await link.inputValue());
  await expect(dialog.getByRole("button", { name: "Öffentlichen Link kopieren" })).toBeVisible();
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  await expectSaved(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // sichtbar, dass die Notiz öffentlich ist
  const badge = page.getByRole("button", { name: "Öffentlich", exact: true });
  await expect(badge).toBeVisible();

  const { anon, close } = await anonymousPage(browser, page);
  try {
    const response = await anon.goto(url.pathname);
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cache-control"]).toContain("no-store");
    await expect(anon).toHaveTitle(`${title} · Triskel`);
    const main = anon.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(main.getByRole("heading", { level: 2, name: "Überblick" })).toBeVisible();
    const web = main.getByRole("link", { name: "dwd.de" });
    await expect(web).toHaveAttribute("href", "https://dwd.de/");
    await expect(web).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(main.getByText("verknüpfte Notiz")).toBeVisible();
    await expect(main.getByText("#einsatz")).toBeVisible();
    // keine Eigenschaften, nichts von der verknüpften Notiz
    const text = (await main.textContent()) ?? "";
    for (const hidden of ["Geheim verlinkt", "e2e-geheimtag", "Wissen", "Privat", "Bereich"]) {
      expect(text, hidden).not.toContain(hidden);
    }
    await expect(main.getByRole("checkbox", { name: "Erledigt" })).toBeChecked();
    await expect(main.getByRole("checkbox", { name: "Erledigt" })).toBeDisabled();
    // Bild lädt (Freigabe-Route → signierter R2-Link, CSP erlaubt R2 hier)
    const image = main.getByRole("img", { name: "Plan" });
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const imageSrc = (await image.getAttribute("src")) ?? "";
    // eingeklappt bleibt eingeklappt, lässt sich aber öffnen
    await expect(main.getByText("Versteckter Punkt")).toBeHidden();
    await main.getByText("1 Unterpunkt").click();
    await expect(main.getByText("Versteckter Punkt")).toBeVisible();
    await expect(anon.getByText("Mit Triskel geteilt")).toBeVisible();
    await expectNoHorizontalOverflow(anon);
    await expectNoA11yViolations(anon);
    // auch im hellen Theme (Papier) lesbar
    await anon.context().addCookies([{ name: "sz-theme", value: "paper", url: url.origin }]);
    await anon.reload();
    await expect(anon.locator("html")).toHaveAttribute("data-theme", "paper");
    await expectNoA11yViolations(anon);

    // beenden (über die Plakette) → die Seite und ihre Bilder sind sofort weg
    await badge.click();
    await dialog.getByRole("button", { name: "Freigabe beenden" }).click();
    await expect(page.getByText(`Freigabe von „${title}“ beendet`)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Freigabe erstellen" })).toBeVisible();
    await expectSaved(page);
    await page.keyboard.press("Escape");
    await expect(badge).toHaveCount(0);
    const gone = await anon.reload();
    expect(gone?.status()).toBe(404);
    await expect(anon.getByText("Diese Freigabe gibt es nicht (mehr).")).toBeVisible();
    const file = await anon.request.get(imageSrc, { maxRedirects: 0 });
    expect(file.status()).toBe(404);
    // ohne Anmeldung: in die App geht es nicht
    await anon.goto("/heute");
    await expect(anon).toHaveURL(/\/login/);
  } finally {
    await close();
  }
});

test("Freigaben in den Einstellungen: öffnen, beenden mit Rückgängig; Rechtsklick bietet „Öffentlich freigeben …“ (#94)", async ({
  page,
}, info) => {
  const { beruf } = await areaIds();
  const title = uniqueName("Freigabe-Liste");
  const [noteId] = await seedNotes([{ title, area_id: beruf, type: "idee" }]);
  const token = newShareToken();
  const db = await seedDb();
  const share = await db.from("note_shares").insert({ note_id: noteId as string, token });
  if (share.error) throw new Error(`Freigabe: ${share.error.message}`);

  await page.goto("/einstellungen#freigaben");
  const section = page.getByRole("list", { name: "Aktive Freigaben" });
  const row = section.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByRole("link", { name: /^Öffentliche Seite öffnen/ })).toHaveAttribute(
    "href",
    new RegExp(`/freigabe/${token}$`),
  );
  await expect(row.getByRole("link", { name: /^Notiz öffnen/ })).toHaveAttribute(
    "href",
    `/wissen/${noteId}`,
  );
  await expectNoHorizontalOverflow(page);
  await row.getByRole("button", { name: /^Beenden/ }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Rückgängig" }).first().click();
  await expect(section.getByRole("listitem").filter({ hasText: title })).toBeVisible();
  await expectSaved(page);
  const restored = await db.from("note_shares").select("revoked_at").eq("token", token).single();
  expect(restored.data?.revoked_at).toBeNull();

  if (info.project.name === "mobile") return;
  // Rechtsklick in der Notizen-Datenbank: eigener Punkt neben „Link kopieren“
  await page.goto("/notizen");
  await page
    .getByPlaceholder(/Suchen/)
    .first()
    .fill(title);
  await page
    .getByRole("main")
    .getByRole("link", { name: title })
    .first()
    .click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Link kopieren" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Öffentlich freigeben …" }).click();
  const dialog = page.getByRole("dialog", { name: "Öffentlich freigeben" });
  await expect(dialog.getByRole("textbox", { name: "Öffentlicher Link" })).toHaveValue(
    new RegExp(`/freigabe/${token}$`),
  );
  await page.keyboard.press("Escape");
  // nach dem Fenster bleibt die Seite bedienbar (Menü → Fenster)
  await page.getByRole("main").getByRole("link", { name: title }).first().click();
  await expect(page).toHaveURL(/notiz=[0-9a-f-]{36}/);
});

test("Nächster Schritt per Ziehen: Fahrplan, Reiter Aufgaben, Panel-Kopf; Erledigte und fremde nicht (#89)", async ({
  page,
}, info) => {
  const prefix = uniqueName("Ziehen");
  const { beruf } = await areaIds();
  const db = await seedDb();
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "aktiv",
  });
  const other = await seedProject({
    title: `${prefix} Fremd`,
    area_id: beruf,
    status: "aktiv",
  });
  const milestone = crypto.randomUUID();
  const m = await db
    .from("milestones")
    .insert({ id: milestone, project_id: project, title: `${prefix} Etappe`, sort: "a0" });
  if (m.error) throw new Error(m.error.message);
  const [inPlan, loose, tabTask, done, foreign] = await seedTasks([
    {
      title: `${prefix} Im Fahrplan`,
      area_id: beruf,
      project_id: project,
      milestone_id: milestone,
    },
    { title: `${prefix} Ohne Meilenstein`, area_id: beruf, project_id: project },
    { title: `${prefix} Im Reiter`, area_id: beruf, project_id: project },
    {
      title: `${prefix} Schon fertig`,
      area_id: beruf,
      project_id: project,
      status: "erledigt",
    },
    { title: `${prefix} Andere`, area_id: beruf, project_id: other },
  ]);
  const nextOf = async () =>
    (await db.from("projects").select("next_task_id").eq("id", project).single()).data
      ?.next_task_id;
  const box = page.getByRole("region", { name: "Nächster Schritt" });
  const row = (title: string) =>
    page.locator("[data-task-drag]").filter({ has: page.getByRole("link", { name: title }) });

  await page.goto(`/projekte/${project}`);
  await expect(box).toBeVisible();

  if (info.project.name === "mobile") {
    // Handy: keine Ziehflächen, die Auswahl bleibt (und läuft nicht über)
    await expect(page.locator("[data-task-drag]")).toHaveCount(0);
    await expect(box.getByRole("button", { name: "Nächsten Schritt festlegen" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    return;
  }

  // Aufgabe aus dem Fahrplan: der Kasten zeigt beim Ziehen, dass er annimmt
  await holdDrag(page, row(`${prefix} Im Fahrplan`), box);
  await expect(box).toHaveAttribute("data-drop", "ueber");
  await expect(box.getByTestId("nextstep-drop-hint")).toBeVisible();
  await releaseDrag(page);
  await expect(box.getByRole("link", { name: `${prefix} Im Fahrplan` })).toBeVisible();
  await expect(page.getByText(`Nächster Schritt: „${prefix} Im Fahrplan“`).first()).toBeVisible();
  await expectSaved(page);
  expect(await nextOf()).toBe(inPlan);

  // Rückgängig stellt den vorigen Stand wieder her
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(box).toContainText("Noch kein nächster Schritt");
  await expectSaved(page);
  expect(await nextOf()).toBeNull();

  // „Ohne Meilenstein“
  await dragTo(page, row(`${prefix} Ohne Meilenstein`), box);
  await expect(box.getByRole("link", { name: `${prefix} Ohne Meilenstein` })).toBeVisible();
  await expectSaved(page);
  expect(await nextOf()).toBe(loose);

  // Klick auf die Zeile öffnet weiter das Panel (kein Ziehen), Häkchen bleiben bedienbar
  await row(`${prefix} Im Fahrplan`)
    .getByRole("link", { name: `${prefix} Im Fahrplan` })
    .click();
  await expect(page).toHaveURL(new RegExp(`aufgabe=${inPlan}`));
  const panel = page.getByRole("complementary", { name: "Aufgabe" });
  await expect(panel.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} Im Fahrplan`,
  );

  // Kopf des Panels: die eigene Aufgabe auf den Kasten ziehen
  await dragTo(page, panel.locator("[data-task-drag]"), box);
  await expect(box.getByRole("link", { name: `${prefix} Im Fahrplan` })).toBeVisible();
  await expectSaved(page);
  expect(await nextOf()).toBe(inPlan);

  // Aufgabe eines anderen Projekts im Panel: der Kasten lehnt sie ab, mit Hinweis
  await page.goto(`/projekte/${project}?aufgabe=${foreign}`);
  const foreignPanel = page.getByRole("complementary", { name: "Aufgabe" });
  await expect(foreignPanel.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} Andere`,
  );
  await holdDrag(page, foreignPanel.locator("[data-task-drag]"), box);
  await expect(box).toHaveAttribute("data-drop", "nein");
  await releaseDrag(page);
  await expect(page.getByText("Nur Aufgaben dieses Projekts")).toBeVisible();
  await expect(box.getByRole("link", { name: `${prefix} Im Fahrplan` })).toBeVisible();

  // Reiter „Aufgaben“ (Tabelle): Titel ziehen; Erledigte sind nicht ziehbar
  await page.goto(`/projekte/${project}?reiter=aufgaben`);
  await expect(page.getByRole("radio", { name: "Tabelle" })).toBeChecked();
  const tableRow = (title: string) =>
    page.getByRole("row").filter({ has: page.getByRole("link", { name: title }) });
  await expect(tableRow(`${prefix} Schon fertig`).locator("[data-task-drag]")).toHaveCount(0);
  await dragTo(page, tableRow(`${prefix} Im Reiter`).locator("[data-task-drag]"), box);
  await expect(box.getByRole("link", { name: `${prefix} Im Reiter` })).toBeVisible();
  await expectSaved(page);
  expect(await nextOf()).toBe(tabTask);
  void done;

  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});

/**
 * Heute mit festem Tag in der Vergangenheit (Sitzung bleibt gültig): Fokus-Tage gehören so nur
 * diesem Test – Desktop und Mobil laufen parallel mit demselben Nutzer.
 */
const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const evening = (page: Page) => card(page, "Abendplanung");

const PICK_DAYS = { desktop: "2026-09-14", mobile: "2026-09-21" } as const;

test("Abendplanung und Fokus: Aufgabenspalte rechts zum Hineinziehen (#90)", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile", "Die Spalte gibt es erst ab 1280 px");
  const prefix = uniqueName("Spalte");
  const { beruf } = await areaIds();
  const db = await seedDb();
  const day = PICK_DAYS.desktop;
  const project = await seedProject({
    title: `${prefix} Projekt`,
    area_id: beruf,
    status: "aktiv",
  });
  const milestone = crypto.randomUUID();
  const m = await db
    .from("milestones")
    .insert({ id: milestone, project_id: project, title: `${prefix} Etappe`, sort: "a0" });
  if (m.error) throw new Error(m.error.message);
  const t = (name: string) => `${prefix} ${name}`;
  const ids = await seedTasks([
    { title: t("Im Projekt"), area_id: beruf, project_id: project, milestone_id: milestone },
    { title: t("Lose Zwei"), area_id: beruf },
    { title: t("Lose Drei"), area_id: beruf },
    { title: t("Lose Vier"), area_id: beruf },
    { title: t("Vorschlag"), area_id: beruf, priority: 1, due_date: "2026-09-01" },
    { title: t("Arbeitsschritt KI"), area_id: beruf, assignee: "ai" },
    { title: t("Für den Fokus"), area_id: beruf },
  ]);
  const dayOf = async (title: string) =>
    (await db.from("tasks").select("focus_date").eq("title", title).single()).data?.focus_date;

  await page.clock.setFixedTime(new Date(berlinDateTime(day, "12:00")));
  await page.goto("/heute");
  const plan = evening(page).getByRole("list", { name: "Fokus für morgen" });
  await expect(plan).toBeVisible();

  // „Andere Aufgabe wählen“ öffnet rechts die Spalte (kein Auswahlfenster), Ziel im Kopf
  await evening(page).getByRole("button", { name: "Aufgabe für morgen wählen" }).click();
  const column = page.getByRole("complementary", { name: "Aufgaben wählen" });
  await expect(column.getByRole("heading", { name: "Für morgen wählen" })).toBeVisible();
  await expect(page).toHaveURL(/waehlen=morgen/);
  await expect(page.getByRole("combobox", { name: "Aufgabe suchen" })).toHaveCount(0);
  await column.getByRole("searchbox", { name: "Aufgaben zum Wählen suchen" }).fill(prefix);
  // Gruppen wie in der Einplanen-Spalte: Projekt mit Meilenstein, lose Aufgaben je Bereich
  const projectGroup = column.getByRole("region", { name: `${prefix} Projekt` });
  await expect(projectGroup).toContainText(`${prefix} Etappe`);
  await expect(projectGroup).toContainText(t("Im Projekt"));
  await expect(column.getByRole("region", { name: "Beruf · ohne Projekt" })).toContainText(
    t("Lose Zwei"),
  );
  // nur Aufgaben des Nutzers: KI-Arbeitsschritte fehlen
  await expect(column).not.toContainText(t("Arbeitsschritt KI"));
  const row = (title: string) => column.locator("[data-task-drag]").filter({ hasText: title });

  // ziehen auf den freien Platz: die Plätze zeigen beim Ziehen, dass sie annehmen
  await holdDrag(page, row(t("Lose Zwei")), plan);
  await expect(plan.locator("[data-drop-slot=bereit]")).toHaveCount(3);
  await releaseDrag(page);
  await expect(plan).toContainText(t("Lose Zwei"));
  await expectSaved(page);
  expect(await dayOf(t("Lose Zwei"))).toBe("2026-09-15");
  // gewählte Aufgaben stehen nicht mehr in der Spalte
  await expect(row(t("Lose Zwei"))).toHaveCount(0);
  await expect(column.getByTestId("pick-summary")).toContainText("1 von 3");

  // auch die Vorschläge der Abendplanung sind ziehbar
  const suggestion = evening(page)
    .getByRole("list", { name: "Vorschläge für morgen" })
    .locator("[data-task-drag]")
    .filter({ hasText: t("Vorschlag") });
  await dragTo(page, suggestion, plan);
  await expect(plan).toContainText(t("Vorschlag"));
  await expectSaved(page);
  expect(await dayOf(t("Vorschlag"))).toBe("2026-09-15");

  // Antippen in der Spalte legt ebenfalls ab – dritter Platz, danach ist der Tag voll
  await column.getByRole("button", { name: `„${t("Im Projekt")}“ für morgen wählen` }).click();
  await expect(plan).toContainText(t("Im Projekt"));
  await expect(evening(page)).toContainText("Morgen steht.");
  await expect(column.getByTestId("pick-summary")).toContainText("voll");

  // voll: die Spalte lässt nichts mehr ziehen, ein Klick sagt warum
  await expect(row(t("Lose Drei"))).toHaveCount(0);
  await column.getByRole("button", { name: `„${t("Lose Drei")}“ für morgen wählen` }).click();
  await expect(page.getByText("Morgen ist voll").first()).toBeVisible();
  expect(await dayOf(t("Lose Drei"))).toBeNull();
  // auch der Kopf einer offenen Aufgabe wird abgewiesen
  await page.goto(`/heute?aufgabe=${ids[2]}`);
  const panel = page.getByRole("complementary", { name: "Aufgabe" });
  await expect(panel.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    t("Lose Drei"),
  );
  await dragTo(page, panel.locator("[data-task-drag]"), plan);
  await expect(page.getByText("Morgen ist voll").first()).toBeVisible();
  expect(await dayOf(t("Lose Drei"))).toBeNull();

  // umschalten auf „Fokus heute“; ziehen auf die Karte, die Karte zeigt, dass sie annimmt
  await page.goto("/heute?waehlen=morgen");
  await expect(column.getByRole("heading", { name: "Für morgen wählen" })).toBeVisible();
  await column.getByRole("button", { name: "Fokus heute" }).click();
  await expect(column.getByRole("heading", { name: "Fokus heute wählen" })).toBeVisible();
  await expect(page).toHaveURL(/waehlen=heute/);
  await column.getByRole("searchbox", { name: "Aufgaben zum Wählen suchen" }).fill(prefix);
  const focus = card(page, "Fokus heute");
  await holdDrag(page, row(t("Für den Fokus")), focus);
  await expect(focus.getByTestId("focus-drop-hint")).toBeVisible();
  await releaseDrag(page);
  await expect(focus.getByRole("list", { name: "Fokus heute" })).toContainText(t("Für den Fokus"));
  await expectSaved(page);
  expect(await dayOf(t("Für den Fokus"))).toBe(day);
  await expect(row(t("Für den Fokus"))).toHaveCount(0);

  // Escape schließt, Verbreitern/Einklappen: Reiter am Rand
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  await column.getByRole("button", { name: "Aufgaben wählen einklappen" }).click();
  await expect(column).toBeHidden();
  await page.getByRole("button", { name: "Aufgaben wählen wieder einblenden" }).click();
  await expect(column).toBeVisible();
  await column.getByRole("searchbox", { name: "Aufgaben zum Wählen suchen" }).focus();
  await page.keyboard.press("Escape");
  await expect(column).toHaveCount(0);
  await expect(page).not.toHaveURL(/waehlen/);
});

test("Aufgabe wählen unter 1280 px: Auswahl mit Suche wie bisher, keine Spalte (#90)", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile";
  const prefix = uniqueName("Auswahl");
  const { beruf } = await areaIds();
  const db = await seedDb();
  const day = mobile ? PICK_DAYS.mobile : "2026-09-28";
  const [one, two] = await seedTasks([
    { title: `${prefix} Eins`, area_id: beruf },
    { title: `${prefix} Zwei`, area_id: beruf },
  ]);
  const dayOf = async (id: string | undefined) =>
    (
      await db
        .from("tasks")
        .select("focus_date")
        .eq("id", id as string)
        .single()
    ).data?.focus_date;
  if (!mobile) await page.setViewportSize({ width: 1279, height: 800 });
  await page.clock.setFixedTime(new Date(berlinDateTime(day, "12:00")));
  await page.goto("/heute?waehlen=morgen");
  await expect(evening(page)).toBeVisible();
  // die Adresse allein öffnet hier nichts
  await expect(page.getByRole("complementary", { name: "Aufgaben wählen" })).toHaveCount(0);

  await evening(page).getByRole("button", { name: "Aufgabe für morgen wählen" }).click();
  await page.getByRole("combobox", { name: "Aufgabe suchen" }).fill(`${prefix} Eins`);
  await page.getByRole("option", { name: new RegExp(`${prefix} Eins`) }).click();
  await expect(evening(page).getByRole("list", { name: "Fokus für morgen" })).toContainText(
    `${prefix} Eins`,
  );
  await expectSaved(page);
  expect(await dayOf(one)).not.toBeNull();

  await card(page, "Fokus heute").getByRole("button", { name: "Fokus für heute wählen" }).click();
  await page.getByRole("combobox", { name: "Aufgabe suchen" }).fill(`${prefix} Zwei`);
  await page.getByRole("option", { name: new RegExp(`${prefix} Zwei`) }).click();
  await expect(card(page, "Fokus heute")).toContainText(`${prefix} Zwei`);
  await expectSaved(page);
  expect(await dayOf(two)).toBe(day);

  await expect(page.getByRole("complementary", { name: "Aufgaben wählen" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});
