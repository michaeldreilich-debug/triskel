"use client";

import {
  BookOpen,
  CalendarDays,
  CircleHelp,
  FileText,
  Folder,
  GanttChart,
  History,
  Inbox,
  Maximize2,
  Menu,
  Moon,
  PanelLeft,
  Search,
  Settings,
  SquareCheck,
  Sun,
  Target,
  Trash2,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TriskelMark } from "@/components/triskel-mark";
import { Button } from "@/components/ui/button";
import { type CommandGroup, CommandPalette } from "@/components/ui/command-palette";
import type { AreaColor } from "@/components/ui/pill";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Sheet } from "@/components/ui/sheet";
import { undoLatest } from "@/components/ui/toast";
import { type AreaSummary, DEFAULT_AREAS } from "@/features/areas/defaults";
import { appPath } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { useLocalNumber } from "@/lib/local-pref";
import { FONT_SIZE_LABELS, FONT_SIZES } from "@/lib/ui-prefs";
import { useUi, useUiStoreApi } from "@/lib/ui-store";
import { isEditableTarget, isUndoShortcut } from "@/lib/undo";
import { LegendSheet } from "./legend";
import { MobileTabBar } from "./mobile-tab-bar";
import { DATABASE_NAV, isActive, MAIN_NAV, SETTINGS_NAV, TRASH_NAV } from "./nav";
import { SidebarContent, type SidebarSlots } from "./sidebar";
import { isDetailPath, Rail, useWide } from "./wide";

/**
 * Breite der Seitenleiste in px, am rechten Rand ziehbar (#95). Ungezogen gilt das Token
 * `--spacing-sidebar` (15,5 rem, wächst mit der Schriftgröße); Doppelklick kehrt dorthin zurück.
 */
const SIDEBAR_WIDTH = { min: 192, max: 420 };
const SIDEBAR_REM = 15.5;

const AREA_BORDER: Record<AreaColor, string> = {
  orange: "border-area-orange",
  blue: "border-area-blue",
};

export interface AppShellProps {
  children: React.ReactNode;
  areas?: AreaSummary[];
  /** Bereiche werden noch geladen (Schalter als Skeleton) */
  areasLoading?: boolean;
  /** Speicherstatus: ausführlich in der Seitenleiste, kompakt in der mobilen Kopfzeile */
  /** full = Seitenleiste, compact = Kopfzeile am Handy, sheet = Menü am Handy (mit Knöpfen) */
  saveStatus?: (variant: "full" | "compact" | "sheet") => React.ReactNode;
  /** Abmelden (Standard: nur Supabase-Sitzung beenden) */
  onSignOut?: () => Promise<void>;
  /** Panel rechts neben dem Inhalt (z. B. offene Aufgabe) */
  panel?: React.ReactNode;
  /** zusätzliche Abschnitte der Seitenleiste (Projekte, gespeicherte Ansichten) */
  sidebarSlots?: SidebarSlots;
  /** Schnellerfassung in der Befehlspalette */
  capture?: { preview: (text: string) => string; submit: (text: string) => void };
  /** Treffer aus den Daten in der Befehlspalette (Suche, B10) */
  searchResults?: (text: string, close: () => void) => React.ReactNode;
  /** Reiterleiste über dem Inhalt (Desktop, #63) */
  tabBar?: React.ReactNode;
  /** Zähler der offenen Reiter in der Kopfzeile (Handy/Tablet, #63) */
  tabCounter?: React.ReactNode;
  /** weitere Gruppen der Befehlspalette (z. B. Reiter) */
  commands?: CommandGroup[];
}

/**
 * Shell: Sidebar 248 px (einklappbar) ab 1024 px, darunter Kopfzeile + Sidebar als Sheet.
 * ⌘K öffnet die Befehlspalette, ⌘\ klappt die Sidebar ein und aus, ⌘Z nimmt die letzte Aktion
 * zurück (außerhalb von Textfeldern).
 */
