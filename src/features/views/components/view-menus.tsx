"use client";

import { ArrowDownUp, Columns3, Group, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSelectAll,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import {
  DATE_PRESET_LABELS,
  DATE_PRESETS,
  type DatePreset,
  type FieldDef,
  type Filter,
  type SortDir,
  type ViewConfig,
} from "../engine";

const keep = (event: Event) => event.preventDefault();

function ToolbarButton({
  icon,
  children,
  active,
  compact,
  ...props
}: React.ComponentProps<typeof Button> & {
  icon: React.ReactNode;
  active?: boolean;
  /** auf dem Handy nur das Symbol (Name bleibt per aria-label) */
  compact?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "max-w-full gap-1.5 text-muted",
        compact && "max-md:w-11 max-md:px-0",
        active && "bg-surface-2 text-fg",
      )}
      {...props}
    >
      {icon}
      <span className={cn("truncate", compact && "max-md:sr-only")}>{children}</span>
    </Button>
  );
}

/** Kurzbeschreibung eines Filters, z. B. „Status ≠ Erledigt“ oder „Fällig: Diese Woche“. */
export function describeFilter<R, C>(filter: Filter, fields: FieldDef<R, C>[], ctx: C): string {
  const field = fields.find((f) => f.key === filter.field);
  if (!field) return "";
  if (filter.op === "date") return `${field.label}: ${DATE_PRESET_LABELS[filter.value]}`;
  const options = field.options?.(ctx) ?? [];
  const excluded = options.filter((o) => !filter.values.includes(o.value));
  if (excluded.length > 0 && excluded.length <= 2 && excluded.length < filter.values.length) {
    return `${field.label} ≠ ${excluded.map((o) => o.label).join(", ")}`;
  }
  const included = options.filter((o) => filter.values.includes(o.value)).map((o) => o.label);
  return `${field.label}: ${included.length > 0 ? included.join(", ") : "nichts"}`;
}

/** Alle Optionen eines Feldes an (= keine Einschränkung) bzw. aus (= nichts) (#78). */
export function setAllOptions(filters: Filter[], field: string, on: boolean): Filter[] {
  const rest = filters.filter((f) => f.field !== field);
  return on ? rest : [...rest, { field, op: "in", values: [] }];
}

/** Auswahl eines Optionsfeldes umschalten (keine Einschränkung = alle Optionen). */
export function toggleOption(
  filters: Filter[],
  field: string,
  allValues: string[],
  value: string,
  checked: boolean,
): Filter[] {
  const current = filters.find((f) => f.field === field && f.op === "in");
  const selected = new Set(current && current.op === "in" ? current.values : allValues);
  if (checked) selected.add(value);
  else selected.delete(value);
  const rest = filters.filter((f) => f.field !== field);
  if (allValues.every((v) => selected.has(v))) return rest;
  return [...rest, { field, op: "in", values: allValues.filter((v) => selected.has(v)) }];
}

export function setDateFilter(
  filters: Filter[],
  field: string,
  value: DatePreset | null,
): Filter[] {
  const rest = filters.filter((f) => f.field !== field);
  return value ? [...rest, { field, op: "date", value }] : rest;
}

