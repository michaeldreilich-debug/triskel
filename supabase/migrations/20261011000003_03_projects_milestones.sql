-- =====================================================================
-- 03 Projekte und Meilensteine
-- =====================================================================

-- ---------------------------------------------------------------------
-- projects: befristet, mit Steckbrief
-- ---------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  area_id uuid not null references public.areas (id) on delete restrict,
  title text not null default '' check (char_length(title) <= 500),
  status text not null default 'idee'
    check (status in ('idee', 'geplant', 'aktiv', 'pausiert', 'abgeschlossen', 'archiv')),
  -- 1 = hoch, 2 = mittel, 3 = niedrig, null = keine
  priority smallint check (priority between 1 and 3),
  start_date date,
  target_date date,
  time_budget_weeks numeric(5, 1) check (time_budget_weeks > 0),
  why text not null default '',
  -- Ergebnis-Checkliste „Fertig ist es, wenn …“: [{id, text, done}]
  outcome jsonb not null default '[]'::jsonb check (jsonb_typeof(outcome) = 'array'),
  -- Verweis auf eine Aufgabe; Fremdschlüssel folgt in 04 (tasks existiert noch nicht)
  next_task_id uuid,
  last_activity_at timestamptz not null default now(),
  -- Abschluss-Ritual: {worked, takeaway, open}
  closing_reflection jsonb
    check (closing_reflection is null or jsonb_typeof(closing_reflection) = 'object'),
  sort text collate "C" not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint projects_dates_check
    check (start_date is null or target_date is null or target_date >= start_date)
);

alter table public.projects enable row level security;
create policy projects_select on public.projects for select to authenticated
  using ((select auth.uid()) = user_id);
create policy projects_insert on public.projects for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy projects_update on public.projects for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy projects_delete on public.projects for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.projects from anon;
grant select, insert, update, delete on table public.projects to authenticated;

create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create index projects_user_idx on public.projects (user_id) where deleted_at is null;
create index projects_area_idx on public.projects (area_id);
create index projects_status_idx on public.projects (user_id, status) where deleted_at is null;

-- ---------------------------------------------------------------------
-- milestones
-- ---------------------------------------------------------------------
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 500),
  due_date date,
  done_at timestamptz,
  sort text collate "C" not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.milestones enable row level security;
create policy milestones_select on public.milestones for select to authenticated
  using ((select auth.uid()) = user_id);
create policy milestones_insert on public.milestones for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy milestones_update on public.milestones for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy milestones_delete on public.milestones for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.milestones from anon;
grant select, insert, update, delete on table public.milestones to authenticated;

create trigger milestones_updated_at before update on public.milestones
  for each row execute function public.set_updated_at();
create index milestones_user_idx on public.milestones (user_id) where deleted_at is null;
create index milestones_project_idx on public.milestones (project_id);
