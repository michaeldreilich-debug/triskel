-- =====================================================================
-- 22 Links im Projekt-Steckbrief (Entscheidung 17.10.2026, Nachtlauf J): Name + Adresse, ein
--   Klick öffnet. Liste [{id, name, url}] wie die Ergebnis-Checkliste (outcome). Die App und die
--   KI-Werkzeuge nehmen nur http(s)- und mailto-Adressen an; die Ansicht prüft beim Anzeigen
--   noch einmal (nie javascript:).
-- =====================================================================

alter table public.projects
  add column links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 100);

-- Suche (#19: neue Inhalte immer durchsuchbar): Link-Namen und Adressen finden das Projekt.
-- Eine generierte Spalte lässt sich nicht ändern – neu anlegen (Index fällt mit der Spalte).
alter table public.projects drop column search;
alter table public.projects
  add column search tsvector generated always as (
    setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A')
    || setweight(to_tsvector('german'::regconfig, coalesce(why, '')), 'B')
    || setweight(jsonb_to_tsvector('german'::regconfig, links, '["string"]'::jsonb), 'C')
  ) stored;
create index projects_search_idx on public.projects using gin (search);
