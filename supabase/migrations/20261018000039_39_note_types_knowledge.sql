-- =====================================================================
-- 39 Notiz-Typen „zählt als Wissen“ (Rückmeldung #56, Nachtlauf N Teil 2, Variante A):
--   Rückmeldung: „Wissen zeigt nur Wissen – Fachwissen, Abläufe.“
--   Der Typ entscheidet: Am Typ steht jetzt `counts_as_knowledge`; die Wissen-Ansicht zeigt nur
--   Notizen solcher Typen (mit und ohne Projekt). Mitgeliefert: „wissen“ und „anleitung“ (Abläufe).
--   Eigene und alle anderen Typen starten mit `false`; je Typ einstellbar (Einstellungen › Notiz-
--   Typen). Rein additiv: keine Notiz wird verändert, Rechte und Policies der Tabelle gelten
--   weiter (die KI liest nur). delete_note_type/restore_note_type zählen keine Spalten auf und
--   bleiben unverändert; ein wiederhergestellter Typ behält seinen Schalter. Idempotent.
-- =====================================================================
alter table public.note_types
  add column if not exists counts_as_knowledge boolean not null default false;
comment on column public.note_types.counts_as_knowledge is
  'Notizen dieses Typs stehen in der Wissen-Ansicht (der Nutzer stellt es je Typ ein).';

-- bisherige Nutzer: die mitgelieferten Wissens-Typen einschalten (nur false → true)
update public.note_types
   set counts_as_knowledge = true
 where key in ('wissen', 'anleitung')
   and counts_as_knowledge = false;

-- ---------------------------------------------------------------------
-- Neue Nutzer: Wissen und Anleitung zählen gleich als Wissen (sonst unverändert, siehe Migration 26)
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
  -- Notiz-Typen (Migration 25/26/39): Idee ist der Standard, Wissen und Anleitung zählen als Wissen
  insert into public.note_types (user_id, key, name, sort, counts_as_knowledge)
  values
    (p_user_id, 'idee', 'Idee', 'a0', false),
    (p_user_id, 'wissen', 'Wissen', 'a1', true),
    (p_user_id, 'protokoll', 'Protokoll', 'a2', false),
    (p_user_id, 'anleitung', 'Anleitung', 'a3', true),
    (p_user_id, 'journal', 'Journal', 'a4', false),
    (p_user_id, 'rueckblick', 'Rückblick', 'a5', false)
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
