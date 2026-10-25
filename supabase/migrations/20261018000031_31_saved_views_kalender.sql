-- =====================================================================
-- 31 Ansichtstyp „kalender“ (Stufe 2, S2c, Nachtlauf M): Die Datenbank-Ansicht „Kalender“
--   (Aufgaben nach Fälligkeit/Plan/Fokus, Projekte als Fristen im Monatsraster) lässt sich wie
--   Liste, Tabelle und Board als Ansicht speichern. Dafür kennt die Prüfung auf
--   saved_views.view_type (Migration 06) den vierten Wert.
--   Rein additiv: nur die Prüfung erweitert, keine Daten geändert, RLS und Grants unverändert.
-- =====================================================================

alter table public.saved_views drop constraint saved_views_view_type_check;
alter table public.saved_views add constraint saved_views_view_type_check
  check (view_type in ('liste', 'tabelle', 'board', 'kalender'));
