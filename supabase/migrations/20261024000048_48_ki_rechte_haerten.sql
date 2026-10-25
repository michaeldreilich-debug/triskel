-- =====================================================================
-- 48 KI-Rechte härten (Review Oktober 2026 Teil B: M-2, M-3, M-4/K-6/V-16, M-6)
--
--   M-2  created_by: Eine Folgeaufgabe erbt „angelegt von“ ihrer Vorlage nur noch, wenn
--        complete_task sie anlegt (transaktionslokales Flag). Vorher stand der Erben-Zweig vor
--        dem KI-Zweig: Ein KI-Token konnte direkt eine Aufgabe mit recurrence_source_id auf eine
--        Aufgabe des Nutzers einfügen und bekam created_by = 'user'.
--   M-3  Rückblicke: Migration 34 öffnet die ganze Zeile für KI-Tokens; „nie Art oder Zeitraum,
--        Abschließen nur in der App“ galt nur im Werkzeug. Jetzt sperrt ein BEFORE-UPDATE-Trigger
--        für Anfragen ohne zweiten Faktor id, kind, period_start, period_end, closed_at, stats
--        und deleted_at (auch über close_recap). Antworten, Werte, Fokus, Themen bleiben offen.
--   M-4  Termin-Verknüpfungen: Lösen, denselben Termin neu verknüpfen (neue Zeile), dann
--        Rückgängig auf das Lösen verletzte event_links_unique (23505, Dauerfehler in der
--        Warteschlange). Wie Migration 38: **Zurückholen gewinnt**, die andere lebende Zeile
--        desselben Termins und Ziels wandert in den Papierkorb.
--   M-6  delete_note_type/restore_note_type liefen unter einem KI-Token halb (notes.type
--        umgestellt, note_types/templates per RLS unberührt, kein Rückgängig, „Erfolg“). Beide
--        prüfen jetzt am Anfang den zweiten Faktor.
--   Rein additiv bzw. Funktionen ersetzt; keine Daten geändert, keine Grants geändert.
-- =====================================================================

