-- =====================================================================
-- 45 Notiz öffentlich per Link freigeben (#94, E42, docs/konzept-freigabe.md). Rückmeldung 23.10.:
--   „einmal Link kopieren für die Öffentlichkeit … nicht die Eigenschaften, sondern nur die Seite“.
--
--   * Eine Zeile = eine Freigabe einer Notiz mit einem nicht erratbaren Token (32 Zufallsbytes,
--     base64url = 43 Zeichen, Format per check). Höchstens eine aktive Freigabe je Notiz;
--     „Beenden“ setzt revoked_at (mit Rückgängig), neues Freigeben erzeugt einen neuen Token –
--     ein alter Link bleibt tot.
--   * Die Tabelle selbst ist wie jede andere: RLS auf den eigenen Nutzer, aal2, Grants nur an
--     authenticated, nie an anon. Die KI sieht sie nicht (nicht in AI_TABLES): sie kann nichts
--     öffentlich machen.
--   * Eine Freigabe zeigt immer auf eine eigene Notiz (Trigger note_shares_own_note) – sonst
--     könnte ein zweites Konto über einen Fremdschlüssel eine fremde Notiz „freigeben“.
--   * Lesen ohne Anmeldung NUR über zwei security-definer-Funktionen (einzige Ausnahme von
--     „nichts an anon“, eng im Audit erlaubt: PUBLIC_RPC_ALLOWLIST). Beide sind `stable` (lesen
--     nur), prüfen das Token-Format, verlangen eine aktive Freigabe einer nicht gelöschten Notiz
--     desselben Nutzers und lesen nur dessen nicht gelöschte Blöcke:
--       - shared_note(token) → {title, blocks: [{id, parent_id, sort, collapsed, content,
--         task_done}]} oder null. Keine Eigenschaften (Typ, Bereich, Thema, Projekt, Tags,
--         Daten), kein content_text (enthielte Titel verlinkter Notizen); Verweise auf andere
--         Notizen verlieren ihre Ziel-ID (`{"type": "noteLink"}`).
--       - shared_note_file(token, pfad) → Bucket („note-images“ bzw. „attachments“) oder null –
--         nur für einen Pfad im Ordner des Besitzers, der in einem nicht gelöschten Block der
--         Notiz als Bild bzw. Datei steht. Die Route /api/freigabe/<token>/datei signiert dann
--         einen kurzlebigen R2-Link (5 min), wie die App selbst.
--   * Notiz im Papierkorb → beide liefern null (die Freigabe ruht), zurückgeholt → wieder aktiv;
--     endgültig gelöscht → die Freigabe geht mit (on delete cascade).
--   Rein additiv: neue Tabelle und Funktionen, keine Daten geändert.
-- =====================================================================

create table public.note_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  deleted_at timestamptz,
  constraint note_shares_token_unique unique (token),
  constraint note_shares_token_format check (token ~ '^[A-Za-z0-9_-]{43}$')
);

alter table public.note_shares enable row level security;
create policy note_shares_select on public.note_shares for select to authenticated
  using ((select auth.uid()) = user_id);
create policy note_shares_insert on public.note_shares for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy note_shares_update on public.note_shares for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy note_shares_delete on public.note_shares for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy note_shares_aal2 on public.note_shares as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
revoke all on table public.note_shares from anon;
grant select, insert, update, delete on table public.note_shares to authenticated;

create trigger note_shares_updated_at before update on public.note_shares
  for each row execute function public.set_updated_at();

-- höchstens eine aktive Freigabe je Notiz; beendete und gelöschte zählen nicht
create unique index note_shares_one_active on public.note_shares (note_id)
  where revoked_at is null and deleted_at is null;
create index note_shares_note_idx on public.note_shares (note_id);

-- nur eigene Notizen freigeben (läuft als der Nutzer: RLS auf notes sieht nur eigene)
create function public.note_shares_own_note()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.notes n where n.id = new.note_id and n.user_id = new.user_id
  ) then
    raise exception 'note_shares: Notiz gehört nicht zum Nutzer' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function public.note_shares_own_note() from public, anon;

create trigger note_shares_own_note before insert or update of note_id, user_id
  on public.note_shares
  for each row execute function public.note_shares_own_note();

-- ---------------------------------------------------------------------
-- Öffentliches Lesen (anon): Titel und Blöcke einer aktiv freigegebenen Notiz
-- ---------------------------------------------------------------------
create function public.shared_note(p_token text)
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
          -- Verweise auf andere Notizen ohne Ziel (die bleiben privat)
          'content', case
            when jsonb_typeof(b.content -> 'content') = 'array' then jsonb_set(
              b.content,
              '{content}',
              (
                select coalesce(
                  jsonb_agg(
                    case
                      when inline.node ->> 'type' = 'noteLink'
                        then jsonb_build_object('type', 'noteLink')
                      else inline.node
                    end
                    order by inline.position
                  ),
                  '[]'::jsonb
                )
                from jsonb_array_elements(b.content -> 'content')
                  with ordinality as inline (node, position)
              )
            )
            else b.content
          end,
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

-- Bucket einer Datei der freigegebenen Notiz – nur, was dort als Bild bzw. Datei im Inhalt steht
create function public.shared_note_file(p_token text, p_path text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when inline.node ->> 'type' = 'noteImage' then 'note-images' else 'attachments' end
  from public.note_shares s
  join public.notes n on n.id = s.note_id and n.user_id = s.user_id
  join public.note_blocks b
    on b.note_id = n.id and b.user_id = n.user_id and b.deleted_at is null
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(b.content -> 'content') = 'array' then b.content -> 'content'
      else '[]'::jsonb
    end
  ) as inline (node)
  where p_token ~ '^[A-Za-z0-9_-]{43}$'
    and s.token = p_token
    and s.revoked_at is null
    and s.deleted_at is null
    and n.deleted_at is null
    and char_length(p_path) <= 300
    and starts_with(p_path, n.user_id::text || '/')
    and inline.node ->> 'type' in ('noteImage', 'noteFile')
    and inline.node -> 'attrs' ->> 'path' = p_path
  order by (inline.node ->> 'type') = 'noteImage' desc
  limit 1
$$;
revoke execute on function public.shared_note_file(text, text) from public, anon;
grant execute on function public.shared_note_file(text, text) to anon, authenticated;
