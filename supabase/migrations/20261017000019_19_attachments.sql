-- =====================================================================
-- 19 Dateien in Notizen und Aufgaben (Rückmeldung #27, aus Stufe 4 vorgezogen wie die Bilder, E26):
--   privater Storage-Bucket „attachments“ für PDFs und beliebige Dateien.
--   * Pfad <user_id>/<notiz- oder aufgaben-id>/<datei>: jeder Nutzer nur im eigenen Ordner.
--   * höchstens 25 MB je Datei; alle Dateitypen (die App öffnet nur PDFs im Browser, alles
--     andere wird heruntergeladen – nie als Seite im eigenen Ursprung angezeigt).
--   * MFA-Pflicht wie überall: restriktive Policy verlangt aal2.
--   * nicht öffentlich: die App lädt Dateien mit der eigenen Sitzung als Blob.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 26214400, null)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy attachments_update on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy attachments_aal2 on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'attachments' or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (bucket_id <> 'attachments' or (select auth.jwt() ->> 'aal') = 'aal2');
