import { expect, test } from "@playwright/test";
import { cssVar, expectNoHorizontalOverflow } from "./helpers";

test("Startseite leitet ohne Anmeldung auf /login, dunkles Standard-Theme mit Tokens", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await cssVar(page, "--bg")).toBe("#0a0a0b");
  const bodyBg = await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bodyBg).toBe("rgb(10, 10, 11)");
  const bodyFont = await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily);
  expect(bodyFont).toMatch(/Geist/i);
  await expectNoHorizontalOverflow(page);
});
