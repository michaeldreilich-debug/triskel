import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";

/** Baum aus dem DOM: eine Zeile je Block, 2 Leerzeichen je Ebene, „▸“ = eingeklappt. */
async function tree(page: Page): Promise<string> {
  return page.locator(".outline-editor").evaluate((root) => {
    const lines: string[] = [];
    const walk = (parent: Element, depth: number) => {
      for (const block of parent.querySelectorAll(":scope > .ol-block")) {
        const body = block.querySelector(":scope > .ol-body");
        const paragraph = body?.querySelector(":scope > p");
        const text = [...(paragraph?.childNodes ?? [])]
          .map((n) =>
            n instanceof HTMLElement && n.classList.contains("ProseMirror-trailingBreak")
              ? ""
              : n.textContent,
          )
          .join("");
        const collapsed = (block as HTMLElement).dataset.collapsed === "true" ? "▸ " : "";
        lines.push(`${"  ".repeat(depth)}${collapsed}${text}`);
        if (body) walk(body, depth + 1);
      }
    };
    walk(root, 0);
    return lines.join("\n");
  });
}

function paragraph(page: Page, text: string): Locator {
  return page
    .locator(".outline-editor p")
    .filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
}

/**
 * Cursor an Anfang oder Ende eines Blocks setzen – nur als Vorbereitung über den Editor der
 * Spielwiese (window.__devOutliner); die geprüften Aktionen laufen danach über echte Tasten.
 */
async function placeCursor(page: Page, text: string, at: "end" | "start" = "end") {
  await page.evaluate(
    ({ text, at }) => {
      const editor = window.__devOutliner;
      if (!editor) throw new Error("Editor nicht bereit");
      let target: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (target !== null) return false;
        if (node.type.name === "paragraph" && node.textContent === text) {
          target = at === "start" ? pos + 1 : pos + 1 + node.content.size;
          return false;
        }
        return true;
      });
      if (target === null) throw new Error(`Block nicht gefunden: ${text}`);
      // ProseMirror fokussiert synchron (TipTaps focus() wartet einen Frame)
      editor.view.focus();
      editor.commands.setTextSelection(target);
    },
    { text, at },
  );
  await page.waitForFunction(() => window.__devOutliner?.view.hasFocus() === true);
}

const status = (page: Page) => page.locator('[role="status"][data-status]');

