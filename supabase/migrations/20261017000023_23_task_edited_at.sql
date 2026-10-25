-- =====================================================================
-- 23 „Zuletzt bearbeitet“ auch mit Aufgaben (Rückmeldung #38, Nachtlauf K): „aber nur, wenn was
--   geändert worden ist“ – zählt bei Titel, Notiz und Checkliste (tasks.body), nicht bei
--   Abhaken, Datum, Status oder neu Anlegen. Die Datenbank führt den Zeitpunkt selbst (auch für
--   Änderungen der KI); von außen gesetzte Werte überschreibt der Trigger.
-- =====================================================================

alter table public.tasks add column edited_at timestamptz;

create or replace function public.set_task_edited_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- neu angelegt zählt nicht als bearbeitet
    new.edited_at := null;
  elsif new.title is distinct from old.title or new.body is distinct from old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_task_edited_at() from public, anon;

create trigger tasks_edited_at before insert or update on public.tasks
  for each row execute function public.set_task_edited_at();
