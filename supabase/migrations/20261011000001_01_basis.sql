-- =====================================================================
-- 01 Basis: Erweiterungen und gemeinsame Hilfsfunktionen
-- Konventionen (docs/plan-phase-1.md, Abschnitt 2):
--   * jede Tabelle: id, user_id, created_at, updated_at, deleted_at, RLS + 4 Policies,
--     Grants nur an authenticated
--   * Funktionen: security invoker (Ausnahme Seed), set search_path = '',
--     EXECUTE für public/anon entzogen
--   * Statuswerte als text + check, Sortierung als text collate "C" (Fractional Indexing)
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- updated_at bei jeder Änderung setzen
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon;
