-- =====================================================================
-- 49 Rückblick: eine Antwort feldweise schreiben (Review Teil B, V-2)
--
--   Die App schrieb `answers` bisher als ganzes Objekt aus ihrem Cache. Hatte die KI inzwischen
--   per update_recap die Gesprächsfelder gefüllt (oder das iPhone eine andere Antwort geändert),
--   überschrieb die nächste Eingabe des Nutzers in einem anderen Feld diese Texte mit dem alten Stand.
--   recap_set_answer ändert nur den einen Schlüssel (`answers || {key: value}`), alles andere
--   bleibt – egal, wer es zuletzt geschrieben hat. Security invoker (RLS wie ein Update), kein
--   Abschließen, keine Art/Zeitraum (Trigger recaps_guard_ai aus Migration 48 bleibt wirksam).
--   Rein additiv.
-- =====================================================================

create function public.recap_set_answer(p_recap_id uuid, p_key text, p_value jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 80 then
    raise exception 'Ungültiger Schlüssel.' using errcode = '22023';
  end if;
  update public.recaps
     set answers = coalesce(answers, '{}'::jsonb) || jsonb_build_object(p_key, p_value)
   where id = p_recap_id and deleted_at is null;
  if not found then
    raise exception 'Rückblick nicht gefunden.' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.recap_set_answer(uuid, text, jsonb) from public, anon;
grant execute on function public.recap_set_answer(uuid, text, jsonb) to authenticated;
