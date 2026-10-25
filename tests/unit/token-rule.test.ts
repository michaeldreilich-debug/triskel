/**
 * Token-Regel (CLAUDE.md, Regel 6): Farbwerte gibt es nur in src/styles/tokens.css.
 * Außerdem keine Tailwind-Standardpaletten (die sind im Theme zurückgesetzt und würden
 * stillschweigend wirkungslos bleiben).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../support/env-file";

const SRC = path.join(REPO_ROOT, "src");
const TOKENS = path.join(SRC, "styles", "tokens.css");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/gi;
const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/gi;
const PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|outline|divide|from|via|to|shadow|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/g;

function findViolations(): string[] {
  const violations: string[] = [];
  for (const file of walk(SRC)) {
    if (file === TOKENS) continue;
    const rel = path.relative(REPO_ROOT, file);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const pattern of [HEX, COLOR_FN, PALETTE]) {
          for (const match of line.matchAll(pattern)) {
            violations.push(`${rel}:${index + 1}  ${match[0]}`);
          }
        }
      });
  }
  return violations;
}

describe("Token-Regel", () => {
  it("keine Farbwerte außerhalb von src/styles/tokens.css", () => {
    expect(findViolations()).toEqual([]);
  });

  it("die Prüfung erkennt Verstöße (Selbsttest der Muster)", () => {
    const sample = 'className="bg-[#ff0000] text-zinc-500" style={{ color: "rgb(1 2 3)" }}';
    expect(sample.match(HEX)).toEqual(["#ff0000"]);
    expect(sample.match(PALETTE)).toEqual(["text-zinc-500"]);
    expect(sample.match(COLOR_FN)).toEqual(["rgb("]);
    expect("#job #privat bg-area-orange text-muted".match(HEX)).toBeNull();
    expect("bg-area-orange text-muted".match(PALETTE)).toBeNull();
  });

  it("tokens.css definiert beide Themes mit denselben Tokens", () => {
    const css = readFileSync(TOKENS, "utf8");
    const block = (selector: string) => {
      const start = css.indexOf(selector);
      return css.slice(start, css.indexOf("}", start));
    };
    const names = (text: string) => [...text.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]).sort();
    const dark = names(block('[data-theme="dark"]'));
    const paper = names(block('[data-theme="paper"]'));
    expect(dark.length).toBeGreaterThan(10);
    expect(paper).toEqual(dark);
  });
});