export function FilterMenu<R, C>({
  fields,
  ctx,
  filters,
  onChange,
  defaults,
}: {
  fields: FieldDef<R, C>[];
  ctx: C;
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  defaults: Filter[];
}) {
  const filterable = fields.filter((f) => f.filterable);
  const summary = filters.length
    ? `${describeFilter(filters[0] as Filter, fields, ctx)}${filters.length > 1 ? ` +${filters.length - 1}` : ""}`
    : "Filter";
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <ToolbarButton
          icon={<ListFilter size={16} strokeWidth={1.5} aria-hidden />}
          active={filters.length > 0}
          aria-label={filters.length ? `Filter: ${summary}` : "Filter"}
        >
          {summary}
        </ToolbarButton>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Filtern nach</MenuLabel>
        {filterable.map((field) => {
          const filter = filters.find((f) => f.field === field.key);
          if (field.type === "enum") {
            const options = field.options?.(ctx) ?? [];
            const values = options.map((o) => o.value);
            const selected = filter && filter.op === "in" ? filter.values : values;
            return (
              <MenuSub key={field.key}>
                <MenuSubTrigger>
                  {field.label}
                  {filter ? (
                    <span className="text-meta text-faint">· {selected.length}</span>
                  ) : null}
                </MenuSubTrigger>
                <MenuSubContent>
                  <MenuSelectAll
                    all={values.every((v) => selected.includes(v))}
                    none={!values.some((v) => selected.includes(v))}
                    onAll={() => onChange(setAllOptions(filters, field.key, true))}
                    onNone={() => onChange(setAllOptions(filters, field.key, false))}
                  />
                  {options.map((option) => (
                    <MenuCheckboxItem
                      key={option.value || "leer"}
                      checked={selected.includes(option.value)}
                      onSelect={keep}
                      onCheckedChange={(checked) =>
                        onChange(
                          toggleOption(filters, field.key, values, option.value, checked === true),
                        )
                      }
                    >
                      {option.label}
                    </MenuCheckboxItem>
                  ))}
                </MenuSubContent>
              </MenuSub>
            );
          }
          return (
            <MenuSub key={field.key}>
              <MenuSubTrigger>
                {field.label}
                {filter && filter.op === "date" ? (
                  <span className="text-meta text-faint">· {DATE_PRESET_LABELS[filter.value]}</span>
                ) : null}
              </MenuSubTrigger>
              <MenuSubContent>
                <MenuRadioGroup
                  value={filter && filter.op === "date" ? filter.value : "alle"}
                  onValueChange={(value) =>
                    onChange(
                      setDateFilter(
                        filters,
                        field.key,
                        value === "alle" ? null : (value as DatePreset),
                      ),
                    )
                  }
                >
                  <MenuRadioItem value="alle" onSelect={keep}>
                    Alle
                  </MenuRadioItem>
                  {DATE_PRESETS.map((preset) => (
                    <MenuRadioItem key={preset} value={preset} onSelect={keep}>
                      {DATE_PRESET_LABELS[preset]}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubContent>
            </MenuSub>
          );
        })}
        <MenuSeparator />
        <MenuItem onSelect={() => onChange(defaults)}>Standardfilter</MenuItem>
        <MenuItem disabled={filters.length === 0} onSelect={() => onChange([])}>
          Alle Filter entfernen
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

export function SortMenu<R, C>({
  fields,
  sort,
  onChange,
}: {
  fields: FieldDef<R, C>[];
  sort: ViewConfig["sort"];
  onChange: (sort: ViewConfig["sort"]) => void;
}) {
  const sortable = fields.filter((f) => f.sortable);
  const current = fields.find((f) => f.key === sort.field);
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <ToolbarButton
          compact
          icon={<ArrowDownUp size={16} strokeWidth={1.5} aria-hidden />}
          aria-label={`Sortieren: ${current?.label ?? ""}`}
        >
          {current?.label ?? "Sortieren"}
        </ToolbarButton>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Sortieren nach</MenuLabel>
        <MenuRadioGroup
          value={sort.field}
          onValueChange={(field) => {
            const type = fields.find((f) => f.key === field)?.type;
            // Zeitpunkte neueste zuerst, sonst aufsteigend
            onChange({ field, dir: type === "timestamp" ? "desc" : "asc" });
          }}
        >
          {sortable.map((field) => (
            <MenuRadioItem key={field.key} value={field.key} onSelect={keep}>
              {field.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuRadioGroup
          value={sort.dir}
          onValueChange={(dir) => onChange({ ...sort, dir: dir as SortDir })}
        >
          <MenuRadioItem value="asc" onSelect={keep}>
            {current?.type === "timestamp" ? "Älteste zuerst" : "Aufsteigend"}
          </MenuRadioItem>
          <MenuRadioItem value="desc" onSelect={keep}>
            {current?.type === "timestamp" ? "Neueste zuerst" : "Absteigend"}
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}

export function GroupMenu<R, C>({
  fields,
  value,
  onChange,
  allowNone = true,
  label = "Gruppieren nach",
  choices,
}: {
  fields: FieldDef<R, C>[];
  value: string | null;
  onChange: (value: string | null) => void;
  allowNone?: boolean;
  label?: string;
  /** feste Auswahl (Board-Spalten); sonst alle gruppierbaren Felder */
  choices?: string[];
}) {
  const options = fields.filter((f) => (choices ? choices.includes(f.key) : f.groupable));
  const current = fields.find((f) => f.key === value);
  const text = current ? `Gruppe: ${current.label}` : "Gruppieren";
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <ToolbarButton
          compact
          icon={<Group size={16} strokeWidth={1.5} aria-hidden />}
          active={Boolean(current) && allowNone}
          aria-label={allowNone ? text : `Spalten: ${current?.label ?? ""}`}
        >
          {allowNone ? text : `Spalten: ${current?.label ?? ""}`}
        </ToolbarButton>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>{label}</MenuLabel>
        <MenuRadioGroup
          value={value ?? "keine"}
          onValueChange={(next) => onChange(next === "keine" ? null : next)}
        >
          {allowNone ? (
            <MenuRadioItem value="keine" onSelect={keep}>
              Keine
            </MenuRadioItem>
          ) : null}
          {options.map((field) => (
            <MenuRadioItem key={field.key} value={field.key} onSelect={keep}>
              {field.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}

export function ColumnsMenu<R, C>({
  fields,
  columns,
  onChange,
}: {
  fields: FieldDef<R, C>[];
  columns: string[];
  onChange: (columns: string[]) => void;
}) {
  const available = fields.filter((f) => f.column);
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <ToolbarButton
          compact
          aria-label="Felder"
          icon={<Columns3 size={16} strokeWidth={1.5} aria-hidden />}
        >
          Felder
        </ToolbarButton>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Spalten</MenuLabel>
        {available.map((field) => (
          <MenuCheckboxItem
            key={field.key}
            checked={columns.includes(field.key)}
            disabled={field.key === "title"}
            onSelect={keep}
            onCheckedChange={(checked) =>
              onChange(
                available
                  .map((f) => f.key)
                  .filter((key) => (key === field.key ? checked === true : columns.includes(key))),
              )
            }
          >
            {field.label}
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
