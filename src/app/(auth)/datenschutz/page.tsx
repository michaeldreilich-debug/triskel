import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";

export const metadata: Metadata = { title: "Datenschutz" };

/**
 * Öffentliche Datenschutzerklärung (#64): Google verlangt sie für die Anmeldeseite der
 * Kalender-Anbindung („Branding“). Ohne Anmeldung erreichbar (`isPublicPath`).
 */
export default function PrivacyPage() {
  return (
    <AuthCard
      title="Datenschutz"
      description="Triskel ist eine private Anwendung für eine einzelne Person."
    >
      <div className="flex flex-col gap-4 text-ui-sm text-muted">
        <section className="flex flex-col gap-1">
          <h2 className="text-ui font-medium text-fg">Wer die App nutzt</h2>
          <p>
            Es gibt keine öffentliche Registrierung. Anmelden kann sich nur der Betreiber, mit
            Passwort und zweitem Faktor. Daten Dritter werden nicht erhoben.
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h2 className="text-ui font-medium text-fg">Google-Kalender</h2>
          <p>
            Nach ausdrücklicher Zustimmung liest und ändert die App Termine im Google-Kalender des
            Betreibers (Berechtigung „calendar.events“) – nur, um sie in der App anzuzeigen und auf
            seinen Wunsch anzulegen, zu verschieben, zu ändern oder zu löschen. Außerdem liest sie
            die Liste der Kalender des Kontos, ausschließlich lesend (Berechtigung
            „calendar.calendarlist.readonly“) – damit der Betreiber in der App auswählen kann,
            welche Kalender angezeigt werden und in welchem ein neuer Termin landet. Termine werden
            nicht dauerhaft gespeichert; der Zugangsschlüssel liegt verschlüsselt in der Datenbank.
            Daten aus Google werden weder verkauft noch weitergegeben noch für Werbung genutzt.
          </p>
          <p>
            Die Nutzung und Weitergabe von Informationen, die über Google-APIs empfangen werden,
            entspricht der{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="text-link underline decoration-link-line underline-offset-2"
            >
              Google API Services User Data Policy
            </a>
            , einschließlich der Anforderungen zur eingeschränkten Nutzung (Limited Use).
          </p>
          <p>
            Widerrufen lässt sich der Zugriff jederzeit in der App (Einstellungen › Kalender ›
            „Google trennen“) oder unter{" "}
            <a
              href="https://myaccount.google.com/permissions"
              className="text-link underline decoration-link-line underline-offset-2"
            >
              myaccount.google.com/permissions
            </a>
            .
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h2 className="text-ui font-medium text-fg">Freigegebene Seiten</h2>
          <p>
            Der Betreiber kann einzelne Notizen über einen geheimen Link öffentlich freigeben. Wer
            diesen Link hat, sieht Titel und Inhalt dieser einen Notiz samt ihren Bildern und
            Dateien – keine weiteren Angaben und keine anderen Notizen. Beim Aufruf werden keine
            Daten über Besucher erhoben oder ausgewertet; der Hosting-Anbieter und der Dateispeicher
            protokollieren technisch bedingt Zugriffe (u. a. IP-Adresse, Zeitpunkt, aufgerufene
            Adresse) für kurze Zeit. Beendet der Betreiber die Freigabe, funktioniert der Link nicht
            mehr.
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h2 className="text-ui font-medium text-fg">Wo die Daten liegen</h2>
          <p>
            Datenbank bei Supabase (EU, Frankfurt), Dateien bei Cloudflare R2 (EU), die Anwendung
            bei Vercel (Region Frankfurt). Keine Analyse- oder Werbedienste, keine Cookies außer
            denen für die Anmeldung und die Darstellung.
          </p>
        </section>
        <Link href="/login" className="text-link underline decoration-link-line underline-offset-2">
          Zur Anmeldung
        </Link>
      </div>
    </AuthCard>
  );
}
