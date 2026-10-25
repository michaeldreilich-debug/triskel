-- =====================================================================
-- 40 „Angelegt von“ an der Aufgabe (Rückmeldungen #62 und #69, E36/E37): Legt die KI dutzende
--   Aufgaben an, will der Nutzer sie in Einplanen, in der Aufgaben-Datenbank und in den Ansichten
--   ein- und ausblenden können. Bisher steht das nur im KI-Protokoll (ai_activity) – zu langsam
--   und zu fragil für einen Filter (Einträge lassen sich zurückholen oder aufräumen).
--
--   * tasks.created_by: 'user' (Standard) oder 'ai'.
--   * Gesetzt vom Trigger, nicht von jedem Werkzeug: Kommt die Anfrage von einem freigegebenen
--     KI-Zugang (ai_client_allowed(), Migration 21), wird beim Anlegen 'ai' eingetragen – für
--     create_task, capture, create_project, Checkbox-Aufgaben aus Notizen und jedes künftige
--     Werkzeug. Jede andere Anfrage mit Anmeldung (die App) bekommt 'user', egal was sie
--     mitschickt; das Feld lässt sich so nicht fälschen. Direkte Datenbankverbindungen ohne
--     Anmeldung (Wiederherstellung, Wartung) behalten den Wert unverändert.
--   * Nach dem Anlegen ändert sich der Wert nie mehr (Update-Teil des Triggers).
--   * Folgeaufgaben wiederkehrender Aufgaben (complete_task) erben den Wert der Vorlage – hakt
--     die KI eine Aufgabe vom Nutzer ab, wird die nächste nicht zu „von KI“.
--   Bestand wird einmalig aus ai_activity nachgetragen (siehe „Nachtrag“).
--   RLS und Grants unverändert (bestehende Tabelle). Additiv: eine Spalte, eine Funktion, ein
--   Trigger, Daten nur durch den Nachtrag geändert.
-- =====================================================================

alter table public.tasks
  add column created_by text not null default 'user'
    check (created_by in ('user', 'ai'));

-- Nachtrag: Bestand aus dem KI-Protokoll. Erkennbar sind
--   1. Aufgaben aus create_task und capture (entity 'aufgabe', Verweis auf die Aufgabe),
--   2. Checkbox-Aufgaben, die update_note beim Anhängen/Ersetzen angelegt hat (undo.tasks_added),
--   3. Aufgaben von create_project (alle Aufgaben des Projekts, die kurz vor dem Protokoll-
--      eintrag entstanden sind) und
--   4. Checkbox-Aufgaben von create_note (Protokolltext nennt „N Aufgaben“; Aufgaben im selben
--      Bereich und Projekt der Notiz, die in der Minute davor entstanden sind).
-- 3 und 4 sind Näherungen über den Zeitstempel – die KI legt Aufgaben unmittelbar vor dem
-- Protokolleintrag an. Das Protokoll selbst bleibt unverändert.
-- Der Nachtrag ist keine Bearbeitung (Prüfung O8): updated_at der Aufgaben und
-- last_activity_at ihrer Projekte bleiben stehen (sonst wären alle Projekte mit KI-Aufgaben
-- „heute aktiv“ und nicht mehr „14 Tage still“) – die beiden Trigger ruhen nur für dieses Update.
alter table public.tasks disable trigger tasks_updated_at;
alter table public.tasks disable trigger tasks_project_activity;

update public.tasks t
   set created_by = 'ai'
 where t.created_by <> 'ai'
   and (
     exists (
       select 1 from public.ai_activity a
        where a.user_id = t.user_id
          and a.entity = 'aufgabe'
          and a.tool in ('create_task', 'capture')
          and a.entity_id = t.id
     )
     or exists (
       select 1 from public.ai_activity a
        where a.user_id = t.user_id
          and a.tool = 'update_note'
          and jsonb_typeof(a.undo -> 'tasks_added') = 'array'
          and a.undo -> 'tasks_added' @> to_jsonb(t.id::text)
     )
     or exists (
       select 1 from public.ai_activity a
        where a.user_id = t.user_id
          and a.tool = 'create_project'
          and a.entity_id = t.project_id
          and t.created_at between a.created_at - interval '2 minutes' and a.created_at + interval '10 seconds'
     )
     or exists (
       select 1 from public.ai_activity a
         join public.notes n on n.id = a.entity_id and n.user_id = a.user_id
        where a.user_id = t.user_id
          and a.tool = 'create_note'
          and a.summary ~ ', [0-9]+ Aufgaben\)'
          and t.area_id is not distinct from n.area_id
          and t.project_id is not distinct from n.project_id
          and t.created_at between a.created_at - interval '1 minute' and a.created_at + interval '10 seconds'
     )
   );

alter table public.tasks enable trigger tasks_updated_at;
alter table public.tasks enable trigger tasks_project_activity;

create function public.tasks_set_created_by()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- einmal gesetzt, nie mehr geändert
    new.created_by := old.created_by;
  elsif new.recurrence_source_id is not null then
    -- Folgeaufgabe: erbt von der Vorlage
    new.created_by := coalesce(
      (select s.created_by from public.tasks s where s.id = new.recurrence_source_id),
      'user'
    );
  elsif auth.uid() is not null then
    -- Anfrage mit Anmeldung: KI-Zugang → 'ai', alles andere (die App) → 'user'
    new.created_by := case when (select public.ai_client_allowed()) then 'ai' else 'user' end;
  end if;
  return new;
end;
$$;
revoke execute on function public.tasks_set_created_by() from public, anon;

create trigger tasks_created_by_insert
  before insert on public.tasks
  for each row execute function public.tasks_set_created_by();

create trigger tasks_created_by_update
  before update on public.tasks
  for each row
  when (old.created_by is distinct from new.created_by)
  execute function public.tasks_set_created_by();
