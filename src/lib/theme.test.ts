import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_COLORS } from "./theme";

/** `--bg` eines Theme-Blocks in tokens.css (Block beginnt mit dem Selektor). */
function tokenBg(css: string, selector: string): string | undefined {
  const block = css.slice(css.indexOf(selector));
  return block
    .match(/--bg:\s*([^;]+);/)?.[1]
    .trim()
    .toLowerCase();
}

describe("Farbe der Statusleiste (theme-color)", () => {
  const css = readFileSync(path.join(process.cwd(), "src/styles/tokens.css"), "utf8");

  it("entspricht dem --bg des jeweiligen Themes in tokens.css", () => {
    expect(THEME_COLORS.dark).toBe(tokenBg(css, '[data-theme="dark"]'));
    expect(THEME_COLORS.paper).toBe(tokenBg(css, '[data-theme="paper"]'));
  });
});