test.describe("Outliner-Spielwiese (/dev/outliner)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/outliner");
    await expect(page.locator(".outline-editor")).toBeVisible();
    await expect(status(page)).toHaveAttribute("data-status", "idle");
    await page.waitForFunction(() => Boolean(window.__devOutliner));
  });

  test("Enter, Tab und Shift+Tab bauen den Baum", async ({ page }) => {
    await placeCursor(page, "Fristen-Export in die Werkstatt-App übernehmen");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Neu A");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Neu B");
    await page.keyboard.press("Tab");
    expect(await tree(page)).toContain(
      "Offene Punkte\n  Fristen-Export in die Werkstatt-App übernehmen\n  Neu A\n    Neu B",
    );
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    expect(await tree(page)).toMatch(/ {2}Neu A\nNeu B$/);
    // jeder Strukturbefehl ist ein eigener Rückgängig-Schritt
    await page.keyboard.press("ControlOrMeta+z");
    expect(await tree(page)).toMatch(/ {2}Neu A\n {2}Neu B$/);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(await tree(page)).toMatch(/ {2}Neu A\nNeu B$/);
  });

  test("Shift+Enter bricht die Zeile im Block um", async ({ page }) => {
    await placeCursor(page, "Fristen-Export in die Werkstatt-App übernehmen");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("zweite Zeile");
    await expect(
      paragraph(page, "Fristen-Export in die Werkstatt-App übernehmenzweite Zeile").locator("br"),
    ).toHaveCount(1);
  });

  test("⌥⇧↑/↓ verschiebt Blöcke samt Kindern", async ({ page }) => {
    await placeCursor(page, "Offene Punkte");
    await page.keyboard.press("Alt+Shift+ArrowUp");
    const lines = (await tree(page)).split("\n").filter((l) => !l.startsWith(" "));
    expect(lines).toEqual(["Pressluftatmer", "Offene Punkte", "▸ Atemschutzmasken"]);
    await page.keyboard.press("Alt+Shift+ArrowDown");
    expect((await tree(page)).split("\n").filter((l) => !l.startsWith(" "))).toEqual([
      "Pressluftatmer",
      "▸ Atemschutzmasken",
      "Offene Punkte",
    ]);
  });

  test("⌘↑/⌘↓ und der Pfeil klappen ein und aus; Kinder werden verborgen", async ({ page }) => {
    await placeCursor(page, "Pressluftatmer");
    await page.keyboard.press("ControlOrMeta+ArrowUp");
    await expect(
      paragraph(page, "Nach jedem Einsatz: Einsatzprüfung + Dokumentation"),
    ).toBeHidden();
    await expect(page.getByRole("button", { name: "Ausklappen" }).first()).toBeVisible();
    await page.keyboard.press("ControlOrMeta+ArrowDown");
    await expect(
      paragraph(page, "Nach jedem Einsatz: Einsatzprüfung + Dokumentation"),
    ).toBeVisible();

    await expect(paragraph(page, "Dichtprüfung halbjährlich")).toBeHidden();
    await page.locator('.ol-block[data-collapsed="true"] > .ol-gutter > .ol-toggle').click();
    await expect(paragraph(page, "Dichtprüfung halbjährlich")).toBeVisible();
  });

  test("Pfeiltasten überspringen eingeklappte Kinder", async ({ page }) => {
    await placeCursor(page, "Atemschutzmasken");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("X");
    await expect(paragraph(page, "XOffene Punkte")).toBeVisible();
    await page.keyboard.press("Backspace");

    await placeCursor(page, "Offene Punkte", "start");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.type("Y");
    await expect(paragraph(page, "AtemschutzmaskenY")).toBeVisible();
    expect(await tree(page)).toContain("▸ AtemschutzmaskenY\n  Sichtprüfung vor jedem Einsatz");
  });

  test("Rücktaste am Blockanfang führt zusammen, ⌘Z stellt wieder her", async ({ page }) => {
    await placeCursor(page, "Nach jedem Einsatz: Einsatzprüfung + Dokumentation", "start");
    await page.keyboard.press("Backspace");
    await expect(
      page.locator(".outline-editor p", { hasText: "Wartungsplan PANach jedem Einsatz" }),
    ).toBeVisible();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(
      paragraph(page, "Nach jedem Einsatz: Einsatzprüfung + Dokumentation"),
    ).toBeVisible();
  });

  test("[[ verlinkt Notizen und legt bei Bedarf eine neue an", async ({ page }) => {
    await placeCursor(page, "Fristen-Export in die Werkstatt-App übernehmen");
    await page.keyboard.type(" siehe [[Herst");
    const list = page.getByRole("listbox", { name: "Notiz verlinken" });
    await expect(list.getByRole("option", { name: "Herstellerunterlagen PA" })).toBeVisible();
    // Screenreader: Editor ist mit der Liste verbunden, die aktive Option ist gemeldet (O-11)
    const editor = page.locator(".ProseMirror.outline-editor");
    await expect(editor).toHaveAttribute("aria-expanded", "true");
    const listId = await list.getAttribute("id");
    await expect(editor).toHaveAttribute("aria-controls", listId as string);
    const active = await editor.getAttribute("aria-activedescendant");
    await expect(list.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(list).toBeHidden();
    await expect(editor).not.toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator(".ol-note-link", { hasText: "Herstellerunterlagen PA" }),
    ).toBeVisible();

    await page.keyboard.type("und [[Neue Idee");
    await expect(
      list.getByRole("option", { name: "Neue Notiz „Neue Idee“ anlegen" }),
    ).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator(".ol-note-link", { hasText: "Neue Idee" })).toBeVisible();
  });

  test("# legt Tags an (Autocomplete oder Leerzeichen)", async ({ page }) => {
    await placeCursor(page, "Fristen-Export in die Werkstatt-App übernehmen");
    await page.keyboard.type(" #wart");
    const list = page.getByRole("listbox", { name: "Tag einfügen" });
    await expect(list.getByRole("option", { name: "wartung" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(".ol-tag", { hasText: "#wartung" })).toBeVisible();
    await page.keyboard.type("#dringend ");
    await expect(page.locator(".ol-tag", { hasText: "#dringend" })).toBeVisible();
  });

  test("eingefügte Markdown-Liste ergibt verschachtelte Blöcke mit eindeutigen IDs", async ({
    page,
  }) => {
    await placeCursor(page, "Fristen-Export in die Werkstatt-App übernehmen");
    await page.locator(".outline-editor").evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "- Paste A\n  - Paste B\n- Paste C");
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    expect(await tree(page)).toContain(
      "  Fristen-Export in die Werkstatt-App übernehmen\n  Paste A\n    Paste B\n  Paste C",
    );
    const ids = await page
      .locator(".ol-block")
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.blockId));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("Reload erhält Baum und Klappzustand", async ({ page }) => {
    await placeCursor(page, "Fristen-Export in die Werkstatt-App übernehmen");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Bleibt erhalten");
    await page.keyboard.press("Tab");
    await placeCursor(page, "Pressluftatmer");
    await page.keyboard.press("ControlOrMeta+ArrowUp");
    await expect(status(page)).toHaveAttribute("data-status", "idle");
    await expect(page.getByTestId("server-tree")).toContainText("Bleibt erhalten");
    const before = await tree(page);

    await page.reload();
    await expect(page.locator(".outline-editor")).toBeVisible();
    expect(await tree(page)).toBe(before);
    expect(before).toContain("▸ Pressluftatmer");
    expect(before).toContain("    Bleibt erhalten");
  });

  test("Tippen und sofort neu laden: nichts geht verloren", async ({ page }) => {
    await placeCursor(page, "Offene Punkte");
    await page.keyboard.type(" (eilig)");
    await page.reload();
    await expect(paragraph(page, "Offene Punkte (eilig)")).toBeVisible();
    await expect(status(page)).toHaveAttribute("data-status", "idle");
    await expect(page.getByTestId("server-tree")).toContainText("Offene Punkte (eilig)");
  });

  test("Netzabbruch: Änderungen bleiben lokal und werden nachgeholt", async ({ page }) => {
    await page.getByLabel("Netz trennen (simuliert)").click();
    await placeCursor(page, "Offene Punkte");
    await page.keyboard.type(" offline");
    await expect(status(page)).toHaveAttribute("data-status", "offline");
    await expect(page.getByTestId("server-tree")).not.toContainText("Offene Punkte offline");

    await page.reload();
    await expect(page.getByTestId("restored-hint")).toBeVisible();
    await expect(paragraph(page, "Offene Punkte offline")).toBeVisible();
    await expect(status(page)).toHaveAttribute("data-status", "idle");
    await expect(page.getByTestId("server-tree")).toContainText("Offene Punkte offline");
  });

  test("390 px: kein horizontales Scrollen; keine a11y-Verstöße", async ({ page }) => {
    await expectNoHorizontalOverflow(page);
    await expectNoA11yViolations(page);
  });
});
