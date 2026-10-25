/**
 * Nachtlauf K – Oberfläche Teil 2 (Rückmeldungen #34, #36, #38, #40, #44, #48) gegen das
 * Testprojekt, Desktop 1440 px und Mobil 390 px. Jeder Test legt eigene Daten mit E2E-Präfix an.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { areaIds, seedDb, seedProject, seedTasks } from "./support/seed";
import { createTask, taskList, taskPanel } from "./support/tasks";

test.use({ storageState: AUTH_FILE });

test("Aufgaben und Notizen stehen standardmäßig nach Projekt gruppiert, der Kopf führt ins Projekt (#48)", async ({
  page,
}) => {
  const prefix = uniqueName("Gruppe");
  const { beruf } = await areaIds();
  const projectTitle = `${prefix} Projekt`;
  const projectId = await seedProject({ title: projectTitle, area_id: beruf, status: "aktiv" });
  await seedTasks([
    { title: `${prefix} im Projekt`, area_id: beruf, project_id: projectId },
    { title: `${prefix} ohne Projekt`, area_id: beruf },
  ]);
  const db = await seedDb();
  const { error } = await db.from("notes").insert([
    { title: `${prefix} Notiz im Projekt`, area_id: beruf, project_id: projectId },
    { title: `${prefix} Notiz ohne Projekt`, area_id: beruf },
  ]);
  if (error) throw new Error(`Notizen: ${error.message}`);

  // älterer Stand des Geräts (vor #48): Tabelle nach Fälligkeit – Tabelle bleibt, Gruppe wechselt
  await page.goto("/aufgaben");
  await page.evaluate(() =>
    window.localStorage.setItem(
      "sz:ansicht:tasks",
      JSON.stringify({ type: "tabelle", group: "due_date" }),
    ),
  );
  await page.reload();
  await page.getByRole("textbox", { name: "Aufgaben durchsuchen" }).fill(prefix);
  await expect(page.getByRole("radio", { name: "Tabelle" })).toBeChecked();
  const table = page.getByRole("table");
  await expect(
    table.getByRole("columnheader", { name: new RegExp(`^${projectTitle}`) }),
  ).toBeVisible();
  await expect(table.getByRole("columnheader", { name: /^Ohne Projekt/ })).toBeVisible();

  // Liste: Abschnitt je Projekt, „Ohne Projekt“ oben (#79)
  await page.getByRole("radio", { name: "Liste" }).click();
  const list = taskList(page);
  const group = page.getByRole("region", { name: new RegExp(`^${projectTitle} \\(1\\)`) });
  await expect(group).toContainText(`${prefix} im Projekt`);
  await expect(group).not.toContainText(`${prefix} ohne Projekt`);
  await expect(page.getByRole("region", { name: /^Ohne Projekt \(/ })).toContainText(
    `${prefix} ohne Projekt`,
  );
  await expect(list).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Notizen-Datenbank ebenso; der Pfeil im Kopf öffnet das Projekt
  await page.goto("/notizen");
  await page.getByRole("textbox", { name: "Notizen durchsuchen" }).fill(prefix);
  const notes = page.getByRole("region", { name: new RegExp(`^${projectTitle} \\(1\\)`) });
  await expect(notes).toContainText(`${prefix} Notiz im Projekt`);
  await expect(page.getByRole("region", { name: /^Ohne Projekt \(/ })).toContainText(
    `${prefix} Notiz ohne Projekt`,
  );
  await notes.getByRole("link", { name: `Projekt „${projectTitle}“ öffnen` }).click();
  await expect(page).toHaveURL(new RegExp(`/projekte/${projectId}$`));
});

test("„Zuletzt bearbeitet“ zeigt Aufgaben erst, wenn Titel oder Notiz geändert wurden (#38) @desktop", async ({
  page,
}) => {
  // im Bereich Privat (andere Tests arbeiten parallel in Beruf), Bereich nicht speichern
  const prefix = uniqueName("Bearbeitet");
  const { privat } = await areaIds();
  const [taskId, dateOnly] = await seedTasks([
    { title: `${prefix} Aufgabe`, area_id: privat },
    { title: `${prefix} nur Datum`, area_id: privat },
  ]);
  const db = await seedDb();
  await db.from("tasks").update({ due_date: "2026-12-24", status: "in_arbeit" }).eq("id", dateOnly);
  await page.route("**/rest/v1/user_settings?*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.goto(`/aufgaben?aufgabe=${taskId}`);
  const sidebar = page.getByRole("complementary", { name: "Seitenleiste" });
  await sidebar.getByRole("radio", { name: "Privat" }).click();
  const recent = sidebar.getByRole("list", { name: "Zuletzt bearbeitet" });
  await expect(page.getByRole("main")).toBeVisible();
  await expect(recent.getByRole("link", { name: new RegExp(prefix) })).toHaveCount(0);

  const panel = taskPanel(page);
  await panel.getByRole("textbox", { name: "Titel", exact: true }).fill(`${prefix} Aufgabe neu`);
  const link = recent.getByRole("link", { name: `${prefix} Aufgabe neu` });
  await expect(link).toBeVisible();
  await expect(recent.getByRole("link", { name: `${prefix} nur Datum` })).toHaveCount(0);

  // gespeichert? (expectSaved geht hier nicht: das abgefangene user_settings meldet „Nicht gespeichert“)
  await expect
    .poll(async () => (await db.from("tasks").select("edited_at").eq("id", taskId).single()).data)
    .toEqual({ edited_at: expect.any(String) });
  // öffnet als Panel auf der aktuellen Seite
  await sidebar.getByRole("link", { name: "Heute", exact: true }).click();
  await expect(page).toHaveURL(/\/heute$/);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/heute\\?aufgabe=${taskId}`));
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(panel.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${prefix} Aufgabe neu`,
  );

  // erledigt fällt heraus
  await panel.getByRole("checkbox", { name: "Erledigt" }).click();
  await expect(recent.getByRole("link", { name: `${prefix} Aufgabe neu` })).toHaveCount(0);
});

