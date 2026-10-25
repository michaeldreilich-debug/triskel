"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, ChevronRight, Copy } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FoldSection } from "@/components/ui/fold-section";
import { controlClasses, FieldHint } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { notifyWithUndo, toast } from "@/components/ui/toast";
import { calendarEventsKey } from "@/features/calendar/api";
import { linkableEvent } from "@/features/calendar/links";
import { createEventLinkActions, eventLinksKey } from "@/features/calendar/links-api";
import { notesKey } from "@/features/notes/api";
import { milestonesKey, projectsKey, tasksKey } from "@/features/tasks/api";
import { cn } from "@/lib/cn";
import { useSupabase } from "@/lib/data/provider";
import { berlinDate, berlinTime, formatDayShort } from "@/lib/dates";
import { useSaveQueue } from "@/lib/save-queue/react";
import {
  type ActivityRow,
  activityHref,
  activityKey,
  canUndo,
  editedBlockIds,
  fetchActivity,
  fieldLabel,
  isEventUndo,
  parseUndo,
  undoConflicts,
  undoNoteIds,
  undoOps,
} from "../activity";
import { allowClient } from "../consent";
import { fetchGoogleSourceMap, undoEventAction } from "../event-undo";

export const grantsKey = ["ai-grants"] as const;
export const aiClientsKey = ["ai-clients"] as const;
const MCP_PATH = "/api/mcp";

interface Grant {
  clientId: string;
  name: string;
  grantedAt: string;
}

interface AiClient {
  client_id: string;
  name: string;
  revoked_at: string | null;
}

const when = (at: string) => `${formatDayShort(berlinDate(at))}, ${berlinTime(at)}`;

/**
 * Einstellungen › KI-Zugänge (#33): Adresse und Anleitung für Claude und ChatGPT, erteilte
 * Zugänge (Trennen mit Rückfrage inline) und was die KI zuletzt geändert hat – mit Link und, wo
 * möglich, „Rückgängig“ (über die Speicher-Warteschlange wie jede Änderung). Ein Zugang wirkt
 * nur mit Freigabe in ai_clients (E27 Fall B); fehlt sie, steht hier ein Hinweis – dann wurde
 * nicht auf /ki-zugang mit TOTP erlaubt.
 */
