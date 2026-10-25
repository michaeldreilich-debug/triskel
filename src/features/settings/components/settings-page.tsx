"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FileText,
  Folder,
  History,
  LayoutTemplate,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { FontSizeSwitch } from "@/components/shell/font-size-switch";
import { Page, PageHeader } from "@/components/shell/page";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { useBufferedText } from "@/components/ui/buffered";
import { BufferedInput } from "@/components/ui/buffered-input";
import { Button } from "@/components/ui/button";
import { FoldSection } from "@/components/ui/fold-section";
import { controlClasses, FieldHint } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarSourcesSection } from "@/features/calendar/components/calendar-sources-section";
import { InstallSection } from "@/features/install/components/install-section";
import { IntroSection } from "@/features/intro/intro-section";
import { NoteTypesSection } from "@/features/notes/components/note-types-section";
import { type NoteTypes, useNoteTypes } from "@/features/notes/note-types";
import { DEFAULT_QUESTIONS, FIXED_KEYS, parseQuestions } from "@/features/recaps/model";
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, type RecapQuestion } from "@/features/recaps/types";
import { SharesSection } from "@/features/share/components/shares-section";
import { useTemplateActions, useTemplates } from "@/features/templates/api";
import {
  docToLines,
  linesToDoc,
  newQuestionKey,
  noteTemplateDoc,
  type ProjectTemplate,
  parseProjectTemplate,
  projectTemplateBody,
  splitLines,
} from "@/features/templates/model";
import { type TemplateRow, templateName } from "@/features/templates/types";
import { DEFAULT_EVENING, EVENING_LEAD_MIN } from "@/features/today/select";
import { cn } from "@/lib/cn";
import { timeToMinutes } from "@/lib/dates";
import { THEME_LABELS } from "@/lib/theme";
import { FONT_SIZE_LABELS } from "@/lib/ui-prefs";
import { useUi } from "@/lib/ui-store";
import { useSettingsActions, useUserSettings } from "../api";

const ALL_TYPES = "alle";

/**
 * Einstellungen (B11): Darstellung (aus der Seitenleiste hierher, #29), Startbild (E45), Abendzeit, Notiz-Typen
 * (#34), Vorlagen (Rückblick, Projekt, Notiz), öffentliche Freigaben (#94); dazu der Export (B14).
 */
export function SettingsPage({ children }: { children?: React.ReactNode }) {
  return (
    <Page>
      <PageHeader title="Einstellungen" />
      <div className="flex w-full max-w-3xl flex-col gap-10">
        <AppearanceSection />
        <IntroSection />
        <EveningSection />
        <CalendarSourcesSection />
        <NoteTypesSection />
        <TemplatesSection />
        <SharesSection />
        <InstallSection />
        {children}
      </div>
    </Page>
  );
}

function AppearanceSection() {
  const theme = useUi((s) => s.theme);
  const fontSize = useUi((s) => s.fontSize);
  return (
    <FoldSection
      id="darstellung"
      icon={Palette}
      title="Darstellung"
      sub="Dunkel oder Papier (alle Geräte), Schriftgröße (nur dieses Gerät)"
      summary={`${THEME_LABELS[theme]} · Schrift ${FONT_SIZE_LABELS[fontSize]}`}
    >
      <div className="w-full max-w-60">
        <ThemeSwitch />
      </div>
      <FieldHint>Auch über ⌘K: „Theme: Dunkel“ oder „Theme: Papier“.</FieldHint>
      <div className="flex flex-col gap-2">
        <span className="text-ui font-medium">Schriftgröße</span>
        <div className="w-full max-w-sm">
          <FontSizeSwitch />
        </div>
        <p
          data-testid="font-preview"
          className="max-w-prose rounded-card border border-border bg-surface px-3 py-2 text-body"
        >
          So groß erscheint der Text. Die Einstellung gilt nur auf diesem Gerät.
        </p>
      </div>
    </FoldSection>
  );
}

