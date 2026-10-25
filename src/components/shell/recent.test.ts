import { describe, expect, it } from "vitest";
import { recentItems } from "./recent";

const note = (id: string, edited: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Notiz ${id}`,
  area_id: "fw",
  edited_at: edited,
  updated_at: "2026-10-01T00:00:00Z",
  archived_at: null,
  ...extra,
});
const project = (id: string, updated: string, area = "fw") => ({
  id,
  title: `Projekt ${id}`,
  area_id: area,
  updated_at: updated,
});

describe("recentItems", () => {
  it("mischt Notizen und Projekte, neueste zuerst, höchstens fünf", () => {
    const items = recentItems(
      {
        notes: [
          note("a", "2026-10-16T08:00:00Z"),
          note("b", "2026-10-16T10:00:00Z"),
          note("c", "2026-10-10T10:00:00Z"),
          note("d", "2026-10-11T10:00:00Z"),
        ],
        projects: [project("p", "2026-10-16T09:00:00Z"), project("q", "2026-10-12T09:00:00Z")],
      },
      null,
    );
    expect(items.map((i) => i.id)).toEqual(["b", "p", "a", "q", "d"]);
    expect(items[1]).toMatchObject({ kind: "project", href: "/projekte/p" });
    expect(items[0]).toMatchObject({ kind: "note", href: "/wissen/b", title: "Notiz b" });
  });

  it("filtert nach Bereich und lässt archivierte Notizen weg", () => {
    const items = recentItems(
      {
        notes: [
          note("a", "2026-10-16T08:00:00Z", { archived_at: "2026-10-16T09:00:00Z" }),
          note("b", "2026-10-16T07:00:00Z", { area_id: "privat" }),
          note("c", "2026-10-15T07:00:00Z"),
        ],
        projects: [project("p", "2026-10-16T09:00:00Z", "privat")],
      },
      "fw",
    );
    expect(items.map((i) => i.id)).toEqual(["c"]);
  });

  it("ohne Titel: „Ohne Titel“", () => {
    const [item] = recentItems(
      { notes: [note("a", "2026-10-16T08:00:00Z", { title: " " })], projects: [] },
      null,
    );
    expect(item.title).toBe("Ohne Titel");
  });

  it("Aufgaben nur mit inhaltlicher Bearbeitung, ohne erledigte; Inbox nur bei „Alles“ (#38)", () => {
    const task = (id: string, edited: string | null, extra: Record<string, unknown> = {}) => ({
      id,
      title: `Aufgabe ${id}`,
      area_id: "fw" as string | null,
      edited_at: edited,
      status: "offen" as const,
      ...extra,
    });
    const tasks = [
      task("t1", "2026-10-16T11:00:00Z"),
      task("t2", null),
      task("t3", "2026-10-16T12:00:00Z", { status: "erledigt" }),
      task("t4", "2026-10-16T13:00:00Z", { area_id: null }),
    ];
    const sources = { notes: [note("a", "2026-10-16T10:00:00Z")], projects: [], tasks };
    const all = recentItems(sources, null, { taskHref: (id) => `/heute?aufgabe=${id}` });
    expect(all.map((i) => i.id)).toEqual(["t4", "t1", "a"]);
    expect(all[1]).toMatchObject({ kind: "task", href: "/heute?aufgabe=t1", title: "Aufgabe t1" });
    expect(recentItems(sources, "fw").map((i) => i.id)).toEqual(["t1", "a"]);
    expect(recentItems(sources, "fw")[0]?.href).toBe("/aufgaben?aufgabe=t1");
  });
});
