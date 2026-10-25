-- =====================================================================
-- 10 Verweise aus der Notiz einer Aufgabe auf Notizen (Rückverweise)
--   Rückmeldung 12.10.2026: In der Aufgaben-Notiz verlinkt „((“ Notizen. Die verlinkte Notiz soll
--   die Aufgabe unter „Verlinkt von“ zeigen – wie Verweise aus anderen Notizen (Tabelle links).
-- =====================================================================

-- ---------------------------------------------------------------------
-- task_note_links: abgeleitet aus noteLink-Knoten in tasks.body (nur per Trigger gepflegt)
-- ---------------------------------------------------------------------
create table public.task_note_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  target_note_id uuid not null references public.notes (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint task_note_links_unique unique (task_id, target_note_id)
);

alter table public.task_note_links enable row level security;
create policy task_note_links_select on public.task_note_links for select to authenticated
  using ((select auth.uid()) = user_id);
create policy task_note_links_insert on public.task_note_links for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy task_note_links_update on public.task_note_links for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy task_note_links_delete on public.task_note_links for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.task_note_links from anon;
-- Schreibrechte braucht der Trigger (security invoker); die App schreibt die Tabelle nie direkt.
grant select, insert, update, delete on table public.task_note_links to authenticated;

create trigger task_note_links_updated_at before update on public.task_note_links
  for each row execute function public.set_updated_at();
create index task_note_links_user_idx on public.task_note_links (user_id) where deleted_at is null;
create index task_note_links_target_idx on public.task_note_links (target_note_id);
create index task_note_links_task_idx on public.task_note_links (task_id);

-- ---------------------------------------------------------------------
-- Trigger: Verweise aus dem Aufgabeninhalt neu aufbauen (Umbenennen bricht nichts: per ID).
-- Aufgabe im Papierkorb → keine Verweise; zurückgeholt → wieder da.
-- ---------------------------------------------------------------------
create or replace function public.tasks_sync_note_links()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.body is distinct from old.body
     or new.deleted_at is distinct from old.deleted_at then

    delete from public.task_note_links l where l.task_id = new.id;

    if new.deleted_at is null and new.body is not null then
      insert into public.task_note_links (user_id, task_id, target_note_id)
      select new.user_id, new.id, n.id
        from (
          select distinct (v #>> '{}') as raw
            from jsonb_path_query(new.body, 'lax $.** ? (@.type == "noteLink").attrs.noteId') as v
        ) ids
        join public.notes n
          on n.id = case
                      when ids.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then ids.raw::uuid
                    end
       where n.user_id = new.user_id
      on conflict (task_id, target_note_id) do nothing;
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.tasks_sync_note_links() from public, anon;

create trigger tasks_note_links after insert or update on public.tasks
  for each row execute function public.tasks_sync_note_links();

-- ---------------------------------------------------------------------
-- Bestehende Aufgaben einmalig übernehmen
-- ---------------------------------------------------------------------
insert into public.task_note_links (user_id, task_id, target_note_id)
select t.user_id, t.id, n.id
  from public.tasks t
  cross join lateral (
    select distinct (v #>> '{}') as raw
      from jsonb_path_query(t.body, 'lax $.** ? (@.type == "noteLink").attrs.noteId') as v
  ) ids
  join public.notes n
    on n.id = case
                when ids.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then ids.raw::uuid
              end
   and n.user_id = t.user_id
 where t.deleted_at is null
   and t.body is not null
on conflict (task_id, target_note_id) do nothing;