function EveningSection() {
  const settings = useUserSettings();
  const actions = useSettingsActions();
  const id = useId();
  const value = (settings.data?.evening_time ?? DEFAULT_EVENING).slice(0, 5);
  const minutes = timeToMinutes(value) ?? 1200;
  const lead = minutes - EVENING_LEAD_MIN;
  const from = `${String(Math.floor(lead / 60)).padStart(2, "0")}:${String(lead % 60).padStart(2, "0")}`;
  return (
    <FoldSection
      id="abendplanung"
      icon={Moon}
      title="Abendplanung"
      sub="Wann du den Fokus für morgen wählst"
      summary={settings.isPending ? undefined : `Abendzeit ${value}`}
    >
      {settings.isPending ? (
        <Skeleton className="h-9 w-40" />
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={id} className="text-ui font-medium">
            Abendzeit
          </label>
          <div className="w-36">
            <input
              id={id}
              type="time"
              step={900}
              value={value}
              onChange={(event) => {
                const next = event.target.value;
                if (timeToMinutes(next) !== null) actions.update({ evening_time: next });
              }}
              className={cn(controlClasses, "h-11 tabular-nums md:h-9")}
            />
          </div>
          <FieldHint>
            Auf Heute steht die Abendplanung ab {from} oben (eine Stunde vorher). Standard: 20:00.
          </FieldHint>
        </div>
      )}
    </FoldSection>
  );
}

function TemplatesSection() {
  const templates = useTemplates();
  const actions = useTemplateActions();
  const list = templates.data ?? [];
  const recap = list.find((t) => t.kind === "rueckblick");
  const projects = list.filter((t) => t.kind === "projekt");
  const notes = list.filter((t) => t.kind === "notiz");
  const noteTypes = useNoteTypes();
  return (
    <FoldSection
      id="vorlagen"
      icon={LayoutTemplate}
      title="Vorlagen"
      sub="Auf einer leeren Seite einen Klick entfernt; ein neues Protokoll startet gleich damit"
      summary={
        templates.isPending
          ? undefined
          : `${list.length} ${list.length === 1 ? "Vorlage" : "Vorlagen"}`
      }
      bodyClassName="gap-6"
    >
      {templates.isPending ? (
        <Skeleton className="h-40 w-full rounded-card" />
      ) : (
        <>
          <Group
            icon={History}
            title="Rückblick"
            hint="Leitfragen für neue Wochen- und Monatsrückblicke"
          >
            {recap ? (
              <RecapTemplateEditor template={recap} />
            ) : (
              <Button
                onClick={() =>
                  actions.create({
                    kind: "rueckblick",
                    name: "Wochenrückblick",
                    body: { questions: DEFAULT_QUESTIONS },
                  })
                }
              >
                Leitfragen anlegen
              </Button>
            )}
          </Group>
          <Group
            icon={Folder}
            title="Projekt"
            hint="Warum, „Fertig ist es, wenn …“, Meilensteine und Aufgaben für neue Projekte"
          >
            <ul aria-label="Projekt-Vorlagen" className="flex flex-col gap-2">
              {projects.map((t) => (
                <TemplateItem key={t.id} template={t} summary={projectSummary(t)}>
                  <ProjectTemplateEditor template={t} />
                </TemplateItem>
              ))}
            </ul>
            <AddButton
              label="Neue Projekt-Vorlage"
              onClick={() =>
                actions.create({
                  kind: "projekt",
                  name: "Neue Projekt-Vorlage",
                  body: projectTemplateBody({ why: "", outcome: [], milestones: [], tasks: [] }),
                })
              }
            />
          </Group>
          <Group icon={FileText} title="Notiz" hint="Gliederung für neue Notizen, je Typ">
            <ul aria-label="Notiz-Vorlagen" className="flex flex-col gap-2">
              {notes.map((t) => (
                <TemplateItem key={t.id} template={t} summary={noteSummary(t, noteTypes)}>
                  <NoteTemplateEditor template={t} />
                </TemplateItem>
              ))}
            </ul>
            <AddButton
              label="Neue Notiz-Vorlage"
              onClick={() =>
                actions.create({
                  kind: "notiz",
                  name: "Neue Notiz-Vorlage",
                  note_type: null,
                  body: { type: "doc", content: [] },
                })
              }
            />
          </Group>
        </>
      )}
    </FoldSection>
  );
}

