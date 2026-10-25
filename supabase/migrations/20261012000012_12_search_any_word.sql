-- =====================================================================
-- 12 Suche mit mehreren Wörtern: ein Wort reicht für einen Treffer (Rückmeldung #19)
--   Bisher mussten alle Wörter im selben Eintrag stehen – „digitale Software“ fand weder das
--   Projekt „Digitale Werkstatt“ noch die Aufgabe „Demo Werkstatt software ablauf“. Jetzt zählt
--   jedes Wort (Präfix, Stemming, Teilwort); Einträge mit allen Wörtern stehen oben.
--   Wörter unter 2 Zeichen zählen nicht (sonst passt „Plan B“ auf fast alles).
-- =====================================================================

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
  v_likes text[];  -- je Wort '%wort%' für Teilwörter; Sonderzeichen sind schon abgetrennt
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
         array_agg('%' || w || '%')
    into v_any, v_all, v_likes
    from unnest(v_words) as w;

  return query
  select s.kind, s.id, s.title, s.snippet, s.rank
    from (
      select
        'aufgabe'::text as kind, t.id, t.title, left(t.body_text, 160) as snippet,
        (coalesce(ts_rank(t.search, v_any), 0) + extensions.similarity(t.title, v_q)
          + case when t.search @@ v_all or t.title ilike all (v_likes) then 1 else 0 end
        )::real as rank
      from public.tasks t
      where t.deleted_at is null
        and (p_area_id is null or t.area_id = p_area_id)
        and (t.search @@ v_any or t.title ilike any (v_likes))

      union all

      select
        'projekt'::text, p.id, p.title, left(p.why, 160),
        (coalesce(ts_rank(p.search, v_any), 0) + extensions.similarity(p.title, v_q)
          + case when p.search @@ v_all or p.title ilike all (v_likes) then 1 else 0 end
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
          + case when n.search @@ v_all or n.title ilike all (v_likes) or coalesce(b.block_all, false)
              then 1 else 0 end
        )::real
      from public.notes n
      left join lateral (
        select nb.content_text,
               coalesce(ts_rank(nb.search, v_any), 0) as block_rank,
               (nb.search @@ v_all or nb.content_text ilike all (v_likes)) as block_all
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
        case r.kind when 'woche' then 'Wochenrückblick ' else 'Monatsrückblick ' end
          || to_char(r.period_start, 'DD.MM.YYYY'),
        left(coalesce(r.answers ->> 'good', ''), 160),
        (coalesce(ts_rank(r.search, v_any), 0)
          + case when r.search @@ v_all then 1 else 0 end)::real
      from public.recaps r
      where r.deleted_at is null
        and r.search @@ v_any
    ) s
   order by s.rank desc, s.title asc
   limit 50;
end;
$$;
revoke execute on function public.search_all(text, uuid) from public, anon;
grant execute on function public.search_all(text, uuid) to authenticated;
