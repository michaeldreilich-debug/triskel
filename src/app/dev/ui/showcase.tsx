"use client";

import { CalendarClock, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { GalleryCard, KanbanCard } from "@/components/ui/cards";
import { Checkbox } from "@/components/ui/checkbox";
import { CommandPalette } from "@/components/ui/command-palette";
import { DatePicker } from "@/components/ui/date-picker";
import { DueDate } from "@/components/ui/due-date";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError, FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Pill, Tag } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ProgressRing, ProjectStatusIcon } from "@/components/ui/progress-ring";
import { SectionHeader, SegmentMeter } from "@/components/ui/section-header";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityBadge, ProjectStatusBadge, TaskStatusBadge } from "@/components/ui/status-badge";
import { SummaryLine } from "@/components/ui/summary-line";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { TaskCheck } from "@/components/ui/task-check";
import { notifyWithUndo, toast } from "@/components/ui/toast";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-meta uppercase tracking-widest text-faint">{title}</h3>
      {children}
    </div>
  );
}

export function Showcase() {
  const id = useId();
  const [date, setDate] = useState<string | null>("2026-10-18");
  const [status, setStatus] = useState("offen");
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState<"left" | "right" | "bottom" | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <Block title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Speichern</Button>
          <Button variant="secondary">Abbrechen</Button>
          <Button variant="ghost">Mehr</Button>
          <Button variant="danger">Löschen</Button>
          <Button variant="secondary" disabled>
            Deaktiviert
          </Button>
          <Button variant="secondary" size="icon" aria-label="Hinzufügen">
            <Plus size={16} strokeWidth={1.5} aria-hidden />
          </Button>
          <Button variant="primary" size="sm">
            Klein
          </Button>
        </div>
      </Block>

      <Block title="Eingaben">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-title`}>Titel</Label>
            <Input id={`${id}-title`} placeholder="Was ist zu tun?" />
            <FieldHint>Kurz und als Tätigkeit formulieren.</FieldHint>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-invalid`}>Pflichtfeld</Label>
            <Input
              id={`${id}-invalid`}
              aria-invalid
              aria-describedby={`${id}-invalid-error`}
              defaultValue=""
            />
            <FieldError id={`${id}-invalid-error`}>Bitte ausfüllen.</FieldError>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-status`}>Status</Label>
            <Select
              id={`${id}-status`}
              value={status}
              onValueChange={setStatus}
              options={[
                { value: "offen", label: "Offen" },
                { value: "in_arbeit", label: "In Arbeit" },
                { value: "wartet", label: "Wartet" },
                { value: "erledigt", label: "Erledigt" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-due`}>Fällig</Label>
            <DatePicker id={`${id}-due`} value={date} onChange={setDate} />
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor={`${id}-why`}>Warum</Label>
            <Textarea id={`${id}-why`} placeholder="Warum ist mir das wichtig?" />
          </div>
          <div className="flex flex-col md:col-span-2">
            <Checkbox id={`${id}-cb1`} label="Lebenslauf aktualisieren" />
            <Checkbox id={`${id}-cb2`} label="Einkaufen" defaultChecked />
          </div>
        </div>
      </Block>

      <Block title="Pillen, Tags, Status">
        <div className="flex flex-wrap items-center gap-2">
          <Pill area="orange">Beruf</Pill>
          <Pill area="blue">Privat</Pill>
          <Tag name="prüfung" />
          <TaskStatusBadge status="offen" />
          <TaskStatusBadge status="in_arbeit" />
          <TaskStatusBadge status="wartet" />
          <TaskStatusBadge status="erledigt" />
          <ProjectStatusBadge status="aktiv" />
          <ProjectStatusBadge status="pausiert" />
          <PriorityBadge priority={1} />
          <PriorityBadge priority={2} />
          <Kbd>⌘K</Kbd>
        </div>
      </Block>

      <Block title="Menü und Kontextmenü">
        <div className="flex flex-wrap items-center gap-3">
          <MenuRoot>
            <MenuTrigger asChild>
              <Button variant="secondary">
                <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
                Aktionen
              </Button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuLabel>Aufgabe</MenuLabel>
              <MenuItem shortcut="⌘E">
                <Pencil aria-hidden />
                Bearbeiten
              </MenuItem>
              <MenuItem>
                <Copy aria-hidden />
                Duplizieren
              </MenuItem>
              <MenuSeparator />
              <MenuItem variant="danger">
                <Trash2 aria-hidden />
                In den Papierkorb
              </MenuItem>
            </MenuContent>
          </MenuRoot>
          <ContextMenuRoot>
            <ContextMenuTrigger className="flex min-h-11 items-center rounded-card border border-dashed border-border px-4 text-ui-sm text-muted">
              Rechtsklick (oder lange drücken)
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem>Öffnen</ContextMenuItem>
              <ContextMenuItem>→ Aufgabe</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="danger">Löschen</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenuRoot>
        </div>
      </Block>

      <Block title="Überlagerungen">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSheet("bottom")}>Sheet unten</Button>
          <Button onClick={() => setSheet("left")}>Sheet links</Button>
          <Button onClick={() => setSheet("right")}>Sheet rechts</Button>
          <Button onClick={() => setPalette(true)}>Befehlspalette</Button>
          <Button
            onClick={() => notifyWithUndo("Aufgabe erledigt", () => toast("Rückgängig gemacht"))}
          >
            Toast mit Rückgängig
          </Button>
        </div>
        <Sheet
          open={sheet !== null}
          onOpenChange={(open) => !open && setSheet(null)}
          side={sheet ?? "bottom"}
          title="Details"
        >
          <p className="text-ui text-muted">
            Sheets ersetzen auf dem Handy Sidebar und rechtes Panel.
          </p>
        </Sheet>
        <CommandPalette
          open={palette}
          onOpenChange={setPalette}
          groups={[
            {
              heading: "Beispiel",
              items: [
                {
                  id: "a",
                  label: "Neue Aufgabe",
                  shortcut: "N",
                  onSelect: () => toast("Neue Aufgabe"),
                },
                { id: "b", label: "Neue Notiz", onSelect: () => toast("Neue Notiz") },
              ],
            },
          ]}
        />
      </Block>

      <Block title="Skeleton">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-16 w-full rounded-card" />
        </div>
      </Block>

      <Block title="Leerer Zustand">
        <EmptyState
          icon={<Plus strokeWidth={1.5} />}
          title="Noch keine Aufgaben"
          description="Lege die erste Aufgabe an oder ziehe etwas aus der Inbox hierher."
          action={<Button variant="primary">Aufgabe anlegen</Button>}
        />
      </Block>

      <Block title="Tabelle">
        <Table>
          <THead>
            <TR>
              <TH>Titel</TH>
              <TH>Status</TH>
              <TH>Fällig</TH>
              <TH>Bereich</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD>Atemschutz-Prüffristen exportieren</TD>
              <TD>
                <TaskStatusBadge status="in_arbeit" />
              </TD>
              <TD className="text-ui-sm tabular-nums text-danger">09.10.2026</TD>
              <TD>
                <Pill area="orange">Beruf</Pill>
              </TD>
            </TR>
            <TR>
              <TD>Versicherung: Rückmeldung nachhaken</TD>
              <TD>
                <TaskStatusBadge status="wartet" />
              </TD>
              <TD className="text-ui-sm tabular-nums text-faint">10.10.2026</TD>
              <TD>
                <Pill area="blue">Privat</Pill>
              </TD>
            </TR>
          </TBody>
        </Table>
      </Block>

      <Block title="Karten">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <KanbanCard
            title="Lebenslauf aktualisieren"
            area="blue"
            context="Bewerbung Musterfirma"
            due="2026-10-12"
            priority={1}
          />
          <KanbanCard
            title="Live-Gang Werkstatt-App"
            area="orange"
            context="Werkstatt digitalisieren"
            blocked
          />
          <GalleryCard
            title="Prüffristen Atemschutzgeräte"
            snippet="Pressluftatmer, Masken, offene Punkte …"
            type="Wissen"
            date="02.10."
            area="orange"
            selected
          />
          <GalleryCard
            title="Wartungsplan PA"
            snippet="Intervalle und Zuständigkeiten in der Werkstatt"
            type="Wissen"
            date="28.09."
          />
        </div>
      </Block>

      <Block title="Fortschritt">
        <div className="flex flex-col gap-3">
          <ProgressBar value={0.45} color="orange" label="Werkstatt digitalisieren" />
          <ProgressBar value={0.2} color="blue" label="Bewerbung Musterfirma" />
        </div>
      </Block>

      <Block title="Feinschliff #23: Muster">
        <div className="flex flex-col gap-5">
          <SummaryLine
            parts={[
              { text: "3 im Fokus, 1 erledigt" },
              { text: "1 überfällig", tone: "danger" },
              { text: "4 in der Inbox" },
            ]}
          />
          <SectionHeader
            icon={CalendarClock}
            title="Fällig & überfällig"
            sub="1 überfällig, 1 heute"
            meta={
              <>
                <SegmentMeter value={1} total={3} />1 von 3
              </>
            }
          />
          <div className="flex flex-wrap items-center gap-4">
            <TaskCheck status="offen" aria-label="Offen" />
            <TaskCheck status="offen" priority={1} aria-label="Offen, hoch" />
            <TaskCheck status="offen" priority={2} aria-label="Offen, mittel" />
            <TaskCheck status="in_arbeit" aria-label="In Arbeit" />
            <TaskCheck status="wartet" aria-label="Wartet" />
            <TaskCheck status="erledigt" aria-label="Erledigt" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <DueDate value="2026-10-14" today="2026-10-16" />
            <DueDate value="2026-10-16" today="2026-10-16" />
            <DueDate value="2026-10-17" today="2026-10-16" />
            <DueDate value="2026-10-20" today="2026-10-16" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ProgressRing value={0.6} color="orange" label="Atemschutz-Übung Herbst" />
            <ProgressRing value={0.4} color="blue" label="Schaltzentrale bauen" />
            <ProgressRing value={null} color="blue" label="Garten winterfest" />
            <ProjectStatusIcon status="idee" color="orange" />
            <ProjectStatusIcon status="geplant" color="orange" />
            <ProjectStatusIcon status="pausiert" color="blue" />
            <ProjectStatusIcon status="abgeschlossen" color="blue" />
            <ProjectStatusIcon status="archiv" />
          </div>
        </div>
      </Block>

      <Block title="Typografie">
        <div className="flex flex-col gap-2">
          <p className="heading text-title-lg">Seitentitel</p>
          <p className="heading text-heading">Abschnitt</p>
          <p className="text-body">Fließtext für Notizen und Beschreibungen.</p>
          <p className="text-ui text-muted">Oberflächentext, gedämpft.</p>
          <p className="text-meta uppercase tracking-widest text-faint">Meta-Label</p>
          <p className="text-ui-sm tabular-nums">18.10.2026 · 3 / 3</p>
        </div>
      </Block>
    </div>
  );
}
