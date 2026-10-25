-- =====================================================================
-- 02 Bereiche, Themen, Nutzereinstellungen
-- =====================================================================

-- ---------------------------------------------------------------------
-- areas: Bereiche (Beruf, Privat)
-- ---------------------------------------------------------------------
create table public.areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  -- Token-Schlüssel statt Farbwert: Dunkel und Papier haben verschiedene Werte
  color text not null default 'blue' check (color in ('orange', 'blue')),
  sort text collate "C" not null,
  -- stabiler Schlüssel für idempotente Seeds (null bei selbst angelegten Bereichen)
  seed_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.areas enable row level security;
create policy areas_select on public.areas for select to authenticated
  using ((select auth.uid()) = user_id);
create policy areas_insert on public.areas for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy areas_update on public.areas for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy areas_delete on public.areas for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.areas from anon;
grant select, insert, update, delete on table public.areas to authenticated;

create trigger areas_updated_at before update on public.areas
  for each row execute function public.set_updated_at();
create index areas_user_idx on public.areas (user_id) where deleted_at is null;
create unique index areas_seed_key_idx on public.areas (user_id, seed_key) where seed_key is not null;

-- ---------------------------------------------------------------------
-- topics: Wissensthemen (dauerhaft, z. B. Atemschutz)
-- ---------------------------------------------------------------------
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  area_id uuid not null references public.areas (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  sort text collate "C" not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.topics enable row level security;
create policy topics_select on public.topics for select to authenticated
  using ((select auth.uid()) = user_id);
create policy topics_insert on public.topics for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy topics_update on public.topics for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy topics_delete on public.topics for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.topics from anon;
grant select, insert, update, delete on table public.topics to authenticated;

create trigger topics_updated_at before update on public.topics
  for each row execute function public.set_updated_at();
create index topics_user_idx on public.topics (user_id) where deleted_at is null;
create index topics_area_idx on public.topics (area_id);

-- ---------------------------------------------------------------------
-- user_settings: genau eine Zeile je Nutzer
-- ---------------------------------------------------------------------
create table public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'paper')),
  active_area_id uuid references public.areas (id) on delete set null,
  evening_time time not null default '20:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.user_settings enable row level security;
create policy user_settings_select on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy user_settings_insert on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy user_settings_update on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy user_settings_delete on public.user_settings for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.user_settings from anon;
grant select, insert, update, delete on table public.user_settings to authenticated;

create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();
create index user_settings_area_idx on public.user_settings (active_area_id);
