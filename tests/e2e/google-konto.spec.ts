/**
 * Google-Konto (#64, N1a) gegen das Testprojekt und den Google-Ersatz /dev/google (nie ein
 * echtes Google; Test-Werte in playwright.config.ts): Einstellungen › Kalender › „Mit Google
 * verbinden“ (state + PKCE), Kalenderliste an/aus und Farbe, Stand nach Neuladen, Trennen mit
 * Widerruf; Abbrechen, fehlende Berechtigung, in Google widerrufen → „Neu verbinden“; Cookie,
 * Weiterleitung und Routenschutz; fehlende Vercel-Werte → Hinweis; 390 px mit „ersetzt durch
 * Google“.
 *
 * Google-Termine verschieben (#64, N1b) – ebenfalls hier, weil sie dieselbe Verbindung brauchen
 * und nie neben den Tests oben laufen dürfen (eine Zeile je Nutzer; Playwright serialisiert nur
 * innerhalb einer Datei): Termin auf andere Uhrzeit/Tag ziehen, Dauer ziehen, ganztägig nur auf
 * einen Tag, Serie nur diese Instanz, nur lesbar fest, Rückgängig, Konflikt (etag), „Verschieben
 * auf …“ und Uhrzeit im Termin-Fenster, ersetzte iCal-Quelle nicht doppelt; Mobil (390 px) mit
 * abgefangenen Antworten.
 *
 * Google-Termine anlegen, ändern, löschen (#64, N1c) – ebenfalls hier: im Raster klicken/ziehen und
 * „＋ Termin“ (ganztägig, nur beschreibbare Kalender wählbar), Titel/Ort ändern, Kalender wechseln,
 * löschen (Rechtsklick, Entf, Knopf; Serie nur diese Instanz), jeweils mit Rückgängig (Löschen:
 * aus Googles Papierkorb, sonst neu angelegt); Routen; Mobil (390 px) mit „＋ Termin“-Sheet.
 *
 * Das Google-Konto ist eine Zeile je Nutzer – Desktop und Mobil laufen parallel mit demselben
 * Testnutzer. Deshalb verbinden nur die Desktop-Tests wirklich (nacheinander); Mobil fängt
 * /api/google/* und die Kalenderquellen per page.route ab und schreibt nichts.
 */
import { expect, type Page, test } from "@playwright/test";
import { berlinDateTime } from "@/lib/dates";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { expectSaved } from "./support/app";
import { AUTH_FILE, uniqueName } from "./support/auth";
import {
  areaIds,
  deleteCalendarSource,
  seedCalendarSource,
  seedDb,
  seedNotes,
  seedTasks,
} from "./support/seed";
import { freshContext } from "./support/session";

test.use({ storageState: AUTH_FILE });

const PRIMARY = "e2e-alex@example.com";
const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const section = (page: Page) => page.getByRole("region", { name: "Kalender" });
const googleList = (page: Page) => section(page).getByRole("list", { name: "Google-Kalender" });
const calendarRow = (page: Page, name: string) =>
  googleList(page).getByRole("listitem").filter({ hasText: name });
const head = (page: Page) =>
  section(page).getByRole("heading", { level: 2, name: "Kalender" }).getByRole("button");
const connectLink = (page: Page) =>
  section(page).getByRole("link", { name: "Mit Google verbinden" });

async function fake(page: Page, action: string, data?: unknown) {
  const response = await page.request.post(`/dev/google/_test/${action}`, { data: data ?? {} });
  expect(response.ok(), action).toBe(true);
}

async function fakeState(page: Page) {
  return (await (await page.request.get("/dev/google/_test/state")).json()) as {
    refreshTokens: { live: number; revoked: number };
    revokeCalls: number;
  };
}

/** Sauberer Anfang: Google-Ersatz leer, Konto getrennt. */
async function startDisconnected(page: Page) {
  await fake(page, "reset");
  expect((await page.request.post("/api/google/disconnect")).ok()).toBe(true);
  await page.goto("/einstellungen#kalender");
  await expect(connectLink(page)).toBeVisible();
}

