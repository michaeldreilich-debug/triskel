"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Plus, X } from "lucide-react";
import { useMemo } from "react";
import type { CommandGroup } from "@/components/ui/command-palette";
import { SaveStatus } from "@/components/ui/save-status";
import { notifyWithUndo } from "@/components/ui/toast";
import { useAreas } from "@/features/areas/api";
import { useCapture } from "@/features/inbox/capture";
import { CaptureSheet } from "@/features/inbox/capture-sheet";
import { inboxItems } from "@/features/inbox/inbox-page";
import { DailyIntro } from "@/features/intro/daily-intro";
import { NotePeekPanel } from "@/features/notes/components/note-peek";
import { PendingUploadsRetry } from "@/features/notes/components/pending-uploads-retry";
import { PaletteSearchResults } from "@/features/search/palette-results";
import { SettingsSync } from "@/features/settings/api";
import { NoteShareDialogHost } from "@/features/share/components/share-dialog";
import { useTasks } from "@/features/tasks/api";
import { TaskDndProvider } from "@/features/tasks/components/task-dnd";
import { TaskPeekPanel, TaskPeekSheet } from "@/features/tasks/components/task-peek";
import { TodayPickPanel } from "@/features/today/pick-panel";
import { useSupabase } from "@/lib/data/provider";
import { useSaveQueue, useSaveStatus } from "@/lib/save-queue/react";
import { AppShell } from "./app-shell";
import { ActiveProjectsNav, RecentNav, SavedViewsNav } from "./sidebar-sections";
import { TabBar, TabCounter, TabTitleSync } from "./tabs/tab-bar";
import { type TabActions, TabsProvider, useTabActions } from "./tabs/tabs-provider";

const projectsSlot = (onNavigate?: () => void) => <ActiveProjectsNav onNavigate={onNavigate} />;
const viewsSlot = (onNavigate?: () => void) => <SavedViewsNav onNavigate={onNavigate} />;
const recentSlot = (onNavigate?: () => void) => <RecentNav onNavigate={onNavigate} />;
const searchResults = (text: string, close: () => void) => (
  <PaletteSearchResults text={text} onOpen={close} />
);

const countInbox = (rows: Parameters<typeof inboxItems>[0]) => inboxItems(rows).length;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const tabBar = <TabBar />;
const tabCounter = <TabCounter />;

/** Reiter in ⌘K (#63): auch ohne Maus erreichbar. */
const tabCommands = (tabs: TabActions | null): CommandGroup[] =>
  tabs
    ? [
        {
          heading: "Reiter",
          items: [
            {
              id: "reiter-neu",
              label: "Neuer Reiter",
              keywords: ["Tab"],
              icon: <Plus size={16} strokeWidth={1.5} />,
              onSelect: tabs.openNew,
            },
            {
              id: "reiter-weiter",
              label: "Nächster Reiter",
              keywords: ["Tab", "wechseln"],
              icon: <ArrowLeftRight size={16} strokeWidth={1.5} />,
              shortcut: "⌃⌥→",
              onSelect: () => tabs.step(1),
            },
            {
              id: "reiter-zurueck",
              label: "Vorheriger Reiter",
              keywords: ["Tab", "wechseln"],
              icon: <ArrowLeftRight size={16} strokeWidth={1.5} />,
              shortcut: "⌃⌥←",
              onSelect: () => tabs.step(-1),
            },
            {
              id: "reiter-schliessen",
              label: "Reiter schließen",
              keywords: ["Tab"],
              icon: <X size={16} strokeWidth={1.5} />,
              onSelect: tabs.closeActive,
            },
          ],
        },
      ]
    : [];

/** Shell mit echten Daten: Bereiche aus der DB, Speicherstatus, Einstellungen, Abmelden, Reiter. */
export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <TabsProvider>
      {/* Aufgaben per Ziehen ablegen (#89, #90): Seite und Seitenpanels im selben Kontext */}
      <TaskDndProvider>
        <AppFrameShell>{children}</AppFrameShell>
      </TaskDndProvider>
    </TabsProvider>
  );
}

function AppFrameShell({ children }: { children: React.ReactNode }) {
  const tabs = useTabActions();
  const commands = useMemo(() => tabCommands(tabs), [tabs]);
  const areas = useAreas();
  const queue = useSaveQueue();
  const status = useSaveStatus(queue);
  const queryClient = useQueryClient();
  const getSupabase = useSupabase();
  // nur die Zahl abonnieren: Tippen in einer Aufgabe rendert die Shell dann nicht neu (O-7)
  const inboxCount = useTasks(countInbox).data ?? 0;
  const capture = useCapture();
  const sidebarSlots = useMemo(
    () => ({
      projects: projectsSlot,
      views: viewsSlot,
      recent: recentSlot,
      badges: { "/inbox": inboxCount },
    }),
    [inboxCount],
  );
  const paletteCapture = useMemo(
    () => ({
      preview: (text: string) => capture.describe(capture.parse(text)),
      submit: (text: string) => {
        capture.submit(text);
      },
    }),
    [capture],
  );

  async function signOut() {
    // Ungespeichertes zuerst senden (höchstens 3 s); was offen bleibt, liegt weiter lokal je Nutzer
    await Promise.race([queue.flush(), wait(3000)]);
    // danach nichts mehr senden (sonst mit dem anon-Schlüssel → „fehlgeschlagen“, D-4); der
    // Rest bleibt im Spiegel und geht nach der nächsten Anmeldung raus
    queue.dispose();
    await getSupabase().auth.signOut({ scope: "local" });
    queryClient.clear();
  }

  return (
    <AppShell
      areas={areas.data ?? []}
      areasLoading={areas.isPending}
      onSignOut={signOut}
      panel={
        <>
          <NotePeekPanel />
          <TaskPeekPanel />
          <TodayPickPanel />
          <PendingUploadsRetry />
        </>
      }
      sidebarSlots={sidebarSlots}
      capture={paletteCapture}
      searchResults={searchResults}
      tabBar={tabBar}
      tabCounter={tabCounter}
      commands={commands}
      saveStatus={(variant) => (
        <SaveStatus
          snapshot={status}
          onRetry={() => queue.retryFailed({ force: true })}
          onDiscard={() => {
            const dropped = queue.discardFailed();
            if (dropped.length === 0) return;
            notifyWithUndo(
              `${dropped.length} nicht speicherbare Änderung${dropped.length === 1 ? "" : "en"} verworfen`,
              () => queue.restoreFailed(dropped),
            );
          }}
          compact={variant === "compact"}
          data-testid={`save-status-${variant}`}
        />
      )}
    >
      <SettingsSync />
      <TabTitleSync />
      {children}
      <TaskPeekSheet />
      <CaptureSheet />
      <NoteShareDialogHost />
      <DailyIntro />
    </AppShell>
  );
}
