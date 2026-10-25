"use client";

import type { Editor, JSONContent } from "@tiptap/core";
import { RotateCcw } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { SaveStatus } from "@/components/ui/save-status";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { OutlineEditor } from "@/features/outliner/components/outline-editor";
import { OUTLINER_HELP } from "@/features/outliner/components/outliner-help";
import {
  createLocalNoteDirectory,
  createLocalTagDirectory,
  type NoteSummary,
} from "@/features/outliner/directory";
import { ensureBlockIds } from "@/features/outliner/model/ids";
import { type BlockRow, docToRows, rowsToDoc } from "@/features/outliner/model/serializer";
import { OutlineSync } from "@/features/outliner/sync";
import { newId } from "@/lib/id";
import { useSaveStatus } from "@/lib/save-queue/react";
import { type SaveOp, SaveQueue } from "@/lib/save-queue/save-queue";
import { DEMO_DOC, DEMO_NOTES, DEMO_TAGS } from "./demo";

/**
 * Spielwiese für den Outliner (nur Entwicklung): Der „Server“ ist ein simulierter Speicher in
 * localStorage. Editor → OutlineSync → Speicher-Warteschlange → simuliertes Speichern, mit
 * abschaltbarem Netz. Damit lassen sich Tastaturbefehle, Wiederherstellung und Netzabbruch
 * ohne Backend prüfen.
 */
declare global {
  interface Window {
    /** nur Spielwiese: Editor für E2E-Tests (Cursor setzen, Zustand lesen) */
    __devOutliner?: Editor | null;
  }
}

const exposeEditor = (editor: Editor | null) => {
  window.__devOutliner = editor;
};

const SERVER_KEY = "sz:dev-outliner:server";
const QUEUE_KEY = "sz:dev-outliner:queue";
const TABLE = "note_blocks";

interface ServerState {
  rows: BlockRow[];
  notes: NoteSummary[];
}

function readServer(): ServerState | null {
  try {
    const raw = window.localStorage.getItem(SERVER_KEY);
    return raw ? (JSON.parse(raw) as ServerState) : null;
  } catch {
    return null;
  }
}

function writeServer(state: ServerState) {
  window.localStorage.setItem(SERVER_KEY, JSON.stringify(state));
}

/** Operationen auf den simulierten Server anwenden (Upsert ganzer Zeilen bzw. Update). */
function applyOps(rows: BlockRow[], ops: SaveOp[]): BlockRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const op of ops) {
    if (op.table !== TABLE) continue;
    const existing = byId.get(op.id);
    if (op.mode === "upsert")
      byId.set(op.id, { ...existing, ...(op.values as unknown as BlockRow) });
    else if (existing) byId.set(op.id, { ...existing, ...(op.values as Partial<BlockRow>) });
  }
  return [...byId.values()];
}

function outlineText(doc: JSONContent): string {
  const lines: string[] = [];
  const walk = (blocks: JSONContent[] | undefined, depth: number) => {
    for (const block of blocks ?? []) {
      const [paragraph, ...children] = block.content ?? [];
      const content = (paragraph?.content ?? [])
        .map((n) =>
          n.type === "text"
            ? n.text
            : n.type === "noteLink"
              ? "[[…]]"
              : n.type === "tag"
                ? `#${n.attrs?.name}`
                : "",
        )
        .join("");
      lines.push(`${"  ".repeat(depth)}${block.attrs?.collapsed ? "▸ " : ""}${content}`);
      walk(children, depth + 1);
    }
  };
  walk(doc.content, 0);
  return lines.join("\n");
}

interface Session {
  queue: SaveQueue;
  sync: OutlineSync;
  initialDoc: JSONContent;
  notes: NoteSummary[];
  restored: number;
}

const SHORTCUTS = OUTLINER_HELP.flatMap((section) => section.rows);