export function AiSection() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  const queryClient = useQueryClient();
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Rückfrage: seit der KI-Änderung selbst geändert (D-8) bzw. Notiz öffentlich freigegeben (M-1) */
  const [conflict, setConflict] = useState<{
    id: string;
    fields: string[];
    shared: boolean;
  } | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const address = `${origin}${MCP_PATH}`;

  const grants = useQuery({
    queryKey: grantsKey,
    retry: false,
    queryFn: async (): Promise<Grant[]> => {
      const { data, error } = await getSupabase().auth.oauth.listGrants();
      if (error) throw error;
      return data
        .map((g) => ({
          clientId: g.client.id,
          name: g.client.name || "Unbekannter Client",
          grantedAt: g.granted_at,
        }))
        .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
    },
  });
  const clients = useQuery({
    queryKey: aiClientsKey,
    queryFn: async (): Promise<AiClient[]> => {
      const { data, error } = await getSupabase()
        .from("ai_clients")
        .select("client_id, name, revoked_at")
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
  });
  const activity = useQuery({ queryKey: activityKey, queryFn: () => fetchActivity(getSupabase()) });
  const nameOf = (clientId: string) =>
    grants.data?.find((g) => g.clientId === clientId)?.name ??
    clients.data?.find((c) => c.client_id === clientId)?.name ??
    "KI";
  const isAllowed = (clientId: string) =>
    clients.data?.some((c) => c.client_id === clientId && !c.revoked_at) ?? true;
  /** getrennt (revoked_at), beim Auth-Server aber noch verbunden – Trennen war unvollständig */
  const isHalfRevoked = (clientId: string) =>
    clients.data?.some((c) => c.client_id === clientId && c.revoked_at) ?? false;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopieren nicht möglich – Adresse bitte markieren.");
    }
  };

  // Erst die Freigabe zurücknehmen (sperrt sofort, auch schon ausgestellte Tokens), dann den
  // Zugang beim Auth-Server trennen (Sitzung und Erneuern weg)
  const revoke = async (grant: Grant) => {
    setBusy(grant.clientId);
    const supabase = getSupabase();
    const blocked = await supabase
      .from("ai_clients")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", grant.clientId);
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId: grant.clientId });
    setBusy(null);
    setConfirm(null);
    await Promise.all(
      [grantsKey, aiClientsKey].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
    if (blocked.error || error) {
      toast.error(`Trennen fehlgeschlagen: ${(blocked.error ?? error)?.message}`);
      return;
    }
    toast(`„${grant.name}“ getrennt – der Zugang gilt ab sofort nicht mehr.`);
  };

  const reload = () =>
    Promise.all(
      [
        activityKey,
        notesKey,
        ["note-blocks"],
        tasksKey,
        projectsKey,
        milestonesKey,
        calendarEventsKey,
        eventLinksKey,
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );

  // Wieder freigeben (S-5): nach halb gescheitertem „Trennen“ leitet der Auth-Server beim
  // Wiederverbinden ohne Rückfrage weiter – ohne Freigabe endete jede Anfrage mit 401
  const allow = async (grant: Grant) => {
    setBusy(grant.clientId);
    try {
      await allowClient(getSupabase(), { clientId: grant.clientId, clientName: grant.name });
      toast(`„${grant.name}“ wieder freigegeben.`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
      await queryClient.invalidateQueries({ queryKey: aiClientsKey });
    }
  };

  // Google-Termine (N1d): über die Termin-Routen der App; erst nach Erfolg als zurückgeholt vermerkt
  const undoEvent = async (row: ActivityRow, parsed: Parameters<typeof undoEventAction>[0]) => {
    setBusy(row.id);
    try {
      const sources = await fetchGoogleSourceMap(getSupabase());
      const result = await undoEventAction(parsed, sources);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (result.retarget) {
        const restored = linkableEvent(result.retarget.event);
        if (restored) {
          createEventLinkActions(queue, queryClient).retarget(result.retarget.from, restored);
        }
      }
      for (const op of undoOps(row, new Date().toISOString())) queue.enqueue(op);
      await queue.flush();
      toast(`Zurückgeholt: ${row.summary}${result.note ? ` – ${result.note}` : ""}`);
    } catch {
      toast.error("Zurückholen nicht möglich – bitte später noch einmal versuchen.");
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const undo = async (row: ActivityRow, force = false) => {
    const parsed = parseUndo(row.undo);
    if (isEventUndo(parsed)) return undoEvent(row, parsed);
    setBusy(row.id);
    // aktueller Stand: für die Rückfrage, und damit sich das Zurückholen selbst zurücknehmen lässt
    let current: Record<string, unknown> | null = null;
    const fields: string[] = [];
    if (parsed?.kind === "update" && Object.keys(parsed.before).length > 0) {
      const { data } = await getSupabase()
        .from(parsed.table)
        .select(Object.keys(parsed.before).join(", "))
        .eq("id", parsed.id)
        .maybeSingle();
      current = (data as Record<string, unknown> | null) ?? null;
      if (current) fields.push(...undoConflicts(parsed, current));
    }
    // von der KI eingefügte Blöcke, die seitdem bearbeitet wurden (K-2): Rückgängig löscht sie
    if ((parsed?.kind === "replace" || parsed?.kind === "append") && parsed.added.length > 0) {
      const { data } = await getSupabase()
        .from("note_blocks")
        .select("id, created_at, updated_at")
        .in("id", parsed.added)
        .is("deleted_at", null);
      if (data && editedBlockIds(data).length > 0) fields.push("blocks");
    }
    // öffentlich freigegebene Notiz (M-1/K-4): Rückgängig läuft mit aal2 an der KI-Sperre vorbei
    let shared = false;
    const noteIds = undoNoteIds(parsed);
    if (noteIds.length > 0) {
      const { data, error } = await getSupabase()
        .from("note_shares")
        .select("note_id")
        .in("note_id", noteIds)
        .is("revoked_at", null)
        .is("deleted_at", null)
        .limit(1);
      if (error) {
        setBusy(null);
        toast.error("Freigaben nicht prüfbar – bitte später noch einmal versuchen.");
        return;
      }
      shared = (data?.length ?? 0) > 0;
    }
    if ((fields.length > 0 || shared) && !force) {
      setBusy(null);
      setConflict({ id: row.id, fields, shared });
      return;
    }
    setConflict(null);
    for (const op of undoOps(row, new Date().toISOString())) queue.enqueue(op);
    await queue.flush();
    setBusy(null);
    const snapshot = queue.getSnapshot();
    if (snapshot.failed > 0) {
      toast.error("Zurückholen nicht vollständig gespeichert – siehe Speicherstatus.");
    } else if (snapshot.pending > 0) {
      // offline bzw. Server-Fehler: wartet im Backoff, ist also noch nicht zurückgeholt (D-12)
      toast("Wird zurückgeholt, sobald die Verbindung wieder da ist – siehe Speicherstatus.");
    } else if (parsed?.kind === "update" && current) {
      const { table, id } = parsed;
      const overwritten = current;
      notifyWithUndo(`Zurückgeholt: ${row.summary}`, () => {
        queue.enqueue({ table, id, mode: "update", values: overwritten });
        queue.enqueue({
          table: "ai_activity",
          id: row.id,
          mode: "update",
          values: { undone_at: null },
        });
        void queue.flush().then(reload);
      });
    } else toast(`Zurückgeholt: ${row.summary}`);
    await reload();
  };

  return (
    <FoldSection
      id="ki"
      icon={Bot}
      title="KI-Zugänge"
      sub="Claude und ChatGPT verbinden – Papierkorb nur mit Rückfrage"
      summary={
        grants.data
          ? grants.data.length === 0
            ? "Keine KI verbunden"
            : `Verbunden: ${grants.data.map((g) => g.name).join(", ")}`
          : undefined
      }
      bodyClassName="gap-6"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="mcp-address" className="text-ui font-medium">
          Adresse
        </label>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <input
              id="mcp-address"
              data-testid="mcp-address"
              readOnly
              value={origin ? address : MCP_PATH}
              onFocus={(event) => event.currentTarget.select()}
              className={cn(controlClasses, "h-11 font-mono text-ui-sm md:h-9")}
            />
          </div>
          <Button size="icon" onClick={copy} aria-label="Adresse kopieren" disabled={!origin}>
            {copied ? (
              <Check size={16} strokeWidth={1.5} aria-hidden />
            ) : (
              <Copy size={16} strokeWidth={1.5} aria-hidden />
            )}
          </Button>
        </div>
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-ui-sm text-link md:min-h-9 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={14}
              strokeWidth={1.5}
              aria-hidden
              className="transition-transform group-open:rotate-90"
            />
            So verbindest du Claude und ChatGPT
          </summary>
          <ol className="ml-5 flex list-decimal flex-col gap-2 text-ui-sm text-muted">
            <li>
              Einmal je KI in Supabase unter Authentication › OAuth Apps einen{" "}
              <span className="text-fg">vertraulichen</span> Zugang anlegen (README › KI-Zugang).
              Client-ID und Geheimnis gibst du nur dort ein, wo du die KI verbindest.
            </li>
            <li>
              <span className="text-fg">Claude</span> (Web, Desktop, iPhone): Einstellungen ›
              Konnektoren › „Eigenen Konnektor hinzufügen“, Name „Triskel“, Adresse einfügen. Bei
              „OAuth client“ den eigenen Client wählen („Use your own OAuth client“), Client-ID und
              Geheimnis eintragen, „Verbinden“. Danach öffnet sich diese App: anmelden, „Erlauben“.
              Bei den Werkzeugen „In den Papierkorb legen“ und „Termin löschen“ die Freigabe auf
              „jedes Mal fragen“ lassen.
            </li>
            <li>
              <span className="text-fg">ChatGPT</span> (Web): Einstellungen › Apps › Erweitert ›
              Entwicklermodus an, dann „App erstellen“ mit der Adresse, Anmeldung OAuth mit
              Client-ID und Geheimnis. Die Rücksprung-Adresse, die ChatGPT anzeigt, beim
              ChatGPT-Zugang in Supabase eintragen. Ob ChatGPT auch schreiben darf, hängt vom Abo
              ab.
            </li>
            <li>
              <span className="text-fg">Claude Code</span> (fragt das Geheimnis verdeckt ab):{" "}
              <Kbd className="break-all">
                claude mcp add --transport http --client-id CLIENT-ID --client-secret
                --callback-port 8080 schaltzentrale {address}
              </Kbd>
            </li>
          </ol>
        </details>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-ui font-medium">Verbunden</h3>
        {grants.isPending ? (
          <Skeleton className="h-12 w-full rounded-card" />
        ) : grants.isError ? (
          <FieldHint>
            Noch nicht eingerichtet: Der OAuth-Server ist in Supabase aus (README › KI-Zugang).
          </FieldHint>
        ) : grants.data.length === 0 ? (
          <FieldHint>Noch kein Zugang erteilt.</FieldHint>
        ) : (
          <ul className="flex flex-col rounded-card border border-border" data-testid="ai-grants">
            {grants.data.map((grant) => (
              <li
                key={grant.clientId}
                className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-border px-3 py-1.5 [&:not(:last-child)]:border-b"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ui font-medium">{grant.name}</span>
                  {isAllowed(grant.clientId) ? (
                    <span className="text-meta text-faint">seit {when(grant.grantedAt)}</span>
                  ) : isHalfRevoked(grant.clientId) ? (
                    <span className="text-meta text-warning">
                      Trennen unvollständig – kein Zugriff, aber noch verbunden. Noch einmal trennen
                      oder wieder freigeben.
                    </span>
                  ) : (
                    <span className="text-meta text-warning">
                      Ohne Freigabe – kein Zugriff. Nicht von dir mit TOTP erlaubt? Trennen.
                    </span>
                  )}
                </span>
                {!isAllowed(grant.clientId) && confirm !== grant.clientId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === grant.clientId}
                    onClick={() => allow(grant)}
                    aria-label={`„${grant.name}“ wieder freigeben`}
                  >
                    {isHalfRevoked(grant.clientId) ? "Wieder freigeben" : "Freigeben"}
                  </Button>
                ) : null}
                {confirm === grant.clientId ? (
                  <span className="flex items-center gap-2">
                    <span className="text-ui-sm text-muted">Wirklich trennen?</span>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy === grant.clientId}
                      onClick={() => revoke(grant)}
                    >
                      Trennen
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      Abbrechen
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirm(grant.clientId)}
                    aria-label={`„${grant.name}“ trennen`}
                  >
                    Trennen
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-ui font-medium">Zuletzt durch KI geändert</h3>
        {activity.isPending ? (
          <Skeleton className="h-24 w-full rounded-card" />
        ) : activity.isError ? (
          <FieldHint>Das Protokoll ist gerade nicht erreichbar.</FieldHint>
        ) : activity.data.length === 0 ? (
          <FieldHint>
            Noch nichts – hier erscheint jede Änderung, die Claude oder ChatGPT macht.
          </FieldHint>
        ) : (
          <ul className="flex flex-col" data-testid="ai-activity">
            {activity.data.map((row) => {
              const href = activityHref(row);
              return (
                <li
                  key={row.id}
                  className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border py-1.5 last:border-b-0"
                >
                  <span className="w-28 shrink-0 text-ui-sm text-faint tabular-nums">
                    {when(row.created_at)}
                  </span>
                  <span className="min-w-0 flex-1 text-ui-sm">
                    {href ? (
                      <Link href={href} className="text-link hover:underline">
                        {row.summary}
                      </Link>
                    ) : (
                      row.summary
                    )}
                    <span className="text-faint"> · {nameOf(row.client_id)}</span>
                  </span>
                  {row.undone_at ? (
                    <span className="text-meta text-faint">zurückgeholt</span>
                  ) : conflict?.id === row.id ? (
                    <span
                      className="flex w-full flex-wrap items-center gap-2 text-ui-sm"
                      data-testid="ai-undo-conflict"
                    >
                      <span className="text-muted">
                        {conflict.fields.length > 0
                          ? `Seitdem selbst geändert: ${conflict.fields.map(fieldLabel).join(", ")}. `
                          : null}
                        {conflict.shared
                          ? "Die Notiz ist öffentlich freigegeben – was zurückkommt, sieht jeder mit dem Link. "
                          : null}
                        Trotzdem auf den Stand vor der KI zurücksetzen?
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>
                        Abbrechen
                      </Button>
                      <Button size="sm" disabled={busy === row.id} onClick={() => undo(row, true)}>
                        Trotzdem zurücksetzen
                      </Button>
                    </span>
                  ) : canUndo(row) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === row.id}
                      onClick={() => undo(row)}
                      aria-label={`Rückgängig: ${row.summary}`}
                    >
                      Rückgängig
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FoldSection>
  );
}
