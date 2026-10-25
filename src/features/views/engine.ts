/**
 * Datenbank-Ansichten (B6): Filtern, Sortieren und Gruppieren – generisch über Felddefinitionen,
 * reine Funktionen (unit-getestet). Gleiche Logik für Aufgaben, Projekte und Notizen.
 */
import { addDays, berlinDate, type IsoDate, isoWeekRange } from "@/lib/dates";

export type FieldType = "text" | "enum" | "date" | "timestamp" | "number";

export interface FieldOption {
  value: string;
  label: string;
}

/** Wert eines Feldes: Text, Zahl, Datum (YYYY-MM-DD), Zeitpunkt (ISO) oder Option ("" = keine). */
export type FieldValue = string | number | null;

export interface FieldDef<R, C> {
  key: string;
  label: string;
  type: FieldType;
  value: (row: R, ctx: C) => FieldValue;
  /** Optionen eines Auswahlfelds in Anzeigereihenfolge ("" = „keine“) */
  options?: (ctx: C) => FieldOption[];
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  /**
   * Reihenfolge der Gruppen in Liste und Tabelle, wenn sie von den Optionen abweicht (z. B. aktive
   * Projekte zuerst, #74). Board-Spalten behalten die Reihenfolge der Optionen.
   */
  groupOrder?: string[];
  /** Spalte in der Tabelle */
  column?: boolean;
}

export const DATE_PRESETS = ["overdue", "today", "week", "next7", "none", "any"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];
export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  overdue: "Überfällig",
  today: "Heute",
  week: "Diese Woche",
  next7: "Nächste 7 Tage",
  none: "Ohne Datum",
  any: "Mit Datum",
};

export type Filter =
  | { field: string; op: "in"; values: string[] }
  | { field: string; op: "date"; value: DatePreset };

export type SortDir = "asc" | "desc";
export interface SortSpec {
  field: string;
  dir: SortDir;
}

/** kalender (S2c) = Monatsraster aus `features/calendar` – nur für Datenbanken mit Datum */
export type ViewType = "liste" | "tabelle" | "board" | "kalender";
export const VIEW_TYPES: ViewType[] = ["liste", "tabelle", "board", "kalender"];
export const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  liste: "Liste",
  tabelle: "Tabelle",
  board: "Board",
  kalender: "Kalender",
};

export interface ViewConfig {
  type: ViewType;
  filters: Filter[];
  sort: SortSpec;
  /** Gruppierung in Liste und Tabelle (null = keine) */
  group: string | null;
  /** Spalten des Boards */
  board: string;
  /** sichtbare Spalten der Tabelle (null = Standard) */
  columns: string[] | null;
}

/** Datum eines Wertes (Zeitpunkte als Berliner Kalendertag). */
function dateOf(value: FieldValue, type: FieldType): IsoDate | null {
  if (typeof value !== "string" || !value) return null;
  return type === "timestamp" ? berlinDate(value) : value.slice(0, 10);
}

export function matchesDatePreset(
  date: IsoDate | null,
  preset: DatePreset,
  today: IsoDate,
): boolean {
  switch (preset) {
    case "none":
      return date === null;
    case "any":
      return date !== null;
    case "overdue":
      return date !== null && date < today;
    case "today":
      return date === today;
    case "week": {
      const { start, end } = isoWeekRange(today);
      return date !== null && date >= start && date <= end;
    }
    case "next7":
      return date !== null && date >= today && date <= addDays(today, 6);
  }
}

export function applyFilters<R, C>(
  rows: R[],
  filters: Filter[],
  fields: FieldDef<R, C>[],
  ctx: C,
  today: IsoDate,
): R[] {
  const active = filters
    .map((filter) => ({ filter, field: fields.find((f) => f.key === filter.field) }))
    .filter((entry): entry is { filter: Filter; field: FieldDef<R, C> } => Boolean(entry.field));
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every(({ filter, field }) => {
      const value = field.value(row, ctx);
      if (filter.op === "in") return filter.values.includes(value === null ? "" : String(value));
      return matchesDatePreset(dateOf(value, field.type), filter.value, today);
    }),
  );
}

/** Textsuche über die angegebenen Felder (Groß/klein egal). */
export function applySearch<R, C>(rows: R[], query: string, fields: FieldDef<R, C>[], ctx: C): R[] {
  const q = query.trim().toLocaleLowerCase("de");
  if (!q) return rows;
  return rows.filter((row) =>
    fields.some((field) => {
      const value = field.value(row, ctx);
      return typeof value === "string" && value.toLocaleLowerCase("de").includes(q);
    }),
  );
}

function compareValues<R, C>(field: FieldDef<R, C>, ctx: C) {
  const order = field.options ? new Map(field.options(ctx).map((o, i) => [o.value, i])) : null;
  return (a: FieldValue, b: FieldValue): number => {
    if (field.type === "enum" && order) {
      const ia = order.get(a === null ? "" : String(a)) ?? Number.MAX_SAFE_INTEGER;
      const ib = order.get(b === null ? "" : String(b)) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib;
    }
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (field.type === "timestamp")
      return (Date.parse(String(a)) || 0) - (Date.parse(String(b)) || 0);
    return String(a).localeCompare(String(b), "de");
  };
}

const isEmpty = (value: FieldValue) => value === null || value === "";

