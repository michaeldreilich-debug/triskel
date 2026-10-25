-- =====================================================================
-- 04 Aufgaben und Abhängigkeiten („Blockiert durch“)
-- =====================================================================

-- ---------------------------------------------------------------------
-- tasks (Inbox-Einträge sind Aufgaben mit in_inbox = true, Bereich optional)
-- ---------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  area_id uuid references public.areas (id) on delete restrict,
  project_id uuid references public.projects (id) on delete set null,
  milestone_id uuid references public.milestones (id) on delete set null,
  title text not null default '' check (char_length(title) <= 1000),
  -- Notiz/Checkliste als TipTap-JSON + Klartext für die Suche
  body jsonb check (body is null or jsonb_typeof(body) = 'object'),
  body_text text not null default '',
  status text not null default 'offen'
    check (status in ('offen', 'in_arbeit', 'wartet', 'erledigt')),
  -- 1 = hoch, 2 = mittel, 3 = niedrig, null = keine
  priority smallint check (priority between 1 and 3),
  due_date date,
  scheduled_at timestamptz,
  duration_min integer check (duration_min between 1 and 1440),
  -- Wiederholung als RRULE (RFC 5545), z. B. FREQ=WEEKLY;BYDAY=SU
  recurrence text check (recurrence is null or recurrence ~ '^(RRULE:)?FREQ='),
  -- Aufgabe, aus deren Erledigung diese Instanz entstanden ist
  recurrence_source_id uuid references public.tasks (id) on delete set null,
  focus_date date,
  in_inbox boolean not null default false,
  completed_at timestamptz,
  sort text collate "C" not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint tasks_area_required check (area_id is not null or in_inbox)
);

alter table public.tasks enable row level security;
create policy tasks_select on public.tasks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy tasks_update on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy tasks_delete on public.tasks for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.tasks from anon;
grant select, insert, update, delete on table public.tasks to authenticated;

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create index tasks_user_idx on public.tasks (user_id) where deleted_at is null;
create index tasks_area_idx on public.tasks (area_id);
create index tasks_project_idx on public.tasks (project_id);
create index tasks_milestone_idx on public.tasks (milestone_id);
create index tasks_recurrence_source_idx on public.tasks (recurrence_source_id);
create index tasks_due_idx on public.tasks (user_id, due_date) where deleted_at is null;
create index tasks_focus_idx on public.tasks (user_id, focus_date) where deleted_at is null;
create index tasks_inbox_idx on public.tasks (user_id) where in_inbox and deleted_at is null;

-- „Nächster Schritt“ des Projekts verweist auf eine Aufgabe
alter table public.projects
  add constraint projects_next_task_fk
  foreign key (next_task_id) references public.tasks (id) on delete set null;
create index projects_next_task_idx on public.projects (next_task_id);

-- ---------------------------------------------------------------------
-- task_dependencies: task_id ist blockiert durch blocked_by_task_id
-- ---------------------------------------------------------------------
create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  blocked_by_task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (task_id, blocked_by_task_id),
  constraint task_dependencies_no_self check (task_id <> blocked_by_task_id)
);

alter table public.task_dependencies enable row level security;
create policy task_dependencies_select on public.task_dependencies for select to authenticated
  using ((select auth.uid()) = user_id);
create policy task_dependencies_insert on public.task_dependencies for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy task_dependencies_update on public.task_dependencies for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy task_dependencies_delete on public.task_dependencies for delete to authenticated
  using ((select auth.uid()) = user_id);
revoke all on table public.task_dependencies from anon;
grant select, insert, update, delete on table public.task_dependencies to authenticated;

create trigger task_dependencies_updated_at before update on public.task_dependencies
  for each row execute function public.set_updated_at();
create index task_dependencies_user_idx on public.task_dependencies (user_id) where deleted_at is null;
create index task_dependencies_blocked_by_idx on public.task_dependencies (blocked_by_task_id);

