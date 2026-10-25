import type { Metadata } from "next";
import { AiSection } from "@/features/ai/components/ai-section";
import { BackupSection } from "@/features/backup/components/backup-status";
import { ExportSection } from "@/features/export/components/export-section";
import { SettingsPage } from "@/features/settings/components/settings-page";

export const metadata: Metadata = { title: "Einstellungen" };

export default function EinstellungenPage() {
  return (
    <SettingsPage>
      <BackupSection />
      <ExportSection />
      <AiSection />
    </SettingsPage>
  );
}