-- ---------------------------------------------------------------------
-- M-2: complete_task setzt ein Flag, nur dann erbt die Folgeaufgabe created_by
-- ---------------------------------------------------------------------
create or replace function public.complete_task(
  p_task_id uuid,
  p_next_due date default null,
  p_next_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_next_id uuid;
begin
  select * into v_task
    from public.tasks
   where id = p_task_id and deleted_at is null
     for update;
  if not found then
    raise exception 'Aufgabe nicht gefunden.' using errcode = 'P0002';
  end if;

  if v_task.status = 'erledigt' then
    select t.id into v_next_id
      from public.tasks t
     where t.recurrence_source_id = v_task.id and t.deleted_at is null
     order by t.created_at desc
     limit 1;
    return jsonb_build_object('completed_id', v_task.id, 'next_id', v_next_id);
  end if;

  update public.tasks set status = 'erledigt' where id = v_task.id;

  if v_task.recurrence is not null and p_next_due is not null then
    v_next_id := coalesce(p_next_id, gen_random_uuid());
    -- nur in dieser Transaktion: die Folgeaufgabe darf created_by erben (M-2)
    perform set_config('app.completing_task', '1', true);
    insert into public.tasks (
      id, user_id, area_id, project_id, milestone_id, title, body, body_text, status,
      priority, due_date, scheduled_at, duration_min, recurrence, recurrence_source_id,
      focus_date, in_inbox, sort
    ) values (
      v_next_id, v_task.user_id, v_task.area_id, v_task.project_id, v_task.milestone_id,
      v_task.title,
      -- Checklisten-Punkte der Folgeinstanz starten unerledigt
      case
        when v_task.body is null then null
        else regexp_replace(v_task.body::text, '"checked":\s*true', '"checked": false', 'g')::jsonb
      end,
      v_task.body_text, 'offen', v_task.priority, p_next_due,
      case
        when v_task.scheduled_at is not null and v_task.due_date is not null then
          ((v_task.scheduled_at at time zone 'Europe/Berlin')
            + (p_next_due - v_task.due_date) * interval '1 day') at time zone 'Europe/Berlin'
      end,
      v_task.duration_min, v_task.recurrence, v_task.id, null, v_task.in_inbox,
      v_task.sort || 'V'
    );
    perform set_config('app.completing_task', '', true);
  end if;

  return jsonb_build_object('completed_id', v_task.id, 'next_id', v_next_id);
end;
$$;
revoke execute on function public.complete_task(uuid, date, uuid) from public, anon;
grant execute on function public.complete_task(uuid, date, uuid) to authenticated;

create or replace function public.tasks_set_created_by()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- einmal gesetzt, nie mehr geändert
    new.created_by := old.created_by;
  elsif new.recurrence_source_id is not null
        and coalesce(current_setting('app.completing_task', true), '') = '1' then
    -- Folgeaufgabe aus complete_task: erbt von der Vorlage
    new.created_by := coalesce(
      (select s.created_by from public.tasks s where s.id = new.recurrence_source_id),
      'user'
    );
  elsif auth.uid() is not null then
    -- Anfrage mit Anmeldung: KI-Zugang → 'ai', alles andere (die App) → 'user'
    new.created_by := case when (select public.ai_client_allowed()) then 'ai' else 'user' end;
  end if;
  return new;
end;
$$;
revoke execute on function public.tasks_set_created_by() from public, anon;

-- ---------------------------------------------------------------------
-- M-3: Rückblick – Art, Zeitraum, Abschluss, Statistik, Papierkorb nur mit zweitem Faktor
-- ---------------------------------------------------------------------
create function public.recaps_guard_ai()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2'
     and (
       new.id is distinct from old.id
       or new.kind is distinct from old.kind
       or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end
       or new.closed_at is distinct from old.closed_at
       or new.stats is distinct from old.stats
       or new.deleted_at is distinct from old.deleted_at
     ) then
    raise exception 'Art, Zeitraum, Abschluss und Papierkorb eines Rückblicks ändert nur der Nutzer in der App.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.recaps_guard_ai() from public, anon;

create trigger recaps_guard_ai before update on public.recaps
  for each row execute function public.recaps_guard_ai();

-- ---------------------------------------------------------------------
-- M-4: Termin-Verknüpfung aus dem Papierkorb holen – Zurückholen gewinnt (wie Migration 38)
-- ---------------------------------------------------------------------
create function public.event_links_restore()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- mit den Rechten des Nutzers (RLS): nur eigene Zeilen; dieselbe Schlüsselregel wie der Index
  update public.event_links
     set deleted_at = now()
   where user_id = new.user_id
     and deleted_at is null
     and id <> new.id
     and (case when scope = 'series' then recurring_event_id else event_id end)
         = (case when new.scope = 'series' then new.recurring_event_id else new.event_id end)
     and coalesce(task_id, note_id) = coalesce(new.task_id, new.note_id);
  return new;
end;
$$;
revoke execute on function public.event_links_restore() from public, anon;

-- BEFORE: die andere Zeile ist im Papierkorb, bevor der Index die zurückgeholte prüft
create trigger event_links_restore before update on public.event_links
  for each row
  when (old.deleted_at is not null and new.deleted_at is null)
  execute function public.event_links_restore();

-- ---------------------------------------------------------------------
-- M-6: Notiz-Typen löschen/zurückholen nur mit zweitem Faktor (sonst halbe Ausführung)
-- ---------------------------------------------------------------------
create or replace function public.delete_note_type(p_key text, p_target text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notes uuid[];
  v_templates uuid[];
begin
  if coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'Notiz-Typen ändert nur der Nutzer in der App.' using errcode = '42501';
  end if;
  if p_key = 'idee' then
    raise exception 'Der Standardtyp „Idee“ lässt sich nur umbenennen.' using errcode = '22023';
  end if;
  if p_target = p_key then
    raise exception 'Zieltyp und gelöschter Typ sind gleich.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.note_types where key = p_target and deleted_at is null
  ) then
    raise exception 'Zieltyp % fehlt.', p_target using errcode = '22023';
  end if;
  -- auch Notizen im Papierkorb: wiederhergestellt sollen sie einen gültigen Typ haben
  with moved as (
    update public.notes set type = p_target where type = p_key returning id
  )
  select coalesce(array_agg(id), '{}') into v_notes from moved;
  with moved as (
    update public.templates set note_type = p_target where note_type = p_key returning id
  )
  select coalesce(array_agg(id), '{}') into v_templates from moved;
  update public.note_types
     set deleted_at = now(),
         moved = jsonb_build_object(
           'target', p_target, 'notes', to_jsonb(v_notes), 'templates', to_jsonb(v_templates))
   where key = p_key and deleted_at is null;
end;
$$;
revoke execute on function public.delete_note_type(text, text) from public, anon;
grant execute on function public.delete_note_type(text, text) to authenticated;

create or replace function public.restore_note_type(p_key text, p_note_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_moved jsonb;
begin
  if coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'Notiz-Typen ändert nur der Nutzer in der App.' using errcode = '42501';
  end if;
  select t.moved into v_moved from public.note_types t where t.key = p_key;
  update public.note_types set deleted_at = null, moved = null where key = p_key;
  update public.notes set type = p_key where id = any (coalesce(p_note_ids, '{}'));
  if v_moved is not null then
    update public.notes
       set type = p_key
     where type = v_moved ->> 'target'
       and id in (select e::uuid from jsonb_array_elements_text(v_moved -> 'notes') as e);
    update public.templates
       set note_type = p_key
     where note_type = v_moved ->> 'target'
       and id in (select e::uuid from jsonb_array_elements_text(v_moved -> 'templates') as e);
  end if;
end;
$$;
revoke execute on function public.restore_note_type(text, uuid[]) from public, anon;
grant execute on function public.restore_note_type(text, uuid[]) to authenticated;
