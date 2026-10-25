/**
 * Aufgaben (B5) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px:
 * Eigenschaften, Wiederholung (Erledigen erzeugt die nächste, Rückgängig entfernt sie),
 * „Blockiert durch“ mit Kreis-Sperre, Checkliste, „Block → Aufgabe“ synchron.
 * Jeder Test legt eigene Daten mit E2E-Präfix an (Teardown löscht sie).
 */
import { expect, type Page, test } from "@playwright/test";
import { userClient } from "../support/supabase-node";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { berlinToday } from "./support/seed";
import { storedAccessToken } from "./support/session";
import {
  chooseOption,
  closePanel,
  createTask,
  resetFilters,
  setArea,
  showProperties,
  taskList,
  taskPanel,
  taskRow,
  toggleStatusFilter,
} from "./support/tasks";

test.use({ storageState: AUTH_FILE });

const titleField = (page: Page) => page.getByRole("textbox", { name: "Titel", exact: true });

test("Aufgabe anlegen: Eigenschaften bleiben nach Reload, Panel per URL", async ({ page }) => {
  const title = uniqueName("Steuererklärung");
  const panel = await createTask(page, title);
  await setArea(panel, "Privat");
  await chooseOption(panel, "Priorität", "Hoch");
  await panel.getByRole("button", { name: "Fällig", exact: true }).click();
  await page.getByRole("button", { name: "Heute", exact: true }).click();
  await chooseOption(panel, "Dauer", "45 min");
  await chooseOption(panel, "Wiederholung", /^Wöchentlich/);
  await expectSaved(page);

  await page.reload();
  const reloaded = taskPanel(page);
  await expect(titleField(page)).toHaveValue(title);
  await showProperties(reloaded);
  await expect(reloaded.getByRole("combobox", { name: "Priorität", exact: true })).toContainText(
    "Hoch",
  );
  await expect(reloaded.getByRole("combobox", { name: "Bereich", exact: true })).toContainText(
    "Privat",
  );
  await expect(reloaded.getByRole("combobox", { name: "Dauer", exact: true })).toContainText(
    "45 min",
  );
  await expect(reloaded.getByRole("combobox", { name: "Wiederholung", exact: true })).toContainText(
    /Wöchentlich \((Mo|Di|Mi|Do|Fr|Sa|So)\)/,
  );
  await expect(reloaded.getByRole("button", { name: "Fällig", exact: true })).not.toContainText(
    "Kein Datum",
  );

  // Liste zeigt Priorität und Fälligkeit „heute“
  await closePanel(page);
  const row = taskRow(page, title);
  await expect(row).toContainText("heute");
  await expect(row).toContainText("Hoch");
});

test("Wiederkehrende Aufgabe erledigen erzeugt die nächste, Rückgängig entfernt sie", async ({
  page,
}) => {
  const title = uniqueName("Wochenreview");
  const panel = await createTask(page, title);
  await setArea(panel, "Privat");
  await chooseOption(panel, "Wiederholung", "Täglich");
  await expectSaved(page);
  await closePanel(page);

  const rows = () => taskRow(taskList(page), title);
  await expect(rows()).toHaveCount(1);
  await rows().getByRole("checkbox").click();
  const toast = page.getByText(new RegExp(`${title}“ erledigt · nächste am`));
  await expect(toast).toBeVisible();
  // nächste Instanz: wieder genau eine offene, fällig morgen
  await expect(rows()).toHaveCount(1);
  await expect(rows()).toContainText("morgen");
  await expectSaved(page);
  await page.reload();
  await expect(rows()).toHaveCount(1);
  await expect(rows()).toContainText("morgen");
  // mit erledigten: die erledigte und die neue Instanz
  await toggleStatusFilter(page, "Erledigt");
  await expect(rows()).toHaveCount(2);
  await expect(rows().getByRole("checkbox", { checked: true })).toHaveCount(1);
  await resetFilters(page);

  // Rückgängig: erledigte wieder offen (fällig heute), Folgeinstanz weg – auch nach Reload
  await page.goto("/aufgaben");
  await rows().getByRole("checkbox").click();
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(rows()).toHaveCount(1);
  await expect(rows()).toContainText("morgen");
  await expectSaved(page);
  await page.reload();
  await expect(rows()).toHaveCount(1);
  await expect(rows()).toContainText("morgen");
});