export function Playground() {
  const offlineId = useId();
  const offline = useRef(false);
  const [isOffline, setIsOffline] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [serverRows, setServerRows] = useState<BlockRow[]>([]);

  useEffect(() => {
    let server = readServer();
    if (!server) {
      const doc = ensureBlockIds(DEMO_DOC, newId);
      server = { rows: docToRows(doc), notes: DEMO_NOTES };
      writeServer(server);
    }
    const queue = new SaveQueue({
      storage: window.localStorage,
      storageKey: QUEUE_KEY,
      debounceMs: 300,
      retryBaseMs: 1000,
      retryMaxMs: 4000,
      isOnline: () => !offline.current,
      persist: async (batch) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (offline.current) throw new Error("Netz getrennt (simuliert)");
        const current = readServer() ?? { rows: [], notes: [] };
        const rows = applyOps(current.rows, batch);
        writeServer({ ...current, rows });
        setServerRows(rows);
      },
    });
    // lokaler Stand = gespeichert + noch Unbestätigtes (lokaler Stand hat Vorrang)
    const localRows = applyOps(server.rows, queue.unconfirmedOps());
    const sync = new OutlineSync(queue, { initialRows: localRows, delayMs: 300 });
    void queue.restore().then((restored) => {
      setServerRows(server.rows);
      setSession({ queue, sync, initialDoc: rowsToDoc(localRows), notes: server.notes, restored });
    });

    const flush = () => void sync.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onOnline = () => queue.handleOnline();
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      sync.commit();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      queue.dispose();
    };
  }, []);

  if (!session) {
    return (
      <Page>
        <PageHeader
          title="Spielwiese Outliner"
          meta="Nur in der Entwicklung · lokaler Zustand im Browser"
        />
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      </Page>
    );
  }

  return (
    <PlaygroundView
      session={session}
      serverRows={serverRows}
      isOffline={isOffline}
      offlineId={offlineId}
      onOfflineChange={(value) => {
        offline.current = value;
        setIsOffline(value);
        if (!value) session.queue.handleOnline();
      }}
    />
  );
}

function PlaygroundView({
  session,
  serverRows,
  isOffline,
  offlineId,
  onOfflineChange,
}: {
  session: Session;
  serverRows: BlockRow[];
  isOffline: boolean;
  offlineId: string;
  onOfflineChange: (value: boolean) => void;
}) {
  const status = useSaveStatus(session.queue);
  const notes = useMemo(
    () =>
      createLocalNoteDirectory(session.notes, {
        onChange: (list) => {
          const current = readServer();
          if (current) writeServer({ ...current, notes: list });
        },
      }),
    [session.notes],
  );
  const tags = useMemo(() => createLocalTagDirectory(DEMO_TAGS), []);
  const serverTree = useMemo(() => outlineText(rowsToDoc(serverRows)), [serverRows]);

  return (
    <Page>
      <PageHeader
        title="Spielwiese Outliner"
        meta="Nur in der Entwicklung · lokaler Zustand im Browser"
        actions={
          <SaveStatus
            snapshot={status}
            onRetry={() => session.queue.retryFailed()}
            className="pb-2"
          />
        }
      />
      {session.restored > 0 ? (
        <p
          data-testid="restored-hint"
          className="rounded-control border border-warning/50 px-3 py-2 text-ui-sm text-warning"
        >
          {session.restored} ungespeicherte Änderung(en) aus der letzten Sitzung wiederhergestellt –
          werden jetzt gespeichert.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,760px)_minmax(0,1fr)]">
        <section aria-labelledby="note-title" className="flex min-w-0 flex-col gap-4">
          <h2 id="note-title" className="heading text-title-sm">
            Prüffristen Atemschutzgeräte
          </h2>
          <OutlineEditor
            initialContent={session.initialDoc}
            notes={notes}
            tags={tags}
            ariaLabel="Notiz"
            onChange={(doc) => session.sync.change(doc)}
            onEditorReady={exposeEditor}
            onBlur={() => session.sync.commit()}
            onOpenNote={(id) =>
              toast(
                `„${notes.titleOf(id) ?? "Notiz"}“ – Öffnen gibt es nur in der App unter Wissen`,
              )
            }
          />
        </section>
        <aside aria-label="Steuerung" className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Checkbox
              id={offlineId}
              label="Netz trennen (simuliert)"
              checked={isOffline}
              onCheckedChange={(value) => onOfflineChange(value === true)}
            />
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => {
                window.localStorage.removeItem(SERVER_KEY);
                window.localStorage.removeItem(QUEUE_KEY);
                window.location.reload();
              }}
            >
              <RotateCcw size={16} strokeWidth={1.5} aria-hidden />
              Zurücksetzen
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-meta uppercase tracking-widest text-faint">Tastenkürzel</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-ui-sm">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={keys} className="contents">
                  <dt>
                    <Kbd>{keys}</Kbd>
                  </dt>
                  <dd className="text-muted">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-meta uppercase tracking-widest text-faint">
              Gespeichert (simulierter Server) · {serverRows.filter((r) => !r.deleted_at).length}{" "}
              Blöcke
            </h3>
            <pre
              data-testid="server-tree"
              className="max-h-80 overflow-auto rounded-card border border-border bg-surface p-3 font-mono text-meta whitespace-pre-wrap text-muted"
            >
              {serverTree}
            </pre>
          </div>
        </aside>
      </div>
    </Page>
  );
}
