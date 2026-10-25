-- =====================================================================
-- 07 Views und RPCs
-- Views mit security_invoker = true (sonst würden sie RLS umgehen).
-- Rechnen in Europe/Berlin; Woche Mo–So (ISO).
-- =====================================================================

-- ---------------------------------------------------------------------
-- v_tasks: Aufgaben + is_blocked (mind. eine offene, nicht gelöschte Blockade)
-- ---------------------------------------------------------------------
create view public.v_tasks
with (security_invoker = true)
as
select
  t.*,
  exists (
    select 1
      from public.task_dependencies d
      join public.tasks b on b.id = d.blocked_by_task_id
     where d.task_id = t.id
       and d.deleted_at is null
       and b.deleted_at is null
       and b.status <> 'erledigt'
  ) as is_blocked
from public.tasks t;

revoke all on table public.v_tasks from anon;
grant select on table public.v_tasks to authenticated;

-- ---------------------------------------------------------------------
-- v_projects: Fortschritt = erledigte ÷ alle Aufgaben (null ohne Aufgaben),
-- is_stuck = aktiv ohne Ergebnis oder ohne offenen nächsten Schritt,
-- is_stale = aktiv und 14 Tage ohne Bewegung
-- ---------------------------------------------------------------------
create view public.v_projects
with (security_invoker = true)
as
select
  p.*,
  coalesce(c.task_count, 0)::int as task_count,
  coalesce(c.done_count, 0)::int as done_count,
  case
    when coalesce(c.task_count, 0) = 0 then null
    else round(c.done_count::numeric / c.task_count, 4)
  end as progress,
  (
    p.status = 'aktiv'
    and (
      not exists (
        select 1
          from jsonb_array_elements(p.outcome) as o (item)
         where jsonb_typeof(o.item) = 'object'
           and nullif(btrim(o.item ->> 'text'), '') is not null
      )
      or not exists (
        select 1
          from public.tasks nt
         where nt.id = p.next_task_id
           and nt.deleted_at is null
           and nt.status <> 'erledigt'
      )
    )
  ) as is_stuck,
  (
    p.status = 'aktiv'
    and greatest(p.last_activity_at, p.updated_at) < now() - interval '14 days'
  ) as is_stale
from public.projects p
left join lateral (
  select
    count(*) as task_count,
    count(*) filter (where t.status = 'erledigt') as done_count
  from public.tasks t
  where t.project_id = p.id
    and t.deleted_at is null
) c on true;

revoke all on table public.v_projects from anon;
grant select on table public.v_projects to authenticated;

