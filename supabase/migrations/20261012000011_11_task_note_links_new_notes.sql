-- =====================================================================
-- 11 Verweise aus Aufgaben auch auf Notizen, die erst danach gespeichert werden
--   „((Neue Notiz“ in der Aufgaben-Notiz legt die Notiz an und setzt den Link. Die
--   Speicher-Warteschlange schreibt im selben Paket Aufgaben vor Notizen (notes.task_id zeigt
--   auf tasks) – der Trigger aus Migration 10 findet die Notiz dann noch nicht. Deshalb übernimmt
--   eine neu angelegte Notiz die Verweise aller Aufgaben, die schon auf sie zeigen.
-- =====================================================================

create or replace function public.notes_link_waiting_tasks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.task_note_links (user_id, task_id, target_note_id)
  select t.user_id, t.id, new.id
    from public.tasks t
   where t.user_id = new.user_id
     and t.deleted_at is null
     and t.body is not null
     -- billige Vorauswahl, danach die genaue Prüfung auf einen noteLink-Knoten
     and t.body::text like '%' || new.id::text || '%'
     and jsonb_path_exists(
           t.body,
           '$.** ? (@.type == "noteLink" && @.attrs.noteId == $id)',
           jsonb_build_object('id', new.id::text)
         )
  on conflict (task_id, target_note_id) do nothing;
  return null;
end;
$$;
revoke execute on function public.notes_link_waiting_tasks() from public, anon;

create trigger notes_link_waiting_tasks after insert on public.notes
  for each row execute function public.notes_link_waiting_tasks();
