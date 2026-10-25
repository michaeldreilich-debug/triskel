/**
 * Einstellungen zum Klappen (F6, #58): Abschnitte sind zu, der Kopf nennt den aktuellen Wert,
 * Klick klappt auf, der Zustand bleibt je Gerät, Sprungziele (#sicherung, #kalender …) öffnen den
 * Abschnitt. Desktop 1440 px und Mobil 390 px.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE } from "./support/auth";

test.use({ storageState: AUTH_FILE });

const head = (page: Page, title: string) =>
  page.getByRole("region", { name: title }).getByRole("button").first();

const TITLES = [
  "Darstellung",
  "Startbild",
  "Abendplanung",
  "Kalender",
  "Notiz-Typen",
  "Vorlagen",
  "Freigaben",
  "Sicherung",
  "Export",
  "KI-Zugänge",
];

test("Abschnitte sind zu, zeigen den Wert im Kopf, klappen auf und merken sich das", async ({
  page,
}) => {
  await page.goto("/einstellungen");
  for (const title of TITLES)
    await expect(head(page, title)).toHaveAttribute("aria-expanded", "false");
  await expect(head(page, "Darstellung")).toContainText("Schrift Normal");
  await expect(head(page, "Abendplanung")).toContainText("Abendzeit");
  await expectNoHorizontalOverflow(page);

  await head(page, "Darstellung").click();
  await expect(head(page, "Darstellung")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("radiogroup", { name: "Schriftgröße" })).toBeVisible();
  await expectNoA11yViolations(page);

  // bleibt nach Neuladen offen, die anderen bleiben zu
  await page.reload();
  await expect(head(page, "Darstellung")).toHaveAttribute("aria-expanded", "true");
  await expect(head(page, "Export")).toHaveAttribute("aria-expanded", "false");
  await head(page, "Darstellung").click();
  await expect(page.getByRole("radiogroup", { name: "Schriftgröße" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("Sprungziele öffnen den Abschnitt, auch wenn er zu ist", async ({ page }) => {
  for (const [hash, title] of [
    ["sicherung", "Sicherung"],
    ["kalender", "Kalender"],
    ["export", "Export"],
    ["ki", "KI-Zugänge"],
    ["notiz-typen", "Notiz-Typen"],
    ["freigaben", "Freigaben"],
  ] as const) {
    await page.goto(`/einstellungen#${hash}`);
    await expect(head(page, title)).toHaveAttribute("aria-expanded", "true");
    await expect(head(page, title)).toBeInViewport();
    await expectNoHorizontalOverflow(page);
  }
  // Mehrere geöffnet: Aufklappen und wieder Zuklappen bei offenem Sprungziel
  await page.goto("/einstellungen#sicherung");
  await head(page, "Sicherung").click();
  await expect(head(page, "Sicherung")).toHaveAttribute("aria-expanded", "false");
});

test("Alles aufgeklappt: kein Überlauf, keine a11y-Verstöße", async ({ page }) => {
  await page.goto("/einstellungen");
  for (const title of TITLES) await head(page, title).click();
  await page.waitForTimeout(400);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
});

test("Beim Laden nennt der Kopf noch keinen Wert – nie „Noch keine Sicherung“ (M3-2)", async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rest/v1/user_settings?*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await gate;
    await route.fallback();
  });
  await page.goto("/einstellungen");
  // solange user_settings lädt: die feste Unterzeile, kein ausgedachter Stand
  await expect(head(page, "Sicherung")).toContainText("Jede Nacht automatisch nach Google Drive");
  await expect(head(page, "Export")).toContainText("Alles als Markdown");
  release();
  await expect(head(page, "Sicherung")).not.toContainText("Jede Nacht automatisch");
  await expect(head(page, "Export")).not.toContainText("Alles als Markdown");
});

test("Abschnittsköpfe sind Überschriften, der Knopf steckt darin (M3-3)", async ({ page }) => {
  await page.goto("/einstellungen");
  // Muster „Akkordeon“: <h2><button aria-expanded> – im Knopf wäre die Überschrift für
  // Bildschirmleser keine (Kinder eines Knopfs sind nur Text)
  for (const title of TITLES) {
    await expect(
      page.getByRole("heading", { level: 2, name: title }).getByRole("button"),
    ).toHaveAttribute("aria-expanded", "false");
  }
  await expectNoA11yViolations(page);
});