/** Sortieren (stabil); leere Werte immer ans Ende, unabhängig von der Richtung. */
export function sortRows<R, C>(rows: R[], sort: SortSpec, fields: FieldDef<R, C>[], ctx: C): R[] {
  const field = fields.find((f) => f.key === sort.field);
  if (!field) return rows;
  const compare = compareValues(field, ctx);
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row) => ({ row, value: field.value(row, ctx) }))
    .sort((a, b) => {
      const emptyA = isEmpty(a.value) && field.type !== "enum";
      const emptyB = isEmpty(b.value) && field.type !== "enum";
      if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
      return sign * compare(a.value, b.value);
    })
    .map(({ row }) => row);
}

export interface RowGroup<R> {
  key: string;
  label: string;
  rows: R[];
}

const DATE_BUCKETS: FieldOption[] = [
  { value: "overdue", label: "Überfällig" },
  { value: "today", label: "Heute" },
  { value: "week", label: "Diese Woche" },
  { value: "later", label: "Später" },
  { value: "past", label: "Vergangen" },
  { value: "none", label: "Ohne Datum" },
];

/** Datums-Gruppe relativ zu heute (für Fälligkeit u. Ä.). */
export function dateBucket(date: IsoDate | null, today: IsoDate, futureOnly = true): string {
  if (!date) return "none";
  if (date < today) return futureOnly ? "overdue" : "past";
  if (date === today) return "today";
  return date <= isoWeekRange(today).end ? "week" : "later";
}

/** Gruppen eines Feldes in fester Reihenfolge – alle Optionen (auch leere), wichtig fürs Board. */
export function groupOptions<R, C>(field: FieldDef<R, C>, ctx: C): FieldOption[] {
  if (field.type === "enum") return field.options?.(ctx) ?? [];
  if (field.type === "date" || field.type === "timestamp") {
    return field.type === "timestamp"
      ? DATE_BUCKETS.filter((b) => b.value !== "overdue")
      : DATE_BUCKETS.filter((b) => b.value !== "past");
  }
  return [];
}

export function groupKeyOf<R, C>(field: FieldDef<R, C>, row: R, ctx: C, today: IsoDate): string {
  const value = field.value(row, ctx);
  if (field.type === "date") return dateBucket(dateOf(value, "date"), today);
  if (field.type === "timestamp") return dateBucket(dateOf(value, "timestamp"), today, false);
  return value === null ? "" : String(value);
}

/**
 * Zeilen gruppieren. keepEmpty = auch leere Gruppen (Board-Spalten). Unbekannte Werte landen in
 * einer eigenen Gruppe am Ende, damit nie eine Zeile verschwindet.
 */
export function groupRows<R, C>(
  rows: R[],
  groupField: string,
  fields: FieldDef<R, C>[],
  ctx: C,
  today: IsoDate,
  keepEmpty = false,
): RowGroup<R>[] {
  const field = fields.find((f) => f.key === groupField);
  if (!field) return [{ key: "*", label: "", rows }];
  const options = groupOptions(field, ctx);
  const groups = new Map<string, RowGroup<R>>(
    options.map((o) => [o.value, { key: o.value, label: o.label, rows: [] }]),
  );
  for (const row of rows) {
    const key = groupKeyOf(field, row, ctx, today);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: key || "–", rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  const result = [...groups.values()];
  if (keepEmpty) return result;
  const filled = result.filter((g) => g.rows.length > 0);
  const order = field.groupOrder;
  if (!order) return filled;
  // nicht genannte Gruppen behalten ihre Reihenfolge dahinter (sort ist stabil)
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  return filled.sort((a, b) => rank(a.key) - rank(b.key));
}

/** Alles zusammen: Filter, Suche, Sortierung. */
export function runView<R, C>(
  rows: R[],
  config: Pick<ViewConfig, "filters" | "sort">,
  fields: FieldDef<R, C>[],
  ctx: C,
  options: { today: IsoDate; query?: string; searchFields?: string[] },
): R[] {
  const filtered = applyFilters(rows, config.filters, fields, ctx, options.today);
  const searched = options.query
    ? applySearch(
        filtered,
        options.query,
        fields.filter((f) => (options.searchFields ?? ["title"]).includes(f.key)),
        ctx,
      )
    : filtered;
  return sortRows(searched, config.sort, fields, ctx);
}

/* ------------------------------------------------------------------ */
/* Archiv (B13): vom Standardfilter ausgeblendete Einträge             */
/* ------------------------------------------------------------------ */

export interface ArchiveSpec {
  /** Feld und Wert, die „archiviert“ bedeuten, z. B. status = archiv */
  field: string;
  value: string;
}

/**
 * Wie der Filter zum Archiv steht: „hidden“ = ausgeblendet (Hinweis anbieten), „only“ = es wird
 * nur das Archiv gezeigt (Rückweg anbieten), „shown“ = kein Hinweis nötig.
 */
export function archiveFilterState(
  filters: Filter[],
  archive: ArchiveSpec,
): "hidden" | "only" | "shown" {
  const filter = filters.find((f) => f.field === archive.field && f.op === "in");
  if (filter?.op !== "in") return "shown";
  if (filter.values.length === 1 && filter.values[0] === archive.value) return "only";
  return filter.values.includes(archive.value) ? "shown" : "hidden";
}

/** Filter so ändern, dass nur das Archiv erscheint (übrige Filter bleiben). */
export function archiveOnlyFilters(filters: Filter[], archive: ArchiveSpec): Filter[] {
  return [
    ...filters.filter((f) => f.field !== archive.field),
    { field: archive.field, op: "in", values: [archive.value] },
  ];
}
