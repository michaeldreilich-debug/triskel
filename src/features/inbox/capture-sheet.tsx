"use client";

import { FileText, Inbox } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { controlClasses } from "@/components/ui/input";
import { AreaDot } from "@/components/ui/pill";
import { SearchPicker } from "@/components/ui/search-picker";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { projectTitle } from "@/features/projects/types";
import { cn } from "@/lib/cn";
import { addDays, berlinDate, formatDayShort, type IsoDate } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";
import { useCapture } from "./capture";
import {
  type CaptureDraft,
  captureDraftStorage,
  isEmptyCaptureDraft,
  readCaptureDraft,
  writeCaptureDraft,
} from "./capture-draft";
import { parseDateWord } from "./date-word";
import { resolveProjectToken } from "./parse";

const NO_PROJECT = "__kein__";

const chipClasses = (active: boolean) =>
  cn(
    "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-ui-sm transition-colors",
    active
      ? "border-fg bg-accent font-medium text-accent-fg"
      : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-fg",
  );

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 px-1 text-meta uppercase tracking-widest text-faint">
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

/** „Sa 24.10.“ */
const dueLabel = (date: IsoDate) => formatDayShort(date).replace(",", "");

/**
 * Sheet „Festhalten“ (E44 H3): das ＋ in der Handy-Leiste. Art (Aufgabe/Notiz), Text, Wann,
 * Bereich und Projekt – angelegt wird über `useCapture` (dieselben Aktionen wie die
 * Schnellerfassung). Kürzel im Text gehen vor; ein Datumswort setzt „Wann“, der Titel bleibt.
 */
