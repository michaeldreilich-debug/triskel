-- =====================================================================
-- 29 Suche nach kurzen Tags, Rückgängig beim Löschen eines Notiz-Typs (Code-Review Oktober 2026,
--    T-5 und D-13):
--   * search_all: Tags (notes.tags) und Themen (recaps.themes) stehen in keiner Such-Spalte und
--     wurden nur als Teilwort ab 3 Zeichen gefunden. Eine Notiz mit Tag „ki“ fand weder ⌘K noch
--     das KI-Werkzeug „search“. Jetzt zählt jedes Wort ab 2 Zeichen auch als Wortanfang eines
--     Tags bzw. Themas (wie bei Titeln und Inhalt seit Migration 17). Sonst unverändert.
--   * delete_note_type merkt sich in note_types.moved, welche Notizen (auch im Papierkorb) und
--     Vorlagen in den Zieltyp gezogen sind. restore_note_type holt sie zurück – bisher kamen nur
--     die Notizen zurück, die die App gerade geladen hatte; Vorlagen und Papierkorb-Notizen
--     blieben beim Zieltyp.
--   Additiv: eine neue Spalte (nullable), zwei Funktionen ersetzt, keine Daten geändert.
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
  v_likes text[];  -- je Wort ab 3 Zeichen '%wort%' für Teilwörter; Sonderzeichen sind abgetrennt
  v_starts text[]; -- je Wort ab 2 Zeichen 'wort%': Tags und Themen als Wortanfang (T-5)
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
         coalesce(array_agg('%' || w || '%') filter (where char_length(w) >= 3), '{}'),
         array_agg(w || '%')
    into v_any, v_all, v_likes, v_starts
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
          -- Tags: Teilwort ab 3 Zeichen, Wortanfang schon ab 2 („ki“, „eu“ – T-5)
          or exists (
            select 1 from unnest(n.tags) as tg
             where tg ilike any (v_likes) or lower(tg) like any (v_starts)
          )
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
          or exists (
            select 1 from unnest(r.themes) as th
             where th ilike any (v_likes) or lower(th) like any (v_starts)
          )
        )
    ) s
   order by s.rank desc, s.title asc
   limit 50;
end;
$$;
revoke execute on function public.search_all(text, uuid) from public, anon;
grant execute on function public.search_all(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Notiz-Typ löschen: Umgezogenes merken, damit Rückgängig es vollständig zurückholt (D-13)
-- ---------------------------------------------------------------------
alter table public.note_types add column moved jsonb;
comment on column public.note_types.moved is
  'Beim Löschen umgezogen: {"target": Schlüssel, "notes": [IDs], "templates": [IDs]} – für restore_note_type';

create or replace function public.delete_note_type(p_key text, p_target text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notes uuid[];
  v_templates uuid[];
begin
  if p_key = 'idee' then
    raise exception 'Der Standardtyp „Idee“ lässt sich nur umbenennen.' using errcode = '22023';
  end if;
  if p_target = p_key then
    raise exception 'Zieltyp und gelöschter Typ sind gleich.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.note_types where key = p_target and deleted_at is null
  ) then
    raise exception 'Zieltyp % fehlt.', p_target using errcode = '22023';
  end if;
  -- auch Notizen im Papierkorb: wiederhergestellt sollen sie einen gültigen Typ haben
  with moved as (
    update public.notes set type = p_target where type = p_key returning id
  )
  select coalesce(array_agg(id), '{}') into v_notes from moved;
  with moved as (
    update public.templates set note_type = p_target where note_type = p_key returning id
  )
  select coalesce(array_agg(id), '{}') into v_templates from moved;
  update public.note_types
     set deleted_at = now(),
         moved = jsonb_build_object(
           'target', p_target, 'notes', to_jsonb(v_notes), 'templates', to_jsonb(v_templates))
   where key = p_key and deleted_at is null;
end;
$$;
revoke execute on function public.delete_note_type(text, text) from public, anon;
grant execute on function public.delete_note_type(text, text) to authenticated;

-- Rückgängig: Typ zurück, die genannten Notizen und alles beim Löschen Umgezogene, das noch
-- beim Zieltyp steht (was der Nutzer seitdem selbst umgestellt hat, bleibt)
create or replace function public.restore_note_type(p_key text, p_note_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_moved jsonb;
begin
  select t.moved into v_moved from public.note_types t where t.key = p_key;
  update public.note_types set deleted_at = null, moved = null where key = p_key;
  update public.notes set type = p_key where id = any (coalesce(p_note_ids, '{}'));
  if v_moved is not null then
    update public.notes
       set type = p_key
     where type = v_moved ->> 'target'
       and id in (select e::uuid from jsonb_array_elements_text(v_moved -> 'notes') as e);
    update public.templates
       set note_type = p_key
     where note_type = v_moved ->> 'target'
       and id in (select e::uuid from jsonb_array_elements_text(v_moved -> 'templates') as e);
  end if;
end;
$$;
revoke execute on function public.restore_note_type(text, uuid[]) from public, anon;
grant execute on function public.restore_note_type(text, uuid[]) to authenticated;