test.describe("verbinden mit dem Google-Ersatz @desktop", () => {
  // eine Zeile je Nutzer: diese Tests nacheinander in einem Worker
  test.describe.configure({ mode: "serial" });

  test("verbinden, Kalender an/aus und Farbe, Stand nach Neuladen, trennen mit Widerruf", async ({
    page,
  }) => {
    await startDisconnected(page);
    await connectLink(page).click();
    // zurück in Einstellungen › Kalender, Rückmeldung einmal, Adresse ohne ?google=
    await expect(page.getByTestId("google-return")).toContainText("Mit Google verbunden.");
    await expect(page).toHaveURL(/\/einstellungen#kalender$/);
    await expect(section(page).getByTestId("google-connected")).toContainText(
      `Verbunden als ${PRIMARY}`,
    );
    await expect(head(page)).toHaveAttribute("aria-expanded", "true");

    // Kalenderliste: primärer (beschreibbar) und ein nur lesbarer
    await expect(googleList(page).getByRole("listitem")).toHaveCount(2);
    await expect(calendarRow(page, "E2E-Hauptkalender")).toContainText("Hauptkalender");
    await expect(calendarRow(page, "E2E-Feiertage")).toContainText("In Google nur lesbar");
    await expect(calendarRow(page, "E2E-Hauptkalender")).not.toContainText("nur lesbar");

    // einschalten → Zeile kind = google; Farbe ändern
    const show = page.getByLabel("Google-Kalender „E2E-Hauptkalender“ anzeigen");
    await show.click();
    await expect(show).toBeChecked();
    await expectSaved(page);
    const color = page.getByRole("combobox", { name: "Farbe von „E2E-Hauptkalender“" });
    await color.click();
    await page.getByRole("option", { name: "Lila" }).click();
    await expect(color).toContainText("Lila");
    await expectSaved(page);
    await expectNoHorizontalOverflow(page);
    await page.waitForTimeout(300);
    await expectNoA11yViolations(page);

    // Stand nach Neuladen: verbunden, eingeschaltet, Farbe – ohne Rückmeldung
    await page.reload();
    await expect(section(page).getByTestId("google-connected")).toContainText(PRIMARY);
    await expect(page.getByTestId("google-return")).toHaveCount(0);
    await expect(page.getByLabel("Google-Kalender „E2E-Hauptkalender“ anzeigen")).toBeChecked();
    await expect(page.getByLabel("Google-Kalender „E2E-Feiertage“ anzeigen")).not.toBeChecked();
    await expect(
      page.getByRole("combobox", { name: "Farbe von „E2E-Hauptkalender“" }),
    ).toContainText("Lila");
    // zugeklappt nennt der Kopf den Stand
    await head(page).click();
    await expect(head(page)).toHaveAttribute("aria-expanded", "false");
    await expect(head(page)).toContainText("Google verbunden ·");
    await head(page).click();
    await expect(head(page)).toHaveAttribute("aria-expanded", "true");

    // Schnittstellen nennen nie einen Token
    const status = await page.request.get("/api/google/status");
    const statusBody = (await status.json()) as Record<string, unknown>;
    expect(Object.keys(statusBody).sort()).toEqual([
      "configError",
      "configured",
      "connected",
      "connectedAt",
      "email",
    ]);
    expect(statusBody).toMatchObject({ configured: true, connected: true, email: PRIMARY });
    const calendars = await page.request.get("/api/google/calendars");
    const text = await calendars.text();
    expect(calendars.ok()).toBe(true);
    for (const secret of ["ya29", "1//", "refresh", "v1:"]) expect(text).not.toContain(secret);
    expect((await fakeState(page)).refreshTokens.live).toBe(1);

    // Termine kommen über Google (der Server merkt sie sich 60 s) – nach dem Trennen sofort
    // nicht mehr (G-5)
    const cacheTitle = uniqueName("Cache");
    const seeded = await page.request.post("/dev/google/_test/seed", {
      data: {
        calendarId: PRIMARY,
        events: [
          {
            summary: cacheTitle,
            start: { dateTime: "2027-01-12T09:00:00.000Z", timeZone: "Europe/Berlin" },
            end: { dateTime: "2027-01-12T10:00:00.000Z", timeZone: "Europe/Berlin" },
          },
        ],
      },
    });
    expect(seeded.ok()).toBe(true);
    const titlesIn2027 = async () =>
      (
        (await (await page.request.get("/api/kalender?von=2027-01-11&bis=2027-01-17")).json()) as {
          events: Array<{ title: string }>;
        }
      ).events.map((e) => e.title);
    expect(await titlesIn2027()).toContain(cacheTitle);

    // trennen mit Rückfrage (kein Browser-Dialog) → Widerruf bei Google
    await section(page).getByRole("button", { name: "Google-Konto trennen" }).click();
    await expect(section(page).getByText("Google wirklich trennen?")).toBeVisible();
    await section(page).getByRole("button", { name: "Abbrechen" }).click();
    await expect(section(page).getByTestId("google-connected")).toBeVisible();
    await section(page).getByRole("button", { name: "Google-Konto trennen" }).click();
    await section(page).getByRole("button", { name: "Trennen", exact: true }).click();
    await expect(connectLink(page)).toBeVisible();
    await expect(googleList(page)).toHaveCount(0);
    const after = await fakeState(page);
    expect(after.refreshTokens).toEqual({ live: 0, revoked: 1 });
    expect(after.revokeCalls).toBe(1);
    expect(
      ((await (await page.request.get("/api/google/status")).json()) as { connected: boolean })
        .connected,
    ).toBe(false);
    expect(await titlesIn2027()).not.toContain(cacheTitle);
    await page.reload();
    await expect(connectLink(page)).toBeVisible();
  });

  test("abgebrochen, Berechtigung fehlt, in Google widerrufen → „Neu verbinden“", async ({
    page,
  }) => {
    await startDisconnected(page);

    // bei Google abgebrochen
    await fake(page, "next", { deny: true });
    await connectLink(page).click();
    await expect(page.getByTestId("google-return")).toContainText("abgebrochen");
    await expect(page.getByTestId("google-return")).toHaveAttribute("role", "alert");
    await expect(connectLink(page)).toBeVisible();

    // nur ein Häkchen gesetzt → nicht verbunden, Hinweis
    await fake(page, "next", { scope: EVENTS_SCOPE });
    await connectLink(page).click();
    await expect(page.getByTestId("google-return")).toContainText("nicht alle Berechtigungen");
    await expect(connectLink(page)).toBeVisible();
    await page.getByRole("button", { name: "Hinweis schließen" }).click();
    await expect(page.getByTestId("google-return")).toHaveCount(0);

    // verbinden, dann in Google entfernt → neu verbinden
    await connectLink(page).click();
    await expect(section(page).getByTestId("google-connected")).toBeVisible();
    await expect(googleList(page)).toBeVisible();
    await fake(page, "revoke-all");
    await page.reload();
    const reconnect = section(page).getByTestId("google-reconnect");
    await expect(reconnect).toContainText("bitte neu verbinden");
    await expect(googleList(page)).toHaveCount(0);
    const calendars = await page.request.get("/api/google/calendars");
    expect(calendars.status()).toBe(409);
    expect(await calendars.json()).toMatchObject({ state: "reconnect" });
    await expectNoA11yViolations(page);
    await reconnect.getByRole("link", { name: "Neu verbinden" }).click();
    await expect(page.getByTestId("google-return")).toContainText("Mit Google verbunden.");
    await expect(googleList(page).getByRole("listitem")).toHaveCount(2);

    expect((await page.request.post("/api/google/disconnect")).ok()).toBe(true);
  });

  test("Anmelde-Cookie, Weiterleitung zu Google, falscher state, fremder Ursprung, ohne Sitzung", async ({
    page,
    playwright,
    baseURL,
  }) => {
    // Start: Weiterleitung mit PKCE S256 und beiden Berechtigungen, ohne Clientschlüssel
    const start = await page.request.get("/api/google/start", { maxRedirects: 0 });
    expect(start.status()).toBe(303);
    const target = new URL(start.headers().location as string);
    expect(`${target.origin}${target.pathname}`).toBe(`${baseURL}/dev/google/oauth/auth`);
    const params = Object.fromEntries(target.searchParams);
    expect(params).toMatchObject({
      client_id: "e2e-schaltzentrale.apps.googleusercontent.com",
      redirect_uri: `${baseURL}/api/google/callback`,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      code_challenge_method: "S256",
    });
    expect(params.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.scope?.split(" ").sort()).toEqual([
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      EVENTS_SCOPE,
    ]);
    expect(target.search).not.toContain("client_secret");
    const cookie = start.headers()["set-cookie"] ?? "";
    // verschlüsselt (v1:…; Next kodiert den Doppelpunkt im Cookie als %3A)
    expect(cookie).toMatch(/sz-google-oauth=v1(?::|%3A)/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/google/i);
    expect(cookie).not.toContain(params.state as string);

    // Rückkehr mit falschem state → abgelehnt, Cookie gelöscht, nichts verbunden
    const wrong = await page.request.get(`/api/google/callback?code=x&state=${"a".repeat(43)}`, {
      maxRedirects: 0,
    });
    expect(wrong.status()).toBe(303);
    expect(wrong.headers().location).toBe(`${baseURL}/einstellungen?google=abgelaufen#kalender`);
    expect(wrong.headers()["set-cookie"] ?? "").toMatch(/sz-google-oauth=;.*Max-Age=0/i);

    // Trennen nur von der eigenen Seite
    const foreign = await page.request.post("/api/google/disconnect", {
      headers: { origin: "https://evil.example" },
    });
    expect(foreign.status()).toBe(403);

    // ohne Sitzung: alles leitet zur Anmeldung, nie Daten
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    for (const path of [
      "/api/google/start",
      "/api/google/callback?code=x&state=y",
      "/api/google/status",
      "/api/google/calendars",
    ]) {
      const response = await anonymous.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBeGreaterThanOrEqual(300);
      expect(response.status(), path).toBeLessThan(400);
      expect(response.headers().location ?? "", path).toContain("/login");
    }
    const anonDisconnect = await anonymous.post("/api/google/disconnect", { maxRedirects: 0 });
    expect(anonDisconnect.status()).toBeGreaterThanOrEqual(300);
    expect(anonDisconnect.status()).toBeLessThan(400);
    await anonymous.dispose();
  });
  /* ---------------------------------------------------------------- */
  /* Google-Termine verschieben (#64, N1b)                             */
  /* ---------------------------------------------------------------- */

  const READONLY = "e2e-feiertage@group.v.calendar.google.com";
  const PRIVATE = "e2e-privat@example.com";
  const CALENDAR_NAMES: Record<string, string> = {
    [PRIMARY]: "E2E-Hauptkalender",
    [READONLY]: "E2E-Feiertage",
    [PRIVATE]: "E2E-Privat",
  };
  // Woche 7.–13.12.2026 (Winterzeit): sonst belegt keiner dieser Tage Termine anderer Tests
  const DAY = "2026-12-09";
  const NOW = berlinDateTime(DAY, "09:00");
  const slotId = (date: string, minutes: number) => `slot:${date}:${minutes}`;

  type FakeEvent = {
    id: string;
    etag: string;
    summary?: string;
    location?: string;
    description?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
  };
  type FakeState = {
    ops: Array<{
      op: "insert" | "delete" | "move" | "restore";
      calendarId: string;
      eventId: string;
      ifMatch: string | null;
      sendUpdates: string | null;
      destination?: string;
    }>;
    trash: string[];
    patches: Array<{
      calendarId: string;
      eventId: string;
      ifMatch: string | null;
      sendUpdates: string | null;
      fields: string[];
    }>;
    items?: FakeEvent[];
  };

  const hexId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  async function seedFake(page: Page, calendarId: string, events: object[]) {
    const response = await page.request.post("/dev/google/_test/seed", {
      data: { calendarId, events },
    });
    expect(response.ok()).toBe(true);
    // der Server merkt sich Google-Antworten 60 s: Test-Woche neu holen, sonst sähe die Seite den
    // Stand eines vorigen Tests
    await page.request.get("/api/kalender?von=2026-12-07&bis=2026-12-13&frisch=1");
    return ((await response.json()) as { events: FakeEvent[] }).events;
  }
  const googleState = async (page: Page, calendarId: string) =>
    (await (
      await page.request.get(`/dev/google/_test/state?calendar=${encodeURIComponent(calendarId)}`)
    ).json()) as FakeState;
  const googleEvent = async (page: Page, calendarId: string, id: string) =>
    (await googleState(page, calendarId)).items?.find((e) => e.id === id);

  const timed = (title: string, date: string, from: string, to: string, extra = {}) => ({
    id: hexId(),
    summary: title,
    start: { dateTime: berlinDateTime(date, from), timeZone: "Europe/Berlin" },
    end: { dateTime: berlinDateTime(date, to), timeZone: "Europe/Berlin" },
    ...extra,
  });

  /** Frischer Anfang: Ersatz leer, Google-Quellen weg, verbunden, Kalender eingeschaltet. */
  async function startConnected(page: Page, calendars: string[] = [PRIMARY]) {
    await fake(page, "reset");
    if (calendars.includes(PRIVATE)) {
      await fake(page, "add-calendar", { id: PRIVATE, summary: "E2E-Privat" });
    }
    expect((await page.request.post("/api/google/disconnect")).ok()).toBe(true);
    const db = await seedDb();
    await db.from("calendar_sources").delete().eq("kind", "google");
    await page.goto("/api/google/start");
    await expect(page.getByTestId("google-return")).toContainText("Mit Google verbunden.");
    const ids: string[] = [];
    for (const calendarId of calendars) {
      const id = crypto.randomUUID();
      const { error } = await db.from("calendar_sources").insert({
        id,
        kind: "google",
        google_calendar_id: calendarId,
        name: CALENDAR_NAMES[calendarId] ?? calendarId,
        url: null,
        color: calendarId === PRIMARY ? "lila" : "gruen",
        enabled: true,
        sort: `zz${hexId()}`,
      });
      if (error) throw new Error(`Google-Quelle: ${error.message}`);
      ids.push(id);
    }
    // Server-Cache (60 s) der Test-Woche frisch: Er gilt je Instanz – ob „Trennen“/„Verbinden“
    // ihn in der Kalender-Route leeren, hängt davon ab, ob Next die Module teilt (N4)
    await page.request.get("/api/kalender?von=2026-12-07&bis=2026-12-13&frisch=1");
    return ids;
  }

  async function finish(page: Page, ids: string[]) {
    for (const id of ids) await deleteCalendarSource(id);
    await page.request.post("/api/google/disconnect");
  }

  /** Ziehen mit der Maus (dnd-kit ab 6 px), wie in kalender-ansicht.spec.ts. */
  async function drag(p: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    await p.waitForTimeout(80);
    await p.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
    await p.waitForTimeout(80);
    await p.mouse.move(to.x, to.y, { steps: 20 });
    await p.waitForTimeout(120);
    await p.mouse.up();
  }
  async function top(locator: ReturnType<Page["locator"]>) {
    const box = await locator.boundingBox({ timeout: 5_000 });
    if (!box) throw new Error("Element nicht sichtbar");
    return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 6) };
  }

  async function openWeek(browser: import("@playwright/test").Browser, baseURL: string) {
    const context = await freshContext(browser, baseURL, {
      viewport: { width: 1440, height: 1400 },
      clockUntil: new Date("2026-12-31T00:00:00Z"),
    });
    const p = await context.newPage();
    // nur die Google-Termine dieses Tests: Eingeschaltete iCal-Quellen paralleler Tests desselben
    // Nutzers (z. B. die tägliche „Lagebesprechung“ samt ganztägiger „Rufbereitschaft“ aus
    // today.spec) erschienen sonst je nach Zeitpunkt in der Woche und verschoben mitten im Test
    // das Raster unter Klick und Ziehen (N4). Die Antwort kommt echt vom Server, nur gefiltert.
    const ours = new Set(Object.values(CALENDAR_NAMES));
    await p.route("**/api/kalender?*", async (route) => {
      try {
        const response = await route.fetch();
        const body = (await response.json()) as {
          events: Array<{ google?: unknown }>;
          sources: Array<{ name: string }>;
        };
        await route.fulfill({
          response,
          json: {
            ...body,
            events: body.events.filter((e) => e.google),
            sources: body.sources.filter((s) => ours.has(s.name)),
          },
        });
      } catch {
        // Testende: Kontext schon geschlossen, die Anfrage braucht niemand mehr
        await route.abort().catch(() => {});
      }
    });
    await p.clock.setFixedTime(new Date(NOW));
    await p.goto(`/kalender?ansicht=woche&tag=${DAY}`);
    await expect(p.getByRole("heading", { level: 1, name: /20\d\d/ })).toBeVisible();
    // Seite zur Ruhe kommen lassen (Schriften, Raster), bevor der erste Zug startet
    await p.waitForTimeout(800);
    return { context, p };
  }

  const chip = (p: Page, title: string, time?: string) =>
    p.getByRole("button", { name: new RegExp(`^${title}, ${time ?? ""}`) });
  const block = (p: Page, id: string) => p.locator(`[data-drag-event="${id}"]`);

  test("Google-Termin ziehen: andere Uhrzeit, Rückgängig mit neuem etag, Dauer ziehen", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const ids = await startConnected(page);
    const title = uniqueName("Ziehen");
    const [event] = await seedFake(page, PRIMARY, [timed(title, DAY, "10:00", "11:00")]);
    const id = (event as FakeEvent).id;
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();

      // auf 14:00 ziehen → Google geändert (Dauer bleibt), If-Match, keine Benachrichtigung
      const slot = p.locator(`[data-drop-target="${slotId(DAY, 840)}"]`);
      await drag(p, await top(block(p, id)), await top(slot));
      await expect(p.getByText(`„${title}“ → heute, 14:00–15:00`)).toBeVisible();
      await expect(chip(p, title, "14:00–15:00")).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.start.dateTime)
        .toBe("2026-12-09T13:00:00.000Z");
      const moved = await googleEvent(page, PRIMARY, id);
      expect(moved?.end.dateTime).toBe("2026-12-09T14:00:00.000Z");
      const first = (await googleState(page, PRIMARY)).patches.at(-1);
      expect(first).toMatchObject({
        eventId: id,
        ifMatch: (event as FakeEvent).etag,
        sendUpdates: "none",
        fields: ["end", "start"],
      });

      // Rückgängig: alte Zeiten, mit dem etag der ersten Änderung
      await p.getByRole("button", { name: "Rückgängig" }).click();
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.start.dateTime)
        .toBe("2026-12-09T09:00:00.000Z");
      const patches = (await googleState(page, PRIMARY)).patches.filter((x) => x.eventId === id);
      expect(patches).toHaveLength(2);
      expect(patches[1]?.ifMatch).toBe(moved?.etag);

      // Dauer am unteren Rand: +1 h (40 px je Stunde im Wochenraster)
      const handle = p.getByRole("button", { name: `Dauer von „${title}“ ändern (1 h)` });
      const box = await handle.boundingBox();
      if (!box) throw new Error("Griff nicht sichtbar");
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.down();
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 10 });
      await p.mouse.up();
      await expect(p.getByText(`„${title}“ → heute, 10:00–12:00`)).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.end.dateTime)
        .toBe("2026-12-09T11:00:00.000Z");
      expect((await googleEvent(page, PRIMARY, id))?.start.dateTime).toBe(
        "2026-12-09T09:00:00.000Z",
      );
      // nur ein Patch je Änderung (erst beim Loslassen, kein Doppel)
      expect(
        (await googleState(page, PRIMARY)).patches.filter((x) => x.eventId === id),
      ).toHaveLength(3);
      await expectNoHorizontalOverflow(p);
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  test("ganztägig nur auf einen Tag, Serie nur diese Instanz, nur lesbar bleibt fest", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const ids = await startConnected(page, [PRIMARY, READONLY]);
    const allDay = uniqueName("Ganztag");
    const series = uniqueName("Serie");
    const fixed = uniqueName("Feiertag");
    const [a] = await seedFake(page, PRIMARY, [
      { id: hexId(), summary: allDay, start: { date: "2026-12-10" }, end: { date: "2026-12-11" } },
    ]);
    const [s] = await seedFake(page, PRIMARY, [
      timed(series, "2026-12-08", "15:00", "16:00", { recurringEventId: "serie1abcdef" }),
    ]);
    const [f] = await seedFake(page, READONLY, [timed(fixed, DAY, "14:00", "15:00")]);
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      await expect(chip(p, allDay)).toBeVisible();
      await expect(chip(p, fixed, "14:00–15:00")).toBeVisible();

      // ganztägig: auf eine Uhrzeit nicht (Hinweis, nichts geändert) …
      const allDayBlock = block(p, (a as FakeEvent).id);
      await drag(
        p,
        await top(allDayBlock),
        await top(p.locator(`[data-drop-target="${slotId("2026-12-11", 600)}"]`)),
      );
      await expect(
        p.getByText("Ganztägige Termine lassen sich nur auf einen anderen Tag ziehen."),
      ).toBeVisible();
      expect((await googleState(page, PRIMARY)).patches).toHaveLength(0);
      // … aber auf einen anderen Tag (Freitag 11.12.)
      await drag(
        p,
        await top(allDayBlock),
        await top(p.locator('[data-drop-target="day:2026-12-11:allday"]')),
      );
      await expect(p.getByText(`„${allDay}“ →`)).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, (a as FakeEvent).id))?.start.date)
        .toBe("2026-12-11");
      expect((await googleEvent(page, PRIMARY, (a as FakeEvent).id))?.end.date).toBe("2026-12-12");

      // Serie: gepatcht wird die Instanz (ihre ID), nicht die Serie
      const serieSlot = p.locator(`[data-drop-target="${slotId("2026-12-08", 600)}"]`);
      await drag(p, await top(block(p, (s as FakeEvent).id)), await top(serieSlot));
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, (s as FakeEvent).id))?.start.dateTime)
        .toBe("2026-12-08T09:00:00.000Z");
      const last = (await googleState(page, PRIMARY)).patches.at(-1);
      expect(last?.eventId).toBe((s as FakeEvent).id);
      expect(last?.eventId).not.toBe("serie1abcdef");

      // nur lesbar: fest (kein Ziehen, kein Griff, normaler Zeiger), Hinweis im Fenster
      const fixedBlock = p.locator("[data-event-fixed]").filter({ hasText: fixed });
      await expect(fixedBlock).toBeVisible();
      await expect(p.locator(`[data-drag-event="${(f as FakeEvent).id}"]`)).toHaveCount(0);
      await expect(p.getByRole("button", { name: new RegExp(`Dauer von „${fixed}“`) })).toHaveCount(
        0,
      );
      const cursor = await fixedBlock
        .getByRole("button")
        .evaluate((el) => getComputedStyle(el).cursor);
      expect(cursor).not.toBe("grab");
      const before = (await googleState(page, READONLY)).patches.length;
      await drag(
        p,
        await top(fixedBlock),
        await top(p.locator(`[data-drop-target="${slotId(DAY, 960)}"]`)),
      );
      await p.waitForTimeout(500);
      expect((await googleState(page, READONLY)).patches).toHaveLength(before);
      await chip(p, fixed, "14:00–15:00").click();
      await expect(p.getByTestId("event-fixed")).toContainText("In Google nur lesbar");
      await expect(p.getByTestId("event-move")).toHaveCount(0);
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  test("Konflikt: in Google geändert → Hinweis, Ansicht neu geladen, danach geht es", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const ids = await startConnected(page);
    const title = uniqueName("Konflikt");
    const [event] = await seedFake(page, PRIMARY, [timed(title, DAY, "10:00", "11:00")]);
    const id = (event as FakeEvent).id;
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();
      // inzwischen in Google geändert (etag ändert sich, die Ansicht weiß nichts davon)
      expect(
        (
          await page.request.post("/dev/google/_test/touch", {
            data: { calendarId: PRIMARY, eventId: id },
          })
        ).ok(),
      ).toBe(true);
      const slot = p.locator(`[data-drop-target="${slotId(DAY, 840)}"]`);
      await drag(p, await top(block(p, id)), await top(slot));
      await expect(
        p.getByText("Der Termin wurde inzwischen in Google geändert – neu geladen"),
      ).toBeVisible();
      // neu geladen: wieder an der Google-Stelle, nichts überschrieben
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();
      expect((await googleEvent(page, PRIMARY, id))?.start.dateTime).toBe(
        "2026-12-09T09:00:00.000Z",
      );
      // mit dem frischen etag klappt das Verschieben
      await p.waitForTimeout(500);
      await drag(p, await top(block(p, id)), await top(slot));
      await expect(chip(p, title, "14:00–15:00")).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.start.dateTime)
        .toBe("2026-12-09T13:00:00.000Z");
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  test("Termin-Fenster: Verschieben auf … (morgen) und Uhrzeit/Dauer, je mit Rückgängig", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const ids = await startConnected(page);
    const title = uniqueName("Fenster");
    const [event] = await seedFake(page, PRIMARY, [timed(title, DAY, "10:00", "11:00")]);
    const id = (event as FakeEvent).id;
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      await chip(p, title, "10:00–11:00").click();
      const panel = p.getByTestId("event-move");
      await expect(panel).toBeVisible();
      await panel.getByRole("button", { name: "Morgen" }).click();
      await expect(p.getByText(`„${title}“ → morgen, 10:00–11:00`)).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.start.dateTime)
        .toBe("2026-12-10T09:00:00.000Z");
      await p.getByRole("button", { name: "Rückgängig" }).click();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.start.dateTime)
        .toBe("2026-12-09T09:00:00.000Z");

      // Uhrzeit und Dauer
      await chip(p, title, "10:00–11:00").click();
      const panel2 = p.getByTestId("event-move");
      await panel2.getByLabel("Beginn (Uhrzeit)").fill("11:30");
      await panel2.getByLabel("Dauer").selectOption("30");
      await panel2.getByRole("button", { name: "Uhrzeit übernehmen" }).click();
      await expect(p.getByText(`„${title}“ → heute, 11:30–12:00`)).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.start.dateTime)
        .toBe("2026-12-09T10:30:00.000Z");
      expect((await googleEvent(page, PRIMARY, id))?.end.dateTime).toBe("2026-12-09T11:00:00.000Z");

      // Datum wählen (Kalender im Fenster)
      await chip(p, title, "11:30–12:00").click();
      await p.getByRole("button", { name: "Anderes Datum wählen" }).click();
      await p.getByRole("button", { name: /11\. Dezember 2026/ }).click();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.start.dateTime)
        .toBe("2026-12-11T10:30:00.000Z");
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Termine mit Aufgaben und Notizen verknüpfen (#68)                  */
  /* ---------------------------------------------------------------- */

  test("verknüpfen: Notiz zum Termin mit Kopf, Vorhandenes, Lösen mit Rückgängig, gelöschter Termin bleibt verknüpft", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const ids = await startConnected(page);
    const title = uniqueName("Verknuepft");
    await seedFake(page, PRIMARY, [timed(title, DAY, "10:00", "11:00")]);
    const { beruf } = await areaIds();
    const [taskId] = await seedTasks([{ title: `${title} Geräte prüfen`, area_id: beruf }]);
    const noteTitle = `${title} 09.12. – Protokoll`;
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      // Notiz zum Termin: Protokoll mit Vorlage, Kopf mit dem Termin
      await chip(p, title, "10:00–11:00").click();
      const links = p.getByTestId("event-links");
      await expect(links).toBeVisible();
      await links.getByRole("button", { name: "Notiz zum Termin" }).click();
      await expect(p).toHaveURL(/\/wissen\//);
      await expect(p.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(noteTitle);
      const head = p.getByTestId("linked-event");
      await expect(head).toContainText(`Mi, 09.12. 10:00–11:00 · ${title}`);
      await expect(p.getByText("Teilnehmende")).toBeVisible();
      await expectSaved(p);
      await expectNoHorizontalOverflow(p);

      // Kopf → Kalender (Tag) mit offenem Termin-Fenster, die Notiz steht unter „Verknüpft“
      await head.getByRole("link").click();
      await expect(p).toHaveURL(/ansicht=tag/);
      const section = p.getByTestId("event-links");
      await expect(section.getByRole("link", { name: noteTitle })).toBeVisible();

      // vorhandene Aufgabe verknüpfen
      await section
        .getByRole("button", { name: "Vorhandene Notiz oder Aufgabe verknüpfen" })
        .click();
      await p.getByRole("combobox", { name: "Notiz oder Aufgabe suchen" }).fill(`${title} Geräte`);
      await p.getByRole("option", { name: new RegExp(`${title} Geräte prüfen`) }).click();
      const taskLink = section.getByRole("link", { name: `${title} Geräte prüfen` });
      await expect(taskLink).toBeVisible();
      await expectSaved(p);

      // lösen (nur die Verknüpfung) und Rückgängig
      await section
        .getByRole("button", { name: `Verknüpfung mit „${title} Geräte prüfen“ lösen` })
        .click();
      await expect(taskLink).toHaveCount(0);
      // der Klick in die Meldung schließt das Termin-Fenster (wie bei allen Termin-Aktionen)
      await undo(p);
      await expectSaved(p);
      await chip(p, title, "10:00–11:00").click();
      await expect(taskLink).toBeVisible();

      // Zeichen am Termin: im Raster knapp, auf Heute ausgeschrieben (Stück 2)
      await p.keyboard.press("Escape");
      await expect(chip(p, title, "10:00–11:00")).toHaveAccessibleName(
        /verknüpft: 1 Notiz, 1 Aufgabe/,
      );
      await expect(p.getByTestId("event-link-marks").first()).toBeVisible();
      await p.goto("/heute");
      const today = p
        .getByRole("region", { name: "Tagesablauf", exact: true })
        .getByRole("listitem")
        .filter({ hasText: title });
      await expect(today).toContainText("Notiz · 1 · Aufgabe · 1");
      await p.goto(`/kalender?ansicht=tag&tag=${DAY}`);
      await chip(p, title, "10:00–11:00").click();

      // Termin löschen: die Meldung nennt, was bleibt
      await p.getByTestId("event-delete").click();
      await expect(p.getByText(/1 Notiz und 1 Aufgabe bleiben/)).toBeVisible();
      await expect
        .poll(async () => (await googleState(page, PRIMARY)).ops.some((o) => o.op === "delete"))
        .toBe(true);

      // in der Aufgabe: Kopf gestrichelt mit „war: …“
      await p.goto(`/aufgaben?aufgabe=${taskId}`);
      const gone = p.getByTestId("linked-event");
      await expect(gone).toContainText("Termin in Google nicht mehr gefunden");
      await expect(gone).toContainText(`war: Mi, 09.12. 10:00–11:00 · ${title}`);
    } finally {
      await context.close();
      const db = await seedDb();
      await db.from("notes").delete().eq("title", noteTitle);
      await db
        .from("tasks")
        .delete()
        .eq("id", taskId as string);
      await finish(page, ids);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Google-Termine anlegen, ändern, löschen (#64, N1c)                 */
  /* ---------------------------------------------------------------- */

  /** „Rückgängig“ der jüngsten Meldung (wartet, bis eine ältere Meldung weg ist). */
  async function undo(p: Page) {
    const button = p.getByRole("button", { name: "Rückgängig" });
    await expect(button).toHaveCount(1);
    await button.click();
  }
  const dialog = (p: Page) => p.getByTestId("new-event");
  const toast = (p: Page, text: string | RegExp) => p.getByText(text);
  /** Mitte der Halbstunden-Zeile im Raster (Tag, Minuten), 6 px unter der Oberkante. */
  const slotTop = (p: Page, date: string, minutes: number) =>
    top(p.locator(`[data-drop-target="${slotId(date, minutes)}"]`));

  test("anlegen: im Raster klicken (Enter), Rückgängig; ziehen mit Dauer; Esc bricht ab", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const ids = await startConnected(page);
    const title = uniqueName("Klick");
    const dragged = uniqueName("Ziehen-neu");
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      // Klick auf 10:00 am Donnerstag 10.12. → 1 h, Titel hat den Fokus
      const slot = await slotTop(p, "2026-12-10", 600);
      await p.mouse.click(slot.x, slot.y);
      await expect(dialog(p)).toBeVisible();
      await expect(dialog(p).getByLabel("Titel")).toBeFocused();
      await expect(dialog(p).getByLabel("Beginn (Uhrzeit)")).toHaveValue("10:00");
      await expect(dialog(p).getByLabel("Dauer")).toHaveValue("60");
      await expect(dialog(p).getByRole("combobox", { name: "Kalender" })).toContainText(
        "E2E-Hauptkalender",
      );
      await expect(dialog(p).getByTestId("new-event-end")).toContainText("Ende 11:00");
      await dialog(p).getByLabel("Titel").fill(title);
      await p.keyboard.press("Enter");
      await expect(dialog(p)).toHaveCount(0);
      // sofort im Raster, dann in Google (ohne Benachrichtigung)
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();
      await expect
        .poll(async () =>
          (await googleState(page, PRIMARY)).items?.find((e) => e.summary === title),
        )
        .toMatchObject({
          start: { dateTime: "2026-12-10T09:00:00.000Z", timeZone: "Europe/Berlin" },
          end: { dateTime: "2026-12-10T10:00:00.000Z", timeZone: "Europe/Berlin" },
        });
      const created = (await googleState(page, PRIMARY)).items?.find((e) => e.summary === title);
      expect((await googleState(page, PRIMARY)).ops.at(-1)).toMatchObject({
        op: "insert",
        eventId: created?.id,
        sendUpdates: "none",
      });
      await expect(toast(p, `Termin „${title}“ angelegt`)).toBeVisible();

      // Rückgängig = löschen
      await undo(p);
      await expect(chip(p, title)).toHaveCount(0);
      await expect
        .poll(async () =>
          (await googleState(page, PRIMARY)).items?.some((e) => e.summary === title),
        )
        .toBe(false);
      expect((await googleState(page, PRIMARY)).ops.at(-1)).toMatchObject({
        op: "delete",
        eventId: created?.id,
        sendUpdates: "none",
      });

      // Ziehen von 14:00 bis in die Zeile 15:30 → 14:00–15:45 (105 min)
      const from = await slotTop(p, "2026-12-10", 840);
      const to = await slotTop(p, "2026-12-10", 930);
      await p.mouse.move(from.x, from.y);
      await p.mouse.down();
      await p.mouse.move(to.x, to.y, { steps: 12 });
      await expect(p.locator('[data-new-event-range="14:00-15:45"]')).toBeVisible();
      await p.mouse.up();
      await expect(dialog(p)).toBeVisible();
      await expect(dialog(p).getByLabel("Beginn (Uhrzeit)")).toHaveValue("14:00");
      await expect(dialog(p).getByLabel("Dauer")).toHaveValue("105");
      await expect(dialog(p).getByTestId("new-event-end")).toContainText("Ende 15:45");
      await dialog(p).getByLabel("Titel").fill(dragged);
      await dialog(p).getByRole("button", { name: "Anlegen" }).click();
      await expect(chip(p, dragged, "14:00–15:45")).toBeVisible();
      await expect
        .poll(
          async () =>
            (await googleState(page, PRIMARY)).items?.find((e) => e.summary === dragged)?.end
              .dateTime,
        )
        .toBe("2026-12-10T14:45:00.000Z");

      // Esc bricht ab: nichts wird angelegt
      const before = (await googleState(page, PRIMARY)).ops.length;
      const again = await slotTop(p, "2026-12-11", 600);
      await p.mouse.click(again.x, again.y);
      await dialog(p).getByLabel("Titel").fill("wird nicht angelegt");
      await p.keyboard.press("Escape");
      await expect(dialog(p)).toHaveCount(0);
      await p.waitForTimeout(400);
      expect((await googleState(page, PRIMARY)).ops).toHaveLength(before);

      // ohne Titel: Hinweis, Fenster bleibt
      await p.mouse.click(again.x, again.y);
      await dialog(p).getByRole("button", { name: "Anlegen" }).click();
      await expect(dialog(p).getByRole("alert")).toContainText("Bitte einen Titel eingeben.");
      await p.keyboard.press("Escape");
      expect((await googleState(page, PRIMARY)).ops).toHaveLength(before);

      // Aufgaben-Ziehen aus N1b stört nicht: ein Termin lässt sich weiter ziehen (kein Fenster)
      const block0 = block(
        p,
        (await googleState(page, PRIMARY)).items?.find((e) => e.summary === dragged)?.id as string,
      );
      await drag(p, await top(block0), await slotTop(p, "2026-12-11", 960));
      await expect(chip(p, dragged, "16:00–17:45")).toBeVisible();
      await expect(dialog(p)).toHaveCount(0);
      await expectNoHorizontalOverflow(p);
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  test("＋ Termin: ganztägig, nur beschreibbare Kalender wählbar, Titel mit Enter", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const ids = await startConnected(page, [PRIMARY, READONLY, PRIVATE]);
    const title = uniqueName("Ganztag-neu");
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      await p.getByRole("button", { name: "Termin anlegen" }).click();
      await expect(dialog(p)).toBeVisible();
      // vorbelegt mit dem gewählten Tag (Mittwoch 9.12.), 9 Uhr (anderer Tag als „heute“ zählt nicht: heute = 9.12. 09:00 → 10:00)
      await expect(dialog(p).getByLabel("Beginn (Uhrzeit)")).toHaveValue("10:00");
      // nur beschreibbare Kalender: Haupt und Privat, nicht „Feiertage“
      await dialog(p).getByRole("combobox", { name: "Kalender" }).click();
      await expect(p.getByRole("option")).toHaveCount(2);
      expect((await p.getByRole("option").allTextContents()).sort()).toEqual([
        "E2E-Hauptkalender",
        "E2E-Privat",
      ]);
      await p.getByRole("option", { name: "E2E-Privat" }).click();
      await dialog(p).getByLabel("Titel").fill(title);
      await dialog(p).getByLabel("Ganztägig").click();
      await expect(dialog(p).getByLabel("Beginn (Uhrzeit)")).toHaveCount(0);
      await expect(dialog(p).getByLabel("Bis")).toBeVisible();
      await dialog(p).getByLabel("Ort").fill("Büro");
      await dialog(p).getByLabel("Titel").press("Enter");
      await expect(dialog(p)).toHaveCount(0);
      await expect
        .poll(async () =>
          (await googleState(page, PRIVATE)).items?.find((e) => e.summary === title),
        )
        .toMatchObject({
          start: { date: "2026-12-09" },
          end: { date: "2026-12-10" },
          location: "Büro",
        });
      expect((await googleState(page, PRIMARY)).items?.some((e) => e.summary === title)).toBe(
        false,
      );
      await expect(
        p.getByRole("button", { name: new RegExp(`^${title}, ganztägig`) }),
      ).toBeVisible();

      // der Kalender wird gemerkt: beim nächsten Mal ist „E2E-Privat“ vorgewählt
      await p.getByRole("button", { name: "Termin anlegen" }).click();
      await expect(dialog(p).getByRole("combobox", { name: "Kalender" })).toContainText(
        "E2E-Privat",
      );
      await p.keyboard.press("Escape");
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  test("bearbeiten: Titel und Ort mit Rückgängig; Kalender wechseln; Konflikt", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const ids = await startConnected(page, [PRIMARY, PRIVATE]);
    const title = uniqueName("Bearbeiten");
    const [event] = await seedFake(page, PRIMARY, [
      timed(title, DAY, "10:00", "11:00", { location: "Altstadt", description: "Nicht anfassen" }),
    ]);
    const id = (event as FakeEvent).id;
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      await chip(p, title, "10:00–11:00").click();
      const edit = p.getByTestId("event-edit");
      await expect(edit.getByLabel("Ort")).toHaveValue("Altstadt");
      await expect(edit.getByLabel("Beschreibung")).toHaveValue("Nicht anfassen");

      // Titel mit Enter
      const renamed = `${title} neu`;
      await edit.getByLabel("Titel").fill(renamed);
      await edit.getByLabel("Titel").press("Enter");
      await expect(toast(p, `Titel geändert: „${renamed}“`)).toBeVisible();
      await expect.poll(async () => (await googleEvent(page, PRIMARY, id))?.summary).toBe(renamed);
      const patch = (await googleState(page, PRIMARY)).patches.at(-1);
      expect(patch).toMatchObject({
        eventId: id,
        ifMatch: (event as FakeEvent).etag,
        sendUpdates: "none",
        fields: ["summary"],
      });
      // Ort und Beschreibung blieben, Zeit auch
      expect((await googleEvent(page, PRIMARY, id))?.location).toBe("Altstadt");
      expect((await googleEvent(page, PRIMARY, id))?.start.dateTime).toBe(
        "2026-12-09T09:00:00.000Z",
      );
      await undo(p);
      await expect.poll(async () => (await googleEvent(page, PRIMARY, id))?.summary).toBe(title);

      // Ort ändern (beim Verlassen des Feldes gespeichert), dann leeren
      await chip(p, title, "10:00–11:00").click();
      const edit2 = p.getByTestId("event-edit");
      await edit2.getByLabel("Ort").fill("Rathaus");
      await edit2.getByLabel("Beschreibung").focus();
      await expect(toast(p, `Ort geändert: „${title}“`)).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.location)
        .toBe("Rathaus");
      await undo(p);
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id))?.location)
        .toBe("Altstadt");
      // Esc schließt das Fenster: ein getipptes, nicht verlassenes Feld wird nicht gespeichert
      await chip(p, title, "10:00–11:00").click();
      const edit3 = p.getByTestId("event-edit");
      await edit3.getByLabel("Titel").fill("Verworfen");
      await edit3.getByLabel("Titel").press("Escape");
      await expect(p.getByTestId("event-edit")).toHaveCount(0);
      await p.waitForTimeout(400);
      expect((await googleEvent(page, PRIMARY, id))?.summary).toBe(title);

      // Kalender wechseln (Termin bleibt derselbe), Rückgängig geht zurück
      await chip(p, title, "10:00–11:00").click();
      await p.getByRole("combobox", { name: "Kalender wechseln" }).click();
      await p.getByRole("option", { name: "E2E-Privat" }).click();
      await expect(toast(p, `„${title}“ → Kalender „E2E-Privat“`)).toBeVisible();
      await expect.poll(async () => (await googleEvent(page, PRIVATE, id))?.summary).toBe(title);
      expect(await googleEvent(page, PRIMARY, id)).toBeUndefined();
      expect((await googleState(page, PRIMARY)).ops.at(-1)).toMatchObject({
        op: "move",
        eventId: id,
        destination: PRIVATE,
        sendUpdates: "none",
      });
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();
      await undo(p);
      await expect.poll(async () => (await googleEvent(page, PRIMARY, id))?.summary).toBe(title);
      expect(await googleEvent(page, PRIVATE, id)).toBeUndefined();

      // Konflikt: in Google geändert → Hinweis, nichts überschrieben
      await p.waitForTimeout(500);
      await page.request.post("/dev/google/_test/touch", {
        data: { calendarId: PRIMARY, eventId: id },
      });
      await chip(p, title, "10:00–11:00").click();
      await p.getByTestId("event-edit").getByLabel("Titel").fill("Zu spät");
      await p.getByTestId("event-edit").getByLabel("Titel").press("Enter");
      await expect(
        p.getByText(/Der Termin wurde inzwischen in Google geändert – neu geladen/),
      ).toBeVisible();
      expect((await googleEvent(page, PRIMARY, id))?.summary).toBe(title);
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  test("löschen: Knopf, Rechtsklick, Entf – Rückgängig holt zurück; ohne Papierkorb neu angelegt; Serie nur diese Instanz", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const ids = await startConnected(page);
    const title = uniqueName("Loeschen");
    const viaMenu = uniqueName("Menue");
    const viaKey = uniqueName("Taste");
    const series = uniqueName("Serie-loeschen");
    const [event] = await seedFake(page, PRIMARY, [
      timed(title, DAY, "10:00", "11:00", { location: "Praxis", description: "Karte mitbringen" }),
    ]);
    const [menuEvent] = await seedFake(page, PRIMARY, [timed(viaMenu, DAY, "12:00", "13:00")]);
    const [keyEvent] = await seedFake(page, PRIMARY, [timed(viaKey, DAY, "14:00", "15:00")]);
    const [first, second] = await seedFake(page, PRIMARY, [
      timed(series, "2026-12-08", "16:00", "17:00", { recurringEventId: "serie9abcdef" }),
      timed(series, "2026-12-10", "16:00", "17:00", { recurringEventId: "serie9abcdef" }),
    ]);
    const { context, p } = await openWeek(browser, baseURL as string);
    const id = (event as FakeEvent).id;
    try {
      // Knopf im Termin-Fenster
      await chip(p, title, "10:00–11:00").click();
      await p.getByTestId("event-delete").click();
      await expect(toast(p, `Termin „${title}“ gelöscht`)).toBeVisible();
      await expect(chip(p, title)).toHaveCount(0);
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id)) === undefined)
        .toBe(true);
      const del = (await googleState(page, PRIMARY)).ops.at(-1);
      expect(del).toMatchObject({
        op: "delete",
        eventId: id,
        sendUpdates: "none",
        ifMatch: (event as FakeEvent).etag,
      });

      // Rückgängig: derselbe Termin aus Googles Papierkorb, mit allen Angaben
      await undo(p);
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();
      await expect.poll(async () => (await googleEvent(page, PRIMARY, id))?.summary).toBe(title);
      expect((await googleEvent(page, PRIMARY, id))?.location).toBe("Praxis");
      expect((await googleEvent(page, PRIMARY, id))?.description).toBe("Karte mitbringen");
      expect((await googleState(page, PRIMARY)).ops.at(-1)).toMatchObject({
        op: "restore",
        eventId: id,
      });

      // Ohne Papierkorb in Google: neu angelegt, mit denselben Angaben
      await chip(p, title, "10:00–11:00").click();
      await p.getByTestId("event-delete").click();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, id)) === undefined)
        .toBe(true);
      await fake(page, "purge-trash");
      await undo(p);
      await expect
        .poll(async () =>
          (await googleState(page, PRIMARY)).items?.filter((e) => e.summary === title),
        )
        .toHaveLength(1);
      const again = (await googleState(page, PRIMARY)).items?.find((e) => e.summary === title);
      expect(again?.id).not.toBe(id);
      expect(again).toMatchObject({
        location: "Praxis",
        description: "Karte mitbringen",
        start: { dateTime: "2026-12-09T09:00:00.000Z" },
        end: { dateTime: "2026-12-09T10:00:00.000Z" },
      });
      expect((await googleState(page, PRIMARY)).ops.at(-1)).toMatchObject({ op: "insert" });
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();

      // Rechtsklick › Löschen
      await chip(p, viaMenu, "12:00–13:00").click({ button: "right" });
      await p.getByRole("menuitem", { name: "Löschen" }).click();
      await expect(toast(p, `Termin „${viaMenu}“ gelöscht`)).toBeVisible();
      await expect
        .poll(
          async () => (await googleEvent(page, PRIMARY, (menuEvent as FakeEvent).id)) === undefined,
        )
        .toBe(true);

      // Entf am ausgewählten (fokussierten) Termin
      await chip(p, viaKey, "14:00–15:00").focus();
      await p.keyboard.press("Delete");
      await expect(toast(p, `Termin „${viaKey}“ gelöscht`)).toBeVisible();
      await expect
        .poll(
          async () => (await googleEvent(page, PRIMARY, (keyEvent as FakeEvent).id)) === undefined,
        )
        .toBe(true);

      // Serie: nur diese Instanz (der Text sagt es), die andere bleibt
      await chip(p, series, "16:00–17:00").first().click();
      await expect(p.getByTestId("event-delete")).toContainText("Nur diesen Termin löschen");
      await p.getByTestId("event-delete").click();
      await expect(toast(p, /gelöscht \(nur dieser Termin der Serie\)/)).toBeVisible();
      await expect
        .poll(async () => {
          const items = (await googleState(page, PRIMARY)).items ?? [];
          return [
            items.some((e) => e.id === (first as FakeEvent).id),
            items.some((e) => e.id === (second as FakeEvent).id),
          ];
        })
        .toEqual([false, true]);
      const last = (await googleState(page, PRIMARY)).ops.at(-1);
      expect(last?.eventId).toBe((first as FakeEvent).id);
      expect(last?.eventId).not.toBe("serie9abcdef");
      await expectNoHorizontalOverflow(p);
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  test("Löschen bei Konflikt (in Google geändert): nicht gelöscht, Hinweis", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const ids = await startConnected(page);
    const title = uniqueName("Loesch-Konflikt");
    const [event] = await seedFake(page, PRIMARY, [timed(title, DAY, "10:00", "11:00")]);
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();
      await page.request.post("/dev/google/_test/touch", {
        data: { calendarId: PRIMARY, eventId: (event as FakeEvent).id },
      });
      await chip(p, title, "10:00–11:00").click();
      await p.getByTestId("event-delete").click();
      await expect(
        p.getByText(/Der Termin wurde inzwischen in Google geändert – neu geladen/),
      ).toBeVisible();
      await expect(chip(p, title, "10:00–11:00")).toBeVisible();
      expect(await googleEvent(page, PRIMARY, (event as FakeEvent).id)).toBeDefined();
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  test("KI-Protokoll: Rückgängig für Termine (angelegt, geändert, gelöscht) über die Termin-Routen; Konflikt bleibt offen", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ids = await startConnected(page);
    const sourceId = ids[0] as string;
    const db = await seedDb();
    const prefix = uniqueName("KI-Termin");
    const log = async (summary: string, undo: object) => {
      const { error } = await db.from("ai_activity").insert({
        client_id: "e2e-client",
        tool: "update_event",
        entity: "termin",
        summary,
        undo: undo as never,
      });
      expect(error).toBeNull();
    };
    const row = (summary: string) =>
      page.getByTestId("ai-activity").getByRole("listitem").filter({ hasText: summary });
    const undoButton = (summary: string) =>
      row(summary).getByRole("button", { name: `Rückgängig: ${summary}` });
    try {
      // 1. angelegt → Rückgängig löscht den Termin in Google
      const created = `${prefix} angelegt`;
      const [createdEvent] = (await seedFake(page, PRIMARY, [
        timed(created, DAY, "10:00", "11:00"),
      ])) as FakeEvent[];
      await log(`Termin „${created}“ angelegt`, {
        kind: "event_create",
        calendar_id: PRIMARY,
        event_id: (createdEvent as FakeEvent).id,
        // Pflicht seit Review Teil B (M-1/K-4): ohne etag kein Rückgängig
        etag: (createdEvent as FakeEvent).etag,
        date: DAY,
      });

      // 2. geändert → Rückgängig schreibt den alten Titel und Ort zurück (etag nach der KI-Änderung)
      const before = `${prefix} vorher`;
      const [changedEvent] = (await seedFake(page, PRIMARY, [
        timed(before, DAY, "12:00", "13:00", { location: "Praxis" }),
      ])) as FakeEvent[];
      const changedId = (changedEvent as FakeEvent).id;
      const patched = await page.request.patch("/api/kalender/termin", {
        data: {
          sourceId,
          eventId: changedId,
          etag: (changedEvent as FakeEvent).etag,
          summary: `${prefix} nachher`,
          location: "Anderswo",
        },
      });
      const afterEtag = ((await patched.json()) as { etag: string }).etag;
      await log(`Termin „${prefix} nachher“ geändert (Titel, Ort)`, {
        kind: "event_update",
        calendar_id: PRIMARY,
        event_id: changedId,
        etag: afterEtag,
        before: { summary: before, location: "Praxis" },
        date: DAY,
      });

      // 3. seitdem in Google geändert → Konflikt, nichts überschrieben, Eintrag bleibt offen
      const conflictTitle = `${prefix} Konflikt`;
      const [conflictEvent] = (await seedFake(page, PRIMARY, [
        timed(conflictTitle, DAY, "14:00", "15:00"),
      ])) as FakeEvent[];
      const conflictId = (conflictEvent as FakeEvent).id;
      const conflictPatch = await page.request.patch("/api/kalender/termin", {
        data: {
          sourceId,
          eventId: conflictId,
          etag: (conflictEvent as FakeEvent).etag,
          summary: `${prefix} Konflikt KI`,
        },
      });
      const conflictEtag = ((await conflictPatch.json()) as { etag: string }).etag;
      await page.request.post("/dev/google/_test/touch", {
        data: { calendarId: PRIMARY, eventId: conflictId },
      });
      const conflictSummary = `Termin „${prefix} Konflikt KI“ geändert (Titel)`;
      await log(conflictSummary, {
        kind: "event_update",
        calendar_id: PRIMARY,
        event_id: conflictId,
        etag: conflictEtag,
        before: { summary: conflictTitle },
        date: DAY,
      });

      // 4. gelöscht → Rückgängig holt ihn aus Googles Papierkorb zurück
      const doomed = `${prefix} gelöscht`;
      const [doomedEvent] = (await seedFake(page, PRIMARY, [
        timed(doomed, DAY, "16:00", "17:00", { location: "Büro", description: "Mit Notizen" }),
      ])) as FakeEvent[];
      const doomedId = (doomedEvent as FakeEvent).id;
      expect(
        (
          await page.request.delete("/api/kalender/termin", {
            data: { sourceId, eventId: doomedId },
          })
        ).ok(),
      ).toBe(true);
      await log(`Termin „${doomed}“ gelöscht`, {
        kind: "event_delete",
        calendar_id: PRIMARY,
        event: {
          event_id: doomedId,
          summary: doomed,
          location: "Büro",
          description: "Mit Notizen",
          times: {
            allDay: false,
            start: berlinDateTime(DAY, "16:00"),
            end: berlinDateTime(DAY, "17:00"),
            timeZone: "Europe/Berlin",
          },
        },
        date: DAY,
      });

      // nur der Anker ändert sich: neu laden, damit das Protokoll die neuen Einträge holt
      await page.goto("/einstellungen#ki");
      await page.reload();
      // der Eintrag führt auf den Tag im Kalender
      await expect(
        row(`Termin „${created}“ angelegt`).getByRole("link", {
          name: `Termin „${created}“ angelegt`,
        }),
      ).toHaveAttribute("href", `/kalender?ansicht=tag&tag=${DAY}`);

      await undoButton(`Termin „${created}“ angelegt`).click();
      await expect(row(`Termin „${created}“ angelegt`).getByText("zurückgeholt")).toBeVisible();
      await expect
        .poll(async () => await googleEvent(page, PRIMARY, (createdEvent as FakeEvent).id))
        .toBeUndefined();

      await undoButton(`Termin „${prefix} nachher“ geändert (Titel, Ort)`).click();
      await expect(
        row(`Termin „${prefix} nachher“ geändert (Titel, Ort)`).getByText("zurückgeholt"),
      ).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, changedId))?.summary)
        .toBe(before);
      expect((await googleEvent(page, PRIMARY, changedId))?.location).toBe("Praxis");

      await undoButton(conflictSummary).click();
      await expect(
        page.getByText(/seit der KI-Änderung in Google geändert – bitte dort prüfen/),
      ).toBeVisible();
      await expect(undoButton(conflictSummary)).toBeVisible();
      await expect(row(conflictSummary).getByText("zurückgeholt")).toHaveCount(0);
      expect((await googleEvent(page, PRIMARY, conflictId))?.summary).toBe(`${prefix} Konflikt KI`);
      const open = await db
        .from("ai_activity")
        .select("undone_at")
        .eq("summary", conflictSummary)
        .single();
      expect(open.data?.undone_at).toBeNull();

      await undoButton(`Termin „${doomed}“ gelöscht`).click();
      await expect(row(`Termin „${doomed}“ gelöscht`).getByText("zurückgeholt")).toBeVisible();
      await expect
        .poll(async () => (await googleEvent(page, PRIMARY, doomedId))?.summary)
        .toBe(doomed);
      expect((await googleEvent(page, PRIMARY, doomedId))?.description).toBe("Mit Notizen");
      expect((await googleState(page, PRIMARY)).ops.at(-1)).toMatchObject({
        op: "restore",
        eventId: doomedId,
      });
      await expectNoHorizontalOverflow(page);
    } finally {
      await db
        .from("ai_activity")
        .delete()
        .eq("client_id", "e2e-client")
        .like("summary", `%${prefix}%`);
      await finish(page, ids);
    }
  });

  test("nur lesbar: kein Bearbeiten, kein Löschen, kein Rechtsklick-Menü", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const ids = await startConnected(page, [PRIMARY, READONLY]);
    const fixed = uniqueName("Fest");
    await seedFake(page, READONLY, [timed(fixed, DAY, "14:00", "15:00")]);
    const { context, p } = await openWeek(browser, baseURL as string);
    try {
      await chip(p, fixed, "14:00–15:00").click();
      await expect(p.getByTestId("event-fixed")).toContainText("In Google nur lesbar");
      await expect(p.getByTestId("event-edit")).toHaveCount(0);
      await expect(p.getByTestId("event-delete")).toHaveCount(0);
      await p.keyboard.press("Escape");
      await chip(p, fixed, "14:00–15:00").focus();
      await p.keyboard.press("Delete");
      await chip(p, fixed, "14:00–15:00").click({ button: "right" });
      await expect(p.getByRole("menuitem", { name: "Löschen" })).toHaveCount(0);
      await p.waitForTimeout(300);
      expect((await googleState(page, READONLY)).ops).toHaveLength(0);
    } finally {
      await context.close();
      await finish(page, ids);
    }
  });

  test("Routen: Anlegen, Kalender wechseln, Wiederherstellen, Löschen – Eingaben und Schutz", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const ids = await startConnected(page, [PRIMARY, READONLY, PRIVATE]);
    const [main, readonly, privat] = ids as [string, string, string];
    const base = {
      sourceId: main,
      summary: uniqueName("Route-neu"),
      allDay: false,
      start: "2026-12-09T10:00:00.000Z",
      end: "2026-12-09T11:00:00.000Z",
      timeZone: "Europe/Berlin",
      location: "Ort",
    };
    const post = (path: string, data: unknown, headers?: Record<string, string>) =>
      page.request.post(path, { data, headers });
    try {
      // Schutz und Eingabeprüfung
      expect(
        (await post("/api/kalender/termin", base, { origin: "https://evil.example" })).status(),
      ).toBe(403);
      expect((await post("/api/kalender/termin", { ...base, summary: "  " })).status()).toBe(400);
      expect(
        (await post("/api/kalender/termin", { ...base, summary: "x".repeat(301) })).status(),
      ).toBe(400);
      expect((await post("/api/kalender/termin", { ...base, end: base.start })).status()).toBe(400);
      expect(
        (await post("/api/kalender/termin", { ...base, sourceId: crypto.randomUUID() })).status(),
      ).toBe(404);
      // nur lesbarer Kalender: Google lehnt ab
      expect((await post("/api/kalender/termin", { ...base, sourceId: readonly })).status()).toBe(
        403,
      );
      const anonymous = await playwright.request.newContext({
        baseURL,
        storageState: { cookies: [], origins: [] },
      });
      for (const [method, path] of [
        ["POST", "/api/kalender/termin"],
        ["DELETE", "/api/kalender/termin"],
        ["POST", "/api/kalender/termin/verschieben-kalender"],
        ["POST", "/api/kalender/termin/wiederherstellen"],
      ] as const) {
        const response = await anonymous.fetch(path, { method, data: base, maxRedirects: 0 });
        expect(response.status(), path).toBeGreaterThanOrEqual(300);
        expect(response.status(), path).toBeLessThan(400);
      }
      await anonymous.dispose();
      expect((await googleState(page, PRIMARY)).ops).toHaveLength(0);

      // Anlegen: normalisierter Termin, kein Token
      const created = await post("/api/kalender/termin", base);
      expect(created.status()).toBe(200);
      const text = await created.text();
      for (const secret of ["ya29", "1//", "v1:"]) expect(text).not.toContain(secret);
      const event = (
        JSON.parse(text) as {
          event: { title: string; google: { eventId: string; etag: string; editable: boolean } };
        }
      ).event;
      expect(event).toMatchObject({ title: base.summary, google: { editable: true } });
      const eventId = event.google.eventId;
      expect((await googleState(page, PRIMARY)).ops.at(-1)).toMatchObject({
        op: "insert",
        sendUpdates: "none",
      });

      // Kalender wechseln: falsches etag → 412; passt → neuer Kalender; in den nur lesbaren → 403
      const move = {
        sourceId: main,
        destinationSourceId: privat,
        eventId,
        etag: event.google.etag,
      };
      expect(
        (
          await post("/api/kalender/termin/verschieben-kalender", { ...move, etag: '"alt"' })
        ).status(),
      ).toBe(412);
      expect(
        (
          await post("/api/kalender/termin/verschieben-kalender", {
            ...move,
            destinationSourceId: readonly,
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await post("/api/kalender/termin/verschieben-kalender", {
            ...move,
            destinationSourceId: main,
          })
        ).status(),
      ).toBe(400);
      const moved = await post("/api/kalender/termin/verschieben-kalender", move);
      expect(moved.status()).toBe(200);
      const movedEvent = (
        (await moved.json()) as { event: { sourceId: string; google: { etag: string } } }
      ).event;
      expect(movedEvent.sourceId).toBe(privat);
      expect((await googleEvent(page, PRIVATE, eventId))?.summary).toBe(base.summary);

      // Löschen mit altem etag → 412, mit passendem → ok; danach Wiederherstellen (derselbe Termin)
      expect(
        (
          await page.request.delete("/api/kalender/termin", {
            data: { sourceId: privat, eventId, etag: '"alt"' },
          })
        ).status(),
      ).toBe(412);
      const deleted = await page.request.delete("/api/kalender/termin", {
        data: { sourceId: privat, eventId, etag: movedEvent.google.etag },
      });
      expect(deleted.status()).toBe(200);
      expect(await googleEvent(page, PRIVATE, eventId)).toBeUndefined();
      const restoreBody = {
        sourceId: privat,
        eventId,
        summary: base.summary,
        location: "Ort",
        description: "",
        allDay: false,
        start: base.start,
        end: base.end,
        timeZone: "Europe/Berlin",
      };
      const restored = await post("/api/kalender/termin/wiederherstellen", restoreBody);
      expect(restored.status()).toBe(200);
      expect(await restored.json()).toMatchObject({ ok: true, how: "same" });
      expect((await googleEvent(page, PRIVATE, eventId))?.summary).toBe(base.summary);
      // gelöscht und Papierkorb leer → neu angelegt
      await page.request.delete("/api/kalender/termin", { data: { sourceId: privat, eventId } });
      await fake(page, "purge-trash");
      const renewed = await post("/api/kalender/termin/wiederherstellen", restoreBody);
      const renewedBody = (await renewed.json()) as {
        how: string;
        event: { google: { eventId: string; etag: string } };
      };
      expect(renewedBody.how).toBe("new");
      expect(renewedBody.event.google.eventId).not.toBe(eventId);
      // Wiederherstellen im nur lesbaren Kalender: nichts angelegt
      expect(
        (
          await post("/api/kalender/termin/wiederherstellen", {
            ...restoreBody,
            sourceId: readonly,
          })
        ).status(),
      ).toBe(403);
      // Text ändern über PATCH (nur Titel, ohne Zeiten); Gäste und Co. nehmen die Route nicht an
      const renewedId = renewedBody.event.google.eventId;
      const patched = await page.request.patch("/api/kalender/termin", {
        data: {
          sourceId: privat,
          eventId: renewedId,
          etag: renewedBody.event.google.etag,
          summary: "Neu benannt",
          attendees: [{ email: "gast@example.com" }],
        },
      });
      expect(patched.status()).toBe(200);
      expect((await googleEvent(page, PRIVATE, renewedId))?.summary).toBe("Neu benannt");
      expect((await googleState(page, PRIVATE)).patches.at(-1)?.fields).toEqual(["summary"]);
      expect(
        (
          await page.request.patch("/api/kalender/termin", {
            data: { sourceId: privat, eventId: renewedId, etag: '"x"' },
          })
        ).status(),
      ).toBe(400);
    } finally {
      await finish(page, ids);
    }
  });

  test("ersetzte iCal-Quelle erscheint nicht doppelt", async ({ page }) => {
    const ids = await startConnected(page);
    const title = uniqueName("Einmal");
    await seedFake(page, PRIMARY, [timed(title, DAY, "10:00", "11:00")]);
    // iCal-Quelle desselben Kalenders (die Adresse trägt die Kalender-ID) – wird nie geladen
    const ical = await seedCalendarSource({
      name: "E2E-iCal-ersetzt",
      url: `https://calendar.google.com/calendar/ical/${encodeURIComponent(PRIMARY)}/private-e2e/basic.ics`,
    });
    try {
      const response = await page.request.get(
        `/api/kalender?von=2026-12-07&bis=2026-12-13&frisch=1`,
      );
      const body = (await response.json()) as {
        events: Array<{ title: string; google?: { editable: boolean; etag: string } | null }>;
        sources: Array<{ name: string; error: string | null }>;
      };
      expect(body.events.filter((e) => e.title === title)).toHaveLength(1);
      expect(body.events.find((e) => e.title === title)?.google?.editable).toBe(true);
      expect(body.sources.map((s) => s.name)).toContain("E2E-Hauptkalender");
      expect(body.sources.map((s) => s.name)).not.toContain("E2E-iCal-ersetzt");
      // nur die eigenen Quellen prüfen: parallele Tests desselben Nutzers haben eigene (N4)
      expect(body.sources.find((s) => s.name === "E2E-Hauptkalender")?.error).toBeNull();
      // keine Adresse, kein Token in der Antwort
      const text = JSON.stringify(body);
      for (const secret of ["private-e2e", "ya29", "1//", "v1:"])
        expect(text).not.toContain(secret);
    } finally {
      await deleteCalendarSource(ical);
      await finish(page, ids);
    }
  });

  test("Route: nur eigene Seite, nur Zeitfelder, Zugang weg → neu verbinden", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const ids = await startConnected(page);
    const [event] = await seedFake(page, PRIMARY, [
      timed(uniqueName("Route"), DAY, "10:00", "11:00"),
    ]);
    const body = {
      sourceId: ids[0],
      eventId: (event as FakeEvent).id,
      etag: (event as FakeEvent).etag,
      allDay: false,
      start: "2026-12-09T10:00:00.000Z",
      end: "2026-12-09T11:00:00.000Z",
      timeZone: "Europe/Berlin",
    };
    try {
      // fremder Ursprung, ungültige Eingabe, unbekannte Quelle
      expect(
        (
          await page.request.patch("/api/kalender/termin", {
            data: body,
            headers: { origin: "https://evil.example" },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await page.request.patch("/api/kalender/termin", { data: { ...body, end: body.start } })
        ).status(),
      ).toBe(400);
      expect(
        (
          await page.request.patch("/api/kalender/termin", {
            data: { ...body, sourceId: crypto.randomUUID() },
          })
        ).status(),
      ).toBe(404);
      expect((await googleState(page, PRIMARY)).patches).toHaveLength(0);

      // ohne Sitzung: Weiterleitung zur Anmeldung, nie Daten
      const anonymous = await playwright.request.newContext({
        baseURL,
        storageState: { cookies: [], origins: [] },
      });
      const anon = await anonymous.patch("/api/kalender/termin", { data: body, maxRedirects: 0 });
      expect(anon.status()).toBeGreaterThanOrEqual(300);
      expect(anon.status()).toBeLessThan(400);
      await anonymous.dispose();

      // falsches etag → 412 conflict
      const stale = await page.request.patch("/api/kalender/termin", {
        data: { ...body, etag: '"alt"' },
      });
      expect(stale.status()).toBe(412);
      expect(await stale.json()).toMatchObject({ conflict: true });

      // passt → neues etag, ohne Token
      const ok = await page.request.patch("/api/kalender/termin", { data: body });
      expect(ok.status()).toBe(200);
      const result = (await ok.json()) as { ok: boolean; etag: string };
      expect(result.ok).toBe(true);
      expect(Object.keys(result).sort()).toEqual(["etag", "ok"]);
      expect(result.etag).not.toBe(body.etag);

      // in Google widerrufen → reconnect
      await fake(page, "revoke-all");
      const gone = await page.request.patch("/api/kalender/termin", {
        data: { ...body, etag: result.etag },
      });
      expect(gone.status()).toBe(409);
      expect(await gone.json()).toMatchObject({ state: "reconnect" });
      // die Ansicht fällt zurück: Status „neu verbinden“ statt Absturz
      const list = await page.request.get(`/api/kalender?von=2026-12-07&bis=2026-12-13&frisch=1`);
      const sources = ((await list.json()) as { sources: Array<{ reconnect?: boolean }> }).sources;
      expect(sources.some((s) => s.reconnect === true)).toBe(true);
    } finally {
      await finish(page, ids);
    }
  });
});

