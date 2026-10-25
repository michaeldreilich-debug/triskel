-- Migration 44: alte Storage-Buckets nur noch lesen (R2, E41)
--
-- Warum: Bilder und Dateien liegen seit dem Umzug in Cloudflare R2 (Bucket triskel-dateien);
-- die App schreibt und löscht nur noch dort (/api/dateien/*). Die alten Supabase-Buckets
-- `note-images` und `attachments` bleiben als Altbestand erhalten, damit noch offene alte
-- Tabs ihre Bilder weiter laden können und die Sicherung sie bis zum Widerruf des
-- S3-Schlüssels mitliest. Niemand soll dort noch etwas ablegen, ändern oder löschen –
-- weder die App (auch nicht mit aal2) noch ein freigegebener KI-Zugang.
--
-- Was bleibt: Lesen (`note_images_select`, `attachments_select`: eigener Ordner) samt den
-- restriktiven aal2-Policies (`*_aal2`, `*_delete_mfa`) – sie schränken nur ein.
-- Ohne eine erlaubende Policy für insert/update/delete verweigert RLS diese Vorgänge.
--
-- Zurück: die Policies aus Migration 18 und 19 (`*_insert`, `*_update`, `*_delete`) wieder
-- anlegen – jeweils für den eigenen Ordner `(storage.foldername(name))[1] = auth.uid()`.

drop policy if exists note_images_insert on storage.objects;
drop policy if exists note_images_update on storage.objects;
drop policy if exists note_images_delete on storage.objects;
drop policy if exists attachments_insert on storage.objects;
drop policy if exists attachments_update on storage.objects;
drop policy if exists attachments_delete on storage.objects;
