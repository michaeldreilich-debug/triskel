"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import type { AreaSummary } from "@/features/areas/defaults";
import {
  DatabaseCalendar,
  type DatabaseCalendarInput,
} from "@/features/calendar/components/database-calendar";
import { cn } from "@/lib/cn";
import { berlinDate } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";
import { type Entity, parseViewConfig, sameConfig } from "../config";
import {
  type ArchiveSpec,
  archiveFilterState,
  archiveOnlyFilters,
  type FieldDef,
  groupRows,
  type RowGroup,
  runView,
  VIEW_TYPE_LABELS,
  VIEW_TYPES,
  type ViewConfig,
  type ViewType,
} from "../engine";
import type { GroupLinkTarget } from "../group-link";
import { useSavedViewActions, useSavedViews, viewsInArea } from "../saved";
import { BoardView } from "./board-view";
import { GroupFoldButton, useGroupFold } from "./group-fold";
import { SavedViewsMenu, SaveViewForm } from "./saved-views-menu";
import { GroupLink, TableView } from "./table-view";
import { ColumnsMenu, FilterMenu, GroupMenu, SortMenu } from "./view-menus";

/** Älterer Schlüssel des Ansichts-Zustands und was beim Übernehmen dazukommt. */
export interface StorageUpgrade {
  from: string;
  patch: Partial<ViewConfig> | ((old: Record<string, unknown>) => Partial<ViewConfig>);
}

/** Beschreibung einer Datenbank für die generische Ansicht. */
export interface DatabaseDef<R extends { id: string }, C> {
  entity: Entity;
  /** „Aufgaben“ */
  label: string;
  /** Hinweis auf ausgeblendete Einträge: „weitere Aufgabe“ / „weitere Aufgaben“ */
  hiddenNoun: { one: string; many: string };
  fields: FieldDef<R, C>[];
  defaults: ViewConfig;
  boardFields: string[];
  searchFields: string[];
  /** Bereich einer Zeile (null = ohne, z. B. Inbox) */
  areaOf: (row: R) => string | null;
  renderListItem: (row: R) => React.ReactNode;
  renderCard: (row: R) => React.ReactNode;
  cells: Partial<Record<string, (row: R) => React.ReactNode>>;
  contextMenu?: (row: R) => React.ReactNode;
  /** Board: Karte in Spalte `value` von Feld `field` gezogen */
  move: (row: R, field: string, value: string) => void;
  onAdd?: (field: string, value: string) => void;
  canAdd?: (field: string, value: string) => boolean;
  boardLimit?: (field: string, value: string) => number;
  groupDecor?: (field: string, key: string) => React.ReactNode;
  /** Gruppenkopf führt zum Eintrag der Gruppe, z. B. zum Projekt (#48, Muster #26) */
  groupLink?: (field: string, key: string) => GroupLinkTarget | null;
  /**
   * Gruppierung, deren Gruppen beim Öffnen immer zu sind, außer `open` (#79: Projekte in der
   * Aufgaben-Übersicht zu, „Ohne Projekt“ offen); für sie merkt sich das Gerät nichts (#73).
   */
  startClosed?: { group: string; open: string[] };
  /**
   * Ältere Schlüssel des lokalen Ansichts-Zustands (jüngster zuerst): den ersten vorhandenen
   * einmal übernehmen und dabei `patch` anwenden (neue Vorgabe, ohne die übrigen Einstellungen
   * des Geräts zu verlieren).
   */
  storageUpgrade?: StorageUpgrade | StorageUpgrade[];
  /** Archiv, das der Standardfilter ausblendet: erwähnen und mit einem Klick zeigen (B13) */
  archive?: ArchiveSpec & { noun: { one: string; many: string } };
  /**
   * Darstellung „Kalender“ (S2c): was die gefilterten Zeilen in den Monat geben. Fehlt es, gibt
   * es die Darstellung für diese Datenbank nicht (z. B. Notizen).
   */
  calendar?: (rows: R[], ctx: C) => DatabaseCalendarInput;
  empty: { title: string; description: string; icon: React.ReactNode };
}

export interface DatabaseViewProps<R extends { id: string }, C> {
  def: DatabaseDef<R, C>;
  rows: R[];
  ctx: C;
  areas: AreaSummary[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** gespeicherte Ansichten anbieten (nicht z. B. im Projekt-Reiter) */
  savedViews?: boolean;
  /** Schlüssel für den lokalen Ansichts-Zustand (je Gerät) */
  storageKey: string;
  /** Bereichs-Schalter anwenden (Standard: ja) */
  areaFilter?: boolean;
  /** Anzahl „X von Y“ melden (Seitenkopf) */
  onCount?: (shown: number, total: number) => void;
}

const storageGet = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const storageSet = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // nur Bequemlichkeit (zuletzt benutzte Ansicht je Gerät)
  }
};

