/**
 * Einplanen-Spalte, Variante D (#62), Desktop 1440 px und Mobil 390 px: „Jetzt einplanen“ mit
 * höchstens 7 Zeilen, jede Aufgabe genau einmal, Inbox, Projekte nach Meilenstein (große zu,
 * spätere Meilensteine als Zeile), lose Aufgaben je Bereich, Filter-Menü („Von KI angelegt“),
 * Bereichs-Schalter mit Hinweis. Geprüft über die Suche nach dem Testpräfix – die Spalte zeigt
 * sonst auch die Aufgaben der übrigen Tests. „Von KI angelegt“ setzt der Trigger nur bei einem
 * KI-Token (Migration 40): hier markiert ein abgefangener Abruf die Testaufgaben.
 */
import { expect, type Page, test } from "@playwright/test";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { isNarrow, openNavigation } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import {
  areaIds,
  berlinAddDays,
  berlinToday,
  seedDb,
  seedProject,
  seedTasks,
} from "./support/seed";

test.use({ storageState: AUTH_FILE });
test.setTimeout(90_000);

/** Spalte (Desktop) bzw. Sheet (Handy) öffnen. */
async function openPlan(page: Page) {
  await page.goto("/kalender?ansicht=woche");
  if (isNarrow(page)) {
    await page.getByRole("button", { name: "Einplanen" }).click();
    const sheet = page.getByRole("dialog", { name: "Einplanen" });
    await expect(sheet).toBeVisible();
    return sheet;
  }
  const plan = page.getByRole("complementary", { name: "Einplanen" });
  await expect(plan).toBeVisible();
  return plan;
}

interface Seeded {
  prefix: string;
  titles: Record<string, string>;
  cleanup: () => Promise<void>;
}

async function seed(prefix: string): Promise<Seeded> {
  const { beruf } = await areaIds();
  const db = await seedDb();
  const today = berlinToday();
  const alpha = await seedProject({ title: `${prefix} Alpha`, area_id: beruf });
  const gross = await seedProject({ title: `${prefix} Gross`, area_id: beruf });
  const milestones = [
    { id: crypto.randomUUID(), project_id: alpha, title: "Eins", sort: "a0" },
    { id: crypto.randomUUID(), project_id: alpha, title: "Zwei", sort: "a1" },
    { id: crypto.randomUUID(), project_id: alpha, title: "Drei", sort: "a2" },
  ];
  const m = await db.from("milestones").insert(milestones);
  if (m.error) throw new Error(m.error.message);
  const t = (name: string) => `${prefix} ${name}`;
  const titles = {
    over: t("Überfällig"),
    seven: t("Sieben Tage"),
    eight: t("Acht Tage"),
    prio: t("Hohe Priorität"),
    inbox: t("Inbox-Eintrag"),
    lose: t("Lose Aufgabe"),
    ki: t("KI lose"),
    a1: t("Alpha eins"),
    a2: t("Alpha zwei"),
    a3: t("Alpha drei"),
    a4: t("Alpha vier"),
  };
  await seedTasks([
    { title: titles.over, area_id: beruf, due_date: berlinAddDays(today, -5) },
    { title: titles.seven, area_id: beruf, due_date: berlinAddDays(today, 7) },
    { title: titles.eight, area_id: beruf, due_date: berlinAddDays(today, 8) },
    { title: titles.prio, area_id: beruf, priority: 1 },
    { title: titles.inbox, area_id: null, in_inbox: true },
    { title: titles.lose, area_id: beruf },
    { title: titles.ki, area_id: beruf },
    { title: titles.a1, area_id: beruf, project_id: alpha, milestone_id: milestones[0]?.id },
    { title: titles.a2, area_id: beruf, project_id: alpha, milestone_id: milestones[0]?.id },
    { title: titles.a3, area_id: beruf, project_id: alpha, milestone_id: milestones[1]?.id },
    { title: titles.a4, area_id: beruf, project_id: alpha, milestone_id: milestones[2]?.id },
    ...Array.from({ length: 9 }, (_, i) => ({
      title: t(`Gross ${i + 1}`),
      area_id: beruf,
      project_id: gross,
    })),
  ]);
  return {
    prefix,
    titles,
    cleanup: async () => {
      await db.from("tasks").delete().like("title", `${prefix}%`);
      await db.from("milestones").delete().eq("project_id", alpha);
      await db.from("projects").delete().in("id", [alpha, gross]);
    },
  };
}

const link = (scope: ReturnType<Page["locator"]>, title: string) =>
  scope.getByRole("link", { name: new RegExp(`^${title}`) });

