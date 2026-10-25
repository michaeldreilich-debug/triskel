import { describe, expect, it } from "vitest";
import {
  activateTab,
  closeTab,
  describeHref,
  followHref,
  HOME_HREF,
  MAX_TABS,
  moveTab,
  normalizeHref,
  openTab,
  parseTabs,
  resolveTitle,
  restoreTabs,
  saveScroll,
  serializeTabs,
  setTitle,
  stepTab,
  type Tab,
  type TabsState,
} from "./model";

const tab = (id: string, href: string, usedAt = 0, extra: Partial<Tab> = {}): Tab => ({
  id,
  href,
  title: "",
  usedAt,
  ...extra,
});

const state = (tabs: Tab[], activeId = tabs[0]?.id ?? ""): TabsState => ({ tabs, activeId });

let counter = 0;
const makeId = () => `neu-${++counter}`;

const lookup = {
  note: (id: string) => (id === "n1" ? "Secound Brain Fehler" : undefined),
  project: (id: string) => (id === "p1" ? "Rezeptbuch" : undefined),
  task: (id: string) => (id === "t1" ? "Belege sortieren" : undefined),
  recap: (id: string) => (id === "r1" ? "Wochenrückblick KW 42" : undefined),
};

describe("normalizeHref", () => {
  it("nimmt App-Seiten samt Abfrage, kodiert einheitlich", () => {
    expect(normalizeHref("/kalender?ansicht=woche&tag=2026-10-19")).toBe(
      "/kalender?ansicht=woche&tag=2026-10-19",
    );
    expect(normalizeHref("/wissen/abc?aufgabe=t1#kopf")).toBe("/wissen/abc?aufgabe=t1#kopf");
    expect(normalizeHref("/aufgaben?q=a%20b")).toBe("/aufgaben?q=a+b");
    expect(normalizeHref("/aufgaben?q=a+b")).toBe("/aufgaben?q=a+b");
  });

  it("weist öffentliche Seiten, Login, Schnittstellen und fremde Adressen ab", () => {
    for (const raw of [
      "/login",
      "/datenschutz",
      "/mfa",
      "/ki-zugang",
      "/api/mcp",
      "/dev/ui",
      "/",
      "//evil.example/heute",
      "https://evil.example/heute",
      "/\\evil.example",
      "heute",
      "",
      null,
    ]) {
      expect(normalizeHref(raw)).toBeNull();
    }
  });
});

describe("describeHref / resolveTitle", () => {
  it("erkennt Notiz, Projekt, Aufgabe, Rückblick und Seiten", () => {
    expect(describeHref("/wissen/n1")).toMatchObject({ kind: "note", id: "n1", label: "Notiz" });
    expect(describeHref("/projekte/p1?reiter=aufgaben")).toMatchObject({
      kind: "project",
      id: "p1",
    });
    expect(describeHref("/projekte/zeitstrahl")).toMatchObject({
      kind: "page",
      label: "Zeitstrahl",
    });
    expect(describeHref("/kalender?ansicht=woche&aufgabe=t1")).toMatchObject({
      kind: "task",
      taskId: "t1",
      page: "Kalender",
    });
    expect(describeHref("/rueckblicke/woche-2026-10-12").label).toBe("Wochenrückblick KW 42");
    expect(describeHref("/rueckblicke/monat-2026-10").label).toBe("Monatsrückblick 10/2026");
    expect(describeHref("/rueckblicke/r1")).toMatchObject({ kind: "recap", id: "r1" });
  });

  it("Titel aus den Daten, Aufgabe vor der Seite, unbekannt = null", () => {
    expect(resolveTitle(describeHref("/wissen/n1"), lookup)).toBe("Secound Brain Fehler");
    expect(resolveTitle(describeHref("/projekte/p1"), lookup)).toBe("Rezeptbuch");
    expect(resolveTitle(describeHref("/wissen/n1?aufgabe=t1"), lookup)).toBe("Belege sortieren");
    expect(resolveTitle(describeHref("/rueckblicke/r1"), lookup)).toBe("Wochenrückblick KW 42");
    expect(resolveTitle(describeHref("/kalender"), lookup)).toBe("Kalender");
    expect(resolveTitle(describeHref("/heute"), lookup)).toBe("Heute");
    // Notiz im Papierkorb oder noch nicht geladen: gemerkter Titel bleibt
    expect(resolveTitle(describeHref("/wissen/weg"), lookup)).toBeNull();
    expect(resolveTitle(describeHref("/heute?aufgabe=weg"), lookup)).toBeNull();
  });

  it("Umbenennen: neuer Titel ersetzt den gemerkten, gleicher Titel ändert nichts", () => {
    const s = state([tab("a", "/wissen/n1", 0, { title: "Alt" })]);
    const renamed = setTitle(s, "a", "Neu");
    expect(renamed.tabs[0]?.title).toBe("Neu");
    expect(setTitle(renamed, "a", "Neu")).toBe(renamed);
    expect(setTitle(s, "a", "x".repeat(500)).tabs[0]?.title).toHaveLength(200);
  });
});

