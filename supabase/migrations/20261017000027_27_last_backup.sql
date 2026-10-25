-- =====================================================================
-- 27 Nächtliche Sicherung (E32, aus Stufe 2 vorgezogen): Zeitpunkt und Zusammenfassung der
--   letzten erfolgreichen Sicherung je Nutzer. Schreibt nur das Sicherungs-Skript auf dem Mac
--   (scripts/backup-nightly.mts, über die DB-Verbindung); die App liest beides und zeigt auf
--   „Heute“ einen Hinweis, wenn die letzte Sicherung älter als 36 Stunden ist oder fehlt
--   (fällt so auch auf, wenn der Mac aus war). Zusammenfassung: Stand, Zeilen, Dateien, Bytes.
-- =====================================================================

alter table public.user_settings
  add column last_backup_at timestamptz,
  add column last_backup_summary jsonb;
