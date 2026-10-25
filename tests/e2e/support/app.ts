import { expect, type Locator, type Page } from "@playwright/test";

/** unter 1024 px ist die Sidebar ein Sheet hinter „Menü öffnen“ (unter 768 px in der Leiste unten) */
export const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

export async function openNavigation(page: Page): Promise<Locator> {
  if (isNarrow(page)) {
    // Am Handy sitzt „Menü“ in der Leiste unten, die beim Schreiben ausgeblendet ist (E44 H2):
    // erst den Fokus aus Feld/Editor nehmen, wie es beim Tippen auf eine freie Stelle geschieht
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.getByRole("button", { name: "Menü öffnen" }).click();
    return page.getByRole("dialog", { name: "Navigation" });
  }
  return page.getByRole("complementary", { name: "Seitenleiste" });
}

/** Speicherstatus der Shell: ausführlich in der Seitenleiste, kompakt in der mobilen Kopfzeile */
export function saveStatus(page: Page): Locator {
  return page.getByTestId(isNarrow(page) ? "save-status-compact" : "save-status-full");
}

export async function expectSaved(page: Page, timeout = 15_000) {
  await expect(saveStatus(page)).toHaveAttribute("data-status", "idle", { timeout });
}

/** Wert in ein Feld schreiben, ohne dass er in Step-Titeln oder Reports auftaucht. */
export async function fillQuietly(field: Locator, value: string) {
  await field.evaluate((el, v) => {
    (el as HTMLInputElement).value = v;
  }, value);
}

/**
 * Wie fillQuietly, löst aber das input-Ereignis aus (React-onChange), z. B. für den TOTP-Code.
 * Der Wert erscheint weder in Step-Titeln noch in Reports.
 */
export async function typeQuietly(field: Locator, value: string) {
  await field.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** Outline als Text: eine Zeile je Block, 2 Leerzeichen je Ebene, „▸ “ = eingeklappt. */
export async function outlineTree(page: Page): Promise<string> {
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

/**
 * Erfolgreiche Uploads in den Storage zählen (T-7): Hochladen läuft neben der Warteschlange –
 * statt fester Pausen vor dem Neuladen warten, bis so viele Dateien wirklich angekommen sind.
 * Vor der Aktion aufrufen.
 */
export function trackUploads(page: Page) {
  let done = 0;
  page.on("response", (response) => {
    if (
      // Hochladen (E41): Link von /api/dateien/hochladen, dann PUT der Bytes zu R2
      response.url().includes(".r2.cloudflarestorage.com/") &&
      response.request().method() === "PUT" &&
      response.ok()
    ) {
      done += 1;
    }
  });
  return {
    until: (count: number) =>
      expect.poll(() => done, { timeout: 20_000 }).toBeGreaterThanOrEqual(count),
  };
}