-- ---------------------------------------------------------------------
-- complete_task: atomar erledigen + Folgeinstanz bei Wiederholung (E12)
-- p_next_due berechnet der Client aus der RRULE (erster Termin nach max(Fälligkeit, heute)).
-- p_next_id: ID der Folgeinstanz aus dem Client (E4), sonst neu erzeugt.
-- Idempotent: Ist die Aufgabe schon erledigt, passiert nichts.
-- ---------------------------------------------------------------------
create or replace function public.complete_task(
  p_task_id uuid,
  p_next_due date default null,
  p_next_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_next_id uuid;
begin
  select * into v_task
    from public.tasks
   where id = p_task_id and deleted_at is null
     for update;
  if not found then
    raise exception 'Aufgabe nicht gefunden.' using errcode = 'P0002';
  end if;

  if v_task.status = 'erledigt' then
    select t.id into v_next_id
      from public.tasks t
     where t.recurrence_source_id = v_task.id and t.deleted_at is null
     order by t.created_at desc
     limit 1;
    return jsonb_build_object('completed_id', v_task.id, 'next_id', v_next_id);
  end if;

  update public.tasks set status = 'erledigt' where id = v_task.id;

  if v_task.recurrence is not null and p_next_due is not null then
    v_next_id := coalesce(p_next_id, gen_random_uuid());
    insert into public.tasks (
      id, user_id, area_id, project_id, milestone_id, title, body, body_text, status,
      priority, due_date, scheduled_at, duration_min, recurrence, recurrence_source_id,
      focus_date, in_inbox, sort
    ) values (
      v_next_id, v_task.user_id, v_task.area_id, v_task.project_id, v_task.milestone_id,
      v_task.title,
      -- Checklisten-Punkte der Folgeinstanz starten unerledigt
      case
        when v_task.body is null then null
        else regexp_replace(v_task.body::text, '"checked":\s*true', '"checked": false', 'g')::jsonb
      end,
      v_task.body_text, 'offen', v_task.priority, p_next_due,
      case
        when v_task.scheduled_at is not null and v_task.due_date is not null then
          ((v_task.scheduled_at at time zone 'Europe/Berlin')
            + (p_next_due - v_task.due_date) * interval '1 day') at time zone 'Europe/Berlin'
      end,
      v_task.duration_min, v_task.recurrence, v_task.id, null, false, v_task.sort || 'V'
    );
  end if;

  return jsonb_build_object('completed_id', v_task.id, 'next_id', v_next_id);
end;
$$;
revoke execute on function public.complete_task(uuid, date, uuid) from public, anon;
grant execute on function public.complete_task(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- undo_complete_task: wieder öffnen, entstandene Folgeinstanz in den Papierkorb
-- ---------------------------------------------------------------------
create or replace function public.undo_complete_task(p_task_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_removed uuid[];
begin
  update public.tasks
     set status = 'offen'
   where id = p_task_id and status = 'erledigt' and deleted_at is null;

  with removed as (
    update public.tasks
       set deleted_at = now()
     where recurrence_source_id = p_task_id
       and deleted_at is null
       and status <> 'erledigt'
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_removed from removed;

  return jsonb_build_object('reopened_id', p_task_id, 'removed_ids', to_jsonb(v_removed));
end;
$$;
revoke execute on function public.undo_complete_task(uuid) from public, anon;
grant execute on function public.undo_complete_task(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- week_stats: automatische Zahlen für einen Zeitraum (Datum inklusive, Europe/Berlin)
-- Fokus-Tag zählt, wenn alle Fokus-Aufgaben des Tages bis Tagesende erledigt sind
-- (mindestens eine, E15).
-- ---------------------------------------------------------------------
create or replace function public.week_stats(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_from timestamptz := p_start::timestamp at time zone 'Europe/Berlin';
  v_to timestamptz := (p_end + 1)::timestamp at time zone 'Europe/Berlin';
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Ungültiger Zeitraum.' using errcode = '22023';
  end if;

  with done as (
    select t.area_id
      from public.tasks t
     where t.deleted_at is null
       and t.status = 'erledigt'
       and t.completed_at >= v_from
       and t.completed_at < v_to
  ),
  by_area as (
    select d.area_id, a.name, count(*)::int as cnt
      from done d
      left join public.areas a on a.id = d.area_id
     group by d.area_id, a.name
  ),
  days as (
    select g::date as day
      from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') as g
  ),
  focus as (
    select
      dd.day,
      count(t.id)::int as planned,
      count(t.id) filter (
        where t.status = 'erledigt'
          and t.completed_at < ((dd.day + 1)::timestamp at time zone 'Europe/Berlin')
      )::int as done
    from days dd
    left join public.tasks t on t.focus_date = dd.day and t.deleted_at is null
    group by dd.day
  )
  select jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'tasks_done', jsonb_build_object(
      'total', (select count(*) from done),
      'by_area', coalesce(
        (select jsonb_agg(jsonb_build_object('area_id', b.area_id, 'name', b.name, 'count', b.cnt)
                          order by b.name)
           from by_area b),
        '[]'::jsonb)
    ),
    'milestones_done', (
      select count(*)
        from public.milestones m
       where m.deleted_at is null
         and m.done_at >= v_from
         and m.done_at < v_to
    ),
    'focus_days', jsonb_build_object(
      'achieved', (select count(*) from focus f where f.planned > 0 and f.done = f.planned),
      'planned', (select count(*) from focus f where f.planned > 0),
      'days', (select jsonb_agg(jsonb_build_object('date', f.day, 'planned', f.planned, 'done', f.done)
                                order by f.day)
                 from focus f)
    ),
    'stuck_projects', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title) order by p.title)
         from public.v_projects p
        where p.deleted_at is null and p.is_stuck),
      '[]'::jsonb),
    'stale_projects', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title) order by p.title)
         from public.v_projects p
        where p.deleted_at is null and p.is_stale),
      '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
revoke execute on function public.week_stats(date, date) from public, anon;
grant execute on function public.week_stats(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- close_recap: Zahlen als Snapshot speichern und abschließen (danach stabil)
-- ---------------------------------------------------------------------
create or replace function public.close_recap(p_recap_id uuid)
returns public.recaps
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recap public.recaps;
begin
  select * into v_recap
    from public.recaps
   where id = p_recap_id and deleted_at is null
     for update;
  if not found then
    raise exception 'Rückblick nicht gefunden.' using errcode = 'P0002';
  end if;

  if v_recap.closed_at is not null then
    return v_recap;
  end if;

  update public.recaps
     set stats = public.week_stats(v_recap.period_start, v_recap.period_end),
         closed_at = now()
   where id = p_recap_id
  returning * into v_recap;

  return v_recap;
end;
$$;
revoke execute on function public.close_recap(uuid) from public, anon;
grant execute on function public.close_recap(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- empty_trash: endgültig löschen – nur Einträge, die schon im Papierkorb liegen (E9)
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
    when 'saved_views' then
      delete from public.saved_views where id = any (p_ids) and deleted_at is not null;
    else
      raise exception 'Unbekannter Typ: %', p_entity using errcode = '22023';
  end case;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.empty_trash(text, uuid[]) from public, anon;
grant execute on function public.empty_trash(text, uuid[]) to authenticated;
