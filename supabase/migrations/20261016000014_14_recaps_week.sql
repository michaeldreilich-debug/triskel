-- =====================================================================
-- 14 Wochenrückblick (B12, E24)
--   * recaps.questions: Leitfragen als Schnappschuss beim Anlegen. Ändert sich die Vorlage (B11),
--     zeigt ein alter Rückblick weiter seine Fragen. Eigene Spalte statt in answers, damit die
--     Fragetexte nicht in der Suche landen (answers ist durchsuchbar).
--   * week_stats: zusätzlich der Tagesverlauf je Tag (activity): erledigte Aufgaben, erreichte
--     Meilensteine, neue und bearbeitete Notizen. close_recap speichert ihn mit im Snapshot, ein
--     abgeschlossener Rückblick bleibt damit stabil. „Bearbeitet“ ist der letzte Stand (es gibt
--     keine Änderungsgeschichte): eine Notiz zählt an dem Tag, an dem sie zuletzt geändert wurde.
-- =====================================================================

alter table public.recaps
  add column questions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(questions) = 'array');


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
    select t.id, t.title, t.area_id, t.project_id, t.completed_at,
           (t.completed_at at time zone 'Europe/Berlin')::date as day
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
  ),
  reached as (
    select m.id, m.title, m.project_id, m.done_at,
           (m.done_at at time zone 'Europe/Berlin')::date as day
      from public.milestones m
     where m.deleted_at is null
       and m.done_at >= v_from
       and m.done_at < v_to
  ),
  note_times as (
    select n.id, n.title, n.area_id, n.created_at,
           greatest(
             n.updated_at,
             coalesce((select max(b.updated_at) from public.note_blocks b where b.note_id = n.id),
                      n.updated_at)
           ) as edited_at
      from public.notes n
     where n.deleted_at is null
  ),
  notes_new as (
    select nt.id, nt.title, nt.area_id, nt.created_at,
           (nt.created_at at time zone 'Europe/Berlin')::date as day
      from note_times nt
     where nt.created_at >= v_from and nt.created_at < v_to
  ),
  notes_edited as (
    select nt.id, nt.title, nt.area_id, nt.edited_at,
           (nt.edited_at at time zone 'Europe/Berlin')::date as day
      from note_times nt
     where nt.edited_at >= v_from and nt.edited_at < v_to
       -- am selben Tag angelegt zählt als „neu“, nicht zusätzlich als „bearbeitet“
       and (nt.created_at at time zone 'Europe/Berlin')::date
           < (nt.edited_at at time zone 'Europe/Berlin')::date
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
    'milestones_done', (select count(*) from reached),
    'notes_created', (select count(*) from notes_new),
    'focus_days', jsonb_build_object(
      'achieved', (select count(*) from focus f where f.planned > 0 and f.done = f.planned),
      'planned', (select count(*) from focus f where f.planned > 0),
      'days', (select jsonb_agg(jsonb_build_object('date', f.day, 'planned', f.planned, 'done', f.done)
                                order by f.day)
                 from focus f)
    ),
    'activity', (
      select jsonb_agg(
               jsonb_build_object(
                 'date', dd.day,
                 'done', coalesce(
                   (select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title,
                                                        'area_id', d.area_id,
                                                        'project_id', d.project_id,
                                                        'at', d.completed_at)
                                     order by d.completed_at)
                      from done d where d.day = dd.day),
                   '[]'::jsonb),
                 'milestones', coalesce(
                   (select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title,
                                                        'project_id', r.project_id,
                                                        'at', r.done_at)
                                     order by r.done_at)
                      from reached r where r.day = dd.day),
                   '[]'::jsonb),
                 'notes_created', coalesce(
                   (select jsonb_agg(jsonb_build_object('id', nn.id, 'title', nn.title,
                                                        'area_id', nn.area_id,
                                                        'at', nn.created_at)
                                     order by nn.created_at)
                      from notes_new nn where nn.day = dd.day),
                   '[]'::jsonb),
                 'notes_edited', coalesce(
                   (select jsonb_agg(jsonb_build_object('id', ne.id, 'title', ne.title,
                                                        'area_id', ne.area_id,
                                                        'at', ne.edited_at)
                                     order by ne.edited_at)
                      from notes_edited ne where ne.day = dd.day),
                   '[]'::jsonb)
               )
               order by dd.day
             )
        from days dd
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