test("Freitext im Reiter Übersicht: schreiben, Checkliste, bleibt nach Neuladen (#44)", async ({
  page,
}) => {
  const prefix = uniqueName("Freitext");
  const { beruf } = await areaIds();
  const projectId = await seedProject({ title: `${prefix} Projekt`, area_id: beruf });
  await page.goto(`/projekte/${projectId}`);
  const section = page.getByRole("region", { name: "Freitext" });
  const body = section.getByRole("textbox", { name: "Freitext des Projekts" });
  await expect(body).toBeVisible();
  await body.click();
  await page.keyboard.type(`${prefix} Absprache mit der Teamleitung`);
  await section.getByRole("button", { name: "Checklisten-Punkt hinzufügen" }).click();
  await page.keyboard.type("Termin abstimmen");
  await expect(section.getByRole("checkbox", { name: /Termin abstimmen/ })).toBeVisible();
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(body).toContainText(`${prefix} Absprache mit der Teamleitung`);
  await expect(section.getByRole("checkbox", { name: /Termin abstimmen/ })).toBeVisible();
  const db = await seedDb();
  const saved = await db.from("projects").select("body_text").eq("id", projectId).single();
  // Klartext für Suche und Export (wie bei der Aufgaben-Notiz: Blöcke durch Zeilenumbrüche getrennt)
  expect(saved.data?.body_text.split(/\n+/)).toEqual([
    `${prefix} Absprache mit der Teamleitung`,
    "Termin abstimmen",
  ]);
});

/** Text im Editor markieren (Notiz: __noteEditor, Aufgabe: __taskBodyEditor). */
async function select(page: Page, which: "__noteEditor" | "__taskBodyEditor", needle: string) {
  await page.evaluate(
    ({ which, needle }) => {
      const ed = window[which];
      if (!ed) throw new Error("Kein Editor");
      let range: { from: number; to: number } | null = null;
      ed.state.doc.descendants((node, pos) => {
        const index = !range && node.isText ? (node.text ?? "").indexOf(needle) : -1;
        if (index >= 0) range = { from: pos + index, to: pos + index + needle.length };
      });
      if (!range) throw new Error(`„${needle}“ nicht gefunden`);
      ed.view.focus();
      ed.commands.setTextSelection(range);
    },
    { which, needle },
  );
}

/** Rechtsklick mitten in die Markierung (die Auswahl bleibt stehen). */
async function rightClickSelection(page: Page) {
  const box = await page.evaluate(() => {
    const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
    return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
  });
  if (!box) throw new Error("Keine Markierung");
  await page.mouse.click(box.x, box.y, { button: "right" });
}

/** Absatzart oder Farbe wählen: Desktop per Rechtsklick-Untermenü, Handy über „Aa“ in der Leiste. */
async function chooseStyle(
  page: Page,
  submenu: "Absatz" | "Farbe",
  item: string,
  mobileButton: string,
) {
  if (isNarrow(page)) {
    const toolbar = page.getByRole("toolbar", { name: "Formatieren" });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Absatz und Farbe" }).click();
    await toolbar.getByRole("button", { name: mobileButton, exact: true }).click();
    await toolbar.getByRole("button", { name: "Fertig" }).click();
  } else {
    await rightClickSelection(page);
    const menu = page.getByRole("menu", { name: "Formatieren" });
    // per Tastatur: Playwright springt mit der Maus, das schließt ein links aufgehendes
    // Untermenü (mit echter Mausbahn bleibt es offen)
    const trigger = menu.getByRole("menuitem", { name: submenu });
    await trigger.focus();
    await trigger.press("ArrowRight");
    await page
      .getByRole("menu", { name: submenu })
      // der Name enthält das Kürzel (z. B. „Überschrift 2##“)
      .getByRole("menuitemcheckbox", { name: new RegExp(`^${item}(?![\\p{L}])`, "u") })
      .press("Enter");
    await expect(menu).toBeHidden();
  }
}

