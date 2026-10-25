/**
 * Wissen mit echter Persistenz (B3 + B4) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px.
 * Jeder Test legt eigene Daten mit E2E-Präfix an (Teardown löscht sie).
 */
import { type Browser, expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved, isNarrow, openNavigation, outlineTree, saveStatus } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";

test.use({ storageState: AUTH_FILE });

const editor = (page: Page) => page.locator(".outline-editor");
const titleField = (page: Page) => page.getByRole("textbox", { name: "Titel", exact: true });

/** Neue Notiz über „Neue Notiz“ anlegen, benennen; Cursor steht danach im ersten Block. */
async function createNote(page: Page, title: string): Promise<string> {
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(page).toHaveURL(/\/wissen\/[0-9a-f-]{36}/);
  await expect(editor(page)).toBeVisible();
  await titleField(page).fill(title);
  await titleField(page).press("Enter");
  await expect(editor(page)).toBeFocused();
  return new URL(page.url()).pathname;
}

/** Offene Notiz zu Wissen machen (#56: nur Wissens-Typen stehen in der Liste von Wissen). */
async function makeKnowledge(page: Page) {
  await page.getByRole("button", { name: "Typ", exact: true }).click();
  await page.getByRole("option", { name: "Wissen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Typ", exact: true })).toHaveText("Wissen");
}

/** Notiz in einem frischen Kontext öffnen (leerer localStorage) – zeigt nur den Serverstand. */
async function openFresh(browser: Browser, page: Page, path: string) {
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: page.viewportSize() ?? undefined,
  });
  const fresh = await context.newPage();
  await fresh.goto(path);
  await expect(editor(fresh)).toBeVisible();
  return { fresh, close: () => context.close() };
}

