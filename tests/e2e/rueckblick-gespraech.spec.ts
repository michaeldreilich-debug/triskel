/**
 * Gesprächsfelder im Rückblick (#66) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px:
 * Abschnitt „Gespräch“ mit fünf Feldern, Eingabe bleibt nach Neuladen, „Bezug zur Vorwoche“ zeigt
 * Fokus und Mitnehmen der Woche davor, Vorlage enthält die Felder. Eigene Wochen je Viewport.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved } from "./support/app";
import { AUTH_FILE, E2E_PREFIX } from "./support/auth";
import { mondayWeeksAgo, seedRecap } from "./support/seed";

test.use({ storageState: AUTH_FILE });

const QUESTIONS = [
  { key: "good", label: "Was lief gut?", type: "text" },
  { key: "focus_next", label: "Fokus nächste Woche (3 Punkte)", type: "list", count: 3 },
  ...[
    ["conversation", "Gespräch"],
    ["hypothesis", "Hypothese"],
    ["counter_hypothesis", "Gegenhypothese"],
    ["plain_talk", "Klartext"],
    ["last_week", "Bezug zur Vorwoche"],
  ].map(([key, label]) => ({ key, label, type: "text", section: "Gespräch" })),
];

const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test("Gesprächsfelder: Abschnitt sichtbar, Eingabe bleibt, Vorwoche zum Nachlesen", async ({
  page,
}, info) => {
  const base = info.project.name === "mobile" ? 33 : 30;
  const prev = mondayWeeksAgo(base + 1);
  await seedRecap({
    period_start: prev,
    questions: QUESTIONS,
    focus_next: ["Bericht fertig", "Mehr schlafen"],
    answers: { takeaway: `${E2E_PREFIX}Ruhe bewahren` },
  });
  const id = await seedRecap({ period_start: mondayWeeksAgo(base), questions: QUESTIONS });

  await page.goto(`/rueckblicke/${id}`);
  const reflection = region(page, "Reflexion");
  await expect(reflection.getByRole("heading", { level: 3, name: "Gespräch" })).toBeVisible();
  for (const label of [
    "Gespräch",
    "Hypothese",
    "Gegenhypothese",
    "Klartext",
    "Bezug zur Vorwoche",
  ]) {
    await expect(reflection.getByLabel(label, { exact: true })).toBeVisible();
  }

  const text = `${E2E_PREFIX}Hypothese\nzweite Zeile`;
  await reflection.getByLabel("Hypothese", { exact: true }).fill(text);
  await reflection.getByLabel("Klartext", { exact: true }).fill(`${E2E_PREFIX}Klartext`);
  await expectSaved(page);
  await page.reload();
  await expect(reflection.getByLabel("Hypothese", { exact: true })).toHaveValue(text);
  await expect(reflection.getByLabel("Klartext", { exact: true })).toHaveValue(
    `${E2E_PREFIX}Klartext`,
  );

  // Vorwoche: eingeklappt, danach Fokus und Mitnehmen
  const hints = page.getByTestId("previous-hints");
  await expect(hints).toBeVisible();
  await expect(hints.getByText("Bericht fertig")).toBeHidden();
  await hints.getByText("Zum Nachlesen: Vorwoche").click();
  await expect(hints.getByText("Bericht fertig")).toBeVisible();
  await expect(hints.getByText("Mehr schlafen")).toBeVisible();
  await expect(hints.getByText(`${E2E_PREFIX}Ruhe bewahren`)).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
});

test("Gesprächsfelder: ohne Vorwoche keine Zeile, Rückblick ohne die Felder bleibt wie er war", async ({
  page,
}, info) => {
  const base = info.project.name === "mobile" ? 37 : 36;
  const alt = await seedRecap({
    period_start: mondayWeeksAgo(base),
    questions: [{ key: "good", label: "Was lief gut?", type: "text" }],
  });
  await page.goto(`/rueckblicke/${alt}`);
  const reflection = region(page, "Reflexion");
  await expect(reflection.getByLabel("Was lief gut?")).toBeVisible();
  await expect(reflection.getByRole("heading", { level: 3, name: "Gespräch" })).toHaveCount(0);
  await expect(page.getByTestId("previous-hints")).toHaveCount(0);

  const neu = await seedRecap({ period_start: mondayWeeksAgo(base + 3), questions: QUESTIONS });
  await page.goto(`/rueckblicke/${neu}`);
  await expect(region(page, "Reflexion").getByLabel("Bezug zur Vorwoche")).toBeVisible();
  await expect(page.getByTestId("previous-hints")).toHaveCount(0);
});

test("Vorlage enthält die Gesprächsfelder, Reihenfolge und Art bleiben einstellbar", async ({
  page,
}) => {
  await page.goto("/einstellungen#vorlagen");
  const questions = page.getByRole("list", { name: "Leitfragen" });
  for (const label of [
    "Gespräch",
    "Hypothese",
    "Gegenhypothese",
    "Klartext",
    "Bezug zur Vorwoche",
  ]) {
    await expect(
      questions
        .getByRole("textbox", { name: /^Leitfrage \d+$/ })
        .and(questions.locator(`input[value="${label}"]`)),
    ).toHaveCount(1);
  }
  await expectNoHorizontalOverflow(page);
});
