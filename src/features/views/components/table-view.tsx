"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { DueDate } from "@/components/ui/due-date";
import { ContextMenuContent, ContextMenuRoot, ContextMenuTrigger } from "@/components/ui/menu";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatListDate, type IsoDate } from "@/lib/dates";
import type { FieldDef, RowGroup } from "../engine";
import type { GroupLinkTarget } from "../group-link";
import { type GroupFold, GroupFoldButton } from "./group-fold";

/** Pfeil im Gruppenkopf zum Eintrag der Gruppe (#48, wie „Projekt öffnen“ #26). */
export function GroupLink({ target }: { target: GroupLinkTarget | null | undefined }) {
  if (!target) return null;
  return (
    <Link
      href={target.href}
      aria-label={target.label}
      title={target.label}
      className={cn(buttonClasses("ghost", "icon-sm"), "-my-1 text-faint hover:text-text")}
    >
      <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden />
    </Link>
  );
}

/** Standard-Darstellung eines Feldwerts in einer Zelle. */
export function defaultCell<R, C>(field: FieldDef<R, C>, row: R, ctx: C, today: IsoDate) {
  const value = field.value(row, ctx);
  if (value === null || value === "") return <span className="text-faint">–</span>;
  switch (field.type) {
    case "enum":
      return field.options?.(ctx).find((o) => o.value === String(value))?.label ?? String(value);
    case "date":
      return <DueDate value={String(value)} today={today} size="inherit" />;
    case "timestamp":
      return <span className="tabular-nums text-muted">{formatListDate(String(value))}</span>;
    case "number":
      return <span className="tabular-nums">{value}</span>;
    default:
      return String(value);
  }
}

export function TableView<R extends { id: string }, C>({
  groups,
  columns,
  fields,
  ctx,
  today,
  cells,
  contextMenu,
  groupDecor,
  groupLink,
  fold,
  searching = false,
  label,
}: {
  groups: RowGroup<R>[];
  columns: string[];
  fields: FieldDef<R, C>[];
  ctx: C;
  today: IsoDate;
  cells: Partial<Record<string, (row: R) => React.ReactNode>>;
  contextMenu?: (row: R) => React.ReactNode;
  groupDecor?: (key: string) => React.ReactNode;
  groupLink?: (key: string) => GroupLinkTarget | null | undefined;
  /** Gruppen zuklappen (#73) */
  fold?: GroupFold;
  searching?: boolean;
  label: string;
}) {
  const cols = columns
    .map((key) => fields.find((f) => f.key === key))
    .filter((f): f is FieldDef<R, C> => Boolean(f));
  const grouped = groups.length > 1 || (groups[0] && groups[0].key !== "*");

  const row = (item: R) => {
    const tr = (
      <TR key={item.id} data-row-id={item.id}>
        {cols.map((field, index) => (
          <TD
            key={field.key}
            className={cn(
              index === 0 ? "min-w-64 max-w-[28rem]" : "whitespace-nowrap text-ui-sm",
              index > 0 && "text-fg/85",
            )}
          >
            {cells[field.key]?.(item) ?? defaultCell(field, item, ctx, today)}
          </TD>
        ))}
      </TR>
    );
    if (!contextMenu) return tr;
    return (
      <ContextMenuRoot key={item.id} modal={false}>
        <ContextMenuTrigger asChild>{tr}</ContextMenuTrigger>
        <ContextMenuContent>{contextMenu(item)}</ContextMenuContent>
      </ContextMenuRoot>
    );
  };

  return (
    <Table label={label}>
      <THead>
        <tr>
          {cols.map((field) => (
            <TH key={field.key} scope="col">
              {field.label}
            </TH>
          ))}
        </tr>
      </THead>
      <TBody>
        {groups.map((group) =>
          grouped ? (
            <GroupRows
              key={group.key || "leer"}
              group={group}
              span={cols.length}
              decor={groupDecor?.(group.key)}
              link={groupLink?.(group.key)}
              open={fold?.isOpen(group.key) ?? true}
              onToggle={fold ? (all) => fold.toggle(group.key, all) : undefined}
              searching={searching}
            >
              {group.rows.map(row)}
            </GroupRows>
          ) : (
            group.rows.map(row)
          ),
        )}
      </TBody>
    </Table>
  );
}

function GroupRows<R>({
  group,
  span,
  decor,
  link,
  open,
  onToggle,
  searching,
  children,
}: {
  group: RowGroup<R>;
  span: number;
  decor?: React.ReactNode;
  link?: GroupLinkTarget | null;
  open: boolean;
  onToggle?: (all: boolean) => void;
  searching: boolean;
  children: React.ReactNode;
}) {
  const head = (
    <>
      {decor}
      {group.label}
      <span className="font-normal text-faint tabular-nums">{group.rows.length}</span>
    </>
  );
  return (
    <>
      <tr className="border-b border-border bg-surface/40">
        <th
          scope="colgroup"
          colSpan={span}
          className="px-3 pt-3 pb-1.5 text-left text-ui-sm font-medium"
        >
          <span className="inline-flex items-center gap-2">
            {onToggle ? (
              <GroupFoldButton open={open} onToggle={onToggle} disabled={searching}>
                {head}
              </GroupFoldButton>
            ) : (
              head
            )}
            <GroupLink target={link} />
          </span>
        </th>
      </tr>
      {open ? children : null}
    </>
  );
}