test("Notiz: Überschrift, Zitat, Trennlinie, Marker per Tippen; Textfarbe über das Menü (#40)", async ({
  page,
}) => {
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await page.getByRole("textbox", { name: "Titel", exact: true }).fill(uniqueName("Formatierung"));
  const editor = page.locator(".outline-editor");
  await editor.click();
  await page.keyboard.type("## Ablauf");
  await page.keyboard.press("Enter");
  await page.keyboard.type("> Bitte vorher lesen");
  await page.keyboard.press("Enter");
  await page.keyboard.type("---");
  await page.keyboard.type("Danach weiter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Rot und ==markiert== Ende");

  await expect(editor.locator('p[data-kind="h2"]')).toHaveText("Ablauf");
  await expect(editor.locator('p[data-kind="quote"]')).toHaveText("Bitte vorher lesen");
  await expect(editor.locator('p[data-kind="divider"]')).toHaveCount(1);
  await expect(
    editor.locator("p:not([data-kind])").filter({ hasText: "Danach weiter" }),
  ).toHaveCount(1);
  await expect(editor.locator("mark.tx-marker")).toHaveText("markiert");

  await select(page, "__noteEditor", "Rot");
  await chooseStyle(page, "Farbe", "Rot", "Textfarbe Rot");
  await expect(editor.locator('.tx-color[data-color="rot"]')).toHaveText("Rot");

  await expectSaved(page);
  await page.reload();
  await expect(editor.locator('p[data-kind="h2"]')).toHaveText("Ablauf");
  await expect(editor.locator('p[data-kind="quote"]')).toHaveText("Bitte vorher lesen");
  await expect(editor.locator('p[data-kind="divider"]')).toHaveCount(1);
  await expect(editor.locator('.tx-color[data-color="rot"]')).toHaveText("Rot");
  await expect(editor.locator("mark.tx-marker")).toHaveText("markiert");
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});

test("Aufgaben-Notiz: Überschrift und Hinweis-Kasten über das Menü, Rücktaste macht wieder Text (#40)", async ({
  page,
}) => {
  const panel = await createTask(page, uniqueName("Aufgabe formatiert"));
  const body = panel.getByRole("textbox", { name: "Notiz oder Checkliste" });
  await body.click();
  await page.keyboard.type("Material");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Achtung Termin");
  await select(page, "__taskBodyEditor", "Material");
  await chooseStyle(page, "Absatz", "Überschrift 2", "Überschrift 2");
  await expect(body.locator('p[data-kind="h2"]')).toHaveText("Material");
  await select(page, "__taskBodyEditor", "Achtung");
  await chooseStyle(page, "Absatz", "Hinweis-Kasten", "Hinweis-Kasten");
  await expect(body.locator('p[data-kind="callout"]')).toHaveText("Achtung Termin");
  await expectSaved(page);
  await page.reload();
  const reloaded = taskPanel(page).getByRole("textbox", { name: "Notiz oder Checkliste" });
  await expect(reloaded.locator('p[data-kind="h2"]')).toHaveText("Material");
  await expect(reloaded.locator('p[data-kind="callout"]')).toHaveText("Achtung Termin");

  // Rücktaste am Anfang der Überschrift: wieder normaler Text (Text bleibt)
  await page.evaluate(() => {
    const ed = window.__taskBodyEditor;
    if (!ed) throw new Error("Kein Editor");
    ed.view.focus();
    ed.commands.setTextSelection(1);
  });
  await page.keyboard.press("Backspace");
  await expect(reloaded.locator('p[data-kind="h2"]')).toHaveCount(0);
  await expect(reloaded.locator("p").first()).toHaveText("Material");
});