test("Rückgängig nach dem ersten Erledigen entfernt die Folgeinstanz", async ({ page }) => {
  const title = uniqueName("Gießen");
  const panel = await createTask(page, title);
  await setArea(panel, "Privat");
  await chooseOption(panel, "Wiederholung", "Täglich");
  await panel.getByRole("checkbox", { name: "Erledigt" }).click();
  await expect(page.getByText(new RegExp(`${title}“ erledigt · nächste am`))).toBeVisible();
  await closePanel(page);
  const open = () => taskRow(taskList(page), title);
  await expect(open()).toHaveCount(1);
  await expect(open()).toContainText("morgen");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(open()).toHaveCount(1);
  await expect(open()).toContainText("heute");
  await page.reload();
  await expect(open()).toHaveCount(1);
  await expect(open()).toContainText("heute");
  // auch mit erledigten nur noch eine Instanz
  await toggleStatusFilter(page, "Erledigt");
  await expect(taskRow(taskList(page), title)).toHaveCount(1);
});

test("Blockiert durch: Auswahl per Suche, Kreis wird abgelehnt, erledigter Blocker gibt frei", async ({
  page,
}) => {
  const first = uniqueName("Angebot einholen");
  const second = uniqueName("Bestellen");
  await page.goto("/aufgaben");
  // ⇧Enter legt nur an, ohne zu öffnen (#75)
  for (const title of [first, second]) {
    const input = page.getByRole("textbox", { name: "Neue Aufgabe" });
    await input.fill(title);
    await input.press("Shift+Enter");
    await expect(input).toHaveValue("");
  }
  await expect(taskPanel(page)).toBeHidden();

  // „Bestellen“ wartet auf „Angebot einholen“
  await page.getByRole("link", { name: second }).click();
  const panel = taskPanel(page);
  await showProperties(panel);
  await panel.getByRole("button", { name: "Blockiert durch: Aufgabe wählen" }).click();
  const search = page.getByRole("combobox", { name: "Aufgabe suchen" });
  await search.fill(first.slice(0, 12));
  await page.getByRole("option", { name: first }).click();
  await expect(panel.getByRole("list", { name: "Blockiert durch" })).toContainText(first);
  await expect(panel.getByText("Blockiert – wartet auf eine Aufgabe.")).toBeVisible();
  await expectSaved(page);

  // umgekehrt wäre ein Kreis: wird markiert und abgelehnt
  await page.goto("/aufgaben");
  await page.getByRole("link", { name: first }).click();
  const other = taskPanel(page);
  await showProperties(other);
  await other.getByRole("button", { name: "Blockiert durch: Aufgabe wählen" }).click();
  await page.getByRole("combobox", { name: "Aufgabe suchen" }).fill(second.slice(0, 12));
  const option = page.getByRole("option", { name: second });
  await expect(option).toContainText("bildet Kreis");
  await option.click();
  await expect(other.getByRole("alert")).toContainText("Kreis");
  await expect(other.getByRole("list", { name: "Blockiert durch" })).not.toContainText(second);
  await closePanel(page);

  // Liste zeigt „Blockiert“; ist der Blocker erledigt, ist die Aufgabe frei
  const blocked = taskRow(page, second);
  await expect(blocked.getByLabel("Blockiert")).toBeVisible();
  await page.reload();
  await expect(taskRow(page, second).getByLabel("Blockiert")).toBeVisible();
  await taskRow(page, first).getByRole("checkbox").click();
  await expect(taskRow(page, second).getByLabel("Blockiert")).toHaveCount(0);
});

