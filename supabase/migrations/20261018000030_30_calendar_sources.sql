-- =====================================================================
-- 30 Kalenderquellen (Stufe 2, S2a, Nachtlauf M): Google-Kalender lesend über die geheime
--   iCal-Adresse. Je Nutzer beliebig viele Quellen: Name, Adresse, Farbe (Token-Schlüssel wie
--   die Editor-Farben), an/aus, Reihenfolge, Papierkorb (deleted_at).
--   * Die Adresse ist ein Geheimnis (wer sie kennt, liest den Kalender). Sie bleibt in dieser
--     Tabelle: nur aal2 (keine Öffnung für KI-Zugänge, nicht in AI_TABLES), die App zeigt sie
--     ausschließlich in den Einstellungen, der Export lässt sie aus, Server-Logs nennen sie nie.
--   * Gelesen werden die Termine serverseitig (Route /api/kalender mit der Sitzung des Nutzers,
--     nur Adressen unter https://calendar.google.com/); nichts davon wird gespeichert.
--   * empty_trash kennt die Tabelle (Papierkorb wie Notiz-Typen und Vorlagen).
--   Rein additiv: neue Tabelle, eine Funktion ersetzt, keine Daten geändert.
-- =====================================================================

create table public.calendar_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- geheime iCal-Adresse; die genaue Prüfung (nur calendar.google.com) macht der Server
  url text not null check (char_length(url) between 12 and 2048 and url ~ '^https?://'),
  -- Farbe als Token-Schlüssel (--ink-*), nie als Wert
  color text not null default 'blau'
    check (color in ('grau', 'rot', 'orange', 'gelb', 'gruen', 'blau', 'lila')),
  enabled boolean not null default true,
  sort text collate "C" not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.calendar_sources enable row level security;
create policy calendar_sources_select on public.calendar_sources for select to authenticated
  using ((select auth.uid()) = user_id);
create policy calendar_sources_insert on public.calendar_sources for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy calendar_sources_update on public.calendar_sources for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy calendar_sources_delete on public.calendar_sources for delete to authenticated
  using ((select auth.uid()) = user_id);
-- nur mit zweitem Faktor – auch für freigegebene KI-Zugänge bleibt die Adresse unsichtbar
create policy calendar_sources_aal2 on public.calendar_sources as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
revoke all on table public.calendar_sources from anon;
grant select, insert, update, delete on table public.calendar_sources to authenticated;

create trigger calendar_sources_updated_at before update on public.calendar_sources
  for each row execute function public.set_updated_at();
create index calendar_sources_user_idx on public.calendar_sources (user_id, sort)
  where deleted_at is null;

-- ---------------------------------------------------------------------
-- empty_trash: auch Kalenderquellen endgültig löschen (sonst unverändert, siehe Migration 26)
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
      -- Notiz-Typ endgültig: Notizen sind längst umgezogen; der Standard „idee“ bleibt (26)
      delete from public.note_types
       where id = any (p_ids) and deleted_at is not null and key <> 'idee';
    when 'saved_views' then
      delete from public.saved_views where id = any (p_ids) and deleted_at is not null;
    when 'calendar_sources' then
      delete from public.calendar_sources where id = any (p_ids) and deleted_at is not null;
    else
      raise exception 'Unbekannter Typ: %', p_entity using errcode = '22023';
  end case;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.empty_trash(text, uuid[]) from public, anon;
grant execute on function public.empty_trash(text, uuid[]) to authenticated;
