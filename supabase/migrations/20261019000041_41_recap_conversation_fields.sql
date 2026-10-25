-- =====================================================================
-- 41 Gesprächsfelder im Rückblick (Rückmeldung #66, E37): Ein eigener Abschnitt „Gespräch“ unter
--   den Leitfragen mit den Feldern Gespräch, Hypothese, Gegenhypothese, Klartext und Bezug zur
--   Vorwoche (feste Schlüssel conversation, hypothesis, counter_hypothesis, plain_talk, last_week;
--   Art Text; neues Feld `section` an der Frage). Das Fragen-Modell liegt als jsonb in
--   templates.body.questions (Vorlage) und recaps.questions (Schnappschuss) – keine neue Spalte.
--
--   Dieser Nachtrag bringt die Felder in den vorhandenen Bestand, ohne etwas zu überschreiben:
--   * Vorlage „Rückblick“ (templates.kind = 'rueckblick'): nur fehlende Schlüssel werden hinten
--     angehängt; eigene Fragen, Reihenfolge und Beschriftungen bleiben.
--   * Offene Rückblicke (closed_at is null, nicht im Papierkorb, mit eigenem Schnappschuss):
--     ebenso. Beim Monatsrückblick heißt das Feld „Bezug zum Vormonat“.
--   * Abgeschlossene Rückblicke bleiben unverändert (stabil). Rückblicke ohne Schnappschuss
--     (questions = []) nehmen die eingebauten Fragen, die jetzt die Gesprächsfelder enthalten.
--   Wiederholbar: Schlüssel, die schon da sind, werden nie ein zweites Mal angehängt.
--   Neue Konten bekommen die Felder über die eingebauten Fragen der App; Seed (Migration 09/15)
--   bleibt unverändert. RLS und Grants unverändert (bestehende Tabellen).
-- =====================================================================

create or replace function pg_temp.conversation_fields(p_last_week_label text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'conversation', 'label', 'Gespräch', 'type', 'text', 'section', 'Gespräch'),
    jsonb_build_object('key', 'hypothesis', 'label', 'Hypothese', 'type', 'text', 'section', 'Gespräch'),
    jsonb_build_object('key', 'counter_hypothesis', 'label', 'Gegenhypothese', 'type', 'text', 'section', 'Gespräch'),
    jsonb_build_object('key', 'plain_talk', 'label', 'Klartext', 'type', 'text', 'section', 'Gespräch'),
    jsonb_build_object('key', 'last_week', 'label', p_last_week_label, 'type', 'text', 'section', 'Gespräch')
  );
$$;

-- Hängt aus p_fields alle Einträge an p_questions an, deren Schlüssel dort noch fehlt.
create or replace function pg_temp.append_missing(p_questions jsonb, p_fields jsonb)
returns jsonb
language sql
immutable
as $$
  select p_questions || coalesce(
    (select jsonb_agg(f order by o)
       from jsonb_array_elements(p_fields) with ordinality as t (f, o)
      where not exists (
        select 1 from jsonb_array_elements(p_questions) q where q ->> 'key' = f ->> 'key'
      )),
    '[]'::jsonb
  );
$$;

update public.templates
   set body = jsonb_set(body, '{questions}',
         pg_temp.append_missing(body -> 'questions', pg_temp.conversation_fields('Bezug zur Vorwoche')))
 where kind = 'rueckblick'
   and jsonb_typeof(body -> 'questions') = 'array'
   and pg_temp.append_missing(body -> 'questions', pg_temp.conversation_fields('Bezug zur Vorwoche'))
       <> body -> 'questions';

update public.recaps
   set questions = pg_temp.append_missing(questions,
         pg_temp.conversation_fields(case kind when 'monat' then 'Bezug zum Vormonat' else 'Bezug zur Vorwoche' end))
 where closed_at is null
   and deleted_at is null
   and jsonb_typeof(questions) = 'array'
   and jsonb_array_length(questions) > 0
   and pg_temp.append_missing(questions,
         pg_temp.conversation_fields(case kind when 'monat' then 'Bezug zum Vormonat' else 'Bezug zur Vorwoche' end))
       <> questions;
