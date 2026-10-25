import { expect, type Locator, type Page } from "@playwright/test";

/** Offene Aufgabe: ab 1280 px Panel rechts, darunter Sheet (Dialog). */
export function taskPanel(page: Page): Locator {
  return (page.viewportSize()?.width ?? 1440) >= 1280
    ? page.getByRole("complementary", { name: "Aufgabe" })
    : page.getByRole("dialog", { name: "Aufgabe" });
}

/** Aufgabe über das Feld „Neue Aufgabe“ auf /aufgaben anlegen – Enter öffnet sie (#75). */
export async function createTask(page: Page, title: string): Promise<Locator> {
  if (!new URL(page.url()).pathname.startsWith("/aufgaben")) await page.goto("/aufgaben");
  // erst, wenn die Bereiche da sind (Kürzel im Hinweis) – die Aufgabe öffnet sofort
  await expect(page.getByText(/#job .*@Projekt ordnen zu/)).toBeVisible();
  const input = page.getByRole("textbox", { name: "Neue Aufgabe" });
  await input.fill(title);
  await input.press("Enter");
  await expect(input).toHaveValue("");
  const panel = taskPanel(page);
  await expect(panel.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(title);
  return panel;
}

/** Handy: Eigenschaften sind zugeklappt (eine Zeile Zusammenfassung) – aufklappen. */
export async function showProperties(panel: Locator) {
  // erst warten, bis das Panel steht (sonst ist der Schalter noch nicht da)
  await expect(panel.getByRole("textbox", { name: "Titel", exact: true })).toBeVisible();
  const toggle = panel.getByRole("button", { name: /^Eigenschaften/ });
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
}

/** Radix-Select einer Eigenschaft im Panel wählen. */
export async function chooseOption(panel: Locator, property: string, option: string | RegExp) {
  await showProperties(panel);
  await panel.getByRole("combobox", { name: property, exact: true }).click();
  await panel.page().getByRole("option", { name: option }).click();
}

/** Bereich setzen (Aufgaben im Bereich „Alles“ landen sonst in der Inbox). */
export async function setArea(panel: Locator, area: string) {
  await chooseOption(panel, "Bereich", area);
  await expect(panel.getByRole("combobox", { name: "Bereich", exact: true })).toContainText(area);
}

export async function closePanel(page: Page) {
  await taskPanel(page).getByRole("button", { name: "Aufgabe schließen" }).click();
  await expect(taskPanel(page)).toBeHidden();
}

/** Zeile einer Aufgabe in einer Liste (über den Titel-Link). */
export function taskRow(scope: Page | Locator, title: string): Locator {
  const page = "page" in scope && typeof scope.page === "function" ? scope.page() : (scope as Page);
  return scope.locator("[data-task-id]").filter({ has: page.getByRole("link", { name: title }) });
}

/** Aufgabenliste der Datenbank-Ansicht (alle Gruppen; Standard: nach Projekt gruppiert, #48). */
export const taskList = (page: Page) => page.getByRole("region", { name: "Aufgaben", exact: true });

/** Filter „Status“: einen Wert ein- oder ausblenden (Menü bleibt offen, danach Escape). */
export async function toggleStatusFilter(page: Page, status: string) {
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitem", { name: /^Status/ }).click();
  await page.getByRole("menuitemcheckbox", { name: status }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/** Filter auf die Vorgabe zurücksetzen (Status ≠ Erledigt). */
export async function resetFilters(page: Page) {
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("menuitem", { name: "Standardfilter" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}