function projectSummary(template: TemplateRow) {
  const t = parseProjectTemplate(template.body);
  const parts = [
    t.outcome.length ? `${t.outcome.length} Ergebnis-Punkte` : null,
    t.milestones.length ? `${t.milestones.length} Meilensteine` : null,
    t.tasks.length ? `${t.tasks.length} Aufgaben` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "leer – wird nicht angeboten";
}

function noteSummary(template: TemplateRow, noteTypes: NoteTypes) {
  const lines = docToLines(noteTemplateDoc(template.body)).split("\n").filter(Boolean).length;
  const type = template.note_type ? noteTypes.name(template.note_type) : "alle Typen";
  return `${type} · ${lines === 1 ? "1 Punkt" : `${lines} Punkte`}`;
}

function Group({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof History;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="flex items-center gap-2 text-ui font-medium">
          <Icon size={16} strokeWidth={1.5} aria-hidden className="text-muted" />
          {title}
        </h3>
        <p className="text-meta text-faint">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onClick}>
        <Plus size={16} strokeWidth={1.5} aria-hidden />
        {label}
      </Button>
    </div>
  );
}

/** Eine Vorlage als Zeile mit leichtem Rahmen; „Bearbeiten“ klappt den Editor auf (kein Dialog). */
function TemplateItem({
  template,
  summary,
  children,
}: {
  template: TemplateRow;
  summary: string;
  children: React.ReactNode;
}) {
  const actions = useTemplateActions();
  const [open, setOpen] = useState(false);
  const editorId = useId();
  const name = templateName(template);
  return (
    <li className="rounded-card border border-border">
      <div className="flex min-h-12 items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={editorId}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left md:min-h-9"
        >
          <ChevronDown
            size={16}
            strokeWidth={1.5}
            aria-hidden
            className={cn("shrink-0 text-faint transition-transform", !open && "-rotate-90")}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui font-medium">{name}</span>
            <span className="truncate text-meta text-faint">{summary}</span>
          </span>
          <span className="sr-only">{open ? "zuklappen" : "bearbeiten"}</span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Vorlage „${name}“ in den Papierkorb`}
          onClick={() => actions.trash(template.id)}
        >
          <Trash2 size={16} strokeWidth={1.5} aria-hidden />
        </Button>
      </div>
      <div id={editorId} hidden={!open} className="border-t border-border p-3 md:p-4">
        {open ? children : null}
      </div>
    </li>
  );
}

function NameField({ template }: { template: TemplateRow }) {
  const actions = useTemplateActions();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ui-sm font-medium text-muted">
        Name
      </label>
      <BufferedInput
        id={id}
        value={template.name}
        maxLength={120}
        onValueChange={(name) => {
          if (name.trim()) actions.update(template.id, { name });
        }}
        className={cn(controlClasses, "h-11 md:h-9")}
      />
    </div>
  );
}

/** Mehrzeiliges Feld mit Eingabe-Puffer (eine Zeile je Punkt). */
function LinesField({
  label,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (text: string) => void;
  rows?: number;
}) {
  const id = useId();
  const field = useBufferedText(value, onChange);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ui-sm font-medium text-muted">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={field.value}
        onChange={field.onChange}
        onFocus={field.onFocus}
        onBlur={field.onBlur}
        className={cn(controlClasses, "field-sizing-content min-h-20 resize-none py-2")}
      />
      {hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

function ProjectTemplateEditor({ template }: { template: TemplateRow }) {
  const actions = useTemplateActions();
  const t = parseProjectTemplate(template.body);
  const save = (patch: Partial<ProjectTemplate>) =>
    actions.update(template.id, {
      body: projectTemplateBody({ ...parseProjectTemplate(template.body), ...patch }),
    });
  return (
    <div className="flex flex-col gap-4">
      <NameField template={template} />
      <LinesField label="Warum" value={t.why} rows={2} onChange={(why) => save({ why })} />
      <LinesField
        label="Fertig ist es, wenn …"
        hint="Eine Zeile je Punkt."
        value={t.outcome.join("\n")}
        onChange={(text) => save({ outcome: splitLines(text) })}
      />
      <LinesField
        label="Meilensteine"
        hint="Eine Zeile je Meilenstein, in Reihenfolge."
        value={t.milestones.join("\n")}
        onChange={(text) => save({ milestones: splitLines(text) })}
      />
      <LinesField
        label="Aufgaben"
        hint="Eine Zeile je Aufgabe; sie landen im Projekt."
        value={t.tasks.join("\n")}
        onChange={(text) => save({ tasks: splitLines(text) })}
      />
    </div>
  );
}

function NoteTemplateEditor({ template }: { template: TemplateRow }) {
  const actions = useTemplateActions();
  const noteTypes = useNoteTypes();
  const typeId = useId();
  return (
    <div className="flex flex-col gap-4">
      <NameField template={template} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={typeId} className="text-ui-sm font-medium text-muted">
          Für Notizen vom Typ
        </label>
        <div className="w-full max-w-56">
          <Select
            id={typeId}
            value={template.note_type ?? ALL_TYPES}
            onValueChange={(value) =>
              actions.update(template.id, {
                note_type: value === ALL_TYPES ? null : value,
              })
            }
            options={[
              { value: ALL_TYPES, label: "Alle Typen" },
              ...noteTypes.types.map((type) => ({ value: type.key, label: type.name })),
            ]}
          />
        </div>
        <FieldHint>
          Mit Typ greift die Vorlage automatisch, sobald eine leere Notiz ihn bekommt.
        </FieldHint>
      </div>
      <LinesField
        label="Gliederung"
        hint="Eine Zeile je Punkt, zwei Leerzeichen am Anfang = Unterpunkt."
        rows={6}
        value={docToLines(noteTemplateDoc(template.body))}
        onChange={(text) =>
          actions.update(template.id, { body: linesToDoc(text) as Record<string, unknown> })
        }
      />
    </div>
  );
}

/** Leitfragen: Text, Art (feste Fragen behalten ihre Art), Reihenfolge, entfernen, hinzufügen. */
function RecapTemplateEditor({ template }: { template: TemplateRow }) {
  const actions = useTemplateActions();
  const questions = parseQuestions(template.body, { keepEmpty: true });
  const save = (next: RecapQuestion[]) =>
    actions.update(template.id, { body: { ...template.body, questions: next } });
  const move = (index: number, by: -1 | 1) => {
    const next = [...questions];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + by, 0, item);
    save(next);
  };
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border p-3 md:p-4">
      <ol aria-label="Leitfragen" className="flex flex-col gap-2">
        {questions.map((question, index) => {
          const fixed = FIXED_KEYS[question.key];
          return (
            <li
              key={question.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]"
            >
              <BufferedInput
                value={question.label}
                aria-label={`Leitfrage ${index + 1}`}
                placeholder="Frage"
                onValueChange={(label) =>
                  save(questions.map((q) => (q.key === question.key ? { ...q, label } : q)))
                }
                className={cn(controlClasses, "h-11 md:h-9")}
              />
              <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
                <Select
                  aria-label={`Art von Leitfrage ${index + 1}`}
                  value={question.type}
                  disabled={Boolean(fixed)}
                  onValueChange={(type) =>
                    save(
                      questions.map((q) =>
                        q.key === question.key
                          ? {
                              key: q.key,
                              label: q.label,
                              ...(q.section ? { section: q.section } : {}),
                              type: type as RecapQuestion["type"],
                              ...(type === "list" ? { count: 3 } : {}),
                            }
                          : q,
                      ),
                    )
                  }
                  options={QUESTION_TYPES.map((type) => ({
                    value: type,
                    label: QUESTION_TYPE_LABELS[type],
                  }))}
                />
              </div>
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Leitfrage ${index + 1} nach oben`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} strokeWidth={1.5} aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Leitfrage ${index + 1} nach unten`}
                  disabled={index === questions.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} strokeWidth={1.5} aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Leitfrage ${index + 1} entfernen`}
                  onClick={() => save(questions.filter((q) => q.key !== question.key))}
                >
                  <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => save([...questions, { key: newQuestionKey(), label: "", type: "text" }])}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          Frage hinzufügen
        </Button>
        <Button variant="ghost" size="sm" onClick={() => save(DEFAULT_QUESTIONS)}>
          <RotateCcw size={16} strokeWidth={1.5} aria-hidden />
          Standard wiederherstellen
        </Button>
      </div>
      <FieldHint>
        Gilt für neue Rückblicke; bestehende behalten ihre Fragen. Im Monatsrückblick gilt der Fokus
        dem nächsten Monat. Stimmung, Energie, Sport, Beziehungen, Lernen und Fokus sind über die
        Wochen und Monate vergleichbar und behalten ihre Art. Gespräch, Hypothese, Gegenhypothese,
        Klartext und Bezug zur Vorwoche stehen im Rückblick unter der Überschrift „Gespräch“, wenn
        sie in der Liste hintereinander stehen.
      </FieldHint>
    </div>
  );
}
