-- =====================================================================
-- 20 KI-Protokoll (#33, E27): Was Claude oder ChatGPT über die MCP-Schnittstelle angelegt oder
--   geändert hat – je Schreibaktion eine Zeile. Die Schnittstelle schreibt mit dem OAuth-Token
--   des Nutzers (Supabase OAuth-Server, Claim client_id), RLS und MFA-Pflicht gelten wie überall.
--   „undo“ hält fest, was sich zurückholen lässt (z. B. beim Ersetzen eines Notiz-Inhalts die
--   alten, nur soft-gelöschten Block-IDs); „undone_at“ markiert, dass es zurückgeholt wurde.
-- =====================================================================

create table public.ai_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- OAuth-Client aus dem Token (Name zeigt die App über die erteilten Zugänge an)
  client_id text not null default '' check (char_length(client_id) <= 200),
  tool text not null check (char_length(tool) between 1 and 100),
  entity text not null
    check (entity in ('notiz', 'aufgabe', 'projekt', 'meilenstein', 'thema')),
  entity_id uuid,
  summary text not null default '' check (char_length(summary) <= 1000),
  undo jsonb check (undo is null or jsonb_typeof(undo) = 'object'),
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.ai_activity enable row level security;
create policy ai_activity_select on public.ai_activity for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_activity_insert on public.ai_activity for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy ai_activity_update on public.ai_activity for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ai_activity_delete on public.ai_activity for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_activity_aal2 on public.ai_activity as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
revoke all on table public.ai_activity from anon;
grant select, insert, update, delete on table public.ai_activity to authenticated;

create trigger ai_activity_updated_at before update on public.ai_activity
  for each row execute function public.set_updated_at();
create index ai_activity_user_idx on public.ai_activity (user_id, created_at desc)
  where deleted_at is null;
create index ai_activity_entity_idx on public.ai_activity (entity_id);
