-- =====================================================================
-- 18 Bilder in Notizen (E24, aus Stufe 4 vorgezogen): privater Storage-Bucket „note-images“.
--   * Pfad <user_id>/<note_id>/<datei>: jeder Nutzer nur in seinem eigenen Ordner
--     (storage.foldername(name))[1] = auth.uid().
--   * höchstens 5 MB je Datei, nur PNG, JPEG, WebP, GIF (die App verkleinert vorher auf
--     höchstens 2000 px).
--   * MFA-Pflicht wie bei allen Tabellen (Migration 13): restriktive Policy verlangt aal2.
--   * nicht öffentlich: Die App lädt Bilder mit der eigenen Sitzung als Blob (CSP bleibt dicht).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-images', 'note-images', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy note_images_select on storage.objects for select to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy note_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy note_images_update on storage.objects for update to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy note_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy note_images_aal2 on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'note-images' or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (bucket_id <> 'note-images' or (select auth.jwt() ->> 'aal') = 'aal2');
