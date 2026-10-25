/**
 * Wochenrückblick (B12) gegen das Testprojekt: week_stats mit festen Testdaten (Zahlen und
 * Tagesverlauf), Anlegen und Abschließen über die Speicher-Warteschlange (rpc:close_recap) – der
 * Snapshot bleibt stabil, auch wenn später noch etwas in der Woche erledigt wird. Die Woche liegt
 * weit in der Vergangenheit, damit andere Tests die Zahlen nicht beeinflussen.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { fetchRecaps, fetchWeekStats } from "@/features/recaps/api";
import {
  createSupabasePersister,
  type PersisterClient,
  RPC_CLOSE_RECAP,
  RPC_RECAP_ANSWER,
} from "@/lib/save-queue/supabase-persister";
import { runMarker, userClient } from "../support/supabase-node";

const a = userClient(inject("sessionA"));
const b = userClient(inject("sessionB"));
const marker = runMarker();
const persist = createSupabasePersister(() => a as unknown as PersisterClient);

const WEEK = { start: "2020-03-02", end: "2020-03-08" };
const recapId = crypto.randomUUID();
const taskIds: string[] = [];
let areaId = "";

async function insertDone(title: string, completedAt: string) {
  const id = crypto.randomUUID();
  taskIds.push(id);
  const { error } = await a.from("tasks").insert({
    id,
    area_id: areaId,
    title: `${title} ${marker}`,
    sort: "a0",
    status: "erledigt",
    completed_at: completedAt,
  });
  expect(error).toBeNull();
}

beforeAll(async () => {
  const areas = await a.from("areas").select("id").eq("seed_key", "beruf").single();
  areaId = areas.data?.id ?? "";
  await a.from("recaps").delete().eq("period_start", WEEK.start);
  // Dienstag 09:00 und 17:00 Ortszeit (Winterzeit, UTC+1); Montag danach zählt nicht
  await insertDone("Schläuche", "2020-03-03T08:00:00Z");
  await insertDone("Bericht", "2020-03-03T16:00:00Z");
  await insertDone("Danach", "2020-03-09T08:00:00Z");
});

afterAll(async () => {
  await a.from("recaps").delete().eq("id", recapId);
  await a.from("tasks").delete().in("id", taskIds);
});

describe("Wochenrückblick", () => {
  it("week_stats: Zahlen und Tagesverlauf stimmen mit den festen Testdaten", async () => {
    const stats = await fetchWeekStats(a, WEEK.start, WEEK.end);
    expect(stats?.tasksDone).toBe(2);
    expect(stats?.byArea).toEqual([expect.objectContaining({ name: "Beruf", count: 2 })]);
    const tuesday = stats?.activity?.find((d) => d.date === "2020-03-03");
    expect(tuesday?.done.map((t) => t.title)).toEqual([`Schläuche ${marker}`, `Bericht ${marker}`]);
    expect(stats?.activity).toHaveLength(7);
  });

  it("anlegen und abschließen über die Warteschlange; der Snapshot bleibt stabil", async () => {
    await persist([
      {
        table: "recaps",
        id: recapId,
        mode: "upsert",
        values: {
          kind: "woche",
          period_start: WEEK.start,
          period_end: WEEK.end,
          mood: 4,
          answers: { good: `Ruhige Woche ${marker}` },
          focus_next: ["Bericht"],
          themes: ["schlaf"],
          questions: [{ key: "good", label: "Was lief gut?", type: "text" }],
          deleted_at: null,
        },
      },
      { table: RPC_CLOSE_RECAP, id: recapId, mode: "update", values: {} },
    ]);
    const closed = (await fetchRecaps(a)).find((r) => r.id === recapId);
    expect(closed?.closed_at).not.toBeNull();
    expect(closed?.stats?.tasksDone).toBe(2);
    expect(closed?.questions).toHaveLength(1);

    // nachträglich in der Woche erledigt: live 3, der Snapshot bleibt 2
    await insertDone("Nachzügler", "2020-03-04T10:00:00Z");
    expect((await fetchWeekStats(a, WEEK.start, WEEK.end))?.tasksDone).toBe(3);
    // erneutes Abschließen ändert nichts
    await persist([{ table: RPC_CLOSE_RECAP, id: recapId, mode: "update", values: {} }]);
    const again = (await fetchRecaps(a)).find((r) => r.id === recapId);
    expect(again?.stats?.tasksDone).toBe(2);
    expect(again?.closed_at).toBe(closed?.closed_at);
  });

  it("durchsuchbar über die Antworten; B sieht nichts", async () => {
    const { data, error } = await a.rpc("search_all", { p_query: `Ruhige ${marker}` });
    expect(error).toBeNull();
    expect((data ?? []).some((row) => row.kind === "rueckblick" && row.id === recapId)).toBe(true);
    expect((await fetchRecaps(b)).some((r) => r.id === recapId)).toBe(false);
  });

  it("zweites Gerät legt dieselbe Woche an (feste ID): Antworten bleiben stehen (D-3)", async () => {
    // wie createWeek: nur Kennung der Woche, Fragen und deleted_at
    await persist([
      {
        table: "recaps",
        id: recapId,
        mode: "upsert",
        values: {
          kind: "woche",
          period_start: WEEK.start,
          period_end: WEEK.end,
          questions: [{ key: "good", label: "Was lief gut?", type: "text" }],
          deleted_at: null,
        },
      },
    ]);
    const row = (await fetchRecaps(a)).find((r) => r.id === recapId);
    expect(row?.answers).toEqual({ good: `Ruhige Woche ${marker}` });
    expect(row?.mood).toBe(4);
    expect(row?.focus_next).toEqual(["Bericht"]);
  });
});

describe("Antworten feldweise (Review Teil B, V-2)", () => {
  it("zwei Schreiber: die App schreibt nur ihren Schlüssel, die KI-Texte bleiben", async () => {
    const id = crypto.randomUUID();
    const { error } = await a.from("recaps").insert({
      id,
      kind: "woche",
      period_start: "2019-06-03",
      period_end: "2019-06-09",
      answers: { good: `Lauf ${marker}` },
    });
    expect(error).toBeNull();
    try {
      // „KI“ (bzw. iPhone) füllt inzwischen ein anderes Feld – der Cache der App kennt es nicht
      await a
        .from("recaps")
        .update({ answers: { good: `Lauf ${marker}`, gespraech: "Von der KI" } })
        .eq("id", id);
      await persist([
        { table: RPC_RECAP_ANSWER, id, mode: "update", values: { hard: "Schlaf", takeaway: null } },
      ]);
      const row = (await a.from("recaps").select("answers").eq("id", id).single()).data;
      expect(row?.answers).toEqual({
        good: `Lauf ${marker}`,
        gespraech: "Von der KI",
        hard: "Schlaf",
        takeaway: null,
      });
      expect((await fetchRecaps(b)).some((r) => r.id === id)).toBe(false);
    } finally {
      await a.from("recaps").delete().eq("id", id);
    }
  });
});
