-- =====================================================================
-- 35 Meilenstein folgt seinen Aufgaben (Rückmeldung #60, 18.10.2026): Sind alle Aufgaben eines
--   Meilensteins erledigt, gilt er als erreicht – auch wenn die KI die Aufgaben abhakt. Die Regel
--   steht hier im Trigger, damit App, KI und jede künftige Schnittstelle dieselbe nutzen.
--   Ereignisgesteuert (so bleibt Abhaken von Hand möglich):
--   * Eine offene Aufgabe kommt in den Meilenstein (neu angelegt, wieder geöffnet, aus dem
--     Papierkorb geholt, hineinverschoben) → der Meilenstein ist wieder offen.
--   * Die letzte offene Aufgabe verlässt den Zustand „offen“ (erledigt, in den Papierkorb,
--     hinausverschoben) und es bleibt mindestens eine Aufgabe → erreicht (jetzt).
--   * Ohne Aufgaben bleibt der Meilenstein von Hand; „in Arbeit“ und „wartet“ zählen als offen.
--   Wiederkehrende Aufgaben: complete_task legt die Folgeinstanz im selben Meilenstein an – der
--   Meilenstein bleibt damit offen.
--   Einmalig nachgezogen (Rückmeldung 18.10.): Meilensteine mit Aufgaben, die alle erledigt sind,
--   gelten als erreicht zum Zeitpunkt der letzten Erledigung. Von Hand abgehakte Meilensteine
--   mit offenen Aufgaben bleiben, wie sie sind.
--   Additiv: eine Funktion, ein Trigger, Daten nur durch das Nachziehen geändert.
-- =====================================================================

create or replace function public.milestones_follow_tasks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_was_open boolean := tg_op = 'UPDATE'
    and old.milestone_id is not null
    and old.deleted_at is null
    and old.status <> 'erledigt';
  v_is_open boolean := new.milestone_id is not null
    and new.deleted_at is null
    and new.status <> 'erledigt';
begin
  -- offene Aufgabe kommt dazu → Meilenstein wieder offen
  if v_is_open and not (v_was_open and old.milestone_id = new.milestone_id) then
    update public.milestones
       set done_at = null
     where id = new.milestone_id and done_at is not null and deleted_at is null;
  end if;

  -- offene Aufgabe geht → war es die letzte (und bleibt eine), ist der Meilenstein erreicht
  if v_was_open and not (v_is_open and old.milestone_id = new.milestone_id) then
    update public.milestones m
       set done_at = now()
     where m.id = old.milestone_id
       and m.done_at is null
       and m.deleted_at is null
       and exists (
         select 1 from public.tasks t
          where t.milestone_id = m.id and t.deleted_at is null
       )
       and not exists (
         select 1 from public.tasks t
          where t.milestone_id = m.id and t.deleted_at is null and t.status <> 'erledigt'
       );
  end if;

  return null;
end;
$$;
revoke execute on function public.milestones_follow_tasks() from public, anon;

-- AFTER: sieht die Werte nach den BEFORE-Triggern; WHEN statt Spaltenliste, weil auch ein
-- BEFORE-Trigger einen dieser Werte ändern könnte
create trigger tasks_milestone_follow_insert
  after insert on public.tasks
  for each row
  when (new.milestone_id is not null)
  execute function public.milestones_follow_tasks();

create trigger tasks_milestone_follow_update
  after update on public.tasks
  for each row
  when (
    old.status is distinct from new.status
    or old.milestone_id is distinct from new.milestone_id
    or old.deleted_at is distinct from new.deleted_at
  )
  execute function public.milestones_follow_tasks();

-- Nachziehen (einmalig): alle Aufgaben erledigt, Meilenstein noch offen → erreicht
update public.milestones m
   set done_at = done.last_completed
  from (
    select t.milestone_id, max(coalesce(t.completed_at, t.updated_at)) as last_completed
      from public.tasks t
     where t.milestone_id is not null and t.deleted_at is null
     group by t.milestone_id
    having bool_and(t.status = 'erledigt')
  ) done
 where m.id = done.milestone_id
   and m.done_at is null
   and m.deleted_at is null;