test("Outline per Tastatur, ((Link)) legt neue Notiz an, Rückverweis, Umbenennen, Reload erhält Baum und Klappzustand", async ({
  page,
}) => {
  const source = uniqueName("Quelle");
  const target = uniqueName("Ziel");
  const sourcePath = await createNote(page, source);

  await page.keyboard.type("Pressluftatmer");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Prüffrist jährlich");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`Siehe ((${target}`);
  const suggestions = page.getByRole("listbox", { name: "Notiz verlinken" });
  await expect(
    suggestions.getByRole("option", { name: `Neue Notiz „${target}“ anlegen` }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("prüfen");
  await expect
    .poll(() => outlineTree(page))
    .toBe(`Pressluftatmer\n  Prüffrist jährlich\n  Siehe ${target} prüfen`);
  await expectSaved(page);

  // Link öffnen → Rückverweis auf die Quelle
  await editor(page).locator(".ol-note-link", { hasText: target }).click();
  await expect(titleField(page)).toHaveValue(target);
  const backlinks = page.getByRole("region", { name: "Verlinkt von" });
  await expect(backlinks.getByRole("link", { name: new RegExp(source) })).toBeVisible();

  // Umbenennen bricht keinen Link
  await titleField(page).fill(`${target} neu`);
  await expectSaved(page);
  await page.goBack();
  await expect(titleField(page)).toHaveValue(source);
  await expect(editor(page).locator(".ol-note-link")).toHaveText(`${target} neu`);

  // Einklappen (⌘↑) und Reload
  await editor(page).getByText("Pressluftatmer").click();
  await page.keyboard.press("ControlOrMeta+ArrowUp");
  await expect(editor(page).locator('.ol-block[data-collapsed="true"]')).toHaveCount(1);
  await expectSaved(page);
  const before = await outlineTree(page);
  expect(before).toBe(`▸ Pressluftatmer\n  Prüffrist jährlich\n  Siehe ${target} neu prüfen`);

  await page.reload();
  await expect(editor(page)).toBeVisible();
  expect(await outlineTree(page)).toBe(before);
  expect(new URL(page.url()).pathname).toBe(sourcePath);
});

test("Tippen, sofort wegnavigieren und neu laden: nichts geht verloren (B3)", async ({
  page,
  browser,
}) => {
  const path = await createNote(page, uniqueName("Sofort"));
  await page.keyboard.type("Nicht verlieren");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Zweiter Gedanke");

  // ohne Warten weg (Client-Navigation), dann hart neu laden
  const nav = await openNavigation(page);
  await nav.getByRole("link", { name: "Heute" }).click();
  await page.reload();
  await page.goto(path);
  await expect(editor(page)).toBeVisible();
  await expect.poll(() => outlineTree(page)).toBe("Nicht verlieren\nZweiter Gedanke");
  await expectSaved(page);

  const { fresh, close } = await openFresh(browser, page, path);
  try {
    await expect.poll(() => outlineTree(fresh)).toBe("Nicht verlieren\nZweiter Gedanke");
  } finally {
    await close();
  }
});

test("Netzabbruch: Änderungen bleiben lokal und werden nachgeholt (B3)", async ({
  page,
  browser,
}) => {
  const path = await createNote(page, uniqueName("Offline"));
  await page.keyboard.type("Vor dem Abbruch");
  await expectSaved(page);

  await page.route("**/rest/v1/**", (route) => route.abort("internetdisconnected"));
  await page.keyboard.press("Enter");
  await page.keyboard.type("Ohne Netz geschrieben");
  await expect(saveStatus(page)).toHaveAttribute("data-status", /retrying|offline/, {
    timeout: 10_000,
  });

  await page.unroute("**/rest/v1/**");
  await expectSaved(page, 30_000);

  const { fresh, close } = await openFresh(browser, page, path);
  try {
    await expect.poll(() => outlineTree(fresh)).toBe("Vor dem Abbruch\nOhne Netz geschrieben");
  } finally {
    await close();
  }
});

test("Eingefügte Markdown-Liste wird zu Blöcken mit eindeutigen IDs und gespeichert", async ({
  page,
  browser,
}) => {
  const path = await createNote(page, uniqueName("Einfügen"));
  await page.keyboard.type("Liste:");
  await editor(page).evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "- Punkt A\n  - Punkt B\n- Punkt C");
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expectSaved(page);

  const { fresh, close } = await openFresh(browser, page, path);
  try {
    await expect.poll(() => outlineTree(fresh)).toBe("Liste:\nPunkt A\n  Punkt B\nPunkt C");
    const ids = await fresh
      .locator(".ol-block")
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.blockId));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  } finally {
    await close();
  }
});

/**
 * Text im Editor markieren – über die Editor-API: Playwright tippt schneller als ProseMirrors
 * Fokus-Heuristiken (Auswahl am Dokumentanfang < 200 ms bzw. < 20 ms nach dem Fokus wird als
 * Browser-Reset gewertet und zurückgesetzt). Menschen sind davon nicht betroffen.
 */
async function selectText(page: Page, text: string) {
  await page.evaluate((needle) => {
    const ed = window.__noteEditor;
    if (!ed) throw new Error("Editor nicht verfügbar");
    let range: { from: number; to: number } | null = null;
    ed.state.doc.descendants((node, pos) => {
      const index = !range && node.isText ? (node.text ?? "").indexOf(needle) : -1;
      if (index >= 0) range = { from: pos + index, to: pos + index + needle.length };
    });
    if (!range) throw new Error(`„${needle}“ nicht gefunden`);
    ed.chain().focus().setTextSelection(range).run();
  }, text);
  await expect(editor(page)).toBeFocused();
}

/** Rechtsklick mitten in die aktuelle Markierung (wie ein Mensch: die Auswahl bleibt stehen). */
async function rightClickSelection(page: Page, modifiers: Array<"Shift"> = []) {
  const box = await page.evaluate(() => {
    const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
    return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
  });
  if (!box) throw new Error("Keine Markierung");
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(box.x, box.y, { button: "right" });
  for (const key of modifiers) await page.keyboard.up(key);
}

