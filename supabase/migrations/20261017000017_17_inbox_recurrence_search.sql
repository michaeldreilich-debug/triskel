-- =====================================================================
-- 17 Kleinkram (E24)
--   * complete_task: Die Folgeinstanz einer wiederkehrenden Aufgabe übernimmt in_inbox – auch
--     Inbox-Aufgaben (ohne Bereich) können sich wiederholen (bisher in der Oberfläche gesperrt,
--     weil die Folgeinstanz außerhalb der Inbox ohne Bereich gegen tasks_area_required verstieß).
--   * search_all: Teilwort-Treffer (mitten im Wort) erst ab 3 Zeichen; Wörter mit 2 Zeichen zählen
--     weiter als Wortanfang (Volltext-Präfix). Rückblicke: Titel mit Kalenderwoche wie in der App,
--     Themen und Muster sind durchsuchbar.
-- =====================================================================

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
      v_task.duration_min, v_task.recurrence, v_task.id, null, v_task.in_inbox,
      v_task.sort || 'V'
    );
  end if;

  return jsonb_build_object('completed_id', v_task.id, 'next_id', v_next_id);
end;
$$;
revoke execute on function public.complete_task(uuid, date, uuid) from public, anon;
grant execute on function public.complete_task(uuid, date, uuid) to authenticated;

create or replace function public.search_all(p_query text, p_area_id uuid default null)
returns table (kind text, id uuid, title text, snippet text, rank real)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_words text[];
  v_any tsquery;   -- mindestens ein Wort (Präfix)
  v_all tsquery;   -- alle Wörter (Präfix)
  v_likes text[];  -- je Wort ab 3 Zeichen '%wort%' für Teilwörter; Sonderzeichen sind abgetrennt
  v_has_likes boolean;
begin
  select array_agg(distinct w)
    into v_words
    from regexp_split_to_table(lower(v_q), '[^[:alnum:]äöüß]+') as w
   where char_length(w) >= 2;
  if v_words is null then
    return;
  end if;

  select to_tsquery('german'::regconfig, string_agg(quote_literal(w) || ':*', ' | ')),
         to_tsquery('german'::regconfig, string_agg(quote_literal(w) || ':*', ' & ')),
         -- Teilwort (mitten im Wort) erst ab 3 Zeichen, sonst passt „ab“ auf fast alles (E24)
         coalesce(array_agg('%' || w || '%') filter (where char_length(w) >= 3), '{}')
    into v_any, v_all, v_likes
    from unnest(v_words) as w;
  v_has_likes := cardinality(v_likes) > 0;

  return query
  select s.kind, s.id, s.title, s.snippet, s.rank
    from (
      select
        'aufgabe'::text as kind, t.id, t.title, left(t.body_text, 160) as snippet,
        (coalesce(ts_rank(t.search, v_any), 0) + extensions.similarity(t.title, v_q)
          + case when t.search @@ v_all or (v_has_likes and t.title ilike all (v_likes)) then 1 else 0 end
        )::real as rank
      from public.tasks t
      where t.deleted_at is null
        and (p_area_id is null or t.area_id = p_area_id)
        and (t.search @@ v_any or t.title ilike any (v_likes))

      union all

      select
        'projekt'::text, p.id, p.title, left(p.why, 160),
        (coalesce(ts_rank(p.search, v_any), 0) + extensions.similarity(p.title, v_q)
          + case when p.search @@ v_all or (v_has_likes and p.title ilike all (v_likes)) then 1 else 0 end
        )::real
      from public.projects p
      where p.deleted_at is null
        and (p_area_id is null or p.area_id = p_area_id)
        and (p.search @@ v_any or p.title ilike any (v_likes))

      union all

      select
        'notiz'::text, n.id, n.title, coalesce(left(b.content_text, 160), ''),
        (greatest(coalesce(ts_rank(n.search, v_any), 0), coalesce(b.block_rank, 0))
          + extensions.similarity(n.title, v_q)
          + case when n.search @@ v_all or (v_has_likes and n.title ilike all (v_likes)) or coalesce(b.block_all, false)
              then 1 else 0 end
        )::real
      from public.notes n
      left join lateral (
        select nb.content_text,
               coalesce(ts_rank(nb.search, v_any), 0) as block_rank,
               (nb.search @@ v_all or (v_has_likes and nb.content_text ilike all (v_likes))) as block_all
          from public.note_blocks nb
         where nb.note_id = n.id
           and nb.deleted_at is null
           and (nb.search @@ v_any or nb.content_text ilike any (v_likes))
         order by 3 desc, 2 desc
         limit 1
      ) b on true
      where n.deleted_at is null
        and (p_area_id is null or n.area_id = p_area_id)
        and (
          n.search @@ v_any
          or n.title ilike any (v_likes)
          or b.content_text is not null
          or exists (select 1 from unnest(n.tags) as tg where tg ilike any (v_likes))
        )

      union all

      select
        'rueckblick'::text, r.id,
        case r.kind
          when 'woche' then 'Wochenrückblick KW ' || to_char(r.period_start, 'IW')::int
          else 'Monatsrückblick ' || to_char(r.period_start, 'MM/YYYY')
        end,
        left(coalesce(nullif(r.answers ->> 'good', ''), array_to_string(r.themes, ' '), ''), 160),
        (coalesce(ts_rank(r.search, v_any), 0)
          + case when r.search @@ v_all then 1 else 0 end)::real
      from public.recaps r
      where r.deleted_at is null
        and (
          r.search @@ v_any
          -- Themen und Muster (B12) wie Notiz-Tags
          or exists (select 1 from unnest(r.themes) as th where th ilike any (v_likes))
        )
    ) s
   order by s.rank desc, s.title asc
   limit 50;
end;
$$;
revoke execute on function public.search_all(text, uuid) from public, anon;
grant execute on function public.search_all(text, uuid) to authenticated;
