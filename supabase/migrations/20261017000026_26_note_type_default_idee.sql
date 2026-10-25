-- =====================================================================
-- 26 Standard-Notiztyp „Idee“ statt „Wissen“ (Rückmeldung 17.10.2026 abends, zu #34): „Standardmäßig
--   sollte es bei einer Notiz Idee sein, damit ich kurz was aufschreiben kann – Wissen ist es ja
--   explizit.“ Neue Notizen ohne Typ bekommen „idee“, „idee“ lässt sich nur umbenennen (statt
--   „wissen“), „wissen“ wird ein normaler Typ. Die mitgelieferte Reihenfolge stellt Idee vorn –
--   nur, wo sie noch unverändert ist.
-- =====================================================================

alter table public.notes alter column type set default 'idee';

update public.note_types as t
   set sort = case t.key when 'idee' then 'a0' when 'wissen' then 'a1' else 'a2' end
 where (t.key = 'wissen' and t.sort = 'a0')
    or (t.key = 'protokoll' and t.sort = 'a1')
    or (t.key = 'idee' and t.sort = 'a2');

-- ---------------------------------------------------------------------
-- Neue Nutzer: Idee zuerst (sonst unverändert, siehe Migration 25)
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

  -- Notiz-Typen (Migration 25/26): Idee ist der Standard und steht vorn
  insert into public.note_types (user_id, key, name, sort)
  values
    (p_user_id, 'idee', 'Idee', 'a0'),
    (p_user_id, 'wissen', 'Wissen', 'a1'),
    (p_user_id, 'protokoll', 'Protokoll', 'a2'),
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
-- delete_note_type: geschützt ist jetzt „idee“ (sonst unverändert, siehe Migration 25)
-- ---------------------------------------------------------------------
create or replace function public.delete_note_type(p_key text, p_target text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_key = 'idee' then
    raise exception 'Der Standardtyp „Idee“ lässt sich nur umbenennen.' using errcode = '22023';
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

-- ---------------------------------------------------------------------
-- empty_trash: der Standardtyp „idee“ wird nie endgültig gelöscht (sonst unverändert)
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
       where id = any (p_ids) and deleted_at is not null and key <> 'idee';
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
