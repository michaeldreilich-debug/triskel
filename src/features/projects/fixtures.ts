/** Testdaten für Unit-Tests. */
import type { ProjectRow } from "./types";

export const project = (id: string, extra: Partial<ProjectRow> = {}): ProjectRow => ({
  id,
  area_id: "fw",
  title: id,
  status: "aktiv",
  priority: null,
  start_date: null,
  target_date: null,
  why: "",
  outcome: [],
  links: [],
  body: null,
  body_text: "",
  next_task_id: null,
  last_activity_at: "2026-10-01T10:00:00Z",
  closing_reflection: null,
  sort: "a0",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  deleted_at: null,
  ...extra,
});