test("fehlende Vercel-Werte → Hinweis statt Verbinden; Rückkehr mit Fehler → Hinweis", async ({
  page,
}) => {
  await page.route("**/api/google/status", (route) =>
    route.fulfill({
      json: {
        configured: false,
        configError: "Google-Zugang in Vercel fehlt (GOOGLE_CLIENT_SECRET).",
        connected: false,
        email: null,
        connectedAt: null,
      },
    }),
  );
  await page.goto("/einstellungen?google=nicht-eingerichtet#kalender");
  await expect(page.getByTestId("google-return")).toContainText("Google-Zugang in Vercel fehlt");
  await expect(page).toHaveURL(/\/einstellungen#kalender$/);
  const hint = section(page).getByTestId("google-not-configured");
  await expect(hint).toContainText("Google-Zugang in Vercel fehlt (GOOGLE_CLIENT_SECRET).");
  await expect(hint).toContainText("Google-Kalender bearbeiten einrichten");
  await expect(connectLink(page)).toHaveCount(0);
  // iCal-Adressen bleiben nutzbar
  await expect(section(page).getByRole("form", { name: "Kalender hinzufügen" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});

test("390 px: verbunden mit Kalenderliste und „ersetzt durch Google“ an der iCal-Adresse @mobile", async ({
  page,
}) => {
  const mobile = "e2e-mobil@example.com";
  const longName = "E2E-Mobil-Hauptkalender mit einem recht langen Namen zum Umbrechen";
  await page.route("**/api/google/status", (route) =>
    route.fulfill({
      json: {
        configured: true,
        configError: null,
        connected: true,
        email: "e2e-mobil.mit.langer.adresse@example.com",
        connectedAt: "2026-10-18T20:00:00.000Z",
      },
    }),
  );
  await page.route("**/api/google/calendars", (route) =>
    route.fulfill({
      json: {
        calendars: [
          {
            id: mobile,
            name: longName,
            color: "blau",
            accessRole: "owner",
            primary: true,
            writable: true,
          },
          {
            id: "e2e-mobil-feiertage@group.v.calendar.google.com",
            name: "E2E-Mobil-Feiertage",
            color: "gruen",
            accessRole: "reader",
            primary: false,
            writable: false,
          },
        ],
      },
    }),
  );
  // Kalenderquellen nur im Browser ergänzen (nichts wird gespeichert, nichts angeklickt)
  const now = "2026-10-18T20:00:00.000Z";
  const base = { created_at: now, updated_at: now, deleted_at: null };
  await page.route("**/rest/v1/calendar_sources?*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const rows = (await response.json()) as unknown[];
    await route.fulfill({
      response,
      json: [
        ...rows,
        {
          ...base,
          id: "00000000-0000-4000-8000-0000000e2e01",
          kind: "ical",
          name: "E2E-Mobil-iCal",
          url: `https://calendar.google.com/calendar/ical/${encodeURIComponent(mobile)}/private-x/basic.ics`,
          google_calendar_id: null,
          color: "gruen",
          enabled: false,
          sort: "zzzz1",
        },
        {
          ...base,
          id: "00000000-0000-4000-8000-0000000e2e02",
          kind: "google",
          name: longName,
          url: null,
          google_calendar_id: mobile,
          color: "lila",
          enabled: true,
          sort: "zzzz2",
        },
      ],
    });
  });
  await page.goto("/einstellungen#kalender");
  await expect(section(page).getByTestId("google-connected")).toContainText(
    "e2e-mobil.mit.langer.adresse@example.com",
  );
  await expect(calendarRow(page, longName)).toContainText("Hauptkalender");
  await expect(page.getByLabel(`Google-Kalender „${longName}“ anzeigen`)).toBeChecked();
  await expect(calendarRow(page, "E2E-Mobil-Feiertage")).toContainText("In Google nur lesbar");
  const ical = section(page)
    .getByRole("list", { name: "Kalenderquellen" })
    .getByRole("listitem")
    .filter({ has: page.getByLabel("Name des Kalenders „E2E-Mobil-iCal“") });
  await expect(ical.getByTestId("ical-replaced")).toContainText(
    `Ersetzt durch Google („${longName}“)`,
  );
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(300);
  await expectNoA11yViolations(page);
});

test("390 px: Google-Termin im Fenster verschieben (morgen, Uhrzeit), Rückgängig, nur lesbar @mobile", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const DAY = "2026-12-09";
  const title = uniqueName("Handy");
  const readonly = uniqueName("Handy-fest");
  // eine echte (iCal-)Quelle, damit die Seite Termine anfragt; die Antwort kommt abgefangen
  const source = await seedCalendarSource({
    name: uniqueName("Handy-Quelle"),
    url: `${baseURL}/dev/ics?name=probe`,
  });
  const event = (id: string, name: string, editable: boolean, from: string, to: string) => {
    const start = berlinDateTime(DAY, from);
    const end = berlinDateTime(DAY, to);
    return {
      id: `m:${id}:${start}`,
      sourceId: "mobil-quelle",
      sourceName: "E2E-Mobil",
      color: "lila",
      uid: id,
      title: name,
      location: null,
      description: null,
      allDay: false,
      start,
      end,
      date: DAY,
      endDate: DAY,
      startMinutes: Number(from.slice(0, 2)) * 60 + Number(from.slice(3)),
      endMinutes: Number(to.slice(0, 2)) * 60 + Number(to.slice(3)),
      busy: true,
      recurring: false,
      link: null,
      google: {
        calendarId: "e2e-mobil@example.com",
        eventId: id,
        etag: '"mobil-1"',
        editable,
        recurringEventId: null,
        timeZone: "Europe/Berlin",
      },
    };
  };
  const patches: Array<Record<string, unknown>> = [];
  const context = await freshContext(browser, baseURL as string, {
    viewport: page.viewportSize() ?? { width: 390, height: 844 },
    hasTouch: true,
    clockUntil: new Date("2026-12-31T00:00:00Z"),
  });
  try {
    const p = await context.newPage();
    await p.route("**/api/kalender?*", (route) =>
      route.fulfill({
        json: {
          range: { start: "2026-12-07", end: "2026-12-13" },
          events: [
            event("abc123", title, true, "10:00", "11:00"),
            event("fest456", readonly, false, "14:00", "15:00"),
          ],
          sources: [],
          fetchedAt: "2026-12-09T08:00:00.000Z",
        },
      }),
    );
    await p.route("**/api/kalender/termin", async (route) => {
      patches.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { ok: true, etag: `"mobil-${patches.length + 1}"` } });
    });
    await p.clock.setFixedTime(new Date(berlinDateTime(DAY, "09:00")));
    await p.goto(`/kalender?ansicht=woche&tag=${DAY}`);
    const main = p.getByRole("main");
    await main.getByRole("button", { name: new RegExp(`^${title}, 10:00–11:00`) }).click();
    const panel = p.getByTestId("event-move");
    await expect(panel).toBeVisible();
    await expectNoHorizontalOverflow(p);
    await p.waitForTimeout(400);
    await expectNoA11yViolations(p);

    // Verschieben auf … morgen
    await panel.getByRole("button", { name: "Morgen" }).click();
    await expect(p.getByText(`„${title}“ → morgen, 10:00–11:00`)).toBeVisible();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toMatchObject({
      sourceId: "mobil-quelle",
      eventId: "abc123",
      etag: '"mobil-1"',
      allDay: false,
      start: "2026-12-10T09:00:00.000Z",
      end: "2026-12-10T10:00:00.000Z",
      timeZone: "Europe/Berlin",
    });
    // Rückgängig: alte Zeiten mit dem neuen etag
    await p.getByRole("button", { name: "Rückgängig" }).click();
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1]).toMatchObject({
      eventId: "abc123",
      etag: '"mobil-2"',
      start: "2026-12-09T09:00:00.000Z",
      end: "2026-12-09T10:00:00.000Z",
    });

    // Uhrzeit und Dauer ändern
    await main.getByRole("button", { name: new RegExp(`^${title}, 10:00–11:00`) }).click();
    const panel2 = p.getByTestId("event-move");
    await panel2.getByLabel("Beginn (Uhrzeit)").fill("11:30");
    await panel2.getByLabel("Dauer").selectOption("30");
    await expectNoHorizontalOverflow(p);
    await panel2.getByRole("button", { name: "Uhrzeit übernehmen" }).click();
    await expect(p.getByText(`„${title}“ → heute, 11:30–12:00`)).toBeVisible();
    await expect.poll(() => patches.length).toBe(3);
    expect(patches[2]).toMatchObject({
      etag: '"mobil-3"',
      start: "2026-12-09T10:30:00.000Z",
      end: "2026-12-09T11:00:00.000Z",
    });

    // nur lesbar: Hinweis, keine Bedienung
    await main.getByRole("button", { name: new RegExp(`^${readonly}, 14:00`) }).click();
    await expect(p.getByTestId("event-fixed")).toContainText("In Google nur lesbar");
    await expect(p.getByTestId("event-move")).toHaveCount(0);
    await expectNoHorizontalOverflow(p);
  } finally {
    await context.close();
    await deleteCalendarSource(source);
  }
});

