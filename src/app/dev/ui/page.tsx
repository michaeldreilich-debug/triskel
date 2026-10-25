import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { Page, PageHeader } from "@/components/shell/page";
import { Showcase } from "./showcase";

export const metadata: Metadata = { title: "UI-Kit" };

export default function DevUiPage() {
  return (
    <AppShell>
      <Page>
        <PageHeader title="UI-Kit" meta="Nur in der Entwicklung · /dev/ui" />
        <p className="max-w-page text-body text-muted">
          Alle Komponenten in beiden Themes nebeneinander. Menüs, Sheets, Befehlspalette und Toasts
          erscheinen im Theme der Seite – umschalten über die Seitenleiste.
        </p>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section
            data-theme="dark"
            data-testid="panel-dark"
            aria-label="Theme Dunkel"
            className="min-w-0 rounded-card border border-border bg-bg p-4 text-fg md:p-6"
          >
            <h2 className="heading mb-6 text-title-sm">Dunkel</h2>
            <Showcase />
          </section>
          <section
            data-theme="paper"
            data-testid="panel-paper"
            aria-label="Theme Papier"
            className="min-w-0 rounded-card border border-border bg-bg p-4 text-fg md:p-6"
          >
            <h2 className="heading mb-6 text-title-sm">Papier</h2>
            <Showcase />
          </section>
        </div>
      </Page>
    </AppShell>
  );
}
