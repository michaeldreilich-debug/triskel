"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FoldSection } from "@/components/ui/fold-section";
import { FieldHint } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useSettingsActions, useUserSettings } from "@/features/settings/api";
import { useSupabase } from "@/lib/data/provider";
import { berlinDate, berlinTime, formatDayShort } from "@/lib/dates";
import { useSaveQueue } from "@/lib/save-queue/react";
import { fetchExportData } from "../fetch";
import { buildVault } from "../vault";
import { exportAge, exportName, zipVault } from "../zip";

/** Datei im Browser speichern (kein Server dazwischen). */
function download(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Markdown-Export (B14): alles als ZIP – ein Obsidian-Vault samt export.json. Läuft komplett im
 * Browser mit der eigenen Sitzung; der Zeitpunkt landet in user_settings (Hinweis im Rückblick).
 */
export function ExportSection() {
  const getSupabase = useSupabase();
  const queue = useSaveQueue();
  const settings = useUserSettings();
  const actions = useSettingsActions();
  const [busy, setBusy] = useState(false);
  const last = settings.data?.last_export_at ?? null;
  const age = exportAge(last);

  const run = async () => {
    setBusy(true);
    try {
      // erst Wartendes speichern, sonst fehlte es still im Export (T-10)
      await queue.flush();
      const open = queue.getSnapshot();
      const now = new Date();
      const data = await fetchExportData(getSupabase(), now);
      const files = buildVault(data);
      const name = exportName(berlinDate(now));
      download(zipVault(files, name, now), `${name}.zip`);
      actions.update({ last_export_at: now.toISOString() });
      const count = files.filter((f) => f.path.endsWith(".md")).length;
      const attachments = files.filter((f) => f.path.startsWith("Anhänge/")).length;
      const message = `Export erstellt: ${count} Markdown-Dateien${attachments ? `, ${attachments} Bilder und Dateien` : ""} und export.json`;
      const problems = [
        data.missingAttachments
          ? `${data.missingAttachments} ${data.missingAttachments === 1 ? "Bild/Datei fehlt" : "Bilder/Dateien fehlen"} (Laden fehlgeschlagen)`
          : null,
        open.failed + open.pending > 0
          ? "noch nicht Gespeichertes fehlt (siehe Speicherstatus)"
          : null,
      ].filter(Boolean);
      if (problems.length > 0) toast.error(`${message} – ${problems.join(", ")}.`);
      else toast(message);
    } catch {
      toast.error("Export fehlgeschlagen. Verbindung prüfen und erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FoldSection
      id="export"
      icon={Download}
      title="Export"
      sub="Alles als Markdown – öffnet sich als Obsidian-Vault"
      summary={
        // erst mit geladenen Einstellungen (M3-2)
        !settings.data
          ? undefined
          : last
            ? `Letzter Export: ${formatDayShort(berlinDate(last))}, ${berlinTime(last)}`
            : "Noch kein Export"
      }
    >
      <div className="flex flex-col items-start gap-2">
        <Button variant="primary" onClick={run} disabled={busy}>
          <Download size={16} strokeWidth={1.5} aria-hidden />
          {busy ? "Export wird erstellt …" : "Export herunterladen (ZIP)"}
        </Button>
        <p className="text-ui-sm text-muted" data-testid="last-export">
          {last
            ? `Letzter Export: ${formatDayShort(berlinDate(last))}, ${berlinTime(last)} (${age.label})`
            : "Noch kein Export."}
        </p>
        <FieldHint>
          Projekte mit Fahrplan, Aufgaben, Notizen und Rückblicke als Markdown-Dateien, dazu
          export.json mit allen Daten (auch dem Papierkorb) – zum Mitnehmen, etwa nach Obsidian.
          Gesichert wird ohnehin jede Nacht (Sicherung, oben).
        </FieldHint>
      </div>
    </FoldSection>
  );
}
