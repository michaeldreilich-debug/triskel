-- =====================================================================
-- 50 Serverzeit für den Abgleich übernommener Änderungen (Review Teil B, V-4)
--
--   Die Speicher-Warteschlange prüft Änderungen aus verwaisten Tabs gegen `updated_at` der Zeile.
--   Der Zeitpunkt der Änderung stammt aus der Uhr des Geräts – geht sie falsch (oder steht sie in
--   Tests fest), zählte Aktuelles als veraltet oder Veraltetes als aktuell. server_now() liefert die
--   Uhr der Datenbank; die App rechnet die Abweichung heraus. Nur lesend, keine Daten, kein
--   Schema; für angemeldete Nutzer (auch KI-Tokens – sie erfahren nur die Uhrzeit).
-- =====================================================================

create function public.server_now()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select now()
$$;
revoke execute on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;
