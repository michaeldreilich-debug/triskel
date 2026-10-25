import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { type SaveOp, SaveQueue } from "./save-queue";
import { trashWithUndo } from "./soft-delete";

type Row = { id: string; title: string };
const key = ["notes"];

function setup(rows: Row[]) {
  const calls: SaveOp[][] = [];
  const queue = new SaveQueue({ persist: async (batch) => void calls.push(batch) });
  const queryClient = new QueryClient();
  queryClient.setQueryData<Row[]>(key, rows);
  let undo: (() => void) | undefined;
  const notify = vi.fn((_message: string, onUndo: () => void) => {
    undo = onUndo;
  });
  return { calls, queue, queryClient, notify, undo: () => undo?.() };
}

describe("In den Papierkorb mit Rückgängig", () => {
  it("setzt deleted_at, nimmt die Zeile aus dem Cache und Rückgängig holt beides zurück", async () => {
    const a = { id: "n1", title: "Wartungsplan" };
    const b = { id: "n2", title: "Fahrzeuge" };
    const { calls, queue, queryClient, notify, undo } = setup([a, b]);
    const onTrashed = vi.fn();

    trashWithUndo(queue, queryClient, {
      table: "notes",
      queryKey: key,
      row: a,
      message: "„Wartungsplan“ liegt im Papierkorb",
      onTrashed,
      notify,
    });
    expect(notify).toHaveBeenCalledWith("„Wartungsplan“ liegt im Papierkorb", expect.any(Function));
    expect(onTrashed).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(key)).toEqual([b]);
    await queue.flush();
    expect(calls[0]?.[0]?.values.deleted_at).toEqual(expect.any(String));

    undo();
    await queue.flush();
    expect(calls[1]).toEqual([
      { table: "notes", id: "n1", mode: "update", values: { deleted_at: null } },
    ]);
    expect(queryClient.getQueryData(key)).toEqual([b, a]);
  });

  it("fügt beim Zurückholen nicht doppelt ein und nutzt die gewünschte Stelle", () => {
    const a = { id: "r1", title: "KW 41" };
    const b = { id: "r2", title: "KW 40" };
    const { queue, queryClient, notify, undo } = setup([a, b]);
    trashWithUndo(queue, queryClient, {
      table: "recaps",
      queryKey: key,
      row: a,
      message: "weg",
      restore: (rows, row) => [row, ...rows],
      notify,
    });
    undo();
    expect(queryClient.getQueryData(key)).toEqual([a, b]);
    trashWithUndo(queue, queryClient, {
      table: "recaps",
      queryKey: key,
      row: b,
      message: "weg",
      notify,
    });
    expect(queryClient.getQueryData(key)).toEqual([a]);
    // die Zeile kam vor dem Rückgängig schon vom Server zurück → nicht doppelt
    queryClient.setQueryData<Row[]>(key, [a, b]);
    undo();
    expect(queryClient.getQueryData(key)).toEqual([a, b]);
  });
});
