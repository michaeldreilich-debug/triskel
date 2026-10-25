"use client";

import { Smartphone } from "lucide-react";
import { FoldSection } from "@/components/ui/fold-section";
import { useInstallState } from "../use-install-state";
import { InstallSteps } from "./install-steps";

/**
 * Einstellungen › Auf dem Handy (E44 H1, Anker `#handy`): dieselbe Anleitung wie der Hinweis auf
 * Heute, dazu der Status dieses Geräts – läuft Triskel gerade als App oder im Browser?
 */
export function InstallSection() {
  const device = useInstallState();
  const status = !device.ready
    ? undefined
    : device.standalone
      ? "Läuft gerade als App vom Home-Bildschirm"
      : "Läuft im Browser";
  return (
    <FoldSection
      id="handy"
      icon={Smartphone}
      title="Auf dem Handy"
      sub="Triskel am iPhone auf den Home-Bildschirm legen"
      summary={status}
    >
      <p data-testid="install-status" className="text-ui">
        {status}
      </p>
      <InstallSteps />
    </FoldSection>
  );
}
