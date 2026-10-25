"use client";

import { Sunrise } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FoldSection } from "@/components/ui/fold-section";
import { FieldHint } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLocalFlag } from "@/lib/local-pref";
import { INTRO_KEYS, INTRO_PLAY_EVENT, INTRO_VIDEO } from "./model";

type OnOff = "an" | "aus";

const OPTIONS: { value: OnOff; label: string }[] = [
  { value: "an", label: "An" },
  { value: "aus", label: "Aus" },
];

/** Einstellungen › Startbild (E45, Anker `#startbild`): je Gerät an/aus, sofort abspielen. */
export function IntroSection() {
  const [enabled, setEnabled] = useLocalFlag(INTRO_KEYS.enabled, true);
  return (
    <FoldSection
      id="startbild"
      icon={Sunrise}
      title="Startbild"
      sub="Einmal am Tag beim ersten Öffnen von Heute (nur dieses Gerät)"
      summary={enabled ? "An" : "Aus"}
    >
      <div className="w-full max-w-60">
        <SegmentedControl
          value={enabled ? "an" : "aus"}
          onValueChange={(value) => setEnabled(value === "an")}
          options={OPTIONS}
          aria-label="Startbild"
        />
      </div>
      <div>
        <Button onClick={() => window.dispatchEvent(new Event(INTRO_PLAY_EVENT))}>
          Jetzt abspielen
        </Button>
      </div>
      <FieldHint>
        Supernova, danach deine Leitsätze; Antippen zeigt alles sofort, „Überspringen“ geht direkt
        weiter. {INTRO_VIDEO.credit}, frei nutzbar mit Quellenangabe.
      </FieldHint>
    </FoldSection>
  );
}
