# CLAUDE.md – Triskel (Second Brain App)

Persönliche Schaltzentrale für eine Person (Single-User): Wissensspeicher, Projektsteuerung und
Rückblicke. Sprache im Repo, in der UI und in Commits: **Deutsch**. Code-Bezeichner: Englisch.

## Wo steht was

- `README.md` – Einrichtung, Befehle, Betrieb (KI-Zugang, R2, Sicherung, Kalender, Tests)
- `docs/02-design.md` – Design-Tokens, Muster und Ansichten (bei UI-Arbeit lesen)
- `docs/03-architektur.md` – Datenmodell, Sicherheit, KI-Schnittstelle (beim Datenmodell lesen)
- `supabase/migrations/` – das Schema

## Eiserne Regeln

1. **Nie Daten verlieren.** Eingaben werden optimistisch angezeigt und mit Debounce
   gespeichert. Löschen ist immer Soft-Delete (`deleted_at`) mit Papierkorb.
2. **RLS auf jeder Tabelle.** Jede Tabelle hat `user_id` und eine Policy `user_id = auth.uid()`.
   Keine Tabelle ohne Policy, auch nicht „nur kurz“.
3. **Kein Admin-Schlüssel im Client oder im Repo.** `service_role` nur in Vercel-/GitHub-Secrets.
   Lokale Zugänge liegen ausschließlich in `.env.local` / `.env.test.local` (in `.gitignore`) und
   erscheinen nie in Logs oder Ausgaben. Der R2-Token der App liegt nur in Vercel (Production),
   der Test-Token in `.env.test.local`.
4. **Schema nur über Migrationen** in `supabase/migrations/` (SQL, versioniert).
   Nie per Dashboard-Klick ändern.
5. **Mobile ist gleichwertig.** Jede Ansicht wird auch bei 390 px Breite geprüft.
6. **Design-Tokens statt Einzelwerte.** Farben, Abstände, Radien nur aus den Tokens in
   `docs/02-design.md`.
7. **Fertig heißt getestet.** Ein Feature ist erst fertig, wenn Lint, Typecheck und die
   zugehörigen Playwright-Tests grün sind.
8. **Grants explizit:** Neue Tabellen werden in Supabase nicht automatisch freigegeben. Jede neue
   Tabelle braucht in ihrer Migration `grant … to authenticated` (nie an `anon`) plus
   RLS-Policies.
9. **Tests nie gegen echte Daten.** Integration und E2E laufen nur gegen das Testprojekt
   (`.env.test.local`); der Schutzschalter `tests/guard.ts` bricht sonst ab.

## Befehle

- `npm run dev` – Entwicklungsserver
- `npm run lint` / `npm run typecheck`
- `npm run test` (Vitest) / `npm run test:e2e` (Playwright)
- `npm run db:push:test` – Migrationen ins Testprojekt (immer zuerst), danach
  `npm run db:push:prod`
