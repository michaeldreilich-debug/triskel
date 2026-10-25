/**
 * Konfiguration einer Ansicht (gespeichert in saved_views.config, jsonb) – defensiv gelesen:
 * Unbekannte Felder oder Werte fallen auf die Vorgabe zurück, statt die Ansicht zu zerstören.
 */
import { z } from "zod";
import { DATE_PRESETS, type FieldDef, VIEW_TYPES, type ViewConfig } from "./engine";

export const ENTITIES = ["tasks", "projects", "notes"] as const;
export type Entity = (typeof ENTITIES)[number];

const filterSchema = z.union([
  z.object({ field: z.string(), op: z.literal("in"), values: z.array(z.string()).max(500) }),
  z.object({ field: z.string(), op: z.literal("date"), value: z.enum(DATE_PRESETS) }),
]);

const configSchema = z.object({
  type: z.enum(VIEW_TYPES as [ViewConfig["type"], ...ViewConfig["type"][]]).optional(),
  filters: z.array(z.unknown()).optional(),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
  group: z.string().nullable().optional(),
  board: z.string().optional(),
  columns: z.array(z.string()).nullable().optional(),
});

/** Gespeicherte Konfiguration gegen die Felder der Datenbank prüfen; Rest aus der Vorgabe. */
export function parseViewConfig<R, C>(
  raw: unknown,
  fields: FieldDef<R, C>[],
  defaults: ViewConfig,
  boardFields: string[],
): ViewConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return defaults;
  const value = parsed.data;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const filters = (value.filters ?? defaults.filters)
    .map((f) => filterSchema.safeParse(f))
    .filter((r) => r.success)
    .map((r) => r.data)
    .filter((f) => {
      const field = byKey.get(f.field);
      if (!field?.filterable) return false;
      return f.op === "in"
        ? field.type === "enum"
        : field.type === "date" || field.type === "timestamp";
    });
  const sort =
    value.sort && byKey.get(value.sort.field)?.sortable !== false && byKey.has(value.sort.field)
      ? value.sort
      : defaults.sort;
  const group =
    value.group === undefined
      ? defaults.group
      : value.group && byKey.get(value.group)?.groupable
        ? value.group
        : null;
  const board = value.board && boardFields.includes(value.board) ? value.board : defaults.board;
  const columns =
    value.columns === undefined || value.columns === null
      ? defaults.columns
      : value.columns.filter((c) => byKey.get(c)?.column);
  return {
    type: value.type ?? defaults.type,
    filters,
    sort,
    group,
    board,
    columns: columns && columns.length > 0 ? columns : defaults.columns,
  };
}

/** Gleiche Konfiguration? (zum Erkennen geänderter gespeicherter Ansichten) */
export function sameConfig(a: ViewConfig, b: ViewConfig): boolean {
  const norm = (c: ViewConfig) =>
    JSON.stringify({
      ...c,
      filters: [...c.filters]
        .map((f) => (f.op === "in" ? { ...f, values: [...f.values].sort() } : f))
        .sort((x, y) => x.field.localeCompare(y.field)),
    });
  return norm(a) === norm(b);
}