-- ---------------------------------------------------------------------
-- Trigger: completed_at beim Erledigen setzen, beim Wiedereröffnen leeren
-- ---------------------------------------------------------------------
create or replace function public.tasks_set_completed_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'erledigt' then
    if tg_op = 'INSERT' or old.status is distinct from 'erledigt' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.tasks_set_completed_at() from public, anon;

create trigger tasks_completed_at before insert or update of status, completed_at on public.tasks
  for each row execute function public.tasks_set_completed_at();

-- ---------------------------------------------------------------------
-- Trigger: Projekt aus Meilenstein, Bereich aus Projekt ableiten
-- ---------------------------------------------------------------------
create or replace function public.tasks_derive_project_area()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_area_id uuid;
begin
  if new.milestone_id is not null then
    select m.project_id into v_project_id from public.milestones m where m.id = new.milestone_id;
    if v_project_id is not null then
      if new.project_id is null then
        new.project_id := v_project_id;
      elsif new.project_id <> v_project_id then
        raise exception 'Der Meilenstein gehört zu einem anderen Projekt.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if new.project_id is not null then
    select p.area_id into v_area_id from public.projects p where p.id = new.project_id;
    if v_area_id is not null then
      new.area_id := v_area_id;
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function public.tasks_derive_project_area() from public, anon;

create trigger tasks_derive before insert or update of project_id, milestone_id, area_id on public.tasks
  for each row execute function public.tasks_derive_project_area();

-- Projekt wechselt den Bereich → seine Aufgaben folgen
create or replace function public.projects_propagate_area()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.tasks t
     set area_id = new.area_id
   where t.project_id = new.id
     and t.area_id is distinct from new.area_id;
  return null;
end;
$$;
revoke execute on function public.projects_propagate_area() from public, anon;

create trigger projects_area_to_tasks after update of area_id on public.projects
  for each row when (old.area_id is distinct from new.area_id)
  execute function public.projects_propagate_area();

-- ---------------------------------------------------------------------
-- Trigger: Projektaktivität berühren (für „14 Tage still“)
-- ---------------------------------------------------------------------
create or replace function public.tasks_touch_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op <> 'DELETE' and new.project_id is not null then
    update public.projects set last_activity_at = now()
     where id = new.project_id and last_activity_at < now();
  end if;
  if tg_op <> 'INSERT' and old.project_id is not null
     and (tg_op = 'DELETE' or old.project_id is distinct from new.project_id) then
    update public.projects set last_activity_at = now()
     where id = old.project_id and last_activity_at < now();
  end if;
  return null;
end;
$$;
revoke execute on function public.tasks_touch_project() from public, anon;

create trigger tasks_project_activity after insert or update or delete on public.tasks
  for each row execute function public.tasks_touch_project();

-- ---------------------------------------------------------------------
-- Trigger: Zyklus- und Selbstverweis-Sperre für „Blockiert durch“
-- ---------------------------------------------------------------------
create or replace function public.task_dependencies_check_cycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;

  if new.task_id = new.blocked_by_task_id then
    raise exception 'Eine Aufgabe kann nicht von sich selbst blockiert werden.'
      using errcode = '23514';
  end if;

  -- Zyklus, wenn die blockierende Aufgabe (direkt oder indirekt) schon von task_id blockiert wird
  if exists (
    with recursive chain (id) as (
      select d.blocked_by_task_id
        from public.task_dependencies d
       where d.task_id = new.blocked_by_task_id
         and d.deleted_at is null
      union
      select d.blocked_by_task_id
        from public.task_dependencies d
        join chain c on d.task_id = c.id
       where d.deleted_at is null
    )
    select 1 from chain where chain.id = new.task_id
  ) then
    raise exception 'Zyklus: Diese Abhängigkeit würde einen Kreis bilden.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke execute on function public.task_dependencies_check_cycle() from public, anon;

create trigger task_dependencies_cycle before insert or update on public.task_dependencies
  for each row execute function public.task_dependencies_check_cycle();
