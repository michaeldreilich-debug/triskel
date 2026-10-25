-- =====================================================================
-- 16 Export (B14): Zeitpunkt des letzten Markdown-Exports je Nutzer. Es gibt im Gratis-Tarif
--   keine automatischen Backups (Risiko 4) – der Wochenrückblick erinnert daran und nennt, wie
--   lange der letzte Export her ist (geräteübergreifend, deshalb in user_settings).
-- =====================================================================

alter table public.user_settings add column last_export_at timestamptz;
