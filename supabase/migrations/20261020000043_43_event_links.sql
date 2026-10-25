-- =====================================================================
-- 43 Termine mit Aufgaben und Notizen verknüpfen (#68, Lauf P, Variante 1 aus
--   docs/vorschlag-termine-kontakte.md; Rückmeldung 20.10.: „Ja, alle 4 so“). Termine liegen in Google,
--   Aufgaben und Notizen in der App – die Verknüpfung liegt in der App, Google bleibt unberührt.
--
--   * Eine Zeile = ein Termin ↔ genau eine Aufgabe ODER eine Notiz. Ein Termin kann mehrere
--     haben, eine Notiz/Aufgabe mehrere Termine.
--   * Termin = Google-Kalender-ID + Termin-ID (bei Serien die ID des einen Vorkommens) und die ID
--     der Serie. Umfang „occurrence“ (Standard, nur dieses Mal) oder „series“ (gilt für jedes
--     Vorkommen, erkannt an recurring_event_id).
--   * Schnappschuss (Titel, Beginn, Ende, ganztägig): bleibt lesbar, wenn der Termin in Google
--     verschwindet oder Google nicht verbunden ist; die App zieht ihn nach, sobald sie den Termin
--     wieder sieht.
--   * Gelöschter Termin: Die Zeile bleibt (der Nutzer löst sie selbst). Notiz/Aufgabe im Papierkorb:
--     Die Abfragen blenden die Verknüpfung mit aus, Wiederherstellen bringt sie zurück; endgültig
--     gelöscht → die Zeile geht mit (on delete cascade).
--   * Lösen = deleted_at (Soft-Delete mit Rückgängig); eindeutig je Termin (bzw. Serie) und
--     Aufgabe/Notiz ohne gelöste Zeilen.
--   * RLS, Grants an authenticated (nie anon), aal2 wie überall; die KI liest und schreibt
--     (Werkzeuge mit „termin“, link_event, unlink_event), löscht aber nie endgültig (S-1).
--   Rein additiv: neue Tabelle, keine Daten geändert.
-- =====================================================================

create table public.event_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  google_calendar_id text not null check (char_length(google_calendar_id) between 1 and 1024),
  event_id text not null check (char_length(event_id) between 1 and 1024),
  recurring_event_id text check (char_length(recurring_event_id) between 1 and 1024),
  scope text not null default 'occurrence' check (scope in ('occurrence', 'series')),
  task_id uuid references public.tasks (id) on delete cascade,
  note_id uuid references public.notes (id) on delete cascade,
  event_title text not null default '' check (char_length(event_title) <= 1024),
  event_start timestamptz not null,
  event_end timestamptz not null,
  event_all_day boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint event_links_one_target check ((task_id is null) <> (note_id is null)),
  constraint event_links_series_needs_id check (scope = 'occurrence' or recurring_event_id is not null)
);

alter table public.event_links enable row level security;
create policy event_links_select on public.event_links for select to authenticated
  using ((select auth.uid()) = user_id);
create policy event_links_insert on public.event_links for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy event_links_update on public.event_links for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy event_links_delete on public.event_links for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy event_links_aal2 on public.event_links as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
-- freigegebene KI-Zugänge wie bei den übrigen Inhalten der Werkzeuge (Migration 21) …
alter policy event_links_aal2 on public.event_links
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
-- … aber endgültig löschen nur in der App (Migration 28, S-1)
create policy event_links_delete_mfa on public.event_links as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
revoke all on table public.event_links from anon;
grant select, insert, update, delete on table public.event_links to authenticated;

create trigger event_links_updated_at before update on public.event_links
  for each row execute function public.set_updated_at();

-- eindeutig je Termin (Serie: je Serie) und Ziel, gelöste Zeilen zählen nicht
create unique index event_links_unique on public.event_links (
  user_id,
  (case when scope = 'series' then recurring_event_id else event_id end),
  coalesce(task_id, note_id)
) where deleted_at is null;
create index event_links_task_idx on public.event_links (task_id) where task_id is not null;
create index event_links_note_idx on public.event_links (note_id) where note_id is not null;
