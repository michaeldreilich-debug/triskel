-- =====================================================================
-- 36 Google-Konto für die Kalender-Schnittstelle (#64, E35, Nachtlauf N, Schritt N1a):
--   Mit Anmeldung bei Google liest und bearbeitet die App Termine dort, wo sie liegen.
--
--   * google_accounts: genau eine Zeile je Nutzer – E-Mail (= ID des primären Kalenders), der
--     Refresh-Token **verschlüsselt** (AES-256-GCM mit GOOGLE_TOKEN_KEY, nur in Vercel; Format
--     „v1:iv:tag:daten“), die erteilten Berechtigungen, verbunden seit. Wer die Datenbank oder die
--     nächtliche Sicherung sieht, kann mit dem Token nichts anfangen. Trennen widerruft bei Google
--     und leert den Token (deleted_at gesetzt) – kein Papierkorb, nicht im Export, nicht in der
--     Suche. Eine lebende Zeile hat immer einen Token (Check).
--     Verbinden und Trennen nur mit zweitem Faktor (App). KI-Zugänge lesen die Zeile (die
--     KI-Werkzeuge für Termine brauchen den Token, N1d) – anlegen, ändern und löschen bleibt aal2
--     (Muster Notiz-Typen, Migration 25/28).
--   * calendar_sources kennt jetzt zwei Arten: „ical“ (wie bisher, geheime Adresse) und „google“
--     (ein Kalender aus der Google-Kalenderliste, ID in google_calendar_id, ohne Adresse). Je
--     Nutzer jeder Google-Kalender höchstens einmal (Papierkorb ausgenommen). Vorhandene Zeilen
--     sind „ical“ und bleiben gültig; die bestehenden Policies gelten weiter.
--   Rein additiv: neue Tabelle, neue Spalten mit Standardwert, ein Not-null gelockert.
-- =====================================================================

create table public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  -- ID des primären Google-Kalenders (die Gmail-Adresse)
  email text not null check (char_length(email) between 3 and 320),
  -- verschlüsselt (nie im Klartext, nie im Client, nie im Log); null nach dem Trennen
  refresh_token_enc text check (refresh_token_enc ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  -- erteilte Berechtigungen (Leerzeichen-getrennt, wie Google sie meldet)
  scope text not null default '' check (char_length(scope) <= 2000),
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- verbunden = Token vorhanden; getrennt = Token leer und deleted_at gesetzt
  constraint google_accounts_token_live check (deleted_at is not null or refresh_token_enc is not null)
);

alter table public.google_accounts enable row level security;
create policy google_accounts_select on public.google_accounts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy google_accounts_insert on public.google_accounts for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy google_accounts_update on public.google_accounts for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy google_accounts_delete on public.google_accounts for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy google_accounts_aal2 on public.google_accounts as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
-- die KI-Werkzeuge für Termine (N1d) lesen den verschlüsselten Token mit dem KI-Token …
alter policy google_accounts_aal2 on public.google_accounts
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
-- … verbinden, trennen und löschen nur in der App (aal2)
create policy google_accounts_insert_mfa on public.google_accounts as restrictive for insert to authenticated
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy google_accounts_update_mfa on public.google_accounts as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy google_accounts_delete_mfa on public.google_accounts as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
revoke all on table public.google_accounts from anon;
grant select, insert, update, delete on table public.google_accounts to authenticated;

create trigger google_accounts_updated_at before update on public.google_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- calendar_sources: Google-Kalender neben den iCal-Adressen
-- ---------------------------------------------------------------------
alter table public.calendar_sources
  add column kind text not null default 'ical' check (kind in ('ical', 'google'));
alter table public.calendar_sources
  add column google_calendar_id text check (char_length(google_calendar_id) between 1 and 1024);
-- Google-Kalender haben keine geheime Adresse (die bisherige Prüfung der Adresse bleibt)
alter table public.calendar_sources alter column url drop not null;
alter table public.calendar_sources
  add constraint calendar_sources_kind_fields check (
    (kind = 'ical' and url is not null and google_calendar_id is null)
    or (kind = 'google' and google_calendar_id is not null and url is null)
  );
-- jeder Google-Kalender höchstens einmal je Nutzer (Papierkorb ausgenommen)
create unique index calendar_sources_google_idx
  on public.calendar_sources (user_id, google_calendar_id)
  where deleted_at is null and google_calendar_id is not null;
