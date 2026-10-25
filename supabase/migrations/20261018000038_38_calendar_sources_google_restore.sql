-- =====================================================================
-- 38 Google-Kalender aus dem Papierkorb holen, obwohl derselbe Kalender wieder eingeschaltet ist
--   (#64, Prüfung N1e, Fund G-4): Eine Google-Zeile wandert in den Papierkorb, wenn Google den
--   Kalender nicht mehr nennt; wird er danach wieder eingeschaltet, entsteht eine neue Zeile.
--   Das Zurückholen der alten scheiterte bisher am Eindeutigkeits-Index calendar_sources_google_idx
--   (23505) – die Speicher-Warteschlange meldete einen dauerhaften Fehler.
--   Jetzt gilt: **Zurückholen gewinnt.** Die andere lebende Zeile desselben Google-Kalenders
--   wandert dabei in den Papierkorb (wiederherstellbar, nichts geht verloren). Gilt für App und
--   jeden anderen Weg (Trigger). Zwei lebende Zeilen anzulegen bleibt verboten (Index); die App
--   legt Google-Zeilen ohnehin mit fester ID je Kalender an, „anzeigen“ holt also die Zeile aus
--   dem Papierkorb zurück, statt eine zweite anzulegen.
--   Additiv: eine Funktion, ein Trigger; keine Daten, keine Rechte.
-- =====================================================================

create or replace function public.calendar_sources_google_restore()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- mit den Rechten des Nutzers (RLS): nur eigene Zeilen
  update public.calendar_sources
     set deleted_at = now()
   where user_id = new.user_id
     and kind = 'google'
     and google_calendar_id = new.google_calendar_id
     and deleted_at is null
     and id <> new.id;
  return new;
end;
$$;
revoke execute on function public.calendar_sources_google_restore() from public, anon;

-- BEFORE: die andere Zeile ist im Papierkorb, bevor der Index die zurückgeholte prüft
create trigger calendar_sources_google_restore
  before update on public.calendar_sources
  for each row
  when (old.deleted_at is not null and new.deleted_at is null and new.kind = 'google')
  execute function public.calendar_sources_google_restore();
