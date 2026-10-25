-- =====================================================================
-- 25 Notiz-Typen selbst anlegen, umbenennen, löschen (Rückmeldung #34, Nachtlauf K, E31) –
--   „wie bei Notion“. Bisher feste Liste (Check in Migration 05/06). Jetzt eine Tabelle je
--   Nutzer: Notizen und Vorlagen behalten den Schlüssel (`notes.type`), Umbenennen ändert nur den
--   Namen. Löschen fragt in der App nach dem Zieltyp: delete_note_type verschiebt Notizen und
--   Vorlagen und legt den Typ in den Papierkorb (restore_note_type = Rückgängig).
--   „wissen“ ist der Standard (neue Notizen, unbekannte Schlüssel) und lässt sich nur umbenennen.
-- =====================================================================

create table public.note_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- fester Schlüssel (steht in notes.type), Kleinbuchstaben, Ziffern, Bindestrich
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  sort text collate "C" not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- auch gelöschte Typen halten ihren Schlüssel (Wiederherstellen ohne Zusammenstoß)
  constraint note_types_user_key unique (user_id, key)
);

alter table public.note_types enable row level security;
create policy note_types_select on public.note_types for select to authenticated
  using ((select auth.uid()) = user_id);
create policy note_types_insert on public.note_types for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy note_types_update on public.note_types for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy note_types_delete on public.note_types for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy note_types_aal2 on public.note_types as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
-- die KI-Werkzeuge nennen und setzen Typen (create_note, update_note, overview)
alter policy note_types_aal2 on public.note_types
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
revoke all on table public.note_types from anon;
grant select, insert, update, delete on table public.note_types to authenticated;

create trigger note_types_updated_at before update on public.note_types
  for each row execute function public.set_updated_at();
create index note_types_user_idx on public.note_types (user_id) where deleted_at is null;

-- Typen nicht mehr fest: nur noch die Form des Schlüssels prüfen
alter table public.notes drop constraint notes_type_check;
alter table public.notes
  add constraint notes_type_format check (type ~ '^[a-z0-9][a-z0-9-]{0,39}$');
alter table public.templates drop constraint templates_note_type_check;
alter table public.templates
  add constraint templates_note_type_format
    check (note_type is null or note_type ~ '^[a-z0-9][a-z0-9-]{0,39}$');

-- bisherige Nutzer: die festen Typen als Einträge (neue Nutzer: seed_user_defaults)
insert into public.note_types (user_id, key, name, sort)
select u.id, t.key, t.name, t.sort
  from auth.users as u
 cross join (
   values
     ('wissen', 'Wissen', 'a0'),
     ('protokoll', 'Protokoll', 'a1'),
     ('idee', 'Idee', 'a2'),
     ('anleitung', 'Anleitung', 'a3'),
     ('journal', 'Journal', 'a4'),
     ('rueckblick', 'Rückblick', 'a5')
 ) as t (key, name, sort)
on conflict (user_id, key) do nothing;