test("Einplanen D: Jetzt-Block, jede Aufgabe einmal, Inbox, Projekte nach Meilenstein", async ({
  page,
}) => {
  const seeded = await seed(uniqueName("Plan62"));
  const { titles, prefix } = seeded;
  try {
    const plan = await openPlan(page);
    await expect(plan.getByTestId("plan-summary")).toHaveText(/^\d+ offen · \d+ jetzt$/);

    // Suche: geht über alles und klappt Treffer auf
    await plan.getByRole("searchbox", { name: "Aufgaben zum Einplanen suchen" }).fill(prefix);
    const now = plan.getByRole("region", { name: "Jetzt einplanen" });
    await expect(link(now, titles.over as string)).toBeVisible();
    await expect(link(now, titles.seven as string)).toBeVisible();
    await expect(link(now, titles.prio as string)).toBeVisible();
    // 8 Tage ist nicht mehr „jetzt“, Inbox und Projekte bleiben in ihrer Gruppe
    await expect(link(now, titles.eight as string)).toHaveCount(0);
    await expect(link(now, titles.inbox as string)).toHaveCount(0);
    await expect(
      link(plan.getByRole("region", { name: "Beruf · ohne Projekt" }), titles.eight as string),
    ).toBeVisible();
    await expect(
      link(plan.getByRole("region", { name: "Inbox" }), titles.inbox as string),
    ).toBeVisible();
    const alpha = plan.getByRole("region", { name: `${prefix} Alpha` });
    await expect(alpha).toContainText("Eins");
    await expect(link(alpha, titles.a1 as string)).toBeVisible();
    await expect(link(alpha, titles.a3 as string)).toBeVisible();
    // jede Aufgabe genau einmal
    for (const title of Object.values(titles)) {
      await expect(link(plan, title)).toHaveCount(1);
    }
    await expect(plan.getByTestId("plan-summary")).toHaveText(/^\d+ offen · \d+ jetzt$/);
    await expectNoHorizontalOverflow(page);

    // ohne Suche: nur der nächste Meilenstein offen, spätere als Zeile; das große Projekt ist zu
    await plan.getByRole("searchbox", { name: "Aufgaben zum Einplanen suchen" }).fill("");
    const alpha2 = plan.getByRole("region", { name: `${prefix} Alpha` });
    await expect(link(alpha2, titles.a1 as string)).toBeVisible();
    await expect(link(alpha2, titles.a3 as string)).toHaveCount(0);
    const later = alpha2.getByRole("button", { name: "+ 2 Meilensteine · 2 Aufgaben" });
    await expect(later).toBeVisible();
    await later.click();
    await expect(link(alpha2, titles.a3 as string)).toBeVisible();
    await expect(link(alpha2, titles.a4 as string)).toBeVisible();

    const big = plan.getByRole("button", { name: new RegExp(`^${prefix} Gross`) });
    await expect(big).toHaveAttribute("aria-expanded", "false");
    await expect(link(plan, `${prefix} Gross 1`)).toHaveCount(0);
    await big.click();
    await expect(big).toHaveAttribute("aria-expanded", "true");
    await expect(link(plan, `${prefix} Gross 1`)).toBeVisible();

    // Zeilen am Handy mindestens 44 px hoch
    if (isNarrow(page)) {
      const box = await plan.locator("[data-drag-task]").first().boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);

    // Klappzustand bleibt je Gerät erhalten
    await page.reload();
    const again = await (async () => {
      if (isNarrow(page)) {
        await page.getByRole("button", { name: "Einplanen" }).click();
        return page.getByRole("dialog", { name: "Einplanen" });
      }
      return page.getByRole("complementary", { name: "Einplanen" });
    })();
    await expect(
      again.getByRole("button", { name: new RegExp(`^${prefix} Gross`) }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      again
        .getByRole("region", { name: `${prefix} Alpha` })
        .getByRole("link", { name: new RegExp(`^${titles.a4}`) }),
    ).toBeVisible();
    await page.waitForTimeout(500);
    await expectNoA11yViolations(page);
  } finally {
    await seeded.cleanup();
  }
});

test("Einplanen D: Jetzt-Block zeigt höchstens 7 Zeilen, der Rest steht hinter „N weitere“", async ({
  page,
}) => {
  const prefix = uniqueName("Plan62n");
  const { beruf } = await areaIds();
  const tomorrow = berlinAddDays(berlinToday(), 1);
  await seedTasks(
    Array.from({ length: 9 }, (_, i) => ({
      title: `${prefix} Dringend ${i + 1}`,
      area_id: beruf,
      due_date: tomorrow,
    })),
  );
  try {
    const plan = await openPlan(page);
    const now = plan.getByRole("region", { name: "Jetzt einplanen" });
    await expect(now.locator("[data-drag-task]")).toHaveCount(7);
    const more = now.getByRole("button", { name: /^\d+ weitere$/ });
    await expect(more).toBeVisible();
    await more.click();
    expect(await now.locator("[data-drag-task]").count()).toBeGreaterThanOrEqual(9);
    await expect(now.getByRole("button", { name: "Weniger zeigen" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  } finally {
    await (await seedDb()).from("tasks").delete().like("title", `${prefix}%`);
  }
});

test("Einplanen D: Filter-Menü blendet „Von KI angelegt“ aus, die Suche findet es trotzdem", async ({
  page,
}) => {
  const seeded = await seed(uniqueName("Plan62k"));
  const { titles, prefix } = seeded;
  // der Trigger setzt „ai“ nur bei einem KI-Token (Migration 40): hier markiert der Abruf
  await page.route("**/rest/v1/tasks?*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    try {
      const response = await route.fetch();
      const rows = (await response.json()) as Array<{ title?: string; created_by?: string }>;
      if (Array.isArray(rows)) {
        for (const row of rows) if (row.title === titles.ki) row.created_by = "ai";
      }
      await route.fulfill({ response, json: rows });
    } catch {
      // Seite wurde währenddessen verlassen (Neuladen): Abruf ist hinfällig
      await route.abort().catch(() => {});
    }
  });
  try {
    const plan = await openPlan(page);
    await expect(link(plan, titles.ki as string)).toBeVisible();
    await expect(link(plan, titles.lose as string)).toBeVisible();

    await plan.getByRole("button", { name: "Einplanen-Anzeige" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Von KI angelegt" }).click();
    await page.keyboard.press("Escape");
    await expect(link(plan, titles.ki as string)).toHaveCount(0);
    await expect(link(plan, titles.lose as string)).toBeVisible();

    // Suche geht über alles
    await plan
      .getByRole("searchbox", { name: "Aufgaben zum Einplanen suchen" })
      .fill(`${prefix} KI`);
    await expect(link(plan, titles.ki as string)).toBeVisible();
    await plan.getByRole("searchbox", { name: "Aufgaben zum Einplanen suchen" }).fill("");

    // Inbox ausblenden, gemerkt nach dem Neuladen
    await plan.getByRole("button", { name: "Einplanen-Anzeige" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Inbox" }).click();
    await page.keyboard.press("Escape");
    await expect(link(plan, titles.inbox as string)).toHaveCount(0);
    await page.reload();
    const again = await (async () => {
      if (isNarrow(page)) {
        await page.getByRole("button", { name: "Einplanen" }).click();
        return page.getByRole("dialog", { name: "Einplanen" });
      }
      return page.getByRole("complementary", { name: "Einplanen" });
    })();
    await expect(link(again, titles.lose as string)).toBeVisible();
    await expect(link(again, titles.ki as string)).toHaveCount(0);
    await expect(link(again, titles.inbox as string)).toHaveCount(0);
  } finally {
    await seeded.cleanup();
  }
});

test("Einplanen D: Bereichs-Schalter blendet andere Bereiche aus und nennt, wie viele", async ({
  page,
}) => {
  const seeded = await seed(uniqueName("Plan62b"));
  const { titles } = seeded;
  // Bereich nicht in user_settings speichern (gemeinsamer Testnutzer, andere Tests laufen parallel)
  await page.route("**/rest/v1/user_settings?*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  try {
    await page.goto("/kalender?ansicht=woche");
    const nav = await openNavigation(page);
    await nav.getByRole("radio", { name: "Privat" }).click();
    if (isNarrow(page)) await page.keyboard.press("Escape");
    let plan: ReturnType<Page["locator"]>;
    if (isNarrow(page)) {
      await page.getByRole("button", { name: "Einplanen" }).click();
      plan = page.getByRole("dialog", { name: "Einplanen" });
    } else {
      plan = page.getByRole("complementary", { name: "Einplanen" });
    }
    await expect(plan.getByTestId("plan-hidden-areas")).toContainText(
      /weitere Aufgaben? in anderen Bereichen/,
    );
    await expect(link(plan, titles.lose as string)).toHaveCount(0);
    // die Inbox gehört keinem Bereich und bleibt
    await expect(link(plan, titles.inbox as string)).toBeVisible();
    await plan
      .getByTestId("plan-hidden-areas")
      .getByRole("button", { name: "Alle Bereiche zeigen" })
      .click();
    await expect(link(plan, titles.lose as string)).toBeVisible();
  } finally {
    await seeded.cleanup();
  }
});