describe("öffnen, aktivieren, schließen", () => {
  it("öffnet rechts neben dem aktiven und aktiviert", () => {
    const s = state([tab("a", "/wissen/n1"), tab("b", "/heute")], "a");
    const { state: next, evicted } = openTab(s, "/kalender", { id: "c", now: 5 });
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(next.activeId).toBe("c");
    expect(evicted).toBeNull();
    expect(openTab(s, "/kalender", { id: "d", now: 5, activate: false }).state.activeId).toBe("a");
  });

  it("Obergrenze: der am längsten unbenutzte (nie der aktive) weicht", () => {
    const tabs = Array.from({ length: MAX_TABS }, (_, i) => tab(`t${i}`, "/heute", 10 + i));
    // der aktive ist der älteste – er bleibt trotzdem
    const s = state(tabs, "t0");
    const { state: next, evicted } = openTab(s, "/kalender", { id: "neu", now: 99 });
    expect(next.tabs).toHaveLength(MAX_TABS);
    expect(evicted?.id).toBe("t1");
    expect(next.tabs.map((t) => t.id)).toContain("t0");
    expect(next.tabs.map((t) => t.id)).toContain("neu");
  });

  it("aktivieren merkt die Zeit, unbekannte ID ändert nichts", () => {
    const s = state([tab("a", "/heute", 1), tab("b", "/inbox", 2)], "a");
    const next = activateTab(s, "b", 50);
    expect(next.activeId).toBe("b");
    expect(next.tabs[1]?.usedAt).toBe(50);
    expect(activateTab(s, "x", 50)).toBe(s);
  });

  it("aktiven schließen → zuletzt benutzter wird aktiv; anderen schließen → aktiver bleibt", () => {
    const s = state(
      [tab("a", "/wissen/n1", 30), tab("b", "/kalender", 40), tab("c", "/inbox", 10)],
      "b",
    );
    const closed = closeTab(s, "b", { now: 60, makeId });
    expect(closed.state.tabs.map((t) => t.id)).toEqual(["a", "c"]);
    expect(closed.activate?.id).toBe("a");
    expect(closed.state.activeId).toBe("a");
    const other = closeTab(s, "c", { now: 60, makeId });
    expect(other.activate).toBeNull();
    expect(other.state.activeId).toBe("b");
  });

  it("letzten schließen → Heute", () => {
    const closed = closeTab(state([tab("a", "/wissen/n1")]), "a", { now: 1, makeId });
    expect(closed.state.tabs).toHaveLength(1);
    expect(closed.activate?.href).toBe(HOME_HREF);
    expect(closed.state.activeId).toBe(closed.activate?.id);
  });

  it("wechseln im Kreis, ziehen sortiert um", () => {
    const s = state([tab("a", "/heute"), tab("b", "/inbox"), tab("c", "/kalender")], "c");
    expect(stepTab(s, 1)).toBe("a");
    expect(stepTab(s, -1)).toBe("b");
    expect(stepTab(state([tab("a", "/heute")]), 1)).toBeNull();
    expect(moveTab(s, "a", 3).tabs.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(moveTab(s, "c", 0).tabs.map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(moveTab(s, "a", 0)).toBe(s);
  });
});

describe("Adresse folgen und Scroll-Stelle", () => {
  it("der aktive Reiter folgt der Adresse; neue Seite vergisst die Scroll-Stelle", () => {
    const scroll = { y: 800, areas: { notiz: { top: 1200, left: 0 } } };
    const s = state([tab("a", "/wissen/n1", 0, { scroll }), tab("b", "/heute")], "a");
    const panel = followHref(s, "/wissen/n1?aufgabe=t1");
    expect(panel.tabs[0]?.href).toBe("/wissen/n1?aufgabe=t1");
    expect(panel.tabs[0]?.scroll).toBeUndefined();
    expect(panel.tabs[1]?.href).toBe("/heute");
    // nur die Sprungmarke anders: Scroll-Stelle bleibt
    expect(followHref(s, "/wissen/n1#kopf").tabs[0]?.scroll).toEqual(scroll);
    expect(followHref(s, "/wissen/n1")).toBe(s);
  });

  it("Scroll-Stelle je Reiter merken", () => {
    const s = state([tab("a", "/heute"), tab("b", "/inbox")], "a");
    const next = saveScroll(s, "a", { y: 300, areas: {} });
    expect(next.tabs[0]?.scroll?.y).toBe(300);
    expect(saveScroll(s, "x", { y: 1, areas: {} })).toBe(s);
  });
});

describe("speichern und wiederherstellen", () => {
  it("serialisieren und lesen ergibt denselben Stand", () => {
    const s = state(
      [
        tab("a", "/wissen/n1?aufgabe=t1", 5, {
          title: "Secound Brain Fehler",
          scroll: { y: 120, areas: { notiz: { top: 900, left: 0 } } },
        }),
        tab("b", "/kalender?ansicht=woche&tag=2026-10-19", 9, { title: "Kalender" }),
      ],
      "b",
    );
    expect(parseTabs(serializeTabs(s))).toEqual(s);
  });

  it("Kaputtes, Fremdes und anderes Format wirft nicht", () => {
    expect(parseTabs(null)).toBeNull();
    expect(parseTabs("{kaputt")).toBeNull();
    expect(parseTabs(JSON.stringify({ v: 2, activeId: "a", tabs: [] }))).toBeNull();
    expect(parseTabs(JSON.stringify([1, 2]))).toBeNull();
    const mixed = parseTabs(
      JSON.stringify({
        v: 1,
        activeId: "weg",
        tabs: [
          { id: "a", href: "https://evil.example/heute" },
          { id: "b", href: "/login" },
          { id: "c", href: "/inbox", title: 5, usedAt: "x", scroll: { y: -3 } },
          { id: "c", href: "/heute" },
          { id: "d", href: "/kalender", usedAt: 7, scroll: { y: 50, areas: { r: { top: 1 } } } },
        ],
      }),
    );
    expect(mixed?.tabs.map((t) => t.id)).toEqual(["c", "d"]);
    expect(mixed?.tabs[0]).toMatchObject({ title: "", usedAt: 0, scroll: undefined });
    expect(mixed?.tabs[1]?.scroll).toEqual({ y: 50, areas: {} });
    // aktiver unbekannt → zuletzt benutzter
    expect(mixed?.activeId).toBe("d");
  });

  it("älterer Stand über der Obergrenze: aktiver und zuletzt benutzte bleiben", () => {
    const tabs = Array.from({ length: MAX_TABS + 3 }, (_, i) => tab(`t${i}`, "/heute", i));
    const parsed = parseTabs(serializeTabs(state(tabs, "t0")));
    expect(parsed?.tabs).toHaveLength(MAX_TABS);
    expect(parsed?.tabs.map((t) => t.id)).toContain("t0");
    expect(parsed?.tabs.map((t) => t.id)).not.toContain("t1");
  });

  it("Neuladen: gleiche Adresse → derselbe Reiter samt Scroll-Stelle", () => {
    const scroll = { y: 640, areas: {} };
    const own = serializeTabs(
      state([tab("a", "/wissen/n1", 1, { scroll }), tab("b", "/kalender", 2)], "a"),
    );
    const restored = restoreTabs({ session: own, local: null }, "/wissen/n1", { now: 9, makeId });
    expect(restored?.state.activeId).toBe("a");
    expect(restored?.state.tabs).toHaveLength(2);
    expect(restored?.scroll).toEqual(scroll);
  });

  it("andere Adresse im selben Fenster: vorhandener Reiter wird aktiv, sonst übernimmt der aktive", () => {
    const own = serializeTabs(
      state([tab("a", "/wissen/n1", 1), tab("b", "/kalender?ansicht=monat", 2)], "a"),
    );
    const known = restoreTabs({ session: own, local: null }, "/kalender?ansicht=monat", {
      now: 9,
      makeId,
    });
    expect(known?.state.activeId).toBe("b");
    // eingetippte Adresse, Lesezeichen: ersetzt die Seite des aktiven Reiters, kein neuer
    const typed = restoreTabs({ session: own, local: null }, "/inbox", { now: 9, makeId });
    expect(typed?.state.tabs.map((t) => t.href)).toEqual(["/inbox", "/kalender?ansicht=monat"]);
    expect(typed?.state.activeId).toBe("a");
    expect(typed?.scroll).toBeNull();
  });

  it("neues Fenster: gleiche Seite übernimmt die Adresse, sonst neuer Reiter", () => {
    const last = serializeTabs(
      state([tab("a", "/wissen/n1", 1), tab("b", "/kalender?ansicht=monat", 2)], "a"),
    );
    const same = restoreTabs({ session: null, local: last }, "/kalender?ansicht=woche", {
      now: 9,
      makeId,
    });
    expect(same?.state.activeId).toBe("b");
    expect(same?.state.tabs[1]?.href).toBe("/kalender?ansicht=woche");
    expect(same?.scroll).toBeNull();
    const fresh = restoreTabs({ session: null, local: last }, "/inbox", { now: 9, makeId });
    expect(fresh?.state.tabs).toHaveLength(3);
    expect(fresh?.state.tabs.find((t) => t.id === fresh.state.activeId)?.href).toBe("/inbox");
  });

  it("Fremd-Fenster: die eigene Liste (sessionStorage) gewinnt gegen den letzten Schreiber", () => {
    const own = serializeTabs(state([tab("a", "/wissen/n1", 1), tab("b", "/kalender", 2)], "a"));
    const foreign = serializeTabs(state([tab("x", "/inbox", 5)], "x"));
    const restored = restoreTabs({ session: own, local: foreign }, "/wissen/n1", {
      now: 9,
      makeId,
    });
    expect(restored?.state.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    // neues Fenster ohne eigene Liste: übernimmt den letzten Stand und hängt die Adresse an
    const newWindow = restoreTabs({ session: null, local: foreign }, "/kalender", {
      now: 9,
      makeId,
    });
    expect(newWindow?.state.tabs.map((t) => t.href)).toEqual(["/inbox", "/kalender"]);
    // kaputter eigener Stand: Rückfall auf den letzten Stand aller Fenster
    expect(
      restoreTabs({ session: "{kaputt", local: foreign }, "/inbox", { now: 9, makeId })?.state.tabs,
    ).toHaveLength(1);
  });

  it("ohne gespeicherte Liste: ein Reiter mit der Adresse; fremde Adresse ändert nichts", () => {
    const first = restoreTabs({ session: null, local: null }, "/heute", { now: 1, makeId });
    expect(first?.state.tabs.map((t) => t.href)).toEqual(["/heute"]);
    expect(restoreTabs({ session: null, local: null }, "/login", { now: 1, makeId })).toBeNull();
  });
});
