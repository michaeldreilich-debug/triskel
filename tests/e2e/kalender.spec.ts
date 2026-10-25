/**
 * Kalenderquellen (S2a) gegen das Testprojekt, Desktop 1440 px und Mobil 390 px: Einstellungen ›
 * Kalender – Adresse prüfen, Quelle anlegen, Probe-Abruf, Adresse verborgen, Termine über die
 * Schnittstelle /api/kalender (normalisiert auf Europe/Berlin, Status je Quelle, Adresse nie in
 * der Antwort), ausschalten, Papierkorb. Kein echter Google-Kalender: Die Quelle zeigt auf die
 * eigene Test-ICS unter /dev/ics (playwright.config.ts erlaubt den eigenen Ursprung).
 * Desktop und Mobil laufen parallel mit demselben Nutzer: jeder Test filtert auf seine Quelle.
 */
import { expect, test } from "@playwright/test";
import type { CalendarEvent, CalendarResponse } from "@/features/calendar/types";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";

test.use({ storageState: AUTH_FILE });

const RANGE = "von=2026-10-20&bis=2026-10-22";
const line = (e: CalendarEvent) => `${e.date} ${e.startMinutes ?? "ganztägig"} ${e.title}`;

test("Quelle anlegen, Probe-Abruf, Termine über /api/kalender, ausschalten, Papierkorb", async ({
  page,
  baseURL,
}) => {
  const name = uniqueName("Probe-Kalender");
  const url = `${baseURL}/dev/ics?name=probe`;
  await page.goto("/einstellungen#kalender");
  const section = page.getByRole("region", { name: "Kalender" });
  await expect(section).toBeVisible();

  // Prüfen vor dem Anlegen: liest die Test-ICS, nennt Name und Anzahl
  const form = section.getByRole("form", { name: "Kalender hinzufügen" });
  await form.getByLabel("Geheime Adresse im iCal-Format").fill(url);
  await form.getByRole("button", { name: "Prüfen" }).click();
  await expect(form.getByRole("status")).toContainText("„Probe-Kalender“");
  await expect(form.getByRole("status")).toContainText("in den nächsten 30 Tagen");
  await form.getByLabel("Name").fill(name);
  await form.getByRole("button", { name: "Kalender hinzufügen" }).click();

  const row = section
    .getByRole("list", { name: "Kalenderquellen" })
    .getByRole("listitem")
    .filter({ has: page.getByLabel(`Name des Kalenders „${name}“`) });
  await expect(row).toHaveCount(1);
  await expectSaved(page);
  const id = (await row.getAttribute("data-calendar-id")) as string;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  // Adresse verborgen, auf Wunsch sichtbar; Probe-Abruf in der Zeile
  const address = row.getByLabel(`Geheime Adresse von „${name}“`);
  await expect(address).toHaveAttribute("type", "password");
  await row.getByRole("button", { name: "Adresse zeigen" }).click();
  await expect(address).toHaveAttribute("type", "url");
  await expect(address).toHaveValue(url);
  await row.getByRole("button", { name: "Probe-Abruf" }).click();
  await expect(row.getByRole("status")).toContainText("Termine in den nächsten 30 Tagen");
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  // Schnittstelle für die Ansichten (S2b/S2c): Termine im Zeitraum, Europe/Berlin
  const response = await page.request.get(`/api/kalender?${RANGE}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as CalendarResponse;
  expect(body.range).toEqual({ start: "2026-10-20", end: "2026-10-22" });
  expect(body.events.filter((e) => e.sourceId === id).map(line)).toEqual([
    "2026-10-20 960 Call New York",
    "2026-10-21 540 Online-Schulung",
    "2026-10-22 1110 Übung",
  ]);
  expect(body.sources.find((s) => s.id === id)).toEqual({
    id,
    name,
    color: "blau",
    count: 3,
    error: null,
  });
  // die geheime Adresse verlässt den Server nie
  expect(JSON.stringify(body)).not.toContain("/dev/ics");

  // ausgeschaltet: die Quelle wird nicht mehr geladen
  await row.getByLabel(`Kalender „${name}“ anzeigen`).click();
  await expectSaved(page);
  const off = (await (await page.request.get(`/api/kalender?${RANGE}`)).json()) as CalendarResponse;
  expect(off.sources.some((s) => s.id === id)).toBe(false);

  // Papierkorb mit Rückgängig, dann endgültig in der Papierkorb-Liste
  await row.getByRole("button", { name: `Kalender „${name}“ in den Papierkorb` }).click();
  await expect(row).toHaveCount(0);
  await expectSaved(page);
  await page.goto("/papierkorb");
  await page.getByRole("textbox", { name: "Papierkorb durchsuchen" }).fill(name);
  const trashed = page.getByRole("list", { name: "Papierkorb" }).locator(`[data-trash-id="${id}"]`);
  await expect(trashed).toContainText("Kalender");
});

test("Fremde Adressen werden abgelehnt; die Schnittstelle verlangt Zeitraum und Anmeldung", async ({
  page,
  playwright,
  baseURL,
}) => {
  await page.goto("/einstellungen#kalender");
  const form = page
    .getByRole("region", { name: "Kalender" })
    .getByRole("form", { name: "Kalender hinzufügen" });
  await form.getByLabel("Geheime Adresse im iCal-Format").fill("https://example.com/kalender.ics");
  await form.getByRole("button", { name: "Prüfen" }).click();
  await expect(form.getByRole("alert")).toContainText("calendar.google.com");

  const noRange = await page.request.get("/api/kalender");
  expect(noRange.status()).toBe(400);
  const probe = await page.request.post("/api/kalender/probe", {
    data: { url: "http://169.254.169.254/latest/meta-data" },
  });
  expect(probe.ok()).toBe(true);
  expect(((await probe.json()) as { ok: boolean }).ok).toBe(false);

  // ohne Sitzung: kein Zugriff (der Proxy leitet zur Anmeldung, nie Daten)
  // ausdrücklich ohne die Sitzung aus test.use (sie gälte sonst auch hier)
  const anonymous = await playwright.request.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  const anon = await anonymous.get(`/api/kalender?${RANGE}`, { maxRedirects: 0 });
  expect(anon.status()).toBeGreaterThanOrEqual(300);
  const anonProbe = await anonymous.post("/api/kalender/probe", {
    data: { url: "https://calendar.google.com/calendar/ical/x/basic.ics" },
    maxRedirects: 0,
  });
  expect(anonProbe.status()).toBeGreaterThanOrEqual(300);
  await anonymous.dispose();
});
