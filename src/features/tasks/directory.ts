import type { QueryClient } from "@tanstack/react-query";
import type { TaskDirectory } from "@/features/outliner/directory";
import { type TaskActions, tasksKey } from "./api";
import type { TaskRow } from "./types";

/**
 * Aufgaben für den Outliner (Block → Aufgabe) aus dem TanStack-Query-Cache.
 * Neue Aufgaben landen im Bereich und Projekt der Notiz (context zum Zeitpunkt des Anlegens).
 */
export function createQueryTaskDirectory(
  queryClient: QueryClient,
  actions: TaskActions,
  options: {
    context: () => { areaId: string; projectId: string | null };
    open: (taskId: string) => void;
  },
): TaskDirectory {
  // Nachschlagen über eine Map je Cache-Stand statt `find` je Block (O-15)
  let cached: TaskRow[] | undefined;
  let byId = new Map<string, TaskRow>();
  const lookup = (id: string) => {
    const rows = queryClient.getQueryData<TaskRow[]>(tasksKey);
    if (rows !== cached) {
      cached = rows;
      byId = new Map((rows ?? []).map((row) => [row.id, row]));
    }
    return byId.get(id);
  };
  return {
    get(id) {
      const task = lookup(id);
      return task ? { id, title: task.title, done: task.status === "erledigt" } : undefined;
    },
    create(title) {
      const { areaId, projectId } = options.context();
      return actions.create({ title, area_id: areaId, project_id: projectId, in_inbox: false }).id;
    },
    toggle: (id) => actions.toggle(id),
    open: (id) => options.open(id),
    subscribe(listener) {
      return queryClient.getQueryCache().subscribe((event) => {
        // nur geänderte Daten, nicht jedes Beobachter-Ereignis
        if (event.type === "updated" && event.query.queryKey[0] === tasksKey[0]) listener();
      });
    },
  };
}
