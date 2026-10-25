-- =====================================================================
-- 33 Stand des geführten Wochenreviews (Stufe 2, S1c, Nachtlauf M): Das Review geht Schritt
--   für Schritt durch Inbox, Projekte, Fälliges der nächsten Woche, Wochenrückblick und Fokus.
--   Es lässt sich jederzeit abbrechen; wo es steht (Schritt, durchgesehene Projekte, fertig),
--   hält recaps.review am Wochenrückblick derselben Woche fest – auf jedem Gerät gleich.
--   Eigene Spalte statt in answers, damit der Stand nicht in der Suche landet (answers ist
--   durchsuchbar). Rein additiv: neue Spalte mit Vorgabe, keine Daten geändert, RLS, Grants und
--   MFA-Policies der Tabelle gelten unverändert (die KI ändert Rückblicke weiterhin nicht).
-- =====================================================================

alter table public.recaps
  add column review jsonb not null default '{}'::jsonb
    check (jsonb_typeof(review) = 'object');
