-- =====================================================================
-- 46 Öffentliche Freigabe härten (#94, E42; Funde der Sicherheitsprüfung vom 23.10.2026)
--
--   1. KI-Zugänge ändern keine freigegebene Notiz. Migration 45 hielt die KI nur aus note_shares
--      heraus („die KI sieht keine Freigaben“) – über update_note/attach_file konnte sie aber
--      Inhalt an eine freigegebene Notiz hängen, der dann über den öffentlichen Link lesbar
--      wäre (z. B. nach einer Prompt-Injection). Jetzt gilt: Anfragen ohne zweiten Faktor (also
--      KI-Tokens, aal1) dürfen bei einer Notiz mit aktiver Freigabe weder den Titel (öffentlich)
--      ändern noch Blöcke anlegen, ändern oder löschen (Inhalt samt Bildern und Dateien). Andere
--      Eigenschaften (Typ, Bereich, Thema, Tags …) sind nicht öffentlich und bleiben änderbar –
--      sonst scheiterten auch Folgeänderungen per Trigger (Projekt wechselt den Bereich). Die
--      KI-Werkzeuge lehnen eine freigegebene Notiz schon vorher ganz ab (gleiche Meldung).
--      Die App (aal2), Migrationen und das Wiederherstellen (als Eigentümer) bleiben unberührt.
--      Prüfung über note_share_active(note_id): security definer (die KI sieht note_shares nicht),
--      stable, nur eigene Notizen, nur für aal2 oder einen freigegebenen KI-Zugang, nur boolean –
--      auch für „fetch“ (Hinweis „öffentlich freigegeben“).
--   2. shared_note gibt den Inhalt nur noch über eine Positivliste zurück (shared_block_content):
--      Absatz mit Art, Text mit den bekannten Marken und Attributen, Zeilenumbruch, Tag, Bild,
--      Datei, Diagramm, Verweis ohne Ziel. Alles Unbekannte fällt weg (vorher: alles außer dem
--      Ziel von Verweisen).
--   Rein additiv bzw. Funktionen ersetzt; keine Daten geändert.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ist die Notiz gerade öffentlich freigegeben? (nur eigene, nur aal2 oder KI-Zugang)
-- ---------------------------------------------------------------------
create function public.note_share_active(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    ((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed()))
    and exists (
      select 1
      from public.note_shares s
      join public.notes n on n.id = s.note_id and n.user_id = s.user_id
      where s.note_id = p_note_id
        and s.user_id = (select auth.uid())
        and s.revoked_at is null
        and s.deleted_at is null
    ),
    false
  )
$$;
revoke execute on function public.note_share_active(uuid) from public, anon;
grant execute on function public.note_share_active(uuid) to authenticated;

-- Sperre für Anfragen ohne zweiten Faktor (KI-Tokens): Titel und Blöcke freigegebener Notizen
create function public.note_shares_guard_ai()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- nur über die API ohne aal2; Eigentümer (Migration, Wiederherstellen) und App unberührt
  if current_user = 'authenticated'
     and coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
    if tg_table_name = 'notes' then
      if public.note_share_active(old.id) then
        raise exception 'Diese Notiz ist öffentlich freigegeben – die KI kann sie nicht ändern. Der Nutzer ändert sie in der App oder beendet die Freigabe.'
          using errcode = '42501';
      end if;
    else
      if (tg_op <> 'INSERT' and public.note_share_active(old.note_id))
         or (tg_op <> 'DELETE' and public.note_share_active(new.note_id)) then
        raise exception 'Diese Notiz ist öffentlich freigegeben – die KI kann sie nicht ändern. Der Nutzer ändert sie in der App oder beendet die Freigabe.'
          using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.note_shares_guard_ai() from public, anon;

create trigger notes_guard_shared before update of title on public.notes
  for each row when (old.title is distinct from new.title)
  execute function public.note_shares_guard_ai();
create trigger note_blocks_guard_shared before insert or update or delete on public.note_blocks
  for each row execute function public.note_shares_guard_ai();

-- ---------------------------------------------------------------------
-- 2. Inhalt eines Blocks für die öffentliche Seite – nur Bekanntes (Positivliste)
--    Knoten/Marken wie im Editor (outliner/model/names.ts, text-style.ts, StarterKit):
--    paragraph{kind}, text{marks: bold, italic, strike, code, link{href}, textColor{color},
--    marker{color}}, hardBreak, tag{name}, noteImage{path, alt, width},
--    noteFile{path, name, mime, size, view}, mermaid{code}, noteLink (ohne Ziel).
-- ---------------------------------------------------------------------
create function public.shared_block_content(p_content jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'type', 'paragraph',
    'attrs', case
      when p_content -> 'attrs' ->> 'kind' in ('h1', 'h2', 'h3', 'quote', 'callout', 'divider')
        then jsonb_build_object('kind', p_content -> 'attrs' ->> 'kind')
    end,
    'content', case
      when jsonb_typeof(p_content -> 'content') = 'array' then (
        select coalesce(jsonb_agg(x.node order by x.position), '[]'::jsonb)
        from (
          select i.position, case i.node ->> 'type'
            when 'text' then case
              when jsonb_typeof(i.node -> 'text') = 'string' then jsonb_build_object(
                'type', 'text',
                'text', i.node -> 'text',
                'marks', (
                  select jsonb_agg(m.mark order by m.position)
                  from (
                    select k.position, case k.mark ->> 'type'
                      when 'bold' then jsonb_build_object('type', 'bold')
                      when 'italic' then jsonb_build_object('type', 'italic')
                      when 'strike' then jsonb_build_object('type', 'strike')
                      when 'code' then jsonb_build_object('type', 'code')
                      when 'link' then case
                        when jsonb_typeof(k.mark -> 'attrs' -> 'href') = 'string'
                          then jsonb_build_object(
                            'type', 'link',
                            'attrs', jsonb_build_object('href', k.mark -> 'attrs' -> 'href')
                          )
                      end
                      when 'textColor' then case
                        when k.mark -> 'attrs' ->> 'color'
                          in ('grau', 'rot', 'orange', 'gelb', 'gruen', 'blau', 'lila')
                          then jsonb_build_object(
                            'type', 'textColor',
                            'attrs', jsonb_build_object('color', k.mark -> 'attrs' ->> 'color')
                          )
                      end
                      when 'marker' then jsonb_build_object(
                        'type', 'marker',
                        'attrs', jsonb_build_object('color', case
                          when k.mark -> 'attrs' ->> 'color' in ('gelb', 'gruen', 'blau', 'rot', 'lila')
                            then k.mark -> 'attrs' ->> 'color'
                          else 'gelb'
                        end)
                      )
                    end as mark
                    from jsonb_array_elements(case
                      when jsonb_typeof(i.node -> 'marks') = 'array' then i.node -> 'marks'
                      else '[]'::jsonb
                    end) with ordinality as k (mark, position)
                  ) m
                  where m.mark is not null
                )
              )
            end
            when 'hardBreak' then jsonb_build_object('type', 'hardBreak')
            when 'noteLink' then jsonb_build_object('type', 'noteLink')
            when 'tag' then case
              when jsonb_typeof(i.node -> 'attrs' -> 'name') = 'string' then jsonb_build_object(
                'type', 'tag',
                'attrs', jsonb_build_object('name', i.node -> 'attrs' -> 'name')
              )
            end
            when 'noteImage' then case
              when jsonb_typeof(i.node -> 'attrs' -> 'path') = 'string' then jsonb_build_object(
                'type', 'noteImage',
                'attrs', jsonb_build_object(
                  'path', i.node -> 'attrs' -> 'path',
                  'alt', case
                    when jsonb_typeof(i.node -> 'attrs' -> 'alt') = 'string'
                      then i.node -> 'attrs' -> 'alt'
                  end,
                  'width', case
                    when jsonb_typeof(i.node -> 'attrs' -> 'width') = 'number'
                      then i.node -> 'attrs' -> 'width'
                  end
                )
              )
            end
            when 'noteFile' then case
              when jsonb_typeof(i.node -> 'attrs' -> 'path') = 'string' then jsonb_build_object(
                'type', 'noteFile',
                'attrs', jsonb_build_object(
                  'path', i.node -> 'attrs' -> 'path',
                  'name', case
                    when jsonb_typeof(i.node -> 'attrs' -> 'name') = 'string'
                      then i.node -> 'attrs' -> 'name'
                  end,
                  'mime', case
                    when jsonb_typeof(i.node -> 'attrs' -> 'mime') = 'string'
                      then i.node -> 'attrs' -> 'mime'
                  end,
                  'size', case
                    when jsonb_typeof(i.node -> 'attrs' -> 'size') = 'number'
                      then i.node -> 'attrs' -> 'size'
                  end,
                  'view', case
                    when i.node -> 'attrs' ->> 'view' in ('tile', 'full')
                      then i.node -> 'attrs' -> 'view'
                  end
                )
              )
            end
            when 'mermaid' then case
              when jsonb_typeof(i.node -> 'attrs' -> 'code') = 'string' then jsonb_build_object(
                'type', 'mermaid',
                'attrs', jsonb_build_object('code', i.node -> 'attrs' -> 'code')
              )
            end
          end as node
          from jsonb_array_elements(p_content -> 'content') with ordinality as i (node, position)
        ) x
        where x.node is not null
      )
    end
  ))
$$;
revoke execute on function public.shared_block_content(jsonb) from public, anon, authenticated;

-- shared_note wie in Migration 45, der Inhalt jetzt nur über die Positivliste
create or replace function public.shared_note(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', n.title,
    'blocks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'parent_id', b.parent_id,
          'sort', b.sort,
          'collapsed', b.collapsed,
          'content', public.shared_block_content(b.content),
          -- Block → Aufgabe: nur erledigt ja/nein, nichts von der Aufgabe selbst
          'task_done', case
            when b.task_id is null then null
            else exists (
              select 1 from public.tasks t
              where t.id = b.task_id
                and t.user_id = n.user_id
                and t.deleted_at is null
                and t.status = 'erledigt'
            )
          end
        )
        order by b.sort, b.id
      )
      from public.note_blocks b
      where b.note_id = n.id and b.user_id = n.user_id and b.deleted_at is null
    ), '[]'::jsonb)
  )
  from public.note_shares s
  join public.notes n on n.id = s.note_id and n.user_id = s.user_id
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and s.token = p_token
    and s.revoked_at is null
    and s.deleted_at is null
    and n.deleted_at is null
$$;
revoke execute on function public.shared_note(text) from public, anon;
grant execute on function public.shared_note(text) to anon, authenticated;