export function CaptureSheet() {
  const open = useUi((s) => s.captureOpen);
  const setOpen = useUi((s) => s.setCaptureOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  // Entwurf (Regel „Nie Daten verlieren“): Schließt das Sheet ohne „Anlegen“ – Tipp daneben,
  // Escape –, steht der Text beim nächsten Öffnen wieder da; „Abbrechen“ verwirft ihn bewusst.
  // Der ganze Entwurf liegt zusätzlich in sessionStorage (U-6: iOS räumt die App im Hintergrund ab).
  const draft = useRef("");
  // Ab 768 px gibt es Overlay und Inhalt nicht (md:hidden), der Dialog bliebe aber modal und die
  // Seite tot (U-1: iPhone quer, Fenster breiter) – dann schließen, der Entwurf bleibt gespeichert
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const query = window.matchMedia("(min-width: 768px)");
    const check = () => {
      if (query.matches) setOpen(false);
    };
    check();
    query.addEventListener("change", check);
    return () => query.removeEventListener("change", check);
  }, [open, setOpen]);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out md:hidden" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col overflow-y-auto rounded-t-sheet border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] text-fg shadow-float outline-none data-[state=open]:animate-sheet-bottom-in data-[state=closed]:animate-sheet-bottom-out md:hidden"
        >
          <Dialog.Description className="sr-only">Aufgabe oder Notiz festhalten</Dialog.Description>
          <CaptureForm inputRef={inputRef} draft={draft} onDone={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CaptureForm({
  inputRef,
  draft,
  onDone,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  draft: React.RefObject<string>;
  onDone: () => void;
}) {
  const textId = useId();
  const capture = useCapture();
  const activeArea = useUi((s) => s.area);
  const today = useMemo(() => berlinDate(), []);
  const tomorrow = addDays(today, 1);

  // gespeicherter Entwurf (U-6) geht vor dem Text im Speicher dieser Sitzung
  const [stored] = useState(() => readCaptureDraft(captureDraftStorage()));
  const [text, setTextState] = useState(stored?.text ?? draft.current);
  const setText = (value: string) => {
    draft.current = value;
    setTextState(value);
  };
  // Das Sheet bleibt beim Zugleiten (150 ms) bedienbar: ein zweiter Tipp oder Enter legte sonst
  // denselben Eintrag noch einmal an
  const submitted = useRef(false);
  const [art, setArt] = useState<"task" | "note">(stored?.art ?? "task");
  const [areaChoice, setAreaChoice] = useState<string | null>(
    stored ? stored.areaChoice : activeArea,
  );
  const [projectChoice, setProjectChoice] = useState<string | null>(stored?.projectChoice ?? null);
  // undefined = Wann nicht selbst gewählt (dann gilt ein erkanntes Datumswort)
  const [manualDue, setManualDue] = useState<IsoDate | null | undefined>(stored?.manualDue);
  // jede Änderung in den Entwurf (U-6); leer → Eintrag weg
  useEffect(() => {
    const current: CaptureDraft = { text, art, areaChoice, projectChoice, manualDue };
    writeCaptureDraft(
      captureDraftStorage(),
      isEmptyCaptureDraft(current, activeArea) ? null : current,
    );
  }, [text, art, areaChoice, projectChoice, manualDue, activeArea]);

  const result = capture.parseWith(text, {
    kind: art,
    areaId: areaChoice,
    projectId: projectChoice,
  });
  const isNote = result.kind === "note";
  const detected = isNote ? null : parseDateWord(text, today);
  const due = manualDue !== undefined ? manualDue : (detected?.date ?? null);
  const showDetected = detected && manualDue === undefined;
  const hasText = text.trim().length > 0;
  const canSubmit = hasText && capture.ready && Boolean(result.title);
  const inbox = !result.areaId && !result.projectId;
  const selectedProject = capture.projects.find((p) => p.id === result.projectId);
  const area = capture.areas.find((a) => a.id === result.areaId);
  const customDate = due && due !== today && due !== tomorrow ? due : null;

  const submit = () => {
    if (!canSubmit || submitted.current) return;
    const created = capture.submit(text, {
      kind: art,
      areaId: areaChoice,
      projectId: projectChoice,
      dueDate: isNote ? null : due,
    });
    if (!created) return;
    submitted.current = true;
    draft.current = "";
    writeCaptureDraft(captureDraftStorage(), null);
    onDone();
  };

  /** Projekt aus der Auswahl; passt es zu einem mehrdeutigen @-Kürzel, wird dieses aufgelöst. */
  const chooseProject = (id: string) => {
    const project = capture.projects.find((p) => p.id === id);
    const token = result.ambiguous?.token;
    if (project && token && result.ambiguous?.candidates.some((c) => c.id === id)) {
      const resolved = resolveProjectToken(text, token, projectTitle(project));
      if (resolved !== text) {
        setText(resolved);
        setProjectChoice(null);
        return;
      }
    }
    setProjectChoice(id === NO_PROJECT ? null : id);
  };

  const openProjects = capture.projects.filter(
    (p) => p.status !== "abgeschlossen" && p.status !== "archiv",
  );

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 pt-2">
        <Dialog.Close asChild>
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => {
              draft.current = "";
              writeCaptureDraft(captureDraftStorage(), null);
            }}
          >
            Abbrechen
          </Button>
        </Dialog.Close>
        <Dialog.Title className="heading text-heading">Festhalten</Dialog.Title>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!canSubmit}
          className="justify-self-end"
        >
          Anlegen
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <Group label="Art">
          <SegmentedControl
            aria-label="Art"
            value={result.kind}
            onValueChange={setArt}
            options={[
              { value: "task", label: "Aufgabe" },
              { value: "note", label: "Notiz" },
            ]}
          />
        </Group>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={textId} className="sr-only">
            Was willst du festhalten?
          </label>
          <input
            ref={inputRef}
            id={textId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Was willst du festhalten?"
            autoComplete="off"
            enterKeyHint="done"
            className={cn(controlClasses, "h-11 text-body-lg")}
          />
          <div
            aria-live="polite"
            className="flex min-h-5 flex-col gap-0.5 px-1 text-meta text-faint"
          >
            {hasText ? (
              <>
                {result.ambiguous && !result.projectId ? (
                  <span className="text-warning">
                    @{result.ambiguous.token} passt zu {result.ambiguous.candidates.length}{" "}
                    Projekten – bitte unten wählen
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5" data-testid="festhalten-ziel">
                    {isNote ? (
                      <FileText size={12} strokeWidth={1.5} aria-hidden />
                    ) : inbox ? (
                      <Inbox size={12} strokeWidth={1.5} aria-hidden />
                    ) : (
                      <AreaDot color={area?.color ?? "blue"} />
                    )}
                    → {capture.describe(result)}
                    {result.unknownProject ? (
                      <span className="text-warning">
                        {" "}
                        · kein Projekt „{result.unknownProject}“
                      </span>
                    ) : null}
                  </span>
                )}
                {showDetected ? (
                  <span data-testid="festhalten-datum">
                    „{detected.word}“ erkannt – fällig {dueLabel(detected.date)}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {isNote ? null : (
          <Group label="Wann">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={due === null}
                onClick={() => setManualDue(null)}
                className={chipClasses(due === null)}
              >
                Ohne Datum
              </button>
              <button
                type="button"
                aria-pressed={due === today}
                onClick={() => setManualDue(today)}
                className={chipClasses(due === today)}
              >
                Heute
              </button>
              <button
                type="button"
                aria-pressed={due === tomorrow}
                onClick={() => setManualDue(tomorrow)}
                className={chipClasses(due === tomorrow)}
              >
                Morgen
              </button>
              <div className={cn("rounded-control", customDate && "ring-1 ring-fg")}>
                <DatePicker
                  aria-label="Datum wählen"
                  value={customDate}
                  onChange={(value) => setManualDue(value)}
                  display={
                    <span className="text-ui-sm tabular-nums">
                      {customDate ? dueLabel(customDate) : "Datum …"}
                    </span>
                  }
                />
              </div>
            </div>
          </Group>
        )}

        <Group label="Bereich">
          <div className="flex flex-wrap gap-2">
            {capture.areas.map((a) => {
              const active = result.areaId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setAreaChoice(active ? null : a.id);
                    // ein gewähltes Projekt eines anderen Bereichs passt nicht mehr
                    if (selectedProject && selectedProject.area_id !== a.id) setProjectChoice(null);
                  }}
                  className={cn(chipClasses(active), "min-w-0")}
                >
                  <AreaDot color={a.color} />
                  <span className="truncate">{a.name}</span>
                </button>
              );
            })}
          </div>
        </Group>

        <Group label="Projekt">
          <SearchPicker
            variant="quiet"
            aria-label="Projekt"
            searchLabel="Projekt suchen"
            muted={!selectedProject}
            label={
              selectedProject
                ? projectTitle(selectedProject)
                : inbox && !isNote
                  ? "keins – landet in der Inbox"
                  : "keins"
            }
            fixed={[{ id: NO_PROJECT, label: "Kein Projekt" }]}
            items={openProjects.map((p) => ({
              id: p.id,
              label: projectTitle(p),
              meta: capture.areas.find((a) => a.id === p.area_id)?.name,
            }))}
            selectedIds={selectedProject ? [selectedProject.id] : [NO_PROJECT]}
            onSelect={chooseProject}
            className="w-full border border-border"
          />
        </Group>
      </div>
    </form>
  );
}