/**
 * Generische Datenbank-Ansicht (B6): Liste, Tabelle, Board; Filter, Sortieren, Gruppieren;
 * gespeicherte Ansichten (?ansicht=, höchstens 5 je Bereich). Der Bereichs-Schalter filtert
 * zusätzlich; ausgeblendete Einträge werden erwähnt (feedback.md #9).
 */
export function DatabaseView<R extends { id: string }, C>({
  def,
  rows,
  ctx,
  areas,
  loading,
  error,
  onRetry,
  savedViews: withSaved = true,
  storageKey,
  areaFilter = true,
  onCount,
}: DatabaseViewProps<R, C>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const area = useUi((s) => s.area);
  const setArea = useUi((s) => s.setArea);
  const saved = useSavedViews();
  const savedActions = useSavedViewActions();
  const [config, setConfig] = useState<ViewConfig>(def.defaults);
  const [query, setQuery] = useState("");
  const [savingView, setSavingView] = useState(false);
  const applied = useRef<string | null | undefined>(undefined);

  const activeArea = area && areas.some((a) => a.id === area) ? area : null;
  const areaName = areas.find((a) => a.id === activeArea)?.name ?? "Alles";
  const savedId = withSaved ? params.get("ansicht") : null;
  const allSaved = saved.data ?? [];
  const activeView = allSaved.find((v) => v.id === savedId && v.entity === def.entity) ?? null;
  const parse = (raw: unknown) => {
    const parsed = parseViewConfig(raw, def.fields, def.defaults, def.boardFields);
    // „Kalender“ nur, wo die Datenbank ihn kennt (ein alter Gerätestand fällt auf die Liste zurück)
    return parsed.type === "kalender" && !def.calendar
      ? { ...parsed, type: "liste" as const }
      : parsed;
  };
  const types = def.calendar ? VIEW_TYPES : VIEW_TYPES.filter((t) => t !== "kalender");

  // gespeicherte Ansicht (oder den letzten Stand dieses Geräts) einmal je Auswahl übernehmen
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur beim Wechsel der Ansicht
  useEffect(() => {
    const key = savedId ?? null;
    if (applied.current === key) return;
    if (key && !activeView) return; // wartet auf die Ansichten
    applied.current = key;
    setConfig(activeView ? parse(activeView.config) : parse(localConfig()));
  }, [savedId, activeView, storageKey]);

  /** Letzter Stand dieses Geräts; einmalig aus einem älteren Schlüssel übernommen (storageUpgrade). */
  function localConfig(): unknown {
    const current = storageGet(storageKey);
    if (current) return current;
    const upgrades = def.storageUpgrade
      ? Array.isArray(def.storageUpgrade)
        ? def.storageUpgrade
        : [def.storageUpgrade]
      : [];
    for (const upgrade of upgrades) {
      const old = storageGet(upgrade.from);
      if (!old || typeof old !== "object") continue;
      const patch =
        typeof upgrade.patch === "function"
          ? upgrade.patch(old as Record<string, unknown>)
          : upgrade.patch;
      const next = { ...old, ...patch };
      storageSet(storageKey, next);
      return next;
    }
    return def.defaults;
  }

  const update = (patch: Partial<ViewConfig>) => {
    setConfig((current) => {
      const next = { ...current, ...patch };
      if (!savedId) storageSet(storageKey, next);
      return next;
    });
  };

  const today = berlinDate();
  const inArea = areaFilter && activeArea ? rows.filter((r) => def.areaOf(r) === activeArea) : rows;
  const run = (list: R[], filters = config.filters) =>
    runView(list, { ...config, filters }, def.fields, ctx, {
      today,
      query,
      searchFields: def.searchFields,
    });
  const shown = run(inArea);
  const hiddenByArea =
    areaFilter && activeArea ? run(rows.filter((r) => def.areaOf(r) !== activeArea)).length : 0;

  // Archiv (z. B. abgeschlossene Projekte): ausgeblendete erwähnen (feedback.md #9), Rückweg zeigen
  const archive = def.archive;
  const archiveState =
    archive && config.type !== "board" ? archiveFilterState(config.filters, archive) : "shown";
  const archived =
    archive && archiveState === "hidden"
      ? run(inArea, archiveOnlyFilters(config.filters, archive)).length
      : 0;
  const leaveArchive = () => {
    if (!archive) return;
    const fallback = def.defaults.filters.filter((f) => f.field === archive.field);
    update({
      filters: [...config.filters.filter((f) => f.field !== archive.field), ...fallback],
    });
  };

  useEffect(() => {
    onCount?.(shown.length, inArea.length);
  }, [onCount, shown.length, inArea.length]);

  // Spalten = Werte des Feldes: ein Filter auf genau dieses Feld würde Board-Spalten leeren
  const groups: RowGroup<R>[] =
    config.type === "board"
      ? groupRows(
          run(
            inArea,
            config.filters.filter((f) => f.field !== config.board),
          ),
          config.board,
          def.fields,
          ctx,
          today,
          true,
        )
      : config.group
        ? groupRows(shown, config.group, def.fields, ctx, today)
        : [{ key: "*", label: "", rows: shown }];

  const modified = activeView ? !sameConfig(config, parse(activeView.config)) : false;
  const goToView = (id: string | null) => {
    setSavingView(false);
    router.push(id ? `${pathname}?ansicht=${id}` : pathname, { scroll: false });
  };
  const decor = (field: string | null) => (key: string) =>
    field ? def.groupDecor?.(field, key) : null;
  const groupLink = (key: string) => (config.group ? def.groupLink?.(config.group, key) : null);
  // #73: Gruppen zuklappen, je Gerät, Ansicht und Gruppierung (#79: oder immer zu beim Öffnen)
  const searching = query.trim() !== "";
  const startClosed = def.startClosed?.group === config.group ? def.startClosed : null;
  const fold = useGroupFold(
    config.group ? `${storageKey}:zu:${config.group}` : null,
    groups.map((g) => g.key),
    searching,
    startClosed ? (key) => !startClosed.open.includes(key) : undefined,
  );

  const columns = config.columns ?? def.defaults.columns ?? ["title"];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<ViewType>
          aria-label="Darstellung der Datenbank"
          value={config.type}
          onValueChange={(type) => update({ type })}
          options={types.map((t) => ({ value: t, label: VIEW_TYPE_LABELS[t] }))}
          className={cn("w-full", types.length > 3 ? "sm:w-96" : "sm:w-72")}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <FilterMenu
            fields={def.fields}
            ctx={ctx}
            filters={config.filters}
            defaults={def.defaults.filters}
            onChange={(filters) => update({ filters })}
          />
          {config.type === "kalender" ? null : (
            <SortMenu
              fields={def.fields}
              sort={config.sort}
              onChange={(sort) => update({ sort })}
            />
          )}
          {config.type === "kalender" ? null : config.type === "board" ? (
            <GroupMenu
              fields={def.fields}
              value={config.board}
              allowNone={false}
              choices={def.boardFields}
              label="Spalten nach"
              onChange={(board) => update({ board: board ?? def.defaults.board })}
            />
          ) : (
            <GroupMenu
              fields={def.fields}
              value={config.group}
              onChange={(group) => update({ group })}
            />
          )}
          {config.type === "tabelle" ? (
            <ColumnsMenu
              fields={def.fields}
              columns={columns}
              onChange={(next) => update({ columns: next })}
            />
          ) : null}
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 md:ml-auto md:w-auto">
          <div className="relative min-w-0 flex-1 md:w-56 md:flex-none">
            <Search
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Suchen"
              aria-label={`${def.label} durchsuchen`}
              className="pl-9"
            />
          </div>
          {withSaved ? (
            <SavedViewsMenu
              views={viewsInArea(allSaved, activeArea).filter((v) => v.entity === def.entity)}
              activeId={activeView?.id ?? null}
              modified={modified}
              areaName={areaName}
              areaCount={viewsInArea(allSaved, activeArea).length}
              onSelect={goToView}
              onSaveChanges={() => activeView && savedActions.saveConfig(activeView.id, config)}
              onStartSave={() => setSavingView(true)}
              onDelete={() => activeView && savedActions.trash(activeView.id, () => goToView(null))}
            />
          ) : null}
        </div>
      </div>

      {savingView ? (
        <SaveViewForm
          areaName={areaName}
          areaCount={viewsInArea(allSaved, activeArea).length}
          onCancel={() => setSavingView(false)}
          onSave={(name) => {
            const created = savedActions.create({
              entity: def.entity,
              areaId: activeArea,
              name,
              config,
            });
            if (created) {
              applied.current = created.id;
              goToView(created.id);
            }
          }}
        />
      ) : null}

      {archive && archiveState === "only" && !loading ? (
        <p className="flex flex-wrap items-center gap-x-2 px-2.5 text-ui-sm text-muted">
          <span className="font-medium text-fg">Archiv</span>
          <button
            type="button"
            onClick={leaveArchive}
            className="text-muted underline underline-offset-2 hover:text-fg"
          >
            Archiv ausblenden
          </button>
        </p>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-card border border-danger/50 p-4 text-ui"
        >
          <p className="text-danger">
            {def.label} konnten nicht geladen werden. Verbindung prüfen.
          </p>
          <Button size="sm" onClick={onRetry}>
            Erneut laden
          </Button>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">{def.label} werden geladen</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-card" />
          ))}
        </div>
      ) : config.type === "board" ? (
        <BoardView
          label={`Board: ${def.label}`}
          groups={groups}
          renderCard={def.renderCard}
          contextMenu={def.contextMenu}
          onMove={(row, key) => def.move(row, config.board, key)}
          onAdd={def.onAdd ? (key) => def.onAdd?.(config.board, key) : null}
          canAdd={(key) => def.canAdd?.(config.board, key) ?? true}
          limit={(key) => def.boardLimit?.(config.board, key) ?? 50}
          groupDecor={decor(config.board)}
        />
      ) : config.type === "kalender" && def.calendar ? (
        <DatabaseCalendar input={def.calendar(shown, ctx)} label={def.label} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={def.empty.icon}
          title={inArea.length === 0 ? def.empty.title : "Nichts gefunden"}
          description={inArea.length === 0 ? def.empty.description : "Filter oder Suche anpassen."}
        />
      ) : config.type === "tabelle" ? (
        <TableView
          label={`Tabelle: ${def.label}`}
          groups={groups}
          columns={columns}
          fields={def.fields}
          ctx={ctx}
          today={today}
          cells={def.cells}
          contextMenu={def.contextMenu}
          groupDecor={decor(config.group)}
          groupLink={groupLink}
          fold={fold}
          searching={searching}
        />
      ) : (
        // eine feste Region je Liste, auch wenn sie gruppiert ist (Gruppen sind eigene Abschnitte)
        <section aria-label={def.label} className="flex flex-col gap-6">
          {groups.map((group) => (
            <section
              key={group.key || "leer"}
              aria-label={group.key === "*" ? undefined : `${group.label} (${group.rows.length})`}
              className="flex flex-col gap-0.5"
            >
              {group.key === "*" ? null : (
                // Gruppenkopf (Muster 2, #23): Titel und Anzahl über einer feinen Linie; klappbar (#73)
                <h2
                  className={cn(
                    "mb-1 flex items-center gap-2 border-b border-border px-2.5 pt-1 pb-2 text-ui-sm font-semibold",
                    group.key === "overdue" && "text-danger",
                  )}
                >
                  <GroupFoldButton
                    open={fold.isOpen(group.key)}
                    onToggle={(all) => fold.toggle(group.key, all)}
                    disabled={searching}
                  >
                    {decor(config.group)(group.key)}
                    {group.label}
                    <span
                      className={cn(
                        "font-normal tabular-nums",
                        group.key === "overdue" ? "text-danger" : "text-faint",
                      )}
                    >
                      {group.rows.length}
                    </span>
                  </GroupFoldButton>
                  <GroupLink target={groupLink(group.key)} />
                </h2>
              )}
              {group.key === "*" || fold.isOpen(group.key) ? (
                <ul
                  aria-label={group.key === "*" ? def.label : group.label}
                  className="flex flex-col gap-0.5"
                >
                  {group.rows.map((row) => (
                    <li key={row.id}>{def.renderListItem(row)}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </section>
      )}

      {!loading && archive && archived > 0 ? (
        <p className="px-2.5 text-ui-sm text-faint">
          {archived === 1 ? `1 ${archive.noun.one}` : `${archived} ${archive.noun.many}`} im Archiv.{" "}
          <button
            type="button"
            onClick={() => update({ filters: archiveOnlyFilters(config.filters, archive) })}
            className="text-muted underline underline-offset-2 hover:text-fg"
          >
            Archiv zeigen
          </button>
        </p>
      ) : null}

      {!loading && hiddenByArea > 0 ? (
        <p className="px-2.5 text-ui-sm text-faint">
          {hiddenByArea === 1
            ? `1 ${def.hiddenNoun.one}`
            : `${hiddenByArea} ${def.hiddenNoun.many}`}{" "}
          in anderen Bereichen{def.entity === "tasks" ? " oder der Inbox" : ""}.{" "}
          <button
            type="button"
            onClick={() => setArea(null)}
            className="text-muted underline underline-offset-2 hover:text-fg"
          >
            Alle Bereiche zeigen
          </button>
        </p>
      ) : null}
    </div>
  );
}
