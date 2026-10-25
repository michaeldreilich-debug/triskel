-- =====================================================================
-- 05 Notizen, Outliner-Blöcke und Verweise ([[Links]] + Rückverweise)
-- =====================================================================

-- ---------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  area_id uuid not null references public.areas (id) on delete restrict,
  topic_id uuid references public.topics (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  type text not null default 'wissen'
    check (type in ('wissen', 'protokoll', 'idee', 'anleitung', 'journal', 'rueckblick')),
  title text not null default '' check (char_length(title) <= 500),
  tags text[] not null default '{}',
  -- „Geprüft am“
  reviewed_at date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.notes enable row level security;
create policy notes_select on public.notes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy notes_insert on public.notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy notes_update on public.notes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notes_delete on public.notes for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.notes from anon;
grant select, insert, update, delete on table public.notes to authenticated;

create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_updated_at();
create index notes_user_idx on public.notes (user_id) where deleted_at is null;
create index notes_area_idx on public.notes (area_id);
create index notes_topic_idx on public.notes (topic_id);
create index notes_project_idx on public.notes (project_id);
create index notes_task_idx on public.notes (task_id);
create index notes_tags_idx on public.notes using gin (tags);

-- ---------------------------------------------------------------------
-- note_blocks: Outliner-Baum, eine Zeile je Block (id kommt aus dem Editor)
-- ---------------------------------------------------------------------
create table public.note_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  parent_id uuid references public.note_blocks (id) on delete cascade,
  -- Absatz des Blocks als TipTap-JSON ({type: "paragraph", content: [...]})
  content jsonb not null default '{"type": "paragraph"}'::jsonb
    check (jsonb_typeof(content) = 'object'),
  content_text text not null default '',
  sort text collate "C" not null,
  collapsed boolean not null default false,
  -- „Offener Punkt → Aufgabe“
  task_id uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint note_blocks_not_own_parent check (parent_id is null or parent_id <> id)
);

alter table public.note_blocks enable row level security;
create policy note_blocks_select on public.note_blocks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy note_blocks_insert on public.note_blocks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy note_blocks_update on public.note_blocks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy note_blocks_delete on public.note_blocks for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.note_blocks from anon;
grant select, insert, update, delete on table public.note_blocks to authenticated;

create trigger note_blocks_updated_at before update on public.note_blocks
  for each row execute function public.set_updated_at();
create index note_blocks_user_idx on public.note_blocks (user_id) where deleted_at is null;
create index note_blocks_tree_idx on public.note_blocks (note_id, parent_id, sort)
  where deleted_at is null;
create index note_blocks_parent_idx on public.note_blocks (parent_id);
create index note_blocks_task_idx on public.note_blocks (task_id);

-- ---------------------------------------------------------------------
-- links: abgeleitet aus noteLink-Knoten der Blöcke (nur per Trigger gepflegt)
-- ---------------------------------------------------------------------
create table public.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_note_id uuid not null references public.notes (id) on delete cascade,
  source_block_id uuid not null references public.note_blocks (id) on delete cascade,
  target_note_id uuid not null references public.notes (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint links_unique unique (source_block_id, target_note_id)
);

alter table public.links enable row level security;
create policy links_select on public.links for select to authenticated
  using ((select auth.uid()) = user_id);
create policy links_insert on public.links for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy links_update on public.links for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy links_delete on public.links for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.links from anon;
-- Schreibrechte braucht der Trigger (security invoker); die App schreibt links nie direkt.
grant select, insert, update, delete on table public.links to authenticated;

create trigger links_updated_at before update on public.links
  for each row execute function public.set_updated_at();
create index links_user_idx on public.links (user_id) where deleted_at is null;
create index links_target_idx on public.links (target_note_id);
create index links_source_note_idx on public.links (source_note_id);

-- ---------------------------------------------------------------------
-- Trigger: Bereich der Notiz aus Projekt bzw. Thema ableiten
-- ---------------------------------------------------------------------
create or replace function public.notes_derive_area()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_area_id uuid;
begin
  if new.project_id is not null then
    select p.area_id into v_area_id from public.projects p where p.id = new.project_id;
  elsif new.topic_id is not null then
    select t.area_id into v_area_id from public.topics t where t.id = new.topic_id;
  end if;
  if v_area_id is not null then
    new.area_id := v_area_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.notes_derive_area() from public, anon;

create trigger notes_derive before insert or update of project_id, topic_id, area_id on public.notes
  for each row execute function public.notes_derive_area();

-- Projekt wechselt den Bereich → seine Notizen folgen
create or replace function public.projects_propagate_area_to_notes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.notes n
     set area_id = new.area_id
   where n.project_id = new.id
     and n.area_id is distinct from new.area_id;
  return null;
end;
$$;
revoke execute on function public.projects_propagate_area_to_notes() from public, anon;

create trigger projects_area_to_notes after update of area_id on public.projects
  for each row when (old.area_id is distinct from new.area_id)
  execute function public.projects_propagate_area_to_notes();

-- ---------------------------------------------------------------------
-- Trigger: Projektaktivität bei Notizänderungen
-- ---------------------------------------------------------------------
create or replace function public.notes_touch_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.project_id is not null then
    update public.projects set last_activity_at = now()
     where id = new.project_id and last_activity_at < now();
  end if;
  return null;
end;
$$;
revoke execute on function public.notes_touch_project() from public, anon;

create trigger notes_project_activity after insert or update on public.notes
  for each row execute function public.notes_touch_project();

-- ---------------------------------------------------------------------
-- Trigger: aus dem Blockinhalt abgeleitete Daten
--   * links aus noteLink-Knoten neu aufbauen (Umbenennen bricht nichts: Verweis per ID)
--   * Inline-Tags (#tag) zu notes.tags hinzufügen, nie automatisch entfernen (E14)
--   * Projektaktivität berühren
-- ---------------------------------------------------------------------
create or replace function public.note_blocks_sync_derived()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tags text[];
begin
  if tg_op = 'INSERT'
     or new.content is distinct from old.content
     or new.deleted_at is distinct from old.deleted_at
     or new.note_id is distinct from old.note_id then

    delete from public.links l where l.source_block_id = new.id;

    if new.deleted_at is null then
      insert into public.links (user_id, source_note_id, source_block_id, target_note_id)
      select new.user_id, new.note_id, new.id, n.id
        from (
          select distinct (v #>> '{}') as raw
            from jsonb_path_query(new.content, 'lax $.** ? (@.type == "noteLink").attrs.noteId') as v
        ) ids
        join public.notes n
          on n.id = case
                      when ids.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then ids.raw::uuid
                    end
       where n.id <> new.note_id
      on conflict (source_block_id, target_note_id) do nothing;

      select array_agg(distinct x.tag) into v_tags
        from (
          select btrim(v #>> '{}') as tag
            from jsonb_path_query(new.content, 'lax $.** ? (@.type == "tag").attrs.name') as v
        ) x
       where x.tag <> '' and char_length(x.tag) <= 50;

      if v_tags is not null then
        update public.notes n
           set tags = (select array_agg(distinct t order by t) from unnest(n.tags || v_tags) as t)
         where n.id = new.note_id
           and not (n.tags @> v_tags);
      end if;
    end if;
  end if;

  update public.projects p
     set last_activity_at = now()
    from public.notes n
   where n.id = new.note_id
     and p.id = n.project_id
     and p.last_activity_at < now();

  return null;
end;
$$;
revoke execute on function public.note_blocks_sync_derived() from public, anon;

create trigger note_blocks_derived after insert or update on public.note_blocks
  for each row execute function public.note_blocks_sync_derived();
