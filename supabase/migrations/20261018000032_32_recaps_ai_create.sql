-- =====================================================================
-- 32 Rückblicke von der KI anlegen (Stufe 2, S1a, Nachtlauf M): Die KI-Werkzeuge lesen und
--   legen Wochen- und Monatsrückblicke an (z. B. nach einem Rückblick-Gespräch in Claude).
--   * recaps_insert_mfa (Migration 28) lässt neben aal2 auch freigegebene KI-Zugänge zu – genau
--     wie die MFA-Policies der übrigen KI-Inhalte (Migration 21). Ändern (recaps_update_mfa)
--     und endgültig löschen (recaps_delete_mfa) bleiben der App vorbehalten: Die KI legt nur
--     neue Rückblicke an und überschreibt nie eine Antwort, die der Nutzer schon geschrieben hat.
--     Die ID ist fest je Nutzer, Art und Zeitraum (D-3) – App und KI treffen sich auf derselben
--     Zeile, ein vorhandener Rückblick scheitert am Primärschlüssel statt doppelt zu entstehen.
--   * ai_activity.entity kennt „rueckblick“ (Einträge im KI-Protokoll verlinken den Rückblick).
--   Rein additiv: keine Daten geändert, Grants unverändert.
-- =====================================================================

alter policy recaps_insert_mfa on public.recaps
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));

alter table public.ai_activity drop constraint ai_activity_entity_check;
alter table public.ai_activity add constraint ai_activity_entity_check
  check (entity in ('notiz', 'aufgabe', 'projekt', 'meilenstein', 'thema', 'rueckblick'));
