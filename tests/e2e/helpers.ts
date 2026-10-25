import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Kein horizontales Scrollen (Regel: Mobil ist gleichwertig, 390 px). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "Seite scrollt horizontal").toBeLessThanOrEqual(0);
}

/** Liest einen Token-Wert vom <html>-Element (bzw. einem Element mit data-theme). */
export async function cssVar(page: Page, name: string, selector = "html") {
  return page
    .locator(selector)
    .first()
    .evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);
}

/** axe: keine Verstöße gegen WCAG 2.1 A/AA (inkl. Kontrast). */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("nextjs-portal")
    .analyze();
  // je Knoten das Ziel und – bei Kontrast – Farben und Verhältnis (zum Nachvollziehen im Bericht)
  const summary = results.violations.map(
    (v) =>
      `${v.id}: ${v.help} → ${v.nodes
        .map((n) => {
          const data = n.any[0]?.data as
            | { fgColor?: string; bgColor?: string; contrastRatio?: number }
            | undefined;
          const detail = data?.contrastRatio
            ? ` (${data.fgColor} auf ${data.bgColor}: ${data.contrastRatio})`
            : "";
          return `${n.target.join(" ")}${detail}`;
        })
        .slice(0, 3)
        .join(" | ")}`,
  );
  expect(summary).toEqual([]);
}