test("Notiz-Typen: anlegen, umbenennen, in der Notiz neu anlegen, löschen mit Zieltyp, Rückgängig (#34)", async ({
  page,
}) => {
  const prefix = uniqueName("Typ");
  await page.goto("/einstellungen#notiz-typen");
  const section = page.getByRole("region", { name: "Notiz-Typen" });
  // Standard ist „Idee“ (Rückmeldung 17.10.2026): nur umbenennen, nicht löschen; „Wissen“ ist normal
  await expect(section.getByRole("textbox", { name: "Name des Typs „Idee“" })).toBeVisible();
  await expect(section.getByRole("button", { name: "Typ „Idee“ löschen" })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Typ „Wissen“ löschen" })).toBeVisible();
  await section.getByRole("textbox", { name: "Neuer Notiz-Typ" }).fill(`${prefix} Besprechung`);
  await section.getByRole("button", { name: "Anlegen", exact: true }).click();
  const created = section.getByRole("textbox", { name: `Name des Typs „${prefix} Besprechung“` });
  await expect(created).toBeVisible();
  // umbenennen (Notizen behalten den Typ, nur der Name ändert sich)
  await created.fill(`${prefix} Sitzung`);
  // der Feldname nennt den Typ und ändert sich beim Tippen mit
  await page.keyboard.press("Tab");
  await expect(
    section.getByRole("textbox", { name: `Name des Typs „${prefix} Sitzung“` }),
  ).toHaveValue(`${prefix} Sitzung`);
  await expectNoHorizontalOverflow(page);

  // Notiz: Typ wählen und einen weiteren direkt in der Auswahl anlegen
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  const noteUrl = page.url();
  await page.getByRole("textbox", { name: "Titel", exact: true }).fill(`${prefix} Notiz`);
  const typeButton = page.getByRole("button", { name: "Typ", exact: true });
  await typeButton.click();
  await page.keyboard.type(`${prefix} Sitz`);
  await page.getByRole("option", { name: `${prefix} Sitzung` }).click();
  await expect(typeButton).toHaveText(`${prefix} Sitzung`);
  await typeButton.click();
  await page.keyboard.type(`${prefix} Einsatz`);
  await expect(page.getByRole("option", { name: `Typ „${prefix} Einsatz“ anlegen` })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(typeButton).toHaveText(`${prefix} Einsatz`);
  await expectSaved(page);

  // löschen: die App fragt, wohin die Notiz zieht
  await page.goto("/einstellungen#notiz-typen");
  await section.getByRole("button", { name: `Typ „${prefix} Einsatz“ löschen` }).click();
  const confirm = section.getByRole("group", { name: `„${prefix} Einsatz“ löschen` });
  await expect(confirm).toContainText("Die Notiz zieht um nach");
  await confirm.getByRole("combobox").click();
  await page.getByRole("option", { name: "Protokoll" }).click();
  await confirm.getByRole("button", { name: "Löschen" }).click();
  await expect(
    section.getByRole("textbox", { name: `Name des Typs „${prefix} Einsatz“` }),
  ).toHaveCount(0);
  await expect(
    page.getByText(`Typ „${prefix} Einsatz“ gelöscht – 1 Notiz ist jetzt „Protokoll“`),
  ).toBeVisible();
  await expectSaved(page);
  const db = await seedDb();
  const id = noteUrl.split("/").pop()?.split("?")[0] as string;
  await expect
    .poll(async () => (await db.from("notes").select("type").eq("id", id).single()).data?.type)
    .toBe("protokoll");

  // Rückgängig holt Typ und Notiz zurück (der Knopf im Hinweis – nicht die des KI-Protokolls)
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect(
    section.getByRole("textbox", { name: `Name des Typs „${prefix} Einsatz“` }),
  ).toBeVisible();
  await expect
    .poll(async () => (await db.from("notes").select("type").eq("id", id).single()).data?.type)
    .not.toBe("protokoll");
  await page.goto(noteUrl);
  await expect(page.getByRole("button", { name: "Typ", exact: true })).toHaveText(
    `${prefix} Einsatz`,
  );
});

test("Zeitstempel: „@jetzt“ und „@heute“ in Notiz und Aufgabe, auch über das Menü", async ({
  page,
}) => {
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await page.getByRole("textbox", { name: "Titel", exact: true }).fill(uniqueName("Zeitstempel"));
  // neue Notizen sind „Idee“ (Standard seit 17.10.2026)
  await expect(page.getByRole("button", { name: "Typ", exact: true })).toHaveText("Idee");
  const editor = page.locator(".outline-editor");
  await editor.click();
  await page.keyboard.type("Telefonat mit Kreis @jetzt ");
  await expect(editor).toContainText(/Telefonat mit Kreis \d\d\.\d\d\.\d{4} \d\d:\d\d/);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Stand @heute ");
  await expect(editor).toContainText(/Stand \d\d\.\d\d\.\d{4}/);
  await expect(editor).not.toContainText("@jetzt");
  await expectSaved(page);

  const panel = await createTask(page, uniqueName("Zeitstempel-Aufgabe"));
  const body = panel.getByRole("textbox", { name: "Notiz oder Checkliste" });
  await body.click();
  await page.keyboard.type("Rückruf ");
  if (!isNarrow(page)) {
    await body.click({ button: "right" });
    await page
      .getByRole("menu", { name: "Formatieren" })
      .getByRole("menuitem", { name: /^Zeitstempel einfügen/ })
      .click();
  } else {
    await page.keyboard.type("@jetzt ");
  }
  await expect(body).toContainText(/Rückruf \d\d\.\d\d\.\d{4} \d\d:\d\d/);
});
