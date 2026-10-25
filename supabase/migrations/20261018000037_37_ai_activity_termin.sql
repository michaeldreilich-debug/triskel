-- =====================================================================
-- 37 KI-Protokoll kennt „termin“ (#64, N1d): Die KI legt Google-Termine an, ändert und löscht sie
--   (Werkzeuge create_event, update_event, delete_event) und trägt das mit Rückgängig-Daten ins
--   KI-Protokoll ein. Termine haben keine UUID (Google-IDs), deshalb bleibt entity_id leer; der
--   Verweis auf den Termin steht in „undo“.
--   Nur der Wertebereich von ai_activity.entity wächst – keine Rechte, keine Daten, keine Policy.
-- =====================================================================

alter table public.ai_activity drop constraint ai_activity_entity_check;
alter table public.ai_activity add constraint ai_activity_entity_check
  check (entity in ('notiz', 'aufgabe', 'projekt', 'meilenstein', 'thema', 'rueckblick', 'termin'));
