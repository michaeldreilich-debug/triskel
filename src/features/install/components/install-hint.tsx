"use client";

import { useState } from "react";
import { TriskelMark } from "@/components/triskel-mark";
import { Button } from "@/components/ui/button";
import { shouldShowInstallHint } from "@/lib/install-hint";
import { useLocalFlag } from "@/lib/local-pref";
import { useInstallState } from "../use-install-state";
import { InstallSteps } from "./install-steps";

/** Merker je Gerät: „Verstanden“ blendet den Hinweis dauerhaft aus. */
export const INSTALL_HINT_FLAG = "sz-install-hint-gesehen";

/**
 * Hinweis auf Heute (E44 H1): Triskel auf den Home-Bildschirm legen. Nur auf dem iPhone im
 * Browser (`shouldShowInstallHint`, iPad vorerst nicht), nie am Desktop und nie in der App selbst. „Verstanden“ =
 * dauerhaft weg (je Gerät), „Später“ = nur bis zum nächsten Besuch. Ruhig: umrandet, keine Fläche
 * (die eine gefüllte Karte der Seite ist „Fokus heute“). Dauerhaft unter Einstellungen › Auf dem
 * Handy.
 */
export function InstallHint() {
  const device = useInstallState();
  const [dismissed, setDismissed] = useLocalFlag(INSTALL_HINT_FLAG, false);
  const [later, setLater] = useState(false);
  if (!device.ready || later) return null;
  if (!shouldShowInstallHint({ ...device, dismissed })) return null;
  return (
    <section
      aria-labelledby="install-hint-title"
      data-testid="install-hint"
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-card border border-border bg-surface">
          <TriskelMark size={32} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="install-hint-title" className="heading text-heading">
            Triskel auf den Home-Bildschirm
          </h2>
          <p className="text-ui-sm text-muted">
            Dann startet Triskel wie eine App: ohne Browserleiste, mit eigenem Symbol.
          </p>
        </div>
      </div>
      <InstallSteps />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setDismissed(true)}>
          Verstanden
        </Button>
        <Button variant="ghost" onClick={() => setLater(true)}>
          Später
        </Button>
      </div>
    </section>
  );
}
