-- =====================================================================
-- 09 Seed-Daten je Nutzer: 2 Bereiche, Einstellungen, 3 Vorlagen
--   * seed_user_defaults(uid): idempotent (stabile seed_key, on conflict do nothing)
--   * Trigger on_auth_user_created: neue Nutzer bekommen die Seeds beim Registrieren
--   * einmalige Ausführung für alle schon vorhandenen Nutzer (z. B. Testnutzer A und B)
-- Nur diese Funktionen sind security definer; aufrufbar nur durch Trigger und Migration.
-- =====================================================================

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

  insert into public.templates (user_id, kind, note_type, name, body, seed_key)
  values
    (
      p_user_id, 'projekt', null, 'Projekt',
      jsonb_build_object(
        'why', 'Warum ist mir das wichtig? Was ist anders, wenn es fertig ist?',
        'outcome', jsonb_build_array(
          jsonb_build_object('text', '', 'done', false),
          jsonb_build_object('text', '', 'done', false),
          jsonb_build_object('text', '', 'done', false)
        ),
        'outcome_hint', 'Fertig ist es, wenn …',
        'next_step_hint', 'Nächsten Schritt festlegen'
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_user_defaults(new.id);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Einmalig für alle Nutzer, die schon vor dieser Migration existieren (idempotent)
select public.seed_user_defaults(u.id) from auth.users as u;
