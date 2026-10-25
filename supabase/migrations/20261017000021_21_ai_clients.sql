-- =====================================================================
-- 21 KI-Zugänge freigeben (#33, E27 Fall B): Der Supabase-OAuth-Server stellt Tokens immer mit
--   aal1 aus (amr „oauth_provider/authorization_code“), auch wenn der Nutzer mit TOTP erlaubt hat –
--   und erlauben lässt sich schon mit dem Passwort allein. Die MFA-Pflicht (Migration 13) würde
--   die KI deshalb ganz aussperren; sie bloß zu lockern hieße: Passwort genügt. Stattdessen:
--
--   * ai_clients: die freigegebenen KI-Zugänge (OAuth-Client-ID). Lesen und Ändern nur mit aal2
--     (Freigabe-Seite /ki-zugang trägt ein, Einstellungen › KI-Zugänge › „Trennen“ setzt
--     revoked_at) – die KI selbst kommt an diese Tabelle nicht heran.
--   * ai_client_allowed(): wahr nur für ein OAuth-Token (Claim client_id), dessen Client
--       - vom Nutzer mit aal2 freigegeben und nicht getrennt ist,
--       - vertraulich ist (Client-Geheimnis; öffentliche Clients zählen nie, auch nicht
--         freigegeben). Achtung (Code-Review 10/2026, S-2): Auch die Selbst-Registrierung (DCR)
--         kann vertrauliche Clients anlegen. Schutz: DCR in Prod aus, und /ki-zugang warnt bei
--         einem unbekannten Rücksprung-Ziel und verlangt dann eine ausdrückliche Bestätigung,
--       - und dessen Sitzung noch besteht (Trennen löscht sie → sofort gesperrt, auch bei einem
--         noch nicht abgelaufenen Token direkt gegen die Datenbank).
--     security definer, weil sie auth.oauth_clients/auth.sessions und ai_clients (aal2) liest;
--     normale Sitzungen der App tragen kein client_id → sofort false, ohne Zugriff auf auth.*.
--   * Die MFA-Policies der Inhalte, die die KI-Werkzeuge brauchen (und ihrer Trigger/RPCs), und
--     der zwei Buckets lassen zusätzlich solche Tokens zu: aal2 ODER freigegebener KI-Zugang.
--     Reines aal2 bleiben: user_settings, templates, saved_views und ai_clients.
--   * KI-Protokoll: die KI trägt ein und liest, ändern oder löschen nur mit aal2.
-- =====================================================================

create table public.ai_clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- OAuth-Client des Supabase-OAuth-Servers (auth.oauth_clients.id, Claim client_id)
  client_id uuid not null,
  name text not null default '' check (char_length(name) <= 200),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ai_clients_user_client_key unique (user_id, client_id)
);

alter table public.ai_clients enable row level security;
create policy ai_clients_select on public.ai_clients for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_clients_insert on public.ai_clients for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy ai_clients_update on public.ai_clients for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ai_clients_delete on public.ai_clients for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_clients_aal2 on public.ai_clients as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
revoke all on table public.ai_clients from anon;
grant select, insert, update, delete on table public.ai_clients to authenticated;

create trigger ai_clients_updated_at before update on public.ai_clients
  for each row execute function public.set_updated_at();

create function public.ai_client_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := auth.jwt();
  v_client text := v_claims ->> 'client_id';
  v_session text := v_claims ->> 'session_id';
begin
  -- Sitzungen der App (Login + TOTP) sind keine OAuth-Tokens: nichts weiter prüfen
  if coalesce(v_client, '') = '' or coalesce(v_session, '') = '' then
    return false;
  end if;
  return exists (
    select 1
    from public.ai_clients c
    join auth.oauth_clients o on o.id = c.client_id
    join auth.sessions s on s.oauth_client_id = o.id and s.user_id = c.user_id
    where c.user_id = auth.uid()
      and c.client_id = v_client::uuid
      and c.revoked_at is null
      and c.deleted_at is null
      and o.client_type = 'confidential'
      and o.deleted_at is null
      and s.id = v_session::uuid
  );
end;
$$;
revoke execute on function public.ai_client_allowed() from public, anon;
grant execute on function public.ai_client_allowed() to authenticated;

-- Inhalte für die KI-Werkzeuge: aal2 ODER freigegebener KI-Zugang
alter policy areas_aal2 on public.areas
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy topics_aal2 on public.topics
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy projects_aal2 on public.projects
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy milestones_aal2 on public.milestones
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy tasks_aal2 on public.tasks
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy task_dependencies_aal2 on public.task_dependencies
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy notes_aal2 on public.notes
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy note_blocks_aal2 on public.note_blocks
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy links_aal2 on public.links
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy task_note_links_aal2 on public.task_note_links
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy recaps_aal2 on public.recaps
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy ai_activity_aal2 on public.ai_activity
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));

-- KI-Protokoll: die KI trägt nur ein – ändern (Rückgängig) und löschen nur in der App
create policy ai_activity_update_mfa on public.ai_activity as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy ai_activity_delete_mfa on public.ai_activity as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');

-- Bilder und Dateien (attach_file)
alter policy note_images_aal2 on storage.objects
  using (bucket_id <> 'note-images' or ((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (bucket_id <> 'note-images' or ((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
alter policy attachments_aal2 on storage.objects
  using (bucket_id <> 'attachments' or ((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (bucket_id <> 'attachments' or ((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
