/** Shell mit echten Daten (B2): Bereiche aus der DB, Theme/Bereich in user_settings. */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow, openNavigation } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedProject, seedTasks } from "./support/seed";

test.use({ storageState: AUTH_FILE });

test("Shell: Bereiche aus der Datenbank, Speicherstatus, kein Überlauf, keine a11y-Verstöße", async ({
  page,
}) => {
  await page.goto("/heute");
  await expect(page.getByRole("heading", { name: "Heute" })).toBeVisible();
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  const nav = await openNavigation(page);
  for (const name of ["Alles", "Beruf", "Privat"]) {
    await expect(nav.getByRole("radio", { name })).toBeVisible();
  }
  await expect(nav.getByRole("radio", { name: "Alles" })).toBeChecked();
  if (isNarrow(page)) {
    await expectNoA11yViolations(page);
    // der beim Öffnen fokussierte Schließen-Knopf ist sichtbar (O-17)
    const close = nav.getByRole("button", { name: "Schließen" });
    await expect(close).toBeFocused();
    const box = await close.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(20);
    await page.keyboard.press("Escape");
  }
});

test.describe("Einstellungen in user_settings @desktop", () => {
  test.describe.configure({ mode: "serial" });

  test("Bereich und Theme bleiben nach Reload; ein neues Gerät übernimmt sie", async ({
    page,
    browser,
  }) => {
    await page.goto("/einstellungen#darstellung");
    // erst wählen, wenn user_settings geladen ist (Abendzeit im Kopf): Davor wartet die Wahl
    // noch auf die Zeilen-ID und „Gespeichert“ hieße nichts (unter Last am Laufanfang, N4)
    await expect(page.getByRole("region", { name: "Abendplanung" })).toContainText("Abendzeit");
    const sidebar = await openNavigation(page);
    const appearance = page.getByRole("region", { name: "Darstellung" });
    await sidebar.getByRole("radio", { name: "Privat" }).click();
    await appearance.getByRole("radio", { name: "Papier" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
    await expectSaved(page);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
    await expect(sidebar.getByRole("radio", { name: "Privat" })).toBeChecked();

    // neues Gerät: gleiche Sitzung, aber ohne Geräte-Cookies → Werte aus user_settings
    const state = JSON.parse(readFileSync(AUTH_FILE, "utf8")) as {
      cookies: Array<{ name: string }>;
    };
    state.cookies = state.cookies.filter((c) => !c.name.startsWith("sz-"));
    const device = await browser.newContext({
      storageState: state as never,
      viewport: { width: 1440, height: 900 },
    });
    try {
      const other = await device.newPage();
      await other.goto("/heute");
      await expect(other.locator("html")).toHaveAttribute("data-theme", "paper");
      await expect(
        other.getByRole("complementary", { name: "Seitenleiste" }).getByRole("radio", {
          name: "Privat",
        }),
      ).toBeChecked();
    } finally {
      await device.close();
    }

    await sidebar.getByRole("radio", { name: "Alles" }).click();
    await appearance.getByRole("radio", { name: "Dunkel" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectSaved(page);
  });

  test("Theme gewählt, bevor user_settings geladen war, und sofort neu geladen: kommt trotzdem an (N4)", async ({
    page,
  }) => {
    const db = await seedDb();
    const storedTheme = async () =>
      (await db.from("user_settings").select("theme").single()).data?.theme;
    expect(await storedTheme()).toBe("dark");
    // user_settings antwortet erst nach dem Neuladen: die Wahl kennt noch keine Zeilen-ID
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/rest/v1/user_settings?*", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await gate;
      await route.fallback().catch(() => {});
    });
    await page.goto("/einstellungen#darstellung");
    const appearance = page.getByRole("region", { name: "Darstellung" });
    await appearance.getByRole("radio", { name: "Papier" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
    await page.unrouteAll({ behavior: "ignoreErrors" });
    release();
    await page.reload();
    await expect(page.getByRole("region", { name: "Abendplanung" })).toContainText("Abendzeit");
    await expect.poll(storedTheme).toBe("paper");

    await appearance.getByRole("radio", { name: "Dunkel" }).click();
    await expectSaved(page);
    await expect.poll(storedTheme).toBe("dark");
  });
});

test("Seitenleiste kompakt: passt bei 1440×800 ohne Scrollen, „Zuletzt bearbeitet“ einklappbar (#29, #30) @desktop", async ({
  page,
}) => {
  // im Bereich Privat: andere Tests legen parallel aktive Projekte in Beruf an
  const prefix = uniqueName("Zuletzt");
  const { privat } = await areaIds();
  for (const n of [1, 2, 3, 4]) {
    await seedProject({ title: `${prefix} Projekt ${n}`, area_id: privat, status: "aktiv" });
  }
  const db = await seedDb();
  const note = await db
    .from("notes")
    .insert({ title: `${prefix} Notiz`, area_id: privat })
    .select("id")
    .single();
  expect(note.error).toBeNull();

  // Bereich nicht in user_settings speichern (gemeinsamer Testnutzer, andere Tests laufen parallel)
  await page.route("**/rest/v1/user_settings?*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/heute");
  const sidebar = page.getByRole("complementary", { name: "Seitenleiste" });
  await sidebar.getByRole("radio", { name: "Privat" }).click();
  const recent = sidebar.getByRole("list", { name: "Zuletzt bearbeitet" });
  await expect(recent.getByRole("link", { name: `${prefix} Notiz` })).toBeVisible();
  // keine Darstellung mehr unten, Papierkorb/Einstellungen/Abmelden als eine Zeile
  await expect(sidebar.getByRole("radio", { name: "Papier" })).toHaveCount(0);
  const trash = await sidebar.getByRole("link", { name: "Papierkorb" }).boundingBox();
  const signOut = await sidebar.getByRole("button", { name: "Abmelden" }).boundingBox();
  expect(Math.abs((trash?.y ?? 0) - (signOut?.y ?? 100))).toBeLessThan(2);
  const nav = sidebar.getByRole("navigation", { name: "Hauptnavigation" });
  const scroll = await nav.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(scroll, "Seitenleiste scrollt bei 1440×800").toBeLessThanOrEqual(0);

  await recent.getByRole("link", { name: `${prefix} Notiz` }).click();
  await expect(page).toHaveURL(new RegExp(`/wissen/${note.data?.id}`));

  // einklappen, bleibt nach Reload
  const toggle = sidebar.getByRole("button", { name: "Zuletzt bearbeitet" });
  await toggle.click();
  await expect(recent).toBeHidden();
  await page.reload();
  await expect(sidebar.getByRole("button", { name: "Zuletzt bearbeitet" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await sidebar.getByRole("button", { name: "Zuletzt bearbeitet" }).click();
  await expect(recent).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Legende: Farben und Symbole über die Seitenleiste und ⌘K (#25)", async ({ page }) => {
  await page.goto("/heute");
  const nav = await openNavigation(page);
  await nav.getByRole("button", { name: "Legende: Farben und Symbole" }).click();
  const legend = page.getByRole("dialog", { name: "Legende" });
  await expect(legend).toBeVisible();
  for (const group of [
    "Aufgaben-Kreis",
    "Fälligkeit",
    "Projekte",
    "Bereiche",
    "Wissen",
    "Einplanen",
    "Zeitleisten",
  ]) {
    await expect(legend.getByRole("region", { name: group })).toBeVisible();
  }
  await expect(legend).toContainText("rot: hohe Priorität");
  await expect(legend).toContainText("Orange: Beruf");
  await expect(legend).toContainText("Blau: Privat");
  // Wissen (#56): der Typ entscheidet, „Noch einordnen“ fängt den Rest auf
  await expect(legend).toContainText("„zählt als Wissen“ am Notiz-Typ");
  await expect(legend).toContainText("„Noch einordnen · 3“");
  // Umwandeln (#65)
  await expect(legend).toContainText("In Notiz umwandeln");
  // Einplanen (#62/#69)
  await expect(legend).toContainText("„Jetzt einplanen“");
  await expect(legend).toContainText("von KI angelegt");
  // Zeichen sind Bilder, keine Bedienelemente
  await expect(legend.getByRole("checkbox")).toHaveCount(0);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("Escape");
  await expect(legend).toBeHidden();

  // in der App steht „Erfassen“ oben – den Befehl gezielt wählen
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Legende");
  await page.getByRole("option", { name: "Legende: Farben und Symbole" }).click();
  await expect(legend).toBeVisible();
});

test("Ganze Breite: Notiz, Aufgabe und Projekt; Seitenleiste und Listen als Reiter, Klick klappt auf (#31) @desktop", async ({
  page,
}) => {
  const prefix = uniqueName("Breit");
  const { beruf } = await areaIds();
  const db = await seedDb();
  const note = await db
    .from("notes")
    .insert({ title: `${prefix} Notiz`, area_id: beruf })
    .select("id")
    .single();
  expect(note.error).toBeNull();
  const [task] = await seedTasks([{ title: `${prefix} Aufgabe`, area_id: beruf }]);
  const project = await seedProject({ title: `${prefix} Projekt`, area_id: beruf });
  const sidebar = page.getByRole("complementary", { name: "Seitenleiste" });
  const sidebarRail = page.getByRole("button", { name: "Triskel wieder einblenden" });

  // Notiz
  await page.goto(`/wissen/${note.data?.id}`);
  const article = page
    .getByRole("article")
    .filter({ has: page.getByRole("textbox", { name: "Titel", exact: true }) });
  const normal = (await article.boundingBox())?.width ?? 0;
  await page.getByRole("button", { name: "Ganze Breite" }).click();
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("region", { name: "Notizliste" })).toBeHidden();
  await expect(sidebarRail).toBeVisible();
  await expect(page.getByRole("button", { name: "Themen wieder einblenden" })).toBeVisible();
  expect((await article.boundingBox())?.width ?? 0).toBeGreaterThan(normal + 400);
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Themen wieder einblenden" }).click();
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("region", { name: "Notizliste" })).toBeVisible();

  // Aufgabe im Panel
  await page.goto(`/aufgaben?aufgabe=${task}`);
  const panel = page.getByRole("complementary", { name: "Aufgabe" });
  expect((await panel.boundingBox())?.width).toBe(460);
  await panel.getByRole("button", { name: "Ganze Breite" }).click();
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(1200);
  const pageRail = page.getByRole("button", { name: "Aufgaben wieder einblenden" });
  await expect(pageRail).toBeVisible();
  await expect(sidebarRail).toBeVisible();
  await pageRail.click();
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBe(460);
  await expect(sidebar).toBeVisible();

  // Projekt: nur die Seitenleiste wird zum Reiter; schließen der Seite beendet die ganze Breite
  await page.goto(`/projekte/${project}`);
  await page.getByRole("button", { name: "Ganze Breite" }).click();
  await expect(sidebar).toBeHidden();
  await expect(sidebarRail).toBeVisible();
  await page.goto("/projekte");
  await expect(sidebar).toBeVisible();
  await expect(sidebarRail).toHaveCount(0);
});