-- ---------------------------------------------------------------------
-- Neue Nutzer bekommen die Typen gleich mit (sonst unverändert, siehe Migration 15)
-- ---------------------------------------------------------------------
create or replace function public.seed_user_defaults(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'seed_user_defaults: Nutzer-ID fehlt.' using errcode = '22004';
  end if;

  insert into public.areas (user_id, name, color, sort, seed_key)
  values
    (p_user_id, 'Beruf', 'orange', 'a0', 'beruf'),
    (p_user_id, 'Privat', 'blue', 'a1', 'privat')
  on conflict (user_id, seed_key) where seed_key is not null do nothing;

  insert into public.user_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  -- Notiz-Typen (Migration 25): die bisherigen festen Typen als Ausgangspunkt
  insert into public.note_types (user_id, key, name, sort)
  values
    (p_user_id, 'wissen', 'Wissen', 'a0'),
    (p_user_id, 'protokoll', 'Protokoll', 'a1'),
    (p_user_id, 'idee', 'Idee', 'a2'),
    (p_user_id, 'anleitung', 'Anleitung', 'a3'),
    (p_user_id, 'journal', 'Journal', 'a4'),
    (p_user_id, 'rueckblick', 'Rückblick', 'a5')
  on conflict (user_id, key) do nothing;

  insert into public.templates (user_id, kind, note_type, name, body, seed_key)
  values
    (
      p_user_id, 'projekt', null, 'Projekt',
      jsonb_build_object(
        'why', '',
        'outcome', jsonb_build_array(),
        'milestones', jsonb_build_array(),
        'tasks', jsonb_build_array()
      ),
      'projekt'
    ),
    (
      p_user_id, 'notiz', 'protokoll', 'Protokoll',
      jsonb_build_object(
        'type', 'doc',
        'content', (
          select jsonb_agg(
                   jsonb_build_object(
                     'type', 'block',
                     'content', jsonb_build_array(
                       jsonb_build_object(
                         'type', 'paragraph',
                         'content', jsonb_build_array(
                           jsonb_build_object('type', 'text', 'text', label)
                         )
                       )
                     )
                   )
                   order by pos
                 )
            from unnest(array[
              'Anlass/Datum',
              'Teilnehmende',
              'Themen',
              'Beschlüsse',
              'Offene Punkte (→ Aufgabe)',
              'Nächster Termin'
            ]) with ordinality as l (label, pos)
        )
      ),
      'protokoll'
    ),
    (
      p_user_id, 'rueckblick', null, 'Wochenrückblick',
      jsonb_build_object(
        'questions', jsonb_build_array(
          jsonb_build_object('key', 'mood', 'label', 'Wie ging es mir (1–5)?', 'type', 'scale'),
          jsonb_build_object('key', 'good', 'label', 'Was lief gut?', 'type', 'text'),
          jsonb_build_object('key', 'hard', 'label', 'Was war schwer?', 'type', 'text'),
          jsonb_build_object('key', 'takeaway', 'label', 'Was nehme ich mit?', 'type', 'text'),
          jsonb_build_object('key', 'energy', 'label', 'Energie', 'type', 'scale'),
          jsonb_build_object('key', 'sport', 'label', 'Sport', 'type', 'number'),
          jsonb_build_object('key', 'relations', 'label', 'Beziehungen', 'type', 'scale'),
          jsonb_build_object('key', 'learning', 'label', 'Lernen', 'type', 'scale'),
          jsonb_build_object('key', 'focus_next', 'label', 'Fokus nächste Woche (3 Punkte)',
                             'type', 'list', 'count', 3)
        )
      ),
      'wochenrueckblick'
    )
  on conflict (user_id, seed_key) where seed_key is not null do nothing;
end;
$$;
revoke execute on function public.seed_user_defaults(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- delete_note_type: Notizen und Vorlagen in den Zieltyp, Typ in den Papierkorb (atomar)
-- ---------------------------------------------------------------------
create or replace function public.delete_note_type(p_key text, p_target text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_key = 'wissen' then
    raise exception 'Der Standardtyp „Wissen“ lässt sich nur umbenennen.' using errcode = '22023';
  end if;
  if p_target = p_key then
    raise exception 'Zieltyp und gelöschter Typ sind gleich.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.note_types where key = p_target and deleted_at is null
  ) then
    raise exception 'Zieltyp % fehlt.', p_target using errcode = '22023';
  end if;
  -- auch Notizen im Papierkorb: wiederhergestellt sollen sie einen gültigen Typ haben
  update public.notes set type = p_target where type = p_key;
  update public.templates set note_type = p_target where note_type = p_key;
  update public.note_types set deleted_at = now() where key = p_key and deleted_at is null;
end;
$$;
revoke execute on function public.delete_note_type(text, text) from public, anon;
grant execute on function public.delete_note_type(text, text) to authenticated;

-- restore_note_type: Rückgängig – Typ zurück, die genannten Notizen wieder hinein
create or replace function public.restore_note_type(p_key text, p_note_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.note_types set deleted_at = null where key = p_key;
  update public.notes set type = p_key where id = any (coalesce(p_note_ids, '{}'));
end;
$$;
revoke execute on function public.restore_note_type(text, uuid[]) from public, anon;
grant execute on function public.restore_note_type(text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- empty_trash: auch Notiz-Typen endgültig löschen (sonst unverändert, siehe Migration 07)
-- ---------------------------------------------------------------------
create or replace function public.empty_trash(p_entity text, p_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  case p_entity
    when 'tasks' then
      delete from public.tasks where id = any (p_ids) and deleted_at is not null;
    when 'projects' then
      delete from public.projects where id = any (p_ids) and deleted_at is not null;
    when 'milestones' then
      delete from public.milestones where id = any (p_ids) and deleted_at is not null;
    when 'notes' then
      delete from public.notes where id = any (p_ids) and deleted_at is not null;
    when 'topics' then
      delete from public.topics where id = any (p_ids) and deleted_at is not null;
    when 'recaps' then
      delete from public.recaps where id = any (p_ids) and deleted_at is not null;
    when 'templates' then
      delete from public.templates where id = any (p_ids) and deleted_at is not null;
    when 'note_types' then
      -- Notiz-Typ endgültig: Notizen hängen nur am Schlüssel und sind längst umgezogen
      delete from public.note_types
       where id = any (p_ids) and deleted_at is not null and key <> 'wissen';
    when 'saved_views' then
      delete from public.saved_views where id = any (p_ids) and deleted_at is not null;
    else
      raise exception 'Unbekannter Typ: %', p_entity using errcode = '22023';
  end case;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.empty_trash(text, uuid[]) from public, anon;
grant execute on function public.empty_trash(text, uuid[]) to authenticated;
