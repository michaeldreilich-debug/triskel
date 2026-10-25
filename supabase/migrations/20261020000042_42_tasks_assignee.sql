-- =====================================================================
-- 42 „Zuständig: Ich / KI“ an der Aufgabe (Rückmeldung #77, Lauf P): „Angelegt von“ (Migration 40)
--   trennt nicht, *für wen* eine Aufgabe ist – die KI legt auch Aufgaben für den Nutzer an („PR
--   ausprobieren“, „Plan prüfen und freigeben“). Aufgaben für die KI (eigene Arbeitsschritte, z. B.
--   beim App-Bau) sollen überall verschwinden und nur dezent im Projekt stehen; Aufgaben des Nutzers
--   bleiben sichtbar, egal wer sie angelegt hat.
--
--   * tasks.assignee: 'user' (Standard, der Nutzer) oder 'ai'. Anders als created_by setzen App und
--     KI den Wert selbst (Eigenschaft im Aufgaben-Panel, Werkzeug-Parameter „zustaendig“) und
--     dürfen ihn ändern.
--   * Folgeaufgaben wiederkehrender Aufgaben (complete_task) erben den Wert der Vorlage – per
--     Trigger, damit complete_task unverändert bleibt.
--   * Bestand bleibt 'user'; einsortiert wird nach dem Live-Gang auf Bestätigung des Nutzers.
--   RLS und Grants unverändert (bestehende Tabelle). Additiv: eine Spalte, eine Funktion, ein
--   Trigger; keine Daten geändert.
-- =====================================================================

alter table public.tasks
  add column assignee text not null default 'user'
    check (assignee in ('user', 'ai'));

create function public.tasks_inherit_assignee()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.assignee := coalesce(
    (select s.assignee from public.tasks s where s.id = new.recurrence_source_id),
    new.assignee
  );
  return new;
end;
$$;
revoke execute on function public.tasks_inherit_assignee() from public, anon;

create trigger tasks_assignee_inherit
  before insert on public.tasks
  for each row
  when (new.recurrence_source_id is not null)
  execute function public.tasks_inherit_assignee();