test("390 px: Termin mit vorhandener Notiz verknüpfen, Kopf in der Notiz, lösen (#68) @mobile", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const DAY = "2026-12-16";
  const title = uniqueName("Handy-Link");
  const { privat } = await areaIds();
  const [noteId] = await seedNotes([{ title: `${title} Notiz`, area_id: privat }]);
  const source = await seedCalendarSource({
    name: uniqueName("Handy-Quelle"),
    url: `${baseURL}/dev/ics?name=probe`,
  });
  const start = berlinDateTime(DAY, "19:00");
  const end = berlinDateTime(DAY, "21:00");
  const eventId = `link${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const shown = {
    id: `m:${eventId}:${start}`,
    sourceId: "mobil-quelle",
    sourceName: "E2E-Mobil",
    color: "orange",
    uid: eventId,
    title,
    location: null,
    description: null,
    allDay: false,
    start,
    end,
    date: DAY,
    endDate: DAY,
    startMinutes: 19 * 60,
    endMinutes: 21 * 60,
    busy: true,
    recurring: false,
    link: null,
    google: {
      calendarId: "e2e-mobil@example.com",
      eventId,
      etag: '"mobil-1"',
      editable: false,
      recurringEventId: null,
      timeZone: "Europe/Berlin",
    },
  };
  const context = await freshContext(browser, baseURL as string, {
    viewport: page.viewportSize() ?? { width: 390, height: 844 },
    hasTouch: true,
    clockUntil: new Date("2026-12-31T00:00:00Z"),
  });
  try {
    const p = await context.newPage();
    await p.route("**/api/kalender?*", (route) =>
      route.fulfill({
        json: {
          range: { start: "2026-12-14", end: "2026-12-20" },
          events: [shown],
          sources: [],
          fetchedAt: "2026-12-16T08:00:00.000Z",
        },
      }),
    );
    // Kopf in der Notiz fragt den einen Termin ab
    await p.route("**/api/kalender/termin?*", (route) =>
      route.fulfill({ json: { ok: true, event: shown } }),
    );
    await p.clock.setFixedTime(new Date(berlinDateTime(DAY, "09:00")));
    await p.goto(`/kalender?ansicht=woche&tag=${DAY}`);
    const main = p.getByRole("main");
    await main.getByRole("button", { name: new RegExp(`^${title}, 19:00–21:00`) }).click();
    const links = p.getByTestId("event-links");
    await expect(links).toBeVisible();
    await links.getByRole("button", { name: "Vorhandene Notiz oder Aufgabe verknüpfen" }).click();
    await p.getByRole("combobox", { name: "Notiz oder Aufgabe suchen" }).fill(`${title} Notiz`);
    await p.getByRole("option", { name: new RegExp(`${title} Notiz`) }).click();
    await expect(links.getByRole("link", { name: `${title} Notiz` })).toBeVisible();
    await expectNoHorizontalOverflow(p);
    await expectSaved(p);

    // Kopf in der Notiz, Lösen mit Rückgängig
    await p.goto(`/wissen/${noteId}`);
    const head = p.getByTestId("linked-event");
    await expect(head).toContainText(`Mi, 16.12. 19:00–21:00 · ${title}`);
    await expectNoHorizontalOverflow(p);
    await head.getByRole("button", { name: /^Verknüpfung mit Termin/ }).click();
    await expect(head).toHaveCount(0);
    await p.getByRole("button", { name: "Rückgängig" }).click();
    await expect(p.getByTestId("linked-event")).toBeVisible();
    await expectSaved(p);
  } finally {
    await context.close();
    await deleteCalendarSource(source);
    await (await seedDb())
      .from("notes")
      .delete()
      .eq("id", noteId as string);
  }
});

test("390 px: ＋ Termin als Sheet anlegen, Termin bearbeiten und löschen mit Rückgängig @mobile", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const DAY = "2026-12-09";
  const title = uniqueName("Handy-neu");
  const existing = uniqueName("Handy-alt");
  // eine echte (iCal-)Quelle, damit die Seite Termine anfragt; die Antworten kommen abgefangen
  const source = await seedCalendarSource({
    name: uniqueName("Handy-Quelle"),
    url: `${baseURL}/dev/ics?name=probe`,
  });
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const make = (id: string, name: string, from: string, to: string, extra = {}) => {
    const start = berlinDateTime(DAY, from);
    const end = berlinDateTime(DAY, to);
    return {
      id: `m:${id}:${start}`,
      sourceId: "mobil-quelle",
      sourceName: "E2E-Mobil",
      color: "lila",
      uid: id,
      title: name,
      location: null,
      description: null,
      allDay: false,
      start,
      end,
      date: DAY,
      endDate: DAY,
      startMinutes: minutes(from),
      endMinutes: minutes(to),
      busy: true,
      recurring: false,
      link: null,
      google: {
        calendarId: "e2e-mobil@example.com",
        eventId: id,
        etag: '"mobil-1"',
        editable: true,
        recurringEventId: null,
        timeZone: "Europe/Berlin",
      },
      ...extra,
    };
  };
  const listed = [make("alt123", existing, "10:00", "11:00")];
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  const context = await freshContext(browser, baseURL as string, {
    viewport: page.viewportSize() ?? { width: 390, height: 844 },
    hasTouch: true,
    clockUntil: new Date("2026-12-31T00:00:00Z"),
  });
  try {
    const p = await context.newPage();
    await p.route("**/api/kalender?*", (route) =>
      route.fulfill({
        json: {
          range: { start: "2026-12-07", end: "2026-12-13" },
          events: listed,
          sources: [
            {
              id: "mobil-quelle",
              name: "E2E-Mobil",
              color: "lila",
              count: listed.length,
              error: null,
              writable: true,
              primary: true,
            },
          ],
          fetchedAt: "2026-12-09T08:00:00.000Z",
        },
      }),
    );
    await p.route("**/api/kalender/termin**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      calls.push({ method: request.method(), path: url.pathname, body });
      if (request.method() === "POST" && url.pathname === "/api/kalender/termin") {
        const created = make("neu456", String(body.summary), "09:00", "10:00", {
          location: body.location || null,
        });
        created.google.etag = '"mobil-neu"';
        listed.push(created);
        return route.fulfill({ json: { ok: true, event: created } });
      }
      if (request.method() === "DELETE") {
        const index = listed.findIndex((e) => e.uid === body.eventId);
        if (index >= 0) listed.splice(index, 1);
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname.endsWith("/wiederherstellen")) {
        listed.push(make(String(body.eventId), String(body.summary), "10:00", "11:00"));
        return route.fulfill({
          json: { ok: true, how: "same", event: listed[listed.length - 1] },
        });
      }
      return route.fulfill({ json: { ok: true, etag: '"mobil-2"' } });
    });
    await p.clock.setFixedTime(new Date(berlinDateTime(DAY, "08:00")));
    await p.goto(`/kalender?ansicht=woche&tag=${DAY}`);
    const main = p.getByRole("main");

    // ＋ Termin → Sheet von unten, ohne Überlauf, bedienbar
    await p.getByRole("button", { name: "Termin anlegen" }).click();
    const sheet = p.getByTestId("new-event");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Titel")).toBeFocused();
    await expect(sheet.getByLabel("Beginn (Uhrzeit)")).toHaveValue("09:00");
    await expectNoHorizontalOverflow(p);
    await p.waitForTimeout(400);
    await expectNoA11yViolations(p);
    await sheet.getByLabel("Titel").fill(title);
    await sheet.getByLabel("Ort (optional)").fill("Büro");
    await sheet.getByRole("button", { name: "Anlegen" }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: {
        sourceId: "mobil-quelle",
        summary: title,
        location: "Büro",
        allDay: false,
        start: "2026-12-09T08:00:00.000Z",
        end: "2026-12-09T09:00:00.000Z",
        timeZone: "Europe/Berlin",
      },
    });
    await expect(p.getByText(`Termin „${title}“ angelegt`)).toBeVisible();
    await expect(
      main.getByRole("button", { name: new RegExp(`^${title}, 09:00–10:00`) }),
    ).toBeVisible();
    // Rückgängig = löschen
    await p.getByRole("button", { name: "Rückgängig" }).click();
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[1]).toMatchObject({
      method: "DELETE",
      body: { sourceId: "mobil-quelle", eventId: "neu456" },
    });
    await expect(main.getByRole("button", { name: new RegExp(`^${title}`) })).toHaveCount(0);

    // bestehenden Termin: Titel ändern, löschen, Rückgängig holt zurück
    await main.getByRole("button", { name: new RegExp(`^${existing}, 10:00–11:00`) }).click();
    const edit = p.getByTestId("event-edit");
    await expect(edit).toBeVisible();
    await expectNoHorizontalOverflow(p);
    await p.waitForTimeout(400);
    await expectNoA11yViolations(p);
    await edit.getByLabel("Titel").fill(`${existing} 2`);
    await edit.getByLabel("Titel").press("Enter");
    await expect.poll(() => calls.length).toBe(3);
    expect(calls[2]).toMatchObject({
      method: "PATCH",
      body: { eventId: "alt123", etag: '"mobil-1"', summary: `${existing} 2` },
    });
    await p.keyboard.press("Escape");
    await main.getByRole("button", { name: new RegExp(`^${existing} 2, 10:00–11:00`) }).click();
    await p.getByTestId("event-delete").click();
    await expect(p.getByText(`Termin „${existing} 2“ gelöscht`)).toBeVisible();
    await expect.poll(() => calls.length).toBe(4);
    expect(calls[3]).toMatchObject({
      method: "DELETE",
      body: { sourceId: "mobil-quelle", eventId: "alt123", etag: '"mobil-2"' },
    });
    await p
      .locator("[data-sonner-toast]")
      .filter({ hasText: "gelöscht" })
      .getByRole("button", { name: "Rückgängig" })
      .click();
    await expect.poll(() => calls.length).toBe(5);
    expect(calls[4]).toMatchObject({
      method: "POST",
      path: "/api/kalender/termin/wiederherstellen",
      body: {
        sourceId: "mobil-quelle",
        eventId: "alt123",
        summary: `${existing} 2`,
        allDay: false,
        start: "2026-12-09T09:00:00.000Z",
        end: "2026-12-09T10:00:00.000Z",
      },
    });
    await expect(
      main.getByRole("button", { name: new RegExp(`^${existing} 2, 10:00–11:00`) }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(p);
  } finally {
    await context.close();
    await deleteCalendarSource(source);
  }
});
