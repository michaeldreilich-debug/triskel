-- =====================================================================
-- 47 Freigegebene Notiz: KI-Token holt sie nicht aus dem Papierkorb (Review Teil B, K-3 Punkt 2)
--
--   Migration 46 sperrt für Anfragen ohne zweiten Faktor (KI-Tokens, aal1) Titel und Blöcke
--   einer öffentlich freigegebenen Notiz. `notes.deleted_at` blieb offen: Hatte der Nutzer eine
--   freigegebene Notiz bewusst in den Papierkorb gelegt (der Link zeigt dann nichts), konnte ein
--   Inhaber des rohen KI-Tokens sie per PostgREST mit `deleted_at = null` zurückholen – sie wäre
--   wieder öffentlich. Jetzt gilt derselbe Wächter auch für das Zurückholen aus dem Papierkorb.
--   In den Papierkorb legen (`trash`, `convert`) bleibt der KI erlaubt (Konzept Freigabe; die
--   Werkzeuge weisen jetzt auf die Freigabe hin). App (aal2), Migrationen und Wiederherstellen
--   unberührt. Rein additiv, keine Daten geändert.
-- =====================================================================

create trigger notes_guard_shared_restore before update of deleted_at on public.notes
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function public.note_shares_guard_ai();
