-- =====================================================================
-- 13 MFA-Pflicht (B16, E17): Ohne bestätigten zweiten Faktor ist nichts lesbar oder änderbar,
--   auch nicht direkt über die API. Je Tabelle eine RESTRIKTIVE Policy: Sie gilt zusätzlich (UND)
--   zu den Policies „user_id = auth.uid()“ und verlangt im JWT aal = 'aal2' (Passwort + TOTP).
--   Mit Passwort allein (aal1) sieht man leere Tabellen, Schreiben scheitert an RLS.
--   Views (security_invoker) und RPCs (security invoker) laufen über dieselben Tabellen und
--   erben die Sperre; die zwei Seed-Funktionen (security definer) darf authenticated nicht
--   ausführen (Migration 09).
--
--   Reihenfolge Prod: ERST wenn das eigene TOTP auf der Live-URL funktioniert (sonst sperrt er sich
--   aus). Wiederherstellung (Handy weg): Faktor im Supabase-Dashboard entfernen, siehe README
--   „Zweiter Faktor“. Neue Tabellen brauchen dieselbe Policy (Migrations-Audit prüft das).
-- =====================================================================

create policy user_settings_aal2 on public.user_settings as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy areas_aal2 on public.areas as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy topics_aal2 on public.topics as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy projects_aal2 on public.projects as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy milestones_aal2 on public.milestones as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy tasks_aal2 on public.tasks as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy task_dependencies_aal2 on public.task_dependencies as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy notes_aal2 on public.notes as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy note_blocks_aal2 on public.note_blocks as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy links_aal2 on public.links as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy task_note_links_aal2 on public.task_note_links as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy recaps_aal2 on public.recaps as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy templates_aal2 on public.templates as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

create policy saved_views_aal2 on public.saved_views as restrictive for all to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
