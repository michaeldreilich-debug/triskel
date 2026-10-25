-- =====================================================================
-- 08 Suche: deutsche Volltextsuche (tsvector, Präfix) + Trigramm (Teilwörter, Komposita)
-- „Prüfungen“ findet „Prüfung“ (Stemming), „Atemschutz“ findet „Atemschutzgerät“ (Präfix),
-- „schutz“ findet „Atemschutzgerät“ (Trigramm/ILIKE).
-- =====================================================================

alter table public.tasks
  add column search tsvector generated always as (
    setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A')
    || setweight(to_tsvector('german'::regconfig, coalesce(body_text, '')), 'B')
  ) stored;

alter table public.projects
  add column search tsvector generated always as (
    setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A')
    || setweight(to_tsvector('german'::regconfig, coalesce(why, '')), 'B')
  ) stored;

alter table public.notes
  add column search tsvector generated always as (
    setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A')
  ) stored;

alter table public.note_blocks
  add column search tsvector generated always as (
    to_tsvector('german'::regconfig, coalesce(content_text, ''))
  ) stored;

alter table public.recaps
  add column search tsvector generated always as (
    jsonb_to_tsvector('german'::regconfig, answers, '["string"]'::jsonb)
    || jsonb_to_tsvector('german'::regconfig, focus_next, '["string"]'::jsonb)
  ) stored;

create index tasks_search_idx on public.tasks using gin (search);
create index projects_search_idx on public.projects using gin (search);
create index notes_search_idx on public.notes using gin (search);
create index note_blocks_search_idx on public.note_blocks using gin (search);
create index recaps_search_idx on public.recaps using gin (search);

create index tasks_title_trgm_idx on public.tasks using gin (title extensions.gin_trgm_ops);
create index projects_title_trgm_idx on public.projects using gin (title extensions.gin_trgm_ops);
create index notes_title_trgm_idx on public.notes using gin (title extensions.gin_trgm_ops);
create index note_blocks_text_trgm_idx on public.note_blocks
  using gin (content_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- search_all: eine Trefferliste über Aufgaben, Projekte, Notizen (inkl. Blöcke) und Rückblicke
-- ---------------------------------------------------------------------
create or replace function public.search_all(p_query text, p_area_id uuid default null)
returns table (kind text, id uuid, title text, snippet text, rank real)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_ts tsquery;
  v_like text;
begin
  if char_length(v_q) < 2 then
    return;
  end if;

  -- jedes Wort als Präfix-Suche, mit UND verknüpft
  select to_tsquery('german'::regconfig, string_agg(quote_literal(w) || ':*', ' & '))
    into v_ts
    from regexp_split_to_table(lower(v_q), '[^[:alnum:]äöüß]+') as w
   where w <> '';

  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select s.kind, s.id, s.title, s.snippet, s.rank
    from (
      select
        'aufgabe'::text as kind, t.id, t.title, left(t.body_text, 160) as snippet,
        (coalesce(ts_rank(t.search, v_ts), 0) + extensions.similarity(t.title, v_q))::real as rank
      from public.tasks t
      where t.deleted_at is null
        and (p_area_id is null or t.area_id = p_area_id)
        and ((v_ts is not null and t.search @@ v_ts) or t.title ilike v_like)

      union all

      select
        'projekt'::text, p.id, p.title, left(p.why, 160),
        (coalesce(ts_rank(p.search, v_ts), 0) + extensions.similarity(p.title, v_q))::real
      from public.projects p
      where p.deleted_at is null
        and (p_area_id is null or p.area_id = p_area_id)
        and ((v_ts is not null and p.search @@ v_ts) or p.title ilike v_like)

      union all

      select
        'notiz'::text, n.id, n.title, coalesce(left(b.content_text, 160), ''),
        (greatest(coalesce(ts_rank(n.search, v_ts), 0), coalesce(b.block_rank, 0))
          + extensions.similarity(n.title, v_q))::real
      from public.notes n
      left join lateral (
        select nb.content_text, coalesce(ts_rank(nb.search, v_ts), 0) as block_rank
          from public.note_blocks nb
         where nb.note_id = n.id
           and nb.deleted_at is null
           and ((v_ts is not null and nb.search @@ v_ts) or nb.content_text ilike v_like)
         order by 2 desc
         limit 1
      ) b on true
      where n.deleted_at is null
        and (p_area_id is null or n.area_id = p_area_id)
        and (
          (v_ts is not null and n.search @@ v_ts)
          or n.title ilike v_like
          or b.content_text is not null
          or exists (select 1 from unnest(n.tags) as tg where tg ilike v_like)
        )

      union all

      select
        'rueckblick'::text, r.id,
        case r.kind when 'woche' then 'Wochenrückblick ' else 'Monatsrückblick ' end
          || to_char(r.period_start, 'DD.MM.YYYY'),
        left(coalesce(r.answers ->> 'good', ''), 160),
        coalesce(ts_rank(r.search, v_ts), 0)::real
      from public.recaps r
      where r.deleted_at is null
        and v_ts is not null
        and r.search @@ v_ts
    ) s
   order by s.rank desc, s.title asc
   limit 50;
end;
$$;
revoke execute on function public.search_all(text, uuid) from public, anon;
grant execute on function public.search_all(text, uuid) to authenticated;