export function AppShell({
  children,
  areas = DEFAULT_AREAS,
  areasLoading,
  saveStatus,
  onSignOut,
  panel,
  sidebarSlots,
  capture,
  searchResults,
  tabBar,
  tabCounter,
  commands = [],
}: AppShellProps) {
  const router = useRouter();
  const store = useUiStoreApi();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const commandOpen = useUi((s) => s.commandOpen);
  const setCommandOpen = useUi((s) => s.setCommandOpen);
  const setCaptureOpen = useUi((s) => s.setCaptureOpen);
  const mobileNavOpen = useUi((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUi((s) => s.setMobileNavOpen);
  const setTheme = useUi((s) => s.setTheme);
  const setFontSize = useUi((s) => s.setFontSize);
  const setArea = useUi((s) => s.setArea);
  const areaId = useUi((s) => s.area);
  // feiner Rahmen in der Bereichsfarbe, solange nicht „Alles“ gewählt ist (#45)
  const frameArea = areasLoading ? undefined : areas.find((a) => a.id === areaId);
  const setLegendOpen = useUi((s) => s.setLegendOpen);
  const wide = useWide();
  const [sidebarWidth, setSidebarWidth, resetSidebarWidth] = useLocalNumber(
    "sz:seitenleiste-breite",
    0,
    SIDEBAR_WIDTH,
  );
  // Standardbreite in px (für den Griff): 15,5 rem bei der Schriftgröße dieses Geräts
  const fontSize = useUi((s) => s.fontSize);
  const [standardWidth, setStandardWidth] = useState(248);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fontSize` ändert die rem-Größe am <html>
  useEffect(() => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    setStandardWidth(Math.round(SIDEBAR_REM * rem));
  }, [fontSize]);
  const pathname = usePathname();
  const page = [...MAIN_NAV, ...DATABASE_NAV, TRASH_NAV, SETTINGS_NAV].find((item) =>
    isActive(pathname, item.href),
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      // ⌘Z: letzte Aktion (Papierkorb, Erledigt …); Textfelder und Editoren haben ihr eigenes
      if (isUndoShortcut(event)) {
        if (!event.defaultPrevented && !isEditableTarget(event.target) && undoLatest()) {
          event.preventDefault();
        }
        return;
      }
      const state = store.getState();
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        state.setCommandOpen(!state.commandOpen);
      } else if (event.key === "\\") {
        event.preventDefault();
        state.toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);

  // Datei neben einer Ablagefläche fallen gelassen: Browser soll die App nicht verlassen und die
  // Datei öffnen (#27). Ablageflächen (Notiz, Aufgabe, Editor) behandeln ihr Ablegen selbst.
  useEffect(() => {
    const isFileDrag = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onDragOver = (event: DragEvent) => {
      if (!isFileDrag(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    };
    const onDrop = (event: DragEvent) => {
      if (isFileDrag(event)) event.preventDefault();
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const go = (href: string) => () => router.push(href);

  return (
    <div className="flex min-h-dvh">
      {frameArea ? (
        <div
          aria-hidden
          data-testid="area-frame"
          data-area={frameArea.color}
          className={cn(
            "pointer-events-none fixed inset-0 z-[60] border",
            AREA_BORDER[frameArea.color],
          )}
        />
      ) : null}
      <a
        href="#inhalt"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Zum Inhalt springen
      </a>

      {/* Ganze Breite (#31) oder eingeklappt (F1, #53): Seitenleiste als senkrechter Reiter */}
      {wide.active ? (
        <Rail label="Triskel" icon={TriskelMark} onClick={() => wide.setWide(null)} />
      ) : collapsed ? (
        <Rail
          label="Triskel"
          icon={TriskelMark}
          onClick={toggleSidebar}
          hint="Seitenleiste ausklappen (⌘\)"
        />
      ) : null}
      <aside
        aria-label="Seitenleiste"
        inert={collapsed}
        data-collapsed={collapsed || undefined}
        style={
          sidebarWidth ? ({ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties) : undefined
        }
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 overflow-hidden border-border bg-sidebar transition-[width]",
          // beim Ziehen am Griff (#95) folgt die Breite dem Zeiger ohne Verzögerung
          "[&:has(+*>[role=separator]:active)]:transition-none",
          !wide.active && "lg:block",
          collapsed ? "w-0 border-r-0" : "w-[var(--sidebar-w,var(--spacing-sidebar))] border-r",
        )}
      >
        <div className="h-full w-[var(--sidebar-w,var(--spacing-sidebar))]">
          <SidebarContent
            areas={areas}
            areasLoading={areasLoading}
            saveStatus={saveStatus?.("full")}
            onSignOut={onSignOut}
            slots={sidebarSlots}
            collapsible
          />
        </div>
      </aside>
      {/* Griff auf der Trennlinie (#95): eigenes Element ohne Breite, wie im Wissen (#83) */}
      <div
        className={cn("sticky top-0 z-20 hidden h-dvh", !wide.active && !collapsed && "lg:block")}
      >
        <ResizeHandle
          label="Breite der Seitenleiste"
          value={sidebarWidth || standardWidth}
          min={SIDEBAR_WIDTH.min}
          max={SIDEBAR_WIDTH.max}
          onChange={setSidebarWidth}
          onReset={resetSidebarWidth}
        />
      </div>

      {/* offene Aufgabe über die ganze Breite: die Seite dahinter wird zum Reiter */}
      {wide.task ? (
        <Rail
          label={page?.label ?? "Seite"}
          icon={page?.icon ?? PanelLeft}
          onClick={() => wide.setWide(null)}
          className="hidden xl:flex"
        />
      ) : null}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          // Höhe der Reiterleiste: klebende Spalten der Seiten (Steckbrief, Einplanen) rücken darunter
          tabBar ? "lg:[--tabbar-h:2.25rem]" : null,
          wide.task && "xl:hidden",
        )}
      >
        {tabBar}
        {/* App-Modus (E44): Inhalt liegt unter der Statusleiste – die Kopfzeile wächst um den oberen
            Rand und klebt weiter bei top-0; unten hält <main> den Rand zum Home-Balken frei */}
        <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-1 border-b border-border bg-bg px-2 pt-[env(safe-area-inset-top)] lg:hidden">
          {/* unter 768 px sitzt das Menü in der Leiste unten; max-md:hidden statt hidden md:… (Button setzt inline-flex) */}
          <Button
            variant="ghost"
            size="icon"
            className="max-md:hidden"
            aria-label="Menü öffnen"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={18} strokeWidth={1.5} aria-hidden />
          </Button>
          <span className="heading flex-1 truncate text-heading">Triskel</span>
          {saveStatus ? <span className="px-2">{saveStatus("compact")}</span> : null}
          {tabCounter}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Suche öffnen"
            onClick={() => setCommandOpen(true)}
          >
            <Search size={18} strokeWidth={1.5} aria-hidden />
          </Button>
        </header>

        {/* unter 768 px Platz für die Leiste unten (Höhe + Rand), darüber nur der Rand */}
        <main
          id="inhalt"
          className="min-w-0 flex-1 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] md:pb-[env(safe-area-inset-bottom)]"
        >
          {children}
        </main>
      </div>

      {panel}

      <MobileTabBar onCapture={() => setCaptureOpen(true)} onMenu={() => setMobileNavOpen(true)} />

      <Sheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        side="left"
        title="Navigation"
        hideTitle
        className="p-0 pt-[env(safe-area-inset-top)] [&>div:last-child]:p-0"
      >
        <SidebarContent
          areas={areas}
          areasLoading={areasLoading}
          saveStatus={saveStatus?.("sheet")}
          onSignOut={onSignOut}
          slots={sidebarSlots}
          onNavigate={() => setMobileNavOpen(false)}
        />
      </Sheet>

      <LegendSheet areas={areas} />

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        capture={capture}
        results={searchResults}
        groups={[
          {
            heading: "Gehe zu",
            items: [
              {
                id: "heute",
                label: "Heute",
                icon: <Sun size={16} strokeWidth={1.5} />,
                onSelect: go("/heute"),
              },
              {
                id: "inbox",
                label: "Inbox",
                icon: <Inbox size={16} strokeWidth={1.5} />,
                onSelect: go("/inbox"),
              },
              {
                id: "kalender",
                label: "Kalender",
                icon: <CalendarDays size={16} strokeWidth={1.5} />,
                onSelect: go("/kalender"),
              },
              {
                id: "wissen",
                label: "Wissen",
                icon: <BookOpen size={16} strokeWidth={1.5} />,
                onSelect: go("/wissen"),
              },
              {
                id: "rueckblicke",
                label: "Rückblicke",
                icon: <History size={16} strokeWidth={1.5} />,
                onSelect: go("/rueckblicke"),
              },
              {
                id: "wochenreview",
                label: "Wochenreview",
                icon: <Target size={16} strokeWidth={1.5} />,
                onSelect: go("/wochenreview"),
              },
              {
                id: "projekte",
                label: "Projekte",
                icon: <Folder size={16} strokeWidth={1.5} />,
                onSelect: go("/projekte"),
              },
              {
                id: "zeitstrahl",
                label: "Zeitstrahl",
                keywords: ["Projekte", "Meilensteine", "Zeitachse"],
                icon: <GanttChart size={16} strokeWidth={1.5} />,
                onSelect: go(appPath.timeline()),
              },
              {
                id: "aufgaben",
                label: "Aufgaben",
                icon: <SquareCheck size={16} strokeWidth={1.5} />,
                onSelect: go("/aufgaben"),
              },
              {
                id: "notizen",
                label: "Notizen",
                icon: <FileText size={16} strokeWidth={1.5} />,
                onSelect: go("/notizen"),
              },
              {
                id: "papierkorb",
                label: "Papierkorb",
                icon: <Trash2 size={16} strokeWidth={1.5} />,
                onSelect: go("/papierkorb"),
              },
              {
                id: "einstellungen",
                label: "Einstellungen",
                icon: <Settings size={16} strokeWidth={1.5} />,
                onSelect: go("/einstellungen"),
              },
            ],
          },
          ...commands,
          {
            heading: "Bereich",
            items: [
              { id: "area-alle", label: "Bereich: Alles", onSelect: () => setArea(null) },
              ...areas.map((a) => ({
                id: `area-${a.id}`,
                label: `Bereich: ${a.name}`,
                onSelect: () => setArea(a.id),
              })),
            ],
          },
          {
            heading: "Darstellung",
            items: [
              {
                id: "theme-dark",
                label: "Theme: Dunkel",
                icon: <Moon size={16} strokeWidth={1.5} />,
                onSelect: () => setTheme("dark"),
              },
              {
                id: "theme-paper",
                label: "Theme: Papier",
                icon: <Sun size={16} strokeWidth={1.5} />,
                onSelect: () => setTheme("paper"),
              },
              {
                id: "ganze-breite",
                label: "Ganze Breite ein/aus (Aufgabe, Notiz, Projekt)",
                icon: <Maximize2 size={16} strokeWidth={1.5} />,
                onSelect: () =>
                  wide.setWide(
                    wide.active
                      ? null
                      : new URLSearchParams(window.location.search).get("aufgabe")
                        ? "task"
                        : isDetailPath(pathname)
                          ? "page"
                          : null,
                  ),
              },
              ...FONT_SIZES.map((size) => ({
                id: `font-${size}`,
                label: `Schriftgröße: ${FONT_SIZE_LABELS[size]}`,
                onSelect: () => setFontSize(size),
              })),
              {
                id: "legende",
                label: "Legende: Farben und Symbole",
                icon: <CircleHelp size={16} strokeWidth={1.5} />,
                onSelect: () => setLegendOpen(true),
              },
              {
                id: "sidebar",
                label: "Seitenleiste ein-/ausklappen",
                icon: <PanelLeft size={16} strokeWidth={1.5} />,
                shortcut: "⌘\\",
                onSelect: toggleSidebar,
              },
            ],
          },
        ]}
      />
    </div>
  );
}