test("Text markieren: formatieren (Desktop Rechtsklick-Menü, Touch Leiste), Web-Link, als Notiz verlinken", async ({
  page,
}) => {
  const touch = isNarrow(page); // Mobil-Projekt = Touch
  const target = uniqueName("Markiert");
  await createNote(page, uniqueName("Leiste"));
  await page.keyboard.type(`Prüffristen ${target} beachten`);
  const toolbar = page.getByRole("toolbar", { name: "Formatieren" });
  const menu = page.getByRole("menu", { name: "Formatieren" });

  // „Prüffristen“ fett
  await selectText(page, "Prüffristen");
  if (touch) {
    await expect(toolbar).toBeVisible();
    await expectNoA11yViolations(page);
    await toolbar.getByRole("button", { name: "Fett" }).click();
    await expect(toolbar.getByRole("button", { name: "Fett" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } else {
    // am Desktop keine Leiste beim Markieren, sondern das Menü per Rechtsklick
    await expect(toolbar).toBeHidden();
    await rightClickSelection(page);
    await expect(menu).toBeVisible();
    // Kontrast erst nach dem Einblenden messen (während der Animation ist alles blasser)
    await menu.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    await expectNoA11yViolations(page);
    await menu.getByRole("menuitemcheckbox", { name: "Fett" }).click();
    await expect(menu).toBeHidden();
    await rightClickSelection(page);
    await expect(menu.getByRole("menuitemcheckbox", { name: "Fett" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.keyboard.press("Escape");
  }
  await expect(editor(page).locator("strong")).toHaveText("Prüffristen");

  // „beachten“ als Web-Link
  await selectText(page, "beachten");
  if (touch) {
    await toolbar.getByRole("button", { name: "Web-Link" }).click();
  } else {
    await rightClickSelection(page);
    await menu.getByRole("menuitem", { name: "Web-Link …" }).click();
  }
  const address = toolbar.getByRole("textbox", { name: "Link-Adresse" });
  await expect(address).toBeFocused();
  await address.fill("example.com");
  await address.press("Enter");
  await expect(editor(page).locator('a[href="https://example.com"]')).toHaveText("beachten");
  if (!touch) await expect(toolbar).toBeHidden();

  // markierten Titel als neue Notiz verlinken
  await selectText(page, target);
  if (touch) {
    await toolbar.getByRole("button", { name: "Als Notiz verlinken" }).click();
  } else {
    await rightClickSelection(page);
    await menu.getByRole("menuitem", { name: /Als Notiz verlinken/ }).click();
  }
  const suggestions = page.getByRole("listbox", { name: "Notiz verlinken" });
  await expect(
    suggestions.getByRole("option", { name: `Neue Notiz „${target}“ anlegen` }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor(page).locator(".ol-note-link")).toHaveText(target);
  await expect(toolbar).toBeHidden();
  await expectSaved(page);

  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator("strong")).toHaveText("Prüffristen");
  await expect(editor(page).locator(".ol-note-link")).toHaveText(target);
  await expect(editor(page).locator('a[href="https://example.com"]')).toHaveText("beachten");

  // ⇧ + Rechtsklick lässt das Systemmenü durch (z. B. für Rechtschreibvorschläge)
  if (!touch) {
    await selectText(page, "Prüffristen");
    await rightClickSelection(page, ["Shift"]);
    await expect(menu).toBeHidden();
  }
});

test("Thema anlegen; Typ, Tags (auch #inline) und Geprüft am bleiben nach Reload erhalten", async ({
  page,
}) => {
  const topic = uniqueName("Thema");
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neues Thema" }).click();
  await page.getByRole("textbox", { name: "Name des neuen Themas" }).fill(topic);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\?thema=[0-9a-f-]{36}$/);
  const topicUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: topic })).toBeVisible();

  const title = uniqueName("Protokoll");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(editor(page)).toBeVisible();
  await titleField(page).fill(title);
  await titleField(page).press("Enter");
  await page.keyboard.type("Sichtprüfung #wartung ");
  await expect(editor(page).locator(".ol-tag", { hasText: "#wartung" })).toBeVisible();

  // Typ „Protokoll“ (zählt nicht als Wissen) bleibt nach dem Neuladen
  await page.getByRole("button", { name: "Typ", exact: true }).click();
  await page.getByRole("option", { name: "Protokoll", exact: true }).click();
  await page.getByRole("textbox", { name: "Tag hinzufügen" }).fill("pa");
  await page.getByRole("textbox", { name: "Tag hinzufügen" }).press("Enter");
  await page.getByRole("button", { name: "Geprüft am" }).click();
  await page.getByRole("button", { name: "Heute", exact: true }).click();
  await expectSaved(page);

  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Typ", exact: true })).toHaveText(/Protokoll/);
  await expect(page.getByRole("button", { name: "Thema", exact: true })).toHaveText(
    new RegExp(topic),
  );
  const tags = page.getByRole("list", { name: "Tags" });
  await expect(tags.getByRole("listitem")).toHaveText(["#pa", "#wartung"]);
  const today = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  await expect(page.getByRole("button", { name: "Geprüft am" })).toHaveText(today);

  // #56: Ein Protokoll zählt nicht als Wissen – die Liste des Themas hat die Notiz erst als „Wissen“
  await page.goto(topicUrl);
  await expect(page.getByRole("heading", { level: 1, name: topic })).toBeVisible();
  await expect(page.getByText("Noch kein Wissen")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Notizliste" }).getByRole("link", { name: new RegExp(title) }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "Typ", exact: true }).click();
  await page.getByRole("option", { name: "Wissen", exact: true }).click();
  await expectSaved(page);
  await page.goto(topicUrl);
  const list = page.getByRole("list", { name: "Notizen" });
  await expect(list.getByRole("link", { name: new RegExp(title) })).toBeVisible();
});

test("Ohne Themen-Spalte: Typ-Filter-Menü, Thema umbenennen und in den Papierkorb", async ({
  page,
}) => {
  // unter 1280 px gibt es keine Themen-Spalte
  if (!isNarrow(page)) await page.setViewportSize({ width: 1100, height: 900 });
  const topic = uniqueName("Thema");
  await page.goto("/wissen");
  await expect(page.getByRole("navigation", { name: "Themen" })).toBeHidden();
  await page.getByRole("button", { name: "Neues Thema" }).click();
  await page.getByRole("textbox", { name: "Name des neuen Themas" }).fill(topic);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("button", { name: "Thema wählen" })).toHaveText(topic);
  const topicUrl = page.url();

  const title = uniqueName("Besprechung");
  await page.getByRole("button", { name: "Neue Notiz" }).first().click();
  await expect(editor(page)).toBeVisible();
  await titleField(page).fill(title);
  await page.getByRole("button", { name: "Typ", exact: true }).click();
  await page.getByRole("option", { name: "Wissen", exact: true }).click();
  await expectSaved(page);
  // #56: nur Wissens-Typen stehen in der Liste; das Thema bleibt an der Notiz
  await page.goto(topicUrl);
  const list = page.getByRole("region", { name: "Notizliste" });
  const card = list.getByRole("link", { name: new RegExp(title) });
  await expect(card).toContainText("Wissen");

  // Filter „Anleitung“ blendet die Notiz aus, „Wissen“ zeigt sie wieder
  const filterMenu = async () => {
    await list.getByRole("button", { name: /^Sortieren und filtern/ }).click();
    return page.getByRole("menu");
  };
  const first = await filterMenu();
  // der Filter bietet nur Typen an, die als Wissen zählen
  await expect(first.getByRole("menuitemcheckbox", { name: "Idee" })).toHaveCount(0);
  await first.getByRole("menuitemcheckbox", { name: "Anleitung" }).click();
  await page.keyboard.press("Escape");
  await expect(
    list.getByRole("button", { name: "Sortieren und filtern (1 Filter aktiv)" }),
  ).toBeVisible();
  await expect(card).toBeHidden();
  const menu = await filterMenu();
  await menu.getByRole("menuitemcheckbox", { name: "Anleitung" }).click();
  await menu.getByRole("menuitemcheckbox", { name: "Wissen" }).click();
  await page.keyboard.press("Escape");
  await expect(card).toBeVisible();

  // Umbenennen über das Themen-Menü
  await list.getByRole("button", { name: `Thema ${topic}: Aktionen` }).click();
  await page.getByRole("menuitem", { name: "Umbenennen" }).click();
  const rename = list.getByRole("textbox", { name: "Thema umbenennen" });
  await expect(rename).toBeFocused();
  await rename.fill(`${topic} neu`);
  await rename.press("Enter");
  await expect(page.getByRole("button", { name: "Thema wählen" })).toHaveText(`${topic} neu`);
  await expectSaved(page);

  // In den Papierkorb: zurück zu „Alles Wissen“ (eine offene Notiz bleibt offen)
  await list.getByRole("button", { name: `Thema ${topic} neu: Aktionen` }).click();
  await page.getByRole("menuitem", { name: "In den Papierkorb" }).click();
  await expect(page).not.toHaveURL(/thema=/);
  await expect(page.getByRole("button", { name: "Thema wählen" })).toHaveText("Alles Wissen");
  await expectSaved(page);
});

test("Ab 1280 px: Themen-Spalte mit Typ-Filter statt Themen-Auswahl @desktop", async ({ page }) => {
  await page.goto("/wissen");
  const nav = page.getByRole("navigation", { name: "Themen" });
  await expect(nav.getByRole("link", { name: /Alles Wissen/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Thema wählen" })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Alles Wissen" })).toBeVisible();
  // Zahlen stehen bündig untereinander (auch neben Themen mit ⋯-Menü)
  await page.getByRole("button", { name: "Neues Thema" }).click();
  await page.getByRole("textbox", { name: "Name des neuen Themas" }).fill(uniqueName("Bündig"));
  await page.getByRole("button", { name: "Anlegen" }).click();
  const rightEdges = await nav
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => Math.round(link.lastElementChild?.getBoundingClientRect().right ?? 0)),
    );
  expect(rightEdges.length).toBeGreaterThanOrEqual(2);
  expect(new Set(rightEdges).size).toBe(1);
  await nav.getByRole("button", { name: "Anleitung" }).click();
  await expect(nav.getByRole("button", { name: "Anleitung" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectNoHorizontalOverflow(page);
});

test("Sortierung: neueste zuerst (auch nach Bearbeiten im Text), A–Z bleibt nach Reload", async ({
  page,
}) => {
  const topic = uniqueName("Sortierung");
  await page.goto("/wissen");
  await page.getByRole("button", { name: "Neues Thema" }).click();
  await page.getByRole("textbox", { name: "Name des neuen Themas" }).fill(topic);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: topic })).toBeVisible();
  const topicUrl = page.url();

  // „Zebra“ zuerst anlegen, dann „Apfel“ (neuer)
  const prefix = uniqueName("");
  for (const name of ["Zebra", "Apfel"]) {
    await page.goto(topicUrl);
    await page.getByRole("button", { name: "Neue Notiz" }).first().click();
    await expect(editor(page)).toBeVisible();
    await titleField(page).fill(`${prefix}${name}`);
    await makeKnowledge(page);
    await titleField(page).press("Enter");
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type(`Text ${name}`);
    await expectSaved(page);
  }
  const list = page.getByRole("list", { name: "Notizen" });
  const order = () =>
    list
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((l) => (l.textContent ?? "").match(/(Zebra|Apfel)/)?.[1] ?? ""),
      );
  await page.goto(topicUrl);
  await expect.poll(order).toEqual(["Apfel", "Zebra"]);

  // im Text von „Zebra“ schreiben: rückt nach oben
  await list.getByRole("link", { name: /Zebra/ }).click();
  await expect(editor(page)).toBeVisible();
  await editor(page).getByText("Text Zebra").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ergänzt");
  await expectSaved(page);
  await page.goto(topicUrl);
  await expect.poll(order).toEqual(["Zebra", "Apfel"]);

  // A–Z über das Menü; bleibt nach Reload
  await page.getByRole("button", { name: /^Sortieren und filtern/ }).click();
  await page.getByRole("menuitemradio", { name: "A–Z" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(order).toEqual(["Apfel", "Zebra"]);
  await page.reload();
  await expect.poll(order).toEqual(["Apfel", "Zebra"]);
  await page.getByRole("button", { name: /^Sortieren und filtern/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "A–Z" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("Notiz: neues Thema direkt an der Eigenschaft, Spickzettel, Hinweis auf andere Bereiche", async ({
  page,
}) => {
  const title = uniqueName("Bereich");
  const topic = uniqueName("Eigenschaft");
  await createNote(page, title);
  await makeKnowledge(page);
  await editor(page).click();
  await page.keyboard.type("Inhalt");

  // Spickzettel mit den Zeichen des Outliners
  await page.getByRole("button", { name: "Zeichen und Tastenkürzel" }).click();
  const help = page.getByRole("dialog", { name: "Zeichen und Tastenkürzel" });
  await expect(help.getByText("((", { exact: true })).toBeVisible();
  await expect(help.getByText("Notiz verlinken (Titel tippen, Enter)")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();

  // Thema per Tastatur: tippen, „Neues Thema „…“ anlegen“, Enter – legt an und weist zu
  const topicButton = page.getByRole("button", { name: "Thema", exact: true });
  await topicButton.click();
  const search = page.getByRole("combobox", { name: "Thema suchen" });
  await expect(search).toBeFocused();
  await page.keyboard.type(topic);
  await expect(page.getByRole("option", { name: `Neues Thema „${topic}“ anlegen` })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(topicButton).toHaveText(topic);

  // wieder entfernen und per Suche (Teilwort) erneut wählen: zuletzt benutzt steht oben
  await topicButton.click();
  await page.getByRole("option", { name: "Kein Thema" }).click();
  await expect(topicButton).toHaveText("Kein Thema");
  await topicButton.click();
  await page.keyboard.type(topic.slice(4));
  // vorhandenes Thema steht vor „Neues Thema „…“ anlegen“, Enter nimmt den ersten Treffer
  await expect(page.getByRole("option").first()).toHaveText(topic);
  await page.keyboard.press("Enter");
  await expect(topicButton).toHaveText(topic);
  await expectSaved(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Thema", exact: true })).toHaveText(topic);

  // Bereich „Privat“ blendet die Notiz (Beruf) aus – Hinweis führt zurück zu „Alles“
  await page.goto("/wissen");
  const nav = await openNavigation(page);
  await nav.getByRole("radio", { name: "Privat" }).click();
  if (isNarrow(page)) await page.keyboard.press("Escape");
  const list = page.getByRole("region", { name: "Notizliste" });
  await expect(list.getByRole("link", { name: new RegExp(title) })).toBeHidden();
  await expect(list.getByText(/weitere Notiz(en)? in anderen\s+Bereichen/)).toBeVisible();
  await list.getByRole("button", { name: "Alle Bereiche zeigen" }).click();
  await expect(list.getByRole("link", { name: new RegExp(title) })).toBeVisible();
});

test("In den Papierkorb und Rückgängig", async ({ page }) => {
  const title = uniqueName("Papierkorb");
  await createNote(page, title);
  await page.keyboard.type("Inhalt bleibt");
  await expectSaved(page);

  await page.getByRole("button", { name: "Notiz-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "In den Papierkorb" }).click();
  await expect(page).toHaveURL(/\/wissen(\?|$)/);
  const list = page.getByRole("list", { name: "Notizen" });
  await expect(list.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);

  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(list.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expectSaved(page);
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Notizen" }).getByRole("link", { name: new RegExp(title) }),
  ).toBeVisible();
});

test("Wissen: kein horizontales Scrollen, keine a11y-Verstöße (Liste und Notiz)", async ({
  page,
}) => {
  await createNote(page, uniqueName("Layout"));
  await page.keyboard.type("Ein Block mit [[");
  await page.keyboard.press("Escape");
  await expectSaved(page);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await page.goto("/wissen");
  await expect(page.getByRole("list", { name: "Notizen" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
});

test("Ladefehler: klare Meldung statt „nicht gefunden“, „Erneut laden“ hilft", async ({ page }) => {
  const notesRequest = (url: URL) => url.pathname.endsWith("/rest/v1/notes");
  await page.route(notesRequest, (route) => route.abort("internetdisconnected"));
  await page.goto("/wissen");
  const alert = page.getByRole("alert").filter({ hasText: "Notizen konnten nicht geladen" });
  await expect(alert).toBeVisible({ timeout: 10_000 });

  await page.unroute(notesRequest);
  await alert.getByRole("button", { name: "Erneut laden" }).click();
  await expect(alert).toBeHidden();
  await expect(page.getByRole("region", { name: "Notizliste" })).toBeVisible();
});

test("Nicht speicherbares lässt sich verwerfen, Rückgängig holt es zurück (D-4)", async ({
  page,
}) => {
  await createNote(page, uniqueName("Verwerfen"));
  await expectSaved(page);
  // der Server lehnt jede Änderung an Notizen dauerhaft ab (Check-Verletzung)
  await page.route("**/rest/v1/notes*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ code: "23514", message: "check violation" }),
        })
      : route.continue(),
  );
  await titleField(page).fill(uniqueName("Abgelehnt"));
  await expect(saveStatus(page)).toHaveAttribute("data-status", "error", { timeout: 10_000 });

  const nav = await openNavigation(page);
  const status = nav.getByTestId(isNarrow(page) ? "save-status-sheet" : "save-status-full");
  await status.getByRole("button", { name: "1 Änderung verwerfen" }).click();
  await expect(saveStatus(page)).toHaveAttribute("data-status", "idle");
  await expect(page.getByText("1 nicht speicherbare Änderung verworfen")).toBeVisible();
  await page.getByRole("button", { name: "Rückgängig" }).dispatchEvent("click");
  await expect(saveStatus(page)).toHaveAttribute("data-status", "error");

  // Server nimmt wieder an → „Erneut versuchen“ speichert
  await page.unroute("**/rest/v1/notes*");
  if (isNarrow(page) && !(await status.isVisible())) await openNavigation(page);
  await status.getByRole("button", { name: "Erneut versuchen" }).click();
  await expectSaved(page);
});

test("Notiz direkt aufrufen: kein Hydration-Fehler, auch wenn die Seitenleiste schon Daten hat", async ({
  page,
}) => {
  const path = await createNote(page, uniqueName("Direktaufruf"));
  await expectSaved(page);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/hydrat/i.test(error.message)) errors.push(error.message);
  });
  // Der Code der Wissen-Ansicht kommt spät (langsames Netz): Früher hydrierte die Seitenleiste in
  // der Zeit schon, ihre Abfragen lieferten Daten, und die Ansicht in ihrer eigenen
  // Suspense-Grenze passte nicht mehr zum Ladezustand vom Server
  await page.route("**/_next/static/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("Themen filtern")) await new Promise((done) => setTimeout(done, 1500));
    await route.fulfill({ response, body });
  });
  await page.goto(path);
  await expect(editor(page)).toBeVisible();
  await expect(titleField(page)).not.toHaveValue("");
  await page.unroute("**/_next/static/chunks/**");
  expect(errors).toEqual([]);
});
