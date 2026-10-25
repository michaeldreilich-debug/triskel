-- =====================================================================
-- 06 Rückblicke, Vorlagen, gespeicherte Ansichten
-- =====================================================================

-- ---------------------------------------------------------------------
-- recaps: Wochen- und Monatsrückblicke
-- ---------------------------------------------------------------------
create table public.recaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('woche', 'monat')),
  period_start date not null,
  period_end date not null,
  -- Skalen 1–5; sport als Zahl (z. B. Einheiten oder Stunden)
  mood smallint check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  sport numeric(5, 1) check (sport >= 0),
  relations smallint check (relations between 1 and 5),
  learning smallint check (learning between 1 and 5),
  -- Antworten auf die Leitfragen: {good, hard, takeaway, ...}
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  -- Fokus nächste Woche (3 Punkte)
  focus_next jsonb not null default '[]'::jsonb check (jsonb_typeof(focus_next) = 'array'),
  themes text[] not null default '{}',
  -- Zahlen-Snapshot beim Abschließen (close_recap), danach stabil
  stats jsonb check (stats is null or jsonb_typeof(stats) = 'object'),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint recaps_period_check check (period_end >= period_start)
);

alter table public.recaps enable row level security;
create policy recaps_select on public.recaps for select to authenticated
  using ((select auth.uid()) = user_id);
create policy recaps_insert on public.recaps for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy recaps_update on public.recaps for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy recaps_delete on public.recaps for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.recaps from anon;
grant select, insert, update, delete on table public.recaps to authenticated;

create trigger recaps_updated_at before update on public.recaps
  for each row execute function public.set_updated_at();
create index recaps_user_idx on public.recaps (user_id) where deleted_at is null;
-- ein Rückblick je Art und Zeitraum (Papierkorb ausgenommen)
create unique index recaps_period_idx on public.recaps (user_id, kind, period_start)
  where deleted_at is null;

-- ---------------------------------------------------------------------
-- templates: Vorlagen für Projekt, Notiz (je Notiz-Typ) und Rückblick
-- ---------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('projekt', 'notiz', 'rueckblick')),
  note_type text
    check (note_type is null
           or note_type in ('wissen', 'protokoll', 'idee', 'anleitung', 'journal', 'rueckblick')),
  name text not null check (char_length(name) between 1 and 120),
  body jsonb not null default '{}'::jsonb check (jsonb_typeof(body) = 'object'),
  -- stabiler Schlüssel für idempotente Seeds (null bei eigenen Vorlagen)
  seed_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint templates_note_type_only_notes check (kind = 'notiz' or note_type is null)
);

alter table public.templates enable row level security;
create policy templates_select on public.templates for select to authenticated
  using ((select auth.uid()) = user_id);
create policy templates_insert on public.templates for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy templates_update on public.templates for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy templates_delete on public.templates for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.templates from anon;
grant select, insert, update, delete on table public.templates to authenticated;

create trigger templates_updated_at before update on public.templates
  for each row execute function public.set_updated_at();
create index templates_user_idx on public.templates (user_id) where deleted_at is null;
create unique index templates_seed_key_idx on public.templates (user_id, seed_key)
  where seed_key is not null;

-- ---------------------------------------------------------------------
-- saved_views: gespeicherte Ansichten (Liste, Tabelle, Board)
-- ---------------------------------------------------------------------
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity text not null check (entity in ('tasks', 'projects', 'notes')),
  -- null = „Alles“
  area_id uuid references public.areas (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  view_type text not null check (view_type in ('liste', 'tabelle', 'board')),
  -- Filter, Sortierung, Gruppierung, sichtbare Spalten
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  sort text collate "C" not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.saved_views enable row level security;
create policy saved_views_select on public.saved_views for select to authenticated
  using ((select auth.uid()) = user_id);
create policy saved_views_insert on public.saved_views for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy saved_views_update on public.saved_views for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy saved_views_delete on public.saved_views for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.saved_views from anon;
grant select, insert, update, delete on table public.saved_views to authenticated;

create trigger saved_views_updated_at before update on public.saved_views
  for each row execute function public.set_updated_at();
create index saved_views_user_idx on public.saved_views (user_id) where deleted_at is null;
create index saved_views_area_idx on public.saved_views (area_id);
