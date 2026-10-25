-- =====================================================================
-- 28 KI-Token auf Datenbank-Ebene begrenzen (Code-Review Oktober 2026, S-1 und S-7):
--   Migration 21 öffnet die MFA-Policies der KI-Inhalte „for all“ (aal2 ODER freigegebener
--   KI-Zugang). Das Token liegt bei Anthropic/OpenAI und ist ein normales Supabase-JWT – an der
--   MCP-Route vorbei konnte es deshalb direkt über PostgREST/Storage endgültig löschen
--   (DELETE, empty_trash, Datei entfernen), ohne Eintrag im KI-Protokoll. Die Freigabe sagt aber
--   zu: „Endgültig löschen – das bleibt bei dir in der App“.
--
--   * Endgültig löschen nur mit aal2: je Inhaltstabelle eine restriktive Policy „for delete“
--     (wie ai_activity_delete_mfa aus Migration 21). Ausgenommen sind links und task_note_links –
--     die leeren die Trigger beim Speichern von Blöcken bzw. Aufgaben (Migration 05 und 10)
--     auch unter dem KI-Token. Damit trifft auch empty_trash (security invoker) keine Zeile.
--     In den Papierkorb (deleted_at per Update) darf die KI weiterhin.
--   * Dateien: in beiden Buckets entfernen nur mit aal2 (hochladen bleibt für attach_file).
--   * Rückblicke, Notiz-Typen, Abhängigkeiten liest die KI nur: anlegen und ändern nur mit aal2.
--   * KI-Protokoll (S-7): client_id setzt die Datenbank aus dem Token, wenn es ein KI-Token ist –
--     eine KI kann sich nicht mehr als die andere ausgeben. Die App (aal2, ohne client_id)
--     behält ihren Wert.
--   Rein additiv: keine Daten, keine bestehende Policy wird geändert.
-- =====================================================================

-- Endgültig löschen nur in der App (aal2)
create policy areas_delete_mfa on public.areas as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy topics_delete_mfa on public.topics as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy projects_delete_mfa on public.projects as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy milestones_delete_mfa on public.milestones as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy tasks_delete_mfa on public.tasks as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy task_dependencies_delete_mfa on public.task_dependencies as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy notes_delete_mfa on public.notes as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy note_blocks_delete_mfa on public.note_blocks as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy recaps_delete_mfa on public.recaps as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');
create policy note_types_delete_mfa on public.note_types as restrictive for delete to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');

-- Dateien entfernen nur in der App (aal2)
create policy note_images_delete_mfa on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'note-images' or (select auth.jwt() ->> 'aal') = 'aal2');
create policy attachments_delete_mfa on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'attachments' or (select auth.jwt() ->> 'aal') = 'aal2');

-- Was die KI nur liest: anlegen und ändern nur in der App (aal2)
create policy recaps_insert_mfa on public.recaps as restrictive for insert to authenticated
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy recaps_update_mfa on public.recaps as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy note_types_insert_mfa on public.note_types as restrictive for insert to authenticated
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy note_types_update_mfa on public.note_types as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy task_dependencies_insert_mfa on public.task_dependencies as restrictive for insert to authenticated
  with check ((select auth.jwt() ->> 'aal') = 'aal2');
create policy task_dependencies_update_mfa on public.task_dependencies as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- KI-Protokoll: wer eingetragen hat, steht im Token (S-7)
create function public.set_ai_activity_client()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.client_id := coalesce(nullif((select auth.jwt() ->> 'client_id'), ''), new.client_id);
  return new;
end;
$$;

revoke execute on function public.set_ai_activity_client() from public, anon;

create trigger ai_activity_client before insert on public.ai_activity
  for each row execute function public.set_ai_activity_client();
