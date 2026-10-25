-- =====================================================================
-- 34 Rückblicke von der KI ändern (Stufe 2, S4, Nachtlauf M – Rückmeldung 18.10.: „KI darf auf
--   jeden Fall Wochenrückblicke anlegen und auch ändern“):
--   * recaps_update_mfa (Migration 28) lässt neben aal2 auch freigegebene KI-Zugänge zu – genau
--     wie recaps_insert_mfa seit Migration 32 und die MFA-Policies der übrigen KI-Inhalte
--     (Migration 21). Das Werkzeug update_recap ändert nur Antworten, Werte, Fokus und Themen,
--     nie Art oder Zeitraum, und schreibt jede Änderung mit Rückgängig-Daten ins KI-Protokoll.
--   * Endgültig löschen (recaps_delete_mfa) bleibt der App vorbehalten; in den Papierkorb geht es
--     weiterhin nur über „trash“ nach Rückfrage.
--   Rein additiv: keine Daten geändert, Grants unverändert.
-- =====================================================================

alter policy recaps_update_mfa on public.recaps
  using (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())))
  with check (((select auth.jwt() ->> 'aal') = 'aal2' or (select public.ai_client_allowed())));