test("Checkliste in der Aufgabe bleibt nach Reload erhalten", async ({ page }) => {
  const title = uniqueName("Einkaufen");
  const panel = await createTask(page, title);
  await titleField(page).press("Enter");
  const body = panel.getByRole("textbox", { name: "Notiz oder Checkliste" });
  await expect(body).toBeFocused();
  await page.keyboard.type("[] Milch");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Brot");
  await expect(body.locator('li[data-type="taskItem"]')).toHaveCount(2);
  await body.locator('li[data-type="taskItem"]').first().getByRole("checkbox").check();
  await expectSaved(page);
  await page.reload();
  const items = taskPanel(page).locator('li[data-type="taskItem"]');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toHaveAttribute("data-checked", "true");
  await expect(items.nth(1)).toContainText("Brot");
  // Vorschau in der Liste
  await closePanel(page);
  await expect(taskRow(page, title)).toContainText("Milch");
});

test("Aufgaben-Notiz zeigt beim Öffnen den neuesten Stand, statt ihn zu überschreiben (D-7)", async ({
  page,
}) => {
  const db = userClient(await storedAccessToken());
  const title = uniqueName("KI hängt an");
  const panel = await createTask(page, title);
  const body = panel.getByRole("textbox", { name: "Notiz oder Checkliste" });
  await body.click();
  await page.keyboard.type("Von mir");
  await expectSaved(page);
  const id = new URL(page.url()).searchParams.get("aufgabe") as string;
  await closePanel(page);
  // „die KI“ schreibt die Notiz direkt (z. B. attach_file) – der Cache der Seite kennt das nicht
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const remote = { type: "doc", content: [paragraph("Von mir"), paragraph("Von der KI")] };
  expect(
    (await db.from("tasks").update({ body: remote, body_text: "Von mir\nVon der KI" }).eq("id", id))
      .error,
  ).toBeNull();
  expect((await db.from("tasks").select("body_text").eq("id", id).single()).data?.body_text).toBe(
    "Von mir\nVon der KI",
  );
  await page.getByRole("link", { name: title }).first().click();
  await expect(body).toContainText("Von der KI");
  await body.locator("p").last().click();
  await page.evaluate(() => window.__taskBodyEditor?.commands.focus("end"));
  await page.keyboard.press("Enter");
  await page.keyboard.type("Und weiter");
  await expectSaved(page);
  await expect
    .poll(async () => (await db.from("tasks").select("body_text").eq("id", id).single()).data)
    .toEqual({ body_text: "Von mir\nVon der KI\nUnd weiter" });
});

test("Aufgaben-Notiz: Punkt per Knopf und „()“, Notiz verlinken mit „((“, Rückverweis in der Notiz", async ({
  page,
}) => {
  const title = uniqueName("Fahrzeugpflege");
  const note = uniqueName("Pflegeplan");
  const panel = await createTask(page, title);
  const body = panel.getByRole("textbox", { name: "Notiz oder Checkliste" });
  const items = body.locator('li[data-type="taskItem"]');

  // Knopf: erster Punkt, Enter setzt die Liste fort
  await panel.getByRole("button", { name: "Checklisten-Punkt hinzufügen" }).click();
  await expect(body).toBeFocused();
  await page.keyboard.type("Reifen");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Öl");
  await expect(items).toHaveCount(2);
  // zweimal Enter beendet die Liste, „() “ beginnt wieder einen Punkt
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Danach: ");
  await page.keyboard.type(`((${note}`);
  await page.getByRole("option", { name: `Neue Notiz „${note}“ anlegen` }).click();
  await expect(body.locator(".ol-note-link")).toHaveText(note);
  await page.keyboard.press("Enter");
  await page.keyboard.type("() Wischwasser");
  await expect(items).toHaveCount(3);
  await expectSaved(page);

  await page.reload();
  const reloaded = taskPanel(page).getByRole("textbox", { name: "Notiz oder Checkliste" });
  await expect(reloaded.locator('li[data-type="taskItem"]')).toHaveCount(3);
  await expect(reloaded.locator(".ol-note-link")).toHaveText(note);
  // Vorschau in der Liste ohne Klammern
  await closePanel(page);
  await expect(taskRow(page, title)).toContainText("Reifen");
  // Link öffnet die neue Notiz (im Bereich der Aufgabe angelegt)
  await page.getByRole("link", { name: title }).first().click();
  await taskPanel(page).locator(".ol-note-link").click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(titleField(page)).toHaveValue(note);
  // die Notiz zeigt die Aufgabe unter „Verlinkt von“ und öffnet sie von dort
  const backlinks = page.getByRole("region", { name: "Verlinkt von" });
  await expect(backlinks).toContainText("Verlinkt von · 1");
  await backlinks.getByRole("link", { name: new RegExp(title) }).click();
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    title,
  );
});

