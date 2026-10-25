-- =====================================================================
-- 24 Freie Textfläche im Reiter Übersicht des Projekts (Rückmeldung #44, Nachtlauf K): ein
--   Text wie die Aufgaben-Notiz (TipTap-Dokument mit Checkliste, Notiz-Links, Bildern und
--   Dateien) + Klartext für Suche und Export.
-- =====================================================================

alter table public.projects
  add column body jsonb check (body is null or jsonb_typeof(body) = 'object'),
  add column body_text text not null default '';

-- Suche (#19: neue Inhalte immer durchsuchbar): der Freitext findet das Projekt.
-- Eine generierte Spalte lässt sich nicht ändern – neu anlegen (Index fällt mit der Spalte).
alter table public.projects drop column search;
alter table public.projects
  add column search tsvector generated always as (
    setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A')
    || setweight(to_tsvector('german'::regconfig, coalesce(why, '')), 'B')
    || setweight(jsonb_to_tsvector('german'::regconfig, links, '["string"]'::jsonb), 'C')
    || setweight(to_tsvector('german'::regconfig, coalesce(body_text, '')), 'C')
  ) stored;
create index projects_search_idx on public.projects using gin (search);
