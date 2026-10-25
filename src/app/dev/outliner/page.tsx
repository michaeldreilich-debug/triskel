import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { Playground } from "./playground";

export const metadata: Metadata = { title: "Spielwiese Outliner" };

export default function DevOutlinerPage() {
  return (
    <AppShell>
      <Playground />
    </AppShell>
  );
}