/** Text in der Aufgaben-Notiz markieren (über den Editor, wie eine Maus-Markierung). */
async function selectInTaskBody(page: Page, text: string) {
  await page.evaluate((needle) => {
    const ed = window.__taskBodyEditor;
    if (!ed) throw new Error("Kein Editor");
    let range: { from: number; to: number } | null = null;
    ed.state.doc.descendants((node, pos) => {
      const index = !range && node.isText ? (node.text ?? "").indexOf(needle) : -1;
      if (index >= 0) range = { from: pos + index, to: pos + index + needle.length };
    });
    if (!range) throw new Error(`„${needle}“ nicht gefunden`);
    ed.chain().focus().setTextSelection(range).run();
  }, text);
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

test("Aufgaben-Notiz formatiert wie die Notizen (Rechtsklick am Desktop, Leiste am Handy)", async ({
  page,
}) => {
  const title = uniqueName("Formatieren");
  const panel = await createTask(page, title);
  const body = panel.getByRole("textbox", { name: "Notiz oder Checkliste" });
  await body.click();
  await page.keyboard.type("Wichtig ist der Termin");
  await selectInTaskBody(page, "Wichtig");
  if (isNarrow(page)) {
    const toolbar = page.getByRole("toolbar", { name: "Formatieren" });
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Fett" }).click();
  } else {
    await rightClickSelection(page);
    const menu = page.getByRole("menu", { name: "Formatieren" });
    await menu.getByRole("menuitemcheckbox", { name: "Fett" }).click();
    await expect(menu).toBeHidden();
    // Checkliste über das Menü statt per Klammern
    await rightClickSelection(page);
    await menu.getByRole("menuitemcheckbox", { name: /^Checkliste/ }).click();
    await expect(body.locator('li[data-type="taskItem"]')).toHaveCount(1);
  }
  await expect(body.locator("strong")).toHaveText("Wichtig");
  await expectSaved(page);
  await page.reload();
  await expect(
    taskPanel(page).getByRole("textbox", { name: "Notiz oder Checkliste" }).locator("strong"),
  ).toHaveText("Wichtig");
});

test("Handy: Eigenschaften zugeklappt, eine Zeile fasst sie zusammen @mobile", async ({ page }) => {
  const title = uniqueName("Schlank");
  const panel = await createTask(page, title);
  const toggle = panel.getByRole("button", { name: /^Eigenschaften/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("Offen");
  await expect(panel.getByRole("combobox", { name: "Priorität", exact: true })).toBeHidden();
  // Notiz direkt unter dem Titel erreichbar
  await expect(panel.getByRole("textbox", { name: "Notiz oder Checkliste" })).toBeInViewport();
  await chooseOption(panel, "Priorität", "Hoch");
  await toggle.click();
  await expect(toggle).toContainText("Hoch");
  await expect(panel.getByRole("combobox", { name: "Priorität", exact: true })).toBeHidden();
});

test("Block → Aufgabe: „[] “ in einer Notiz, Checkbox und Aufgabenstatus synchron", async ({
  page,
}) => {
  const noteTitle = uniqueName("Besprechung");
  const taskTitle = uniqueName("Angebot Leiter");
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page.locator(".outline-editor")).toBeVisible();
  await titleField(page).fill(noteTitle);
  await titleField(page).press("Enter");
  await expect(page.locator(".outline-editor")).toBeFocused();
  await page.keyboard.type(`[] ${taskTitle}`);
  const blockBox = page.getByRole("checkbox", { name: `Aufgabe „${taskTitle}“ erledigen` });
  await expect(blockBox).toBeVisible();
  const noteTasks = page.getByRole("region", { name: "Aufgaben in dieser Notiz" });
  await expect(taskRow(noteTasks, taskTitle)).toBeVisible();
  await expectSaved(page);

  // Block abhaken → Aufgabe erledigt (Liste unter der Notiz zeigt es sofort)
  await blockBox.click();
  await expect(
    page.getByRole("checkbox", { name: `Aufgabe „${taskTitle}“ wieder öffnen` }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(taskRow(noteTasks, taskTitle).getByRole("checkbox")).toBeChecked();

  // Aufgabe wieder öffnen (Liste) → Block zeigt es
  await taskRow(noteTasks, taskTitle).getByRole("checkbox").click();
  await expect(blockBox).toHaveAttribute("aria-checked", "false");
  await blockBox.click();
  await expect(taskRow(noteTasks, taskTitle).getByRole("checkbox")).toBeChecked();
  await expectSaved(page);

  // nach dem Reload: Status aus der Datenbank, Aufgabe unter /aufgaben erledigt, mit Quelle
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: `Aufgabe „${taskTitle}“ wieder öffnen` }),
  ).toHaveAttribute("aria-checked", "true");
  await page.goto("/aufgaben");
  await toggleStatusFilter(page, "Erledigt");
  await taskList(page).getByRole("link", { name: taskTitle }).click();
  await expect(taskPanel(page).getByRole("region", { name: "Aus Notiz" })).toContainText(noteTitle);
});

test("Rechtsklick auf eine Aufgabe: Status, Priorität, Erledigt @desktop", async ({ page }) => {
  const title = uniqueName("Kontextmenü");
  await createTask(page, title);
  await closePanel(page);
  const row = taskRow(page, title);
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Priorität" }).hover();
  await page.getByRole("menuitemradio", { name: "Hoch" }).click();
  await expect(row).toContainText("Hoch");
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Erledigt" }).click();
  await expect(page.getByText(`„${title}“ erledigt`)).toBeVisible();
  await expect(taskRow(taskList(page), title)).toHaveCount(0);
});

test("Aufgaben mit offenem Panel: kein horizontales Scrollen, keine a11y-Verstöße", async ({
  page,
}) => {
  const title = uniqueName("Barrierefrei");
  const panel = await createTask(page, title);
  await setArea(panel, "Beruf");
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
  await closePanel(page);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
});

test("Panel: leiser Scrollbalken mit festem Platz, Inhalt springt beim Tippen nicht (#32) @desktop", async ({
  page,
}) => {
  const panel = await createTask(page, uniqueName("Scrollbalken"));
  const style = await panel.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      gutter: css.scrollbarGutter,
      width: css.scrollbarWidth,
      color: css.scrollbarColor,
      border: getComputedStyle(document.documentElement).getPropertyValue("--border-strong"),
    };
  });
  expect(style.gutter).toBe("stable");
  expect(style.width).toBe("thin");
  // Farbe aus dem Token (vererbt von <html>), Spur durchsichtig
  expect(style.color).toMatch(/^rgb\(58, 58, 64\) rgba\(0, 0, 0, 0\)$/);

  // Breite des Inhalts bleibt gleich, auch wenn der Text das Panel überlaufen lässt
  const content = panel.locator(":scope > *").first();
  const before = await content.evaluate((el) => el.getBoundingClientRect().width);
  await panel.locator(".ProseMirror").first().click();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.type("Zeile");
    await page.keyboard.press("Enter");
  }
  await expect.poll(() => panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await content.evaluate((el) => el.getBoundingClientRect().width)).toBe(before);
});

test("Kalender: „+ Aufgabe“ – Enter öffnet die neue Aufgabe, ⇧Enter legt nur an (#75)", async ({
  page,
}) => {
  const title = uniqueName("Kalender neu");
  const today = berlinToday();
  await page.goto(`/kalender?ansicht=tag&tag=${today}`);
  await page
    .getByRole("button", { name: `Aufgabe für ${today} anlegen` })
    .first()
    .click();
  const input = page.getByRole("textbox", { name: `Neue Aufgabe für ${today}` });
  await input.fill(`${title} eins`);
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("");
  await expect(taskPanel(page)).toBeHidden();
  await input.fill(`${title} zwei`);
  await input.press("Enter");
  await expect(taskPanel(page).getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    `${title} zwei`,
  );
  await expectSaved(page);
});
