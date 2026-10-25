/**
 * Alle Migrationen gegen eine Supabase-Nachbildung in PGlite (siehe pglite-supabase.ts).
 * Prüft RLS (anon, A/B-Isolation, MFA, KI-Zugänge), Seeds, Trigger und RPCs.
 */
import path from "node:path";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../support/env-file";
import { applyMigrations, as, createSupabaseLikeDb, createUser } from "./pglite-supabase";
import { PUBLIC_RPC_ALLOWLIST, readMigrations, SECURITY_DEFINER_ALLOWLIST } from "./sql-audit";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

const TABLES = [
  "user_settings",
  "areas",
  "topics",
  "projects",
  "milestones",
  "tasks",
  "task_dependencies",
  "notes",
  "note_blocks",
  "links",
  "task_note_links",
  "recaps",
  "templates",
  "saved_views",
  "ai_activity",
  "ai_clients",
  "note_types",
  "calendar_sources",
  "google_accounts",
  "event_links",
  "note_shares",
];
const VIEWS = ["v_tasks", "v_projects"];
const RPCS = [
  "select public.complete_task(gen_random_uuid())",
  "select public.undo_complete_task(gen_random_uuid())",
  "select public.week_stats('2026-10-05', '2026-10-11')",
  "select public.close_recap(gen_random_uuid())",
  "select public.empty_trash('tasks', '{}')",
  "select * from public.search_all('test')",
  `select public.seed_user_defaults('${A}')`,
  "select public.ai_client_allowed()",
  "select public.delete_note_type('protokoll', 'wissen')",
  "select public.restore_note_type('idee', '{}')",
];

let db: PGlite;
const asA = <T>(fn: (tx: Transaction) => Promise<T>) =>
  as(db, { role: "authenticated", userId: A }, fn);
const asB = <T>(fn: (tx: Transaction) => Promise<T>) =>
  as(db, { role: "authenticated", userId: B }, fn);

async function one<T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> {
  const result = await tx.query<T>(sql, params);
  return result.rows[0] as T;
}

async function areaId(tx: Transaction, seedKey: string): Promise<string> {
  return (
    await one<{ id: string }>(tx, "select id from public.areas where seed_key = $1", [seedKey])
  ).id;
}

beforeAll(async () => {
  db = await createSupabaseLikeDb();
  // A und B existieren schon vor den Migrationen (wie im Testprojekt)
  await createUser(db, A, "a@test.local");
  await createUser(db, B, "b@test.local");
  await applyMigrations(db, readMigrations(path.join(REPO_ROOT, "supabase", "migrations")));
  // C registriert sich danach → Seed über Trigger
  await createUser(db, C, "c@test.local");
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("anon liest und ruft nichts auf", () => {
  it.each([...TABLES, ...VIEWS])("Tabelle/View %s → verweigert", async (name) => {
    await expect(
      as(db, { role: "anon" }, (tx) => tx.query(`select * from public.${name}`)),
    ).rejects.toThrow(/permission denied/);
  });

  it.each(RPCS)("RPC %s → verweigert", async (sql) => {
    await expect(as(db, { role: "anon" }, (tx) => tx.query(sql))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("die Liste oben deckt alle Tabellen und Views in public ab", async () => {
    const rows = await db.query<{ name: string; kind: string }>(
      `select c.relname as name, c.relkind as kind from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v') order by c.relname`,
    );
    expect(
      rows.rows
        .filter((r) => r.kind === "r")
        .map((r) => r.name)
        .sort(),
    ).toEqual([...TABLES].sort());
    expect(
      rows.rows
        .filter((r) => r.kind === "v")
        .map((r) => r.name)
        .sort(),
    ).toEqual([...VIEWS].sort());
  });

  it("anon hat auf keine Tabelle, View oder Funktion in public irgendein Recht – außer den beiden Freigabe-Funktionen (#94)", async () => {
    const rows = await db.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v')
          and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
               or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))
       union all
       select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
       order by 1`,
    );
    expect(rows.rows.map((r) => r.name)).toEqual(["shared_note", "shared_note_file"]);
  });

  it("authenticated darf nur RPCs ausführen, keine Trigger- und Seed-Funktionen", async () => {
    const rows = await db.query<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
        order by 1`,
    );
    expect(rows.rows.map((r) => r.name)).toEqual([
      "ai_client_allowed",
      "close_recap",
      "complete_task",
      "delete_note_type",
      "empty_trash",
      "note_share_active",
      // Migration 49 (V-2): eine Antwort eines Rückblicks feldweise
      "recap_set_answer",
      "restore_note_type",
      "search_all",
      // Migration 50 (V-4): Uhr der Datenbank für den Abgleich übernommener Änderungen
      "server_now",
      "shared_note",
      "shared_note_file",
      "undo_complete_task",
      "week_stats",
    ]);
  });

  it("angemeldete Nutzer dürfen den Seed nicht für andere ausführen", async () => {
    await expect(asA((tx) => tx.query(`select public.seed_user_defaults('${B}')`))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("MFA-Pflicht (Migration 13): ohne zweiten Faktor nichts lesbar oder änderbar", () => {
  const asAal1 = <T>(fn: (tx: Transaction) => Promise<T>) =>
    as(db, { role: "authenticated", userId: A, aal: "aal1" }, fn);
  const asNoAal = <T>(fn: (tx: Transaction) => Promise<T>) =>
    as(db, { role: "authenticated", userId: A, aal: null }, fn);
  const count = (tx: Transaction, name: string) =>
    one<{ n: number }>(tx, `select count(*)::int as n from public.${name}`).then((r) => r.n);

  it.each([...TABLES, ...VIEWS])("%s: aal1 und fehlender Claim sehen nichts", async (name) => {
    expect(await asAal1((tx) => count(tx, name))).toBe(0);
    expect(await asNoAal((tx) => count(tx, name))).toBe(0);
  });

  it("dieselben Zeilen sieht A mit aal2 (Seeds: 2 Bereiche, 3 Vorlagen, Einstellungen)", async () => {
    expect(await asA((tx) => count(tx, "areas"))).toBe(2);
    expect(await asA((tx) => count(tx, "templates"))).toBe(3);
    expect(await asA((tx) => count(tx, "user_settings"))).toBe(1);
  });

  it("aal1 kann nichts anlegen, ändern oder löschen", async () => {
    const area = await asA((tx) => areaId(tx, "beruf"));
    await expect(
      asAal1((tx) =>
        tx.query("insert into public.topics (area_id, name, sort) values ($1, 'MFA', 'z9')", [
          area,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await asAal1((tx) =>
      tx.query("update public.areas set name = 'Gekapert' where id = $1", [area]),
    );
    expect(updated.affectedRows).toBe(0);
    const deleted = await asAal1((tx) =>
      tx.query("delete from public.areas where id = $1", [area]),
    );
    expect(deleted.affectedRows).toBe(0);
    const name = await asA((tx) =>
      one<{ name: string }>(tx, "select name from public.areas where id = $1", [area]),
    );
    expect(name.name).not.toBe("Gekapert");
    expect(await asA((tx) => count(tx, "areas"))).toBe(2);
  });

  it("aal1: RPCs finden nichts (search_all leer, complete_task findet die Aufgabe nicht)", async () => {
    const task = await asA(async (tx) => {
      const area = await areaId(tx, "privat");
      return one<{ id: string }>(
        tx,
        "insert into public.tasks (area_id, title, sort) values ($1, 'MFA-Probe Zweitfaktor', 'z8') returning id",
        [area],
      );
    });
    const found = await asA((tx) => tx.query("select * from public.search_all('Zweitfaktor')"));
    expect(found.rows.length).toBeGreaterThan(0);
    const hidden = await asAal1((tx) => tx.query("select * from public.search_all('Zweitfaktor')"));
    expect(hidden.rows).toEqual([]);
    await expect(
      asAal1((tx) => tx.query("select public.complete_task($1)", [task.id])),
    ).rejects.toThrow(/Aufgabe nicht gefunden/);
    const status = await asA((tx) =>
      one<{ status: string }>(tx, "select status from public.tasks where id = $1", [task.id]),
    );
    expect(status.status).not.toBe("erledigt");
    await asA((tx) => tx.query("delete from public.tasks where id = $1", [task.id]));
  });

  it("jede Tabelle hat genau eine restriktive aal2-Policy", async () => {
    const rows = await db.query<{ table: string }>(
      `select tablename as table from pg_policies
        where schemaname = 'public' and permissive = 'RESTRICTIVE' and policyname like '%\\_aal2'
          and qual like '%aal2%' and with_check like '%aal2%' order by 1`,
    );
    expect(rows.rows.map((r) => r.table)).toEqual([...TABLES].sort());
  });
});

describe("Seeds", () => {
  it.each([
    ["A (vor Migration 09 angelegt)", A],
    ["B (vor Migration 09 angelegt)", B],
    ["C (nach Migration 09 registriert, Trigger)", C],
  ])(
    "%s hat genau 2 Bereiche, 3 Vorlagen, 1 Einstellungszeile, 6 Notiz-Typen",
    async (_label, user) => {
      const counts = await as(db, { role: "authenticated", userId: user }, (tx) =>
        one<{ areas: number; templates: number; settings: number; types: number }>(
          tx,
          `select (select count(*)::int from public.areas) as areas,
                (select count(*)::int from public.templates) as templates,
                (select count(*)::int from public.user_settings) as settings,
                (select count(*)::int from public.note_types) as types`,
        ),
      );
      expect(counts).toEqual({ areas: 2, templates: 3, settings: 1, types: 6 });
    },
  );

  it.each([
    ["A", A],
    ["B", B],
    ["C (Trigger)", C],
  ])("%s: Wissen und Anleitung zählen als Wissen (Migration 39)", async (_label, user) => {
    const rows = await as(db, { role: "authenticated", userId: user }, (tx) =>
      tx.query<{ key: string }>(
        "select key from public.note_types where counts_as_knowledge order by key",
      ),
    );
    expect(rows.rows.map((r) => r.key)).toEqual(["anleitung", "wissen"]);
  });

  it("seed_user_defaults ist wiederholbar und lässt einen geänderten Schalter stehen (Migration 39)", async () => {
    await db.query(
      "update public.note_types set counts_as_knowledge = false where key = 'wissen' and user_id = $1",
      [C],
    );
    await db.query("select public.seed_user_defaults($1)", [C]);
    const rows = await as(db, { role: "authenticated", userId: C }, (tx) =>
      tx.query<{ n: number }>(
        "select count(*)::int as n from public.note_types where key = 'wissen' and not counts_as_knowledge",
      ),
    );
    expect(rows.rows[0]?.n).toBe(1);
    await db.query(
      "update public.note_types set counts_as_knowledge = true where key = 'wissen' and user_id = $1",
      [C],
    );
  });

  it("Bereiche Beruf (orange, a0) und Privat (blue, a1)", async () => {
    const rows = await asA((tx) =>
      tx.query("select name, color, sort from public.areas order by sort"),
    );
    expect(rows.rows).toEqual([
      { name: "Beruf", color: "orange", sort: "a0" },
      { name: "Privat", color: "blue", sort: "a1" },
    ]);
  });

  it("Projekt-Vorlage hat Inhalt statt Hinweistexten (Migration 15)", async () => {
    const tpl = await asA((tx) =>
      one<{ body: object }>(tx, "select body from public.templates where seed_key = 'projekt'"),
    );
    expect(tpl.body).toEqual({ why: "", outcome: [], milestones: [], tasks: [] });
  });

  it("Protokoll-Vorlage enthält die 6 Outline-Blöcke", async () => {
    const tpl = await asA((tx) =>
      one<{ body: { content: { content: { content: { text: string }[] }[] }[] } }>(
        tx,
        "select body from public.templates where seed_key = 'protokoll'",
      ),
    );
    const labels = tpl.body.content.map((block) => block.content[0]?.content[0]?.text);
    expect(labels).toEqual([
      "Anlass/Datum",
      "Teilnehmende",
      "Themen",
      "Beschlüsse",
      "Offene Punkte (→ Aufgabe)",
      "Nächster Termin",
    ]);
  });

  it("seed_user_defaults ist idempotent, auch nach Umbenennen", async () => {
    await asA((tx) =>
      tx.query("update public.areas set name = 'Zuhause' where seed_key = 'privat'"),
    );
    await db.query(`select public.seed_user_defaults('${A}')`);
    await db.query(`select public.seed_user_defaults('${A}')`);
    const counts = await asA((tx) =>
      one<{ areas: number; templates: number }>(
        tx,
        "select (select count(*)::int from public.areas) as areas, (select count(*)::int from public.templates) as templates",
      ),
    );
    expect(counts).toEqual({ areas: 2, templates: 3 });
    await asA((tx) =>
      tx.query("update public.areas set name = 'Privat' where seed_key = 'privat'"),
    );
  });
});

describe("Isolation A/B", () => {
  it("B sieht, ändert und löscht nichts von A", async () => {
    const projectId = await asA(async (tx) => {
      const area = await areaId(tx, "beruf");
      const p = await one<{ id: string }>(
        tx,
        "insert into public.projects (area_id, title, sort) values ($1, 'Geheim A', 'a0') returning id",
        [area],
      );
      await tx.query(
        "insert into public.tasks (area_id, project_id, title, sort) values ($1, $2, 'Aufgabe A', 'a0')",
        [area, p.id],
      );
      return p.id;
    });

    const seen = await asB((tx) =>
      one<{ projects: number; tasks: number; viewp: number; areas: number }>(
        tx,
        `select (select count(*)::int from public.projects) as projects,
                (select count(*)::int from public.tasks) as tasks,
                (select count(*)::int from public.v_projects) as viewp,
                (select count(*)::int from public.areas) as areas`,
      ),
    );
    expect(seen).toEqual({ projects: 0, tasks: 0, viewp: 0, areas: 2 });

    const updated = await asB((tx) =>
      tx.query("update public.projects set title = 'gekapert' where id = $1", [projectId]),
    );
    expect(updated.affectedRows).toBe(0);
    const deleted = await asB((tx) =>
      tx.query("delete from public.projects where id = $1", [projectId]),
    );
    expect(deleted.affectedRows).toBe(0);

    const search = await asB((tx) => tx.query("select * from public.search_all('Geheim')"));
    expect(search.rows).toEqual([]);
  });

  it("B kann keine Zeilen mit user_id von A anlegen oder übernehmen", async () => {
    await expect(
      asB(async (tx) => {
        const area = await areaId(tx, "privat");
        await tx.query(
          "insert into public.tasks (user_id, area_id, title, sort) values ($1, $2, 'x', 'a0')",
          [A, area],
        );
      }),
    ).rejects.toThrow(/row-level security/);

    await expect(
      asB(async (tx) => {
        await tx.query("update public.areas set user_id = $1", [A]);
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("Trigger", () => {
  it("completed_at wird beim Erledigen gesetzt und beim Wiedereröffnen geleert", async () => {
    await asA(async (tx) => {
      const area = await areaId(tx, "privat");
      const t = await one<{ id: string }>(
        tx,
        "insert into public.tasks (area_id, title, sort) values ($1, 'Einkaufen', 'a0') returning id",
        [area],
      );
      await tx.query("update public.tasks set status = 'erledigt' where id = $1", [t.id]);
      expect(
        (
          await one<{ c: Date | null }>(
            tx,
            "select completed_at as c from public.tasks where id = $1",
            [t.id],
          )
        ).c,
      ).not.toBeNull();
      await tx.query("update public.tasks set status = 'offen' where id = $1", [t.id]);
      expect(
        (
          await one<{ c: Date | null }>(
            tx,
            "select completed_at as c from public.tasks where id = $1",
            [t.id],
          )
        ).c,
      ).toBeNull();
    });
  });

  it("Aufgabe übernimmt Projekt aus Meilenstein und Bereich aus Projekt; Inbox ohne Bereich", async () => {
    await asA(async (tx) => {
      const fw = await areaId(tx, "beruf");
      const privat = await areaId(tx, "privat");
      const p = await one<{ id: string }>(
        tx,
        "insert into public.projects (area_id, title, sort) values ($1, 'Werkstatt', 'a1') returning id",
        [fw],
      );
      const m = await one<{ id: string }>(
        tx,
        "insert into public.milestones (project_id, title, sort) values ($1, 'M1', 'a0') returning id",
        [p.id],
      );
      const t = await one<{ project_id: string; area_id: string }>(
        tx,
        "insert into public.tasks (area_id, milestone_id, title, sort) values ($1, $2, 'x', 'a0') returning project_id, area_id",
        [privat, m.id],
      );
      expect(t).toEqual({ project_id: p.id, area_id: fw });

      const inbox = await one<{ area_id: string | null }>(
        tx,
        "insert into public.tasks (in_inbox, title, sort) values (true, 'Idee', 'a0') returning area_id",
      );
      expect(inbox.area_id).toBeNull();

      await tx.query("update public.projects set area_id = $1 where id = $2", [privat, p.id]);
      expect(
        (
          await one<{ area_id: string }>(
            tx,
            "select area_id from public.tasks where milestone_id = $1",
            [m.id],
          )
        ).area_id,
      ).toBe(privat);
    });

    await expect(
      asA((tx) => tx.query("insert into public.tasks (title, sort) values ('ohne Bereich', 'a0')")),
    ).rejects.toThrow(/tasks_area_required/);
  });

  it("Meilenstein folgt seinen Aufgaben (Migration 35, #60)", async () => {
    await asA(async (tx) => {
      const area = await areaId(tx, "privat");
      const p = await one<{ id: string }>(
        tx,
        "insert into public.projects (area_id, title, sort) values ($1, 'M35', 'a2') returning id",
        [area],
      );
      const milestone = (title: string, sort: string) =>
        one<{ id: string }>(
          tx,
          "insert into public.milestones (project_id, title, sort) values ($1, $2, $3) returning id",
          [p.id, title, sort],
        ).then((r) => r.id);
      const task = (m: string, title: string) =>
        one<{ id: string }>(
          tx,
          "insert into public.tasks (milestone_id, title, sort) values ($1, $2, 'a0') returning id",
          [m, title],
        ).then((r) => r.id);
      const doneAt = (m: string) =>
        one<{ d: Date | null }>(tx, "select done_at as d from public.milestones where id = $1", [
          m,
        ]).then((r) => r.d);
      const setTask = (id: string, sql: string) =>
        tx.query(`update public.tasks set ${sql} where id = $1`, [id]);

      const m1 = await milestone("Grundlagen", "a0");
      const t1 = await task(m1, "Eins");
      const t2 = await task(m1, "Zwei");
      await tx.query("select public.complete_task($1)", [t1]);
      expect(await doneAt(m1)).toBeNull();
      // „in Arbeit“ zählt als offen
      await setTask(t2, "status = 'in_arbeit'");
      expect(await doneAt(m1)).toBeNull();
      await tx.query("select public.complete_task($1)", [t2]);
      expect(await doneAt(m1)).not.toBeNull();

      // wieder öffnen → offen; erneut erledigen → erreicht
      await tx.query("select public.undo_complete_task($1)", [t2]);
      expect(await doneAt(m1)).toBeNull();
      await tx.query("select public.complete_task($1)", [t2]);
      expect(await doneAt(m1)).not.toBeNull();

      // neue offene Aufgabe → offen; sie in den Papierkorb → erreicht; zurückholen → offen
      const t3 = await task(m1, "Drei");
      expect(await doneAt(m1)).toBeNull();
      await setTask(t3, "deleted_at = now()");
      expect(await doneAt(m1)).not.toBeNull();
      await setTask(t3, "deleted_at = null");
      expect(await doneAt(m1)).toBeNull();

      // hinausverschieben: m1 erreicht, m2 (hatte nichts Offenes, von Hand erreicht) wieder offen
      const m2 = await milestone("Ausbau", "a1");
      await tx.query("update public.milestones set done_at = now() where id = $1", [m2]);
      await setTask(t3, `milestone_id = '${m2}'`);
      expect(await doneAt(m1)).not.toBeNull();
      expect(await doneAt(m2)).toBeNull();

      // ohne Aufgaben bleibt von Hand: letzte offene Aufgabe in den Papierkorb → bleibt offen
      await setTask(t3, "deleted_at = now()");
      expect(await doneAt(m2)).toBeNull();
      // von Hand abhaken geht, Statuswechsel ohne Erledigen ändert nichts
      await tx.query("update public.milestones set done_at = now() where id = $1", [m2]);
      const t4 = await task(m2, "Vier");
      expect(await doneAt(m2)).toBeNull();
      await tx.query("update public.milestones set done_at = now() where id = $1", [m2]);
      await setTask(t4, "status = 'wartet'");
      expect(await doneAt(m2)).not.toBeNull();
      // Titel ändern löst nichts aus
      await tx.query("update public.milestones set done_at = null where id = $1", [m1]);
      await setTask(t1, "title = 'Eins neu'");
      expect(await doneAt(m1)).toBeNull();

      // wiederkehrende Aufgabe: Folgeinstanz hält den Meilenstein offen
      const m3 = await milestone("Routine", "a2");
      const r = await one<{ id: string }>(
        tx,
        `insert into public.tasks (milestone_id, title, sort, due_date, recurrence)
         values ($1, 'Wöchentlich', 'a0', '2026-10-19', 'FREQ=WEEKLY') returning id`,
        [m3],
      );
      await tx.query("select public.complete_task($1, '2026-10-26')", [r.id]);
      expect(await doneAt(m3)).toBeNull();
    });
  });

  it("Migration 35 zieht erreichte Meilensteine einmalig nach", async () => {
    const sql = readMigrations(path.join(REPO_ROOT, "supabase", "migrations")).find((m) =>
      m.name.includes("_35_"),
    )?.sql;
    const backfill = sql?.slice(sql.indexOf("-- Nachziehen"));
    expect(backfill).toBeTruthy();
    await asA(async (tx) => {
      const area = await areaId(tx, "privat");
      const p = await one<{ id: string }>(
        tx,
        "insert into public.projects (area_id, title, sort) values ($1, 'Altbestand', 'a3') returning id",
        [area],
      );
      const ms = await tx.query<{ id: string }>(
        `insert into public.milestones (project_id, title, sort, done_at) values
           ($1, 'alles erledigt', 'a0', null), ($1, 'eins offen, von Hand', 'a1', null),
           ($1, 'leer', 'a2', null) returning id`,
        [p.id],
      );
      const [allDone, manual, empty] = ms.rows.map((r) => r.id);
      await tx.query(
        `insert into public.tasks (milestone_id, title, sort, status, completed_at) values
           ($1, 'a', 'a0', 'erledigt', '2026-10-10T08:00:00Z'),
           ($1, 'b', 'a1', 'erledigt', '2026-10-12T09:30:00Z'),
           ($2, 'c', 'a0', 'offen', null)`,
        [allDone, manual],
      );
      // Stand vor Migration 35 herstellen: „alles erledigt“ offen, „von Hand“ trotz offener
      // Aufgabe erreicht (das Einfügen der offenen Aufgabe hat ihn per Trigger geöffnet)
      await tx.query("update public.milestones set done_at = null where id = $1", [allDone]);
      await tx.query("update public.milestones set done_at = now() where id = $1", [manual]);
      await tx.query(backfill as string);
      const rows = await tx.query<{ id: string; done_at: Date | null }>(
        "select id, done_at from public.milestones where project_id = $1",
        [p.id],
      );
      const byId = new Map(rows.rows.map((r) => [r.id, r.done_at]));
      expect(byId.get(allDone)?.toISOString()).toBe("2026-10-12T09:30:00.000Z");
      expect(byId.get(manual)).not.toBeNull();
      expect(byId.get(empty)).toBeNull();
    });
  });

  it("„Blockiert durch“: Selbstverweis und Zyklen werden abgelehnt, is_blocked stimmt", async () => {
    const ids = await asA(async (tx) => {
      const area = await areaId(tx, "privat");
      const make = async (title: string) =>
        (
          await one<{ id: string }>(
            tx,
            "insert into public.tasks (area_id, title, sort) values ($1, $2, 'a0') returning id",
            [area, title],
          )
        ).id;
      const [t1, t2, t3] = [await make("T1"), await make("T2"), await make("T3")];
      await tx.query(
        "insert into public.task_dependencies (task_id, blocked_by_task_id) values ($1, $2), ($2, $3)",
        [t1, t2, t3],
      );
      return { t1, t2, t3 };
    });

    await expect(
      asA((tx) =>
        tx.query(
          "insert into public.task_dependencies (task_id, blocked_by_task_id) values ($1, $1)",
          [ids.t1],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asA((tx) =>
        tx.query(
          "insert into public.task_dependencies (task_id, blocked_by_task_id) values ($1, $2)",
          [ids.t3, ids.t1],
        ),
      ),
    ).rejects.toThrow(/Zyklus/);

    await asA(async (tx) => {
      const blocked = async (id: string) =>
        (
          await one<{ b: boolean }>(
            tx,
            "select is_blocked as b from public.v_tasks where id = $1",
            [id],
          )
        ).b;
      expect(await blocked(ids.t1)).toBe(true);
      expect(await blocked(ids.t3)).toBe(false);
      await tx.query("update public.tasks set status = 'erledigt' where id = $1", [ids.t2]);
      expect(await blocked(ids.t1)).toBe(false);
    });
  });

  it("Links und Rückverweise aus noteLink-Knoten; Umbenennen bricht nichts; Tags werden ergänzt", async () => {
    await asA(async (tx) => {
      const area = await areaId(tx, "beruf");
      const target = await one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title) values ($1, 'Wartungsplan PA') returning id",
        [area],
      );
      const source = await one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title, tags) values ($1, 'Prüffristen', '{wartung}') returning id",
        [area],
      );
      const content = {
        type: "paragraph",
        content: [
          { type: "text", text: "Details in " },
          { type: "noteLink", attrs: { noteId: target.id } },
          { type: "noteLink", attrs: { noteId: "kein-uuid" } },
          { type: "tag", attrs: { name: "prüfung" } },
          { type: "tag", attrs: { name: "wartung" } },
        ],
      };
      const block = await one<{ id: string }>(
        tx,
        "insert into public.note_blocks (note_id, content, content_text, sort) values ($1, $2, 'Details in', 'a0') returning id",
        [source.id, JSON.stringify(content)],
      );

      const backlinks = async () =>
        (
          await tx.query<{ source_note_id: string }>(
            "select source_note_id from public.links where target_note_id = $1",
            [target.id],
          )
        ).rows;
      expect(await backlinks()).toEqual([{ source_note_id: source.id }]);

      await tx.query(
        "update public.notes set title = 'Wartungsplan Pressluftatmer' where id = $1",
        [target.id],
      );
      expect(await backlinks()).toHaveLength(1);

      const tags = await one<{ tags: string[] }>(
        tx,
        "select tags from public.notes where id = $1",
        [source.id],
      );
      expect(tags.tags).toEqual(["prüfung", "wartung"]);

      await tx.query("update public.note_blocks set content = $2 where id = $1", [
        block.id,
        JSON.stringify({ type: "paragraph", content: [{ type: "text", text: "ohne Link" }] }),
      ]);
      expect(await backlinks()).toEqual([]);
      const tagsAfter = await one<{ tags: string[] }>(
        tx,
        "select tags from public.notes where id = $1",
        [source.id],
      );
      expect(tagsAfter.tags).toEqual(["prüfung", "wartung"]);

      await tx.query(
        "update public.note_blocks set content = $2, deleted_at = null where id = $1",
        [block.id, JSON.stringify(content)],
      );
      expect(await backlinks()).toHaveLength(1);
      await tx.query("update public.note_blocks set deleted_at = now() where id = $1", [block.id]);
      expect(await backlinks()).toEqual([]);
    });
  });

  it("Rückverweise aus der Notiz einer Aufgabe: Aufgabe zeigt auf Notiz, Papierkorb nimmt ihn weg", async () => {
    await asA(async (tx) => {
      const area = await areaId(tx, "beruf");
      const target = await one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title) values ($1, 'Pflegeplan') returning id",
        [area],
      );
      const body = (noteIds: string[]) =>
        JSON.stringify({
          type: "doc",
          content: [
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [
                    {
                      type: "paragraph",
                      content: noteIds.map((id) => ({ type: "noteLink", attrs: { noteId: id } })),
                    },
                  ],
                },
              ],
            },
          ],
        });
      const task = await one<{ id: string }>(
        tx,
        "insert into public.tasks (area_id, title, sort, body) values ($1, 'Fahrzeugpflege', 'a0', $2) returning id",
        [area, body([target.id, target.id, "kein-uuid"])],
      );
      const backlinks = async () =>
        (
          await tx.query<{ task_id: string }>(
            "select task_id from public.task_note_links where target_note_id = $1",
            [target.id],
          )
        ).rows;
      expect(await backlinks()).toEqual([{ task_id: task.id }]);

      // anderer Inhalt ohne Link → weg; wieder mit Link → da
      await tx.query("update public.tasks set body = $2 where id = $1", [task.id, body([])]);
      expect(await backlinks()).toEqual([]);
      await tx.query("update public.tasks set body = $2 where id = $1", [
        task.id,
        body([target.id]),
      ]);
      expect(await backlinks()).toHaveLength(1);

      // Titel ändern ändert nichts; Papierkorb nimmt den Verweis weg, Zurückholen bringt ihn wieder
      await tx.query("update public.tasks set title = 'Pflege' where id = $1", [task.id]);
      expect(await backlinks()).toHaveLength(1);
      await tx.query("update public.tasks set deleted_at = now() where id = $1", [task.id]);
      expect(await backlinks()).toEqual([]);
      await tx.query("update public.tasks set deleted_at = null where id = $1", [task.id]);
      expect(await backlinks()).toHaveLength(1);

      // „((Neue Notiz“: Aufgabe wird vor der Notiz gespeichert – die Notiz holt den Verweis nach
      const laterId = "00000000-0000-4000-8000-0000000000f1";
      const waiting = await one<{ id: string }>(
        tx,
        "insert into public.tasks (area_id, title, sort, body) values ($1, 'Wartet', 'a1', $2) returning id",
        [area, body([laterId])],
      );
      await tx.query("insert into public.notes (id, area_id, title) values ($1, $2, 'Später')", [
        laterId,
        area,
      ]);
      const later = await tx.query<{ task_id: string }>(
        "select task_id from public.task_note_links where target_note_id = $1",
        [laterId],
      );
      expect(later.rows).toEqual([{ task_id: waiting.id }]);
    });
    // B sieht A's Verweise nicht
    const seen = await asB((tx) =>
      one<{ n: number }>(tx, "select count(*)::int as n from public.task_note_links"),
    );
    expect(seen.n).toBe(0);
  });
});

describe("Views und RPCs", () => {
  it("v_projects: Fortschritt = erledigte ÷ alle Aufgaben, festgefahren und still", async () => {
    await asA(async (tx) => {
      const area = await areaId(tx, "privat");
      const p = await one<{ id: string }>(
        tx,
        "insert into public.projects (area_id, title, status, sort) values ($1, 'Nordlichter-Reise', 'aktiv', 'a2') returning id",
        [area],
      );
      let v = await one<{ progress: string | null; is_stuck: boolean }>(
        tx,
        "select progress, is_stuck from public.v_projects where id = $1",
        [p.id],
      );
      expect(v).toEqual({ progress: null, is_stuck: true });

      const t1 = await one<{ id: string }>(
        tx,
        "insert into public.tasks (project_id, title, sort) values ($1, 'a', 'a0') returning id",
        [p.id],
      );
      await tx.query(
        "insert into public.tasks (project_id, title, status, sort) values ($1, 'b', 'erledigt', 'a1')",
        [p.id],
      );
      await tx.query(
        "insert into public.tasks (project_id, title, status, sort) values ($1, 'c', 'erledigt', 'a2')",
        [p.id],
      );
      await tx.query(
        "insert into public.tasks (project_id, title, sort, deleted_at) values ($1, 'gelöscht', 'a3', now())",
        [p.id],
      );
      await tx.query(
        `update public.projects set outcome = '[{"text": "Unterkunft gebucht", "done": false}]', next_task_id = $2 where id = $1`,
        [p.id, t1.id],
      );
      v = await one(tx, "select progress, is_stuck from public.v_projects where id = $1", [p.id]);
      expect(v).toEqual({ progress: "0.6667", is_stuck: false });

      await tx.query(
        "update public.projects set last_activity_at = now() - interval '15 days', updated_at = now() - interval '15 days' where id = $1",
        [p.id],
      );
      // updated_at setzt der Trigger wieder auf now() → nicht still
      const stale = await one<{ is_stale: boolean }>(
        tx,
        "select is_stale from public.v_projects where id = $1",
        [p.id],
      );
      expect(stale.is_stale).toBe(false);
      return p.id;
    }).then(async (projectId) => {
      // 15 Tage ohne Bewegung simulieren (Trigger umgehen, nur im Test)
      await db.exec(`set session_replication_role = replica;
        update public.projects set last_activity_at = now() - interval '15 days',
               updated_at = now() - interval '15 days' where id = '${projectId}';
        set session_replication_role = origin;`);
      const v = await asA((tx) =>
        one<{ is_stale: boolean }>(tx, "select is_stale from public.v_projects where id = $1", [
          projectId,
        ]),
      );
      expect(v.is_stale).toBe(true);
    });
  });

  it("complete_task: Inbox-Aufgabe wiederholt sich in der Inbox (Migration 17)", async () => {
    await asA(async (tx) => {
      const t = await one<{ id: string }>(
        tx,
        `insert into public.tasks (area_id, in_inbox, title, sort, due_date, recurrence)
         values (null, true, 'Pflanzen gießen', 'a0', '2026-10-18', 'FREQ=WEEKLY') returning id`,
      );
      const r = await one<{ r: { next_id: string } }>(
        tx,
        "select public.complete_task($1, '2026-10-25') as r",
        [t.id],
      );
      const next = await one<{ in_inbox: boolean; area_id: string | null }>(
        tx,
        "select in_inbox, area_id from public.tasks where id = $1",
        [r.r.next_id],
      );
      expect(next).toEqual({ in_inbox: true, area_id: null });
    });
  });

  it("complete_task erzeugt die Folgeinstanz, undo_complete_task entfernt sie wieder", async () => {
    await asA(async (tx) => {
      const area = await areaId(tx, "privat");
      const body = { type: "doc", content: [{ type: "taskItem", attrs: { checked: true } }] };
      const t = await one<{ id: string }>(
        tx,
        `insert into public.tasks (area_id, title, sort, due_date, scheduled_at, recurrence, body)
         values ($1, 'Wochenreview', 'a5', '2026-10-18', '2026-10-18 18:00+02', 'FREQ=WEEKLY;BYDAY=SU', $2) returning id`,
        [area, JSON.stringify(body)],
      );
      const nextId = "00000000-0000-4000-8000-0000000000f1";
      const r = await one<{ r: { completed_id: string; next_id: string } }>(
        tx,
        "select public.complete_task($1, '2026-10-25', $2) as r",
        [t.id, nextId],
      );
      expect(r.r).toEqual({ completed_id: t.id, next_id: nextId });

      const next = await one<{
        status: string;
        due_date: string;
        local_time: string;
        sort: string;
        body: typeof body;
        src: string;
      }>(
        tx,
        `select status, due_date::text, to_char(scheduled_at at time zone 'Europe/Berlin', 'HH24:MI') as local_time,
                sort, body, recurrence_source_id as src
           from public.tasks where id = $1`,
        [nextId],
      );
      // Zeitumstellung am 25.10.2026: Uhrzeit bleibt 18:00 Ortszeit
      expect(next).toMatchObject({
        status: "offen",
        due_date: "2026-10-25",
        local_time: "18:00",
        sort: "a5V",
        src: t.id,
      });
      expect(next.body.content[0]?.attrs.checked).toBe(false);

      // zweiter Aufruf ist idempotent
      const again = await one<{ r: { next_id: string } }>(
        tx,
        "select public.complete_task($1, '2026-10-25') as r",
        [t.id],
      );
      expect(again.r.next_id).toBe(nextId);

      const undo = await one<{ r: { removed_ids: string[] } }>(
        tx,
        "select public.undo_complete_task($1) as r",
        [t.id],
      );
      expect(undo.r.removed_ids).toEqual([nextId]);
      const state = await one<{ status: string; next_deleted: boolean }>(
        tx,
        "select status, (select deleted_at is not null from public.tasks where id = $2) as next_deleted from public.tasks where id = $1",
        [t.id, nextId],
      );
      expect(state).toEqual({ status: "offen", next_deleted: true });
    });
  });

  it("week_stats zählt in Europe/Berlin (Woche mit Zeitumstellung 25.10.2026)", async () => {
    // eigener Nutzer, damit andere Tests die Zahlen nicht beeinflussen
    const user = "00000000-0000-4000-8000-0000000000d1";
    await createUser(db, user, "d@test.local");
    const stats = await as(db, { role: "authenticated", userId: user }, async (tx) => {
      const fw = await areaId(tx, "beruf");
      const privat = await areaId(tx, "privat");
      const ins = (area: string, title: string, completed: string | null, focus: string | null) =>
        tx.query(
          `insert into public.tasks (area_id, title, sort, status, completed_at, focus_date)
           values ($1, $2, 'a0', $3, $4, $5)`,
          [area, title, completed ? "erledigt" : "offen", completed, focus],
        );
      // Montag 19.10. 00:30 Ortszeit (= 18.10. 22:30 UTC) zählt zur Woche
      await ins(fw, "früh", "2026-10-18T22:30:00Z", null);
      // Sonntag 25.10. 23:30 Ortszeit (Winterzeit, = 22:30 UTC) zählt noch zur Woche
      await ins(privat, "spät", "2026-10-25T22:30:00Z", "2026-10-25");
      // Montag 26.10. 00:30 Ortszeit (= 25.10. 23:30 UTC) zählt nicht mehr
      await ins(privat, "danach", "2026-10-25T23:30:00Z", null);
      // Fokus 20.10.: eine von zwei erledigt → kein Fokus-Tag
      await ins(fw, "fokus erledigt", "2026-10-20T10:00:00Z", "2026-10-20");
      await ins(fw, "fokus offen", null, "2026-10-20");
      return one<{ s: Record<string, unknown> }>(
        tx,
        "select public.week_stats('2026-10-19', '2026-10-25') as s",
      );
    });
    expect(stats.s).toMatchObject({
      period: { start: "2026-10-19", end: "2026-10-25" },
      tasks_done: { total: 3 },
      milestones_done: 0,
      focus_days: { achieved: 1, planned: 2 },
    });
    const byArea = (stats.s.tasks_done as { by_area: { name: string; count: number }[] }).by_area;
    expect(byArea).toEqual([
      expect.objectContaining({ name: "Beruf", count: 2 }),
      expect.objectContaining({ name: "Privat", count: 1 }),
    ]);
  });

  it("week_stats: Tagesverlauf je Tag (erledigt, Meilensteine, neue und bearbeitete Notizen)", async () => {
    const user = "00000000-0000-4000-8000-0000000000d2";
    await createUser(db, user, "d2@test.local");
    const stats = await as(db, { role: "authenticated", userId: user }, async (tx) => {
      const fw = await areaId(tx, "beruf");
      await tx.query(
        `insert into public.tasks (area_id, title, sort, status, completed_at)
         values ($1, 'Schläuche prüfen', 'a0', 'erledigt', '2026-10-13T08:00:00Z'),
                ($1, 'Bericht', 'a1', 'erledigt', '2026-10-13T15:00:00Z'),
                ($1, 'Offen', 'a2', 'offen', null)`,
        [fw],
      );
      const project = await one<{ id: string }>(
        tx,
        "insert into public.projects (area_id, title, sort) values ($1, 'Übung', 'a0') returning id",
        [fw],
      );
      await tx.query(
        "insert into public.milestones (project_id, title, sort, done_at) values ($1, 'Plan steht', 'a0', '2026-10-15T09:00:00Z')",
        [project.id],
      );
      // neu am Mittwoch; eine ältere Notiz zuletzt am Freitag bearbeitet
      await tx.query(
        `insert into public.notes (area_id, title, type, created_at, updated_at)
         values ($1, 'Neue Notiz', 'wissen', '2026-10-14T10:00:00Z', '2026-10-14T11:00:00Z'),
                ($1, 'Alte Notiz', 'wissen', '2026-09-01T10:00:00Z', '2026-10-16T12:00:00Z')`,
        [fw],
      );
      return one<{ s: Record<string, unknown> }>(
        tx,
        "select public.week_stats('2026-10-12', '2026-10-18') as s",
      );
    });
    const activity = stats.s.activity as Array<{
      date: string;
      done: { title: string }[];
      milestones: { title: string }[];
      notes_created: { title: string }[];
      notes_edited: { title: string }[];
    }>;
    expect(activity).toHaveLength(7);
    const day = (date: string) => activity.find((d) => d.date === date);
    expect(day("2026-10-13")?.done.map((t) => t.title)).toEqual(["Schläuche prüfen", "Bericht"]);
    expect(day("2026-10-14")?.notes_created.map((n) => n.title)).toEqual(["Neue Notiz"]);
    expect(day("2026-10-14")?.notes_edited).toEqual([]);
    expect(day("2026-10-15")?.milestones.map((m) => m.title)).toEqual(["Plan steht"]);
    expect(day("2026-10-16")?.notes_edited.map((n) => n.title)).toEqual(["Alte Notiz"]);
    expect(stats.s).toMatchObject({
      milestones_done: 1,
      notes_created: 1,
      tasks_done: { total: 2 },
    });
  });

  it("recaps.questions hält die Leitfragen als Liste fest", async () => {
    await asA(async (tx) => {
      const r = await one<{ questions: unknown[] }>(
        tx,
        `insert into public.recaps (kind, period_start, period_end, questions)
         values ('woche', '2026-09-28', '2026-10-04', '[{"key": "good", "label": "Was lief gut?", "type": "text"}]')
         returning questions`,
      );
      expect(r.questions).toHaveLength(1);
      await expect(
        tx.query(
          "insert into public.recaps (kind, period_start, period_end, questions) values ('woche', '2026-09-21', '2026-09-27', '{}')",
        ),
      ).rejects.toThrow();
    });
  });

  it("recaps.review hält den Stand des Wochenreviews als Objekt (Migration 33, S1c)", async () => {
    await asA(async (tx) => {
      const r = await one<{ review: object }>(
        tx,
        "insert into public.recaps (kind, period_start, period_end) values ('woche', '2026-08-31', '2026-09-06') returning review",
      );
      expect(r.review).toEqual({});
      await expect(
        tx.query(
          "insert into public.recaps (kind, period_start, period_end, review) values ('woche', '2026-08-24', '2026-08-30', '[]')",
        ),
      ).rejects.toThrow();
    });
  });

  it("close_recap speichert einen stabilen Snapshot", async () => {
    await asA(async (tx) => {
      const r = await one<{ id: string }>(
        tx,
        "insert into public.recaps (kind, period_start, period_end, answers) values ('woche', '2026-10-05', '2026-10-11', '{\"good\": \"Viel geschafft\"}') returning id",
      );
      const closed = await one<{ stats: object; closed_at: Date }>(
        tx,
        "select stats, closed_at from public.close_recap($1)",
        [r.id],
      );
      expect(closed.stats).toHaveProperty("tasks_done");
      const again = await one<{ closed_at: Date }>(
        tx,
        "select closed_at from public.close_recap($1)",
        [r.id],
      );
      expect(again.closed_at).toEqual(closed.closed_at);
    });
  });

  it("search_all: Stemming, Präfix für Komposita, Teilwort, Bereichsfilter", async () => {
    await asA(async (tx) => {
      const fw = await areaId(tx, "beruf");
      const privat = await areaId(tx, "privat");
      await tx.query(
        "insert into public.tasks (area_id, title, sort) values ($1, 'Prüfung der Leitern', 'a0')",
        [fw],
      );
      const note = await one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title) values ($1, 'Gerätewartung') returning id",
        [fw],
      );
      await tx.query(
        "insert into public.note_blocks (note_id, content, content_text, sort) values ($1, '{\"type\":\"paragraph\"}', 'Jedes Atemschutzgerät jährlich prüfen', 'a0')",
        [note.id],
      );
      await tx.query(
        "insert into public.tasks (area_id, title, sort) values ($1, 'Urlaub planen', 'a0')",
        [privat],
      );

      const titles = async (q: string, area: string | null = null) =>
        (
          await tx.query<{ kind: string; title: string }>(
            "select kind, title from public.search_all($1, $2)",
            [q, area],
          )
        ).rows;

      expect(await titles("Prüfungen")).toContainEqual({
        kind: "aufgabe",
        title: "Prüfung der Leitern",
      });
      expect(await titles("Atemschutz")).toContainEqual({ kind: "notiz", title: "Gerätewartung" });
      expect(await titles("schutzger")).toContainEqual({ kind: "notiz", title: "Gerätewartung" });
      expect(await titles("Urlaub", fw)).toEqual([]);
      expect(await titles("Urlaub", privat)).toEqual([{ kind: "aufgabe", title: "Urlaub planen" }]);
      expect(await titles("x")).toEqual([]);
      expect(await titles("100%_")).toEqual([]);
    });
  });

  it("search_all: Teilwort erst ab 3 Zeichen, 2 Zeichen nur als Wortanfang (Migration 17)", async () => {
    await asA(async (tx) => {
      const fw = await areaId(tx, "beruf");
      await tx.query(
        "insert into public.tasks (area_id, title, sort) values ($1, 'Schlauchpflege', 'a0'), ($1, 'Pfadfinder', 'a1')",
        [fw],
      );
      const titles = async (q: string) =>
        (
          await tx.query<{ title: string }>("select title from public.search_all($1)", [q])
        ).rows.map((r) => r.title);
      // „pf“ steht mitten in „Schlauchpflege“ – zählt nicht mehr, „Pfadfinder“ beginnt damit
      const pf = await titles("pf");
      expect(pf).toContain("Pfadfinder");
      expect(pf).not.toContain("Schlauchpflege");
      expect(await titles("pfl")).toContain("Schlauchpflege");
    });
  });

  it("search_all: Tags und Themen mit 2 Zeichen als Wortanfang (Migration 29, T-5)", async () => {
    await asA(async (tx) => {
      const fw = await areaId(tx, "beruf");
      await tx.query(
        "insert into public.notes (area_id, title, tags) values ($1, 'Werkzeuge im Alltag', '{ki,eu-recht}')",
        [fw],
      );
      await tx.query(
        "insert into public.recaps (kind, period_start, period_end, themes) values ('woche', '2026-09-07', '2026-09-13', '{KI}')",
      );
      const found = async (q: string) =>
        (
          await tx.query<{ kind: string; title: string }>(
            "select kind, title from public.search_all($1)",
            [q],
          )
        ).rows;
      expect(await found("KI")).toContainEqual({ kind: "notiz", title: "Werkzeuge im Alltag" });
      expect(await found("#ki")).toContainEqual({ kind: "notiz", title: "Werkzeuge im Alltag" });
      expect(await found("eu")).toContainEqual({ kind: "notiz", title: "Werkzeuge im Alltag" });
      expect((await found("ki")).map((r) => r.kind)).toContain("rueckblick");
      // mitten im Tag zählt erst ab 3 Zeichen
      expect(await found("ec")).not.toContainEqual({ kind: "notiz", title: "Werkzeuge im Alltag" });
    });
  });

  it("Projekt-Links (Migration 22): Liste mit Höchstzahl, Link-Namen finden das Projekt", async () => {
    await asA(async (tx) => {
      const privat = await areaId(tx, "privat");
      await tx.query(
        `insert into public.projects (area_id, title, sort, links) values ($1, 'Steuer 2024', 'a0',
          '[{"id":"1","name":"Elster Portal","url":"https://www.elster.de"}]')`,
        [privat],
      );
      const rows = (
        await tx.query<{ kind: string; title: string }>(
          "select kind, title from public.search_all('Elster')",
        )
      ).rows;
      expect(rows).toContainEqual({ kind: "projekt", title: "Steuer 2024" });
      const p = await one<{ links: unknown }>(
        tx,
        "select links from public.projects where title = 'Steuer 2024'",
      );
      expect(p.links).toEqual([{ id: "1", name: "Elster Portal", url: "https://www.elster.de" }]);
      await expect(
        tx.query("update public.projects set links = '{}'::jsonb where title = 'Steuer 2024'"),
      ).rejects.toThrow();
    });
  });

  it("Aufgaben „zuletzt bearbeitet“ (Migration 23): nur Titel und Notiz zählen, nicht Status oder Datum", async () => {
    await asA(async (tx) => {
      const privat = await areaId(tx, "privat");
      const task = await one<{ id: string; edited_at: string | null }>(
        tx,
        `insert into public.tasks (area_id, title, sort, edited_at) values ($1, 'Reifen wechseln', 'a0', now())
         returning id, edited_at`,
        [privat],
      );
      expect(task.edited_at).toBeNull();
      const editedAt = async () =>
        (
          await one<{ edited_at: string | null }>(
            tx,
            "select edited_at from public.tasks where id = $1",
            [task.id],
          )
        ).edited_at;
      await tx.query(
        "update public.tasks set status = 'in_arbeit', due_date = current_date where id = $1",
        [task.id],
      );
      await tx.query("update public.tasks set edited_at = now() where id = $1", [task.id]);
      expect(await editedAt()).toBeNull();
      await tx.query("update public.tasks set title = 'Reifen wechseln lassen' where id = $1", [
        task.id,
      ]);
      const afterTitle = await editedAt();
      expect(afterTitle).not.toBeNull();
      await tx.query("update public.tasks set priority = 1 where id = $1", [task.id]);
      expect(await editedAt()).toEqual(afterTitle);
      await tx.query(
        `update public.tasks set body = '{"type":"doc","content":[{"type":"paragraph"}]}' where id = $1`,
        [task.id],
      );
      expect(await editedAt()).not.toBeNull();
    });
  });

  it("Freitext im Projekt (Migration 24): Dokument + Klartext, der Klartext findet das Projekt", async () => {
    await asA(async (tx) => {
      const privat = await areaId(tx, "privat");
      await tx.query(
        `insert into public.projects (area_id, title, sort, body, body_text) values ($1, 'Gartenhaus', 'a0',
          '{"type":"doc","content":[{"type":"paragraph"}]}', 'Absprache mit dem Zimmermann wegen Dachlatten')`,
        [privat],
      );
      const rows = (
        await tx.query<{ kind: string; title: string }>(
          "select kind, title from public.search_all('Zimmermann')",
        )
      ).rows;
      expect(rows).toContainEqual({ kind: "projekt", title: "Gartenhaus" });
      await expect(
        tx.query("update public.projects set body = '[]'::jsonb where title = 'Gartenhaus'"),
      ).rejects.toThrow();
    });
  });

  it("Notiz-Typen (Migration 25): eigener Typ, Löschen verschiebt Notizen, Wissen bleibt, Rückgängig", async () => {
    // je erwarteter Fehler eine eigene Transaktion (ein Fehler bricht die Transaktion ab)
    const keys = () =>
      asB(async (tx) =>
        (
          await tx.query<{ key: string }>(
            "select key from public.note_types where deleted_at is null order by sort",
          )
        ).rows.map((r) => r.key),
      );
    // Migration 26: Idee ist der Standard und steht vorn
    expect(await keys()).toEqual([
      "idee",
      "wissen",
      "protokoll",
      "anleitung",
      "journal",
      "rueckblick",
    ]);
    const note = await asB(async (tx) => {
      const privat = await areaId(tx, "privat");
      await tx.query(
        "insert into public.note_types (key, name, sort) values ('besprechung', 'Besprechung', 'a6')",
      );
      await tx.query(
        "update public.templates set note_type = 'besprechung' where seed_key = 'protokoll'",
      );
      return one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title, type) values ($1, 'Dienstbesprechung', 'besprechung') returning id",
        [privat],
      );
    });
    await expect(
      asB((tx) =>
        tx.query("insert into public.note_types (key, name, sort) values ('Böse Typ', 'x', 'a7')"),
      ),
    ).rejects.toThrow();
    await expect(
      asB((tx) => tx.query("select public.delete_note_type('idee', 'wissen')")),
    ).rejects.toThrow(/Standardtyp „Idee“/);
    await expect(
      asB((tx) => tx.query("select public.delete_note_type('besprechung', 'gibtsnicht')")),
    ).rejects.toThrow(/Zieltyp/);

    // M-6 (Migration 48): ohne zweiten Faktor (KI-Token) laufen die Funktionen gar nicht an
    for (const call of [
      "select public.delete_note_type('besprechung', 'protokoll')",
      "select public.restore_note_type('besprechung', '{}')",
    ]) {
      await expect(
        as(db, { role: "authenticated", userId: B, aal: "aal1" }, (tx) => tx.query(call)),
        call,
      ).rejects.toThrow(/nur der Nutzer in der App/);
    }
    expect(
      await asB((tx) =>
        one<{ type: string }>(tx, "select type from public.notes where id = $1", [note.id]),
      ),
    ).toEqual({ type: "besprechung" });
    await asB((tx) => tx.query("select public.delete_note_type('besprechung', 'protokoll')"));
    const after = await asB((tx) =>
      one<{ type: string; tpl: string }>(
        tx,
        `select (select type from public.notes where id = $1) as type,
                (select note_type from public.templates where seed_key = 'protokoll') as tpl`,
        [note.id],
      ),
    );
    expect(after).toEqual({ type: "protokoll", tpl: "protokoll" });
    expect(await keys()).not.toContain("besprechung");

    await asB((tx) => tx.query("select public.restore_note_type('besprechung', $1)", [[note.id]]));
    expect(await keys()).toContain("besprechung");
    const back = await asB((tx) =>
      one<{ type: string }>(tx, "select type from public.notes where id = $1", [note.id]),
    );
    expect(back.type).toBe("besprechung");

    // Rückgängig holt auch Vorlagen und Notizen im Papierkorb zurück (Migration 29, D-13)
    const trashed = await asB(async (tx) => {
      const privat = await areaId(tx, "privat");
      const row = await one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title, type, deleted_at) values ($1, 'Alte Besprechung', 'besprechung', now()) returning id",
        [privat],
      );
      await tx.query("select public.delete_note_type('besprechung', 'protokoll')");
      // nach dem Löschen selbst umgestellt: bleibt beim Rückgängig, wie es ist
      await tx.query("update public.notes set type = 'journal' where id = $1", [note.id]);
      await tx.query("select public.restore_note_type('besprechung', '{}')");
      return row;
    });
    const restored = await asB((tx) =>
      one<{ trashed: string; kept: string; tpl: string; moved: unknown }>(
        tx,
        `select (select type from public.notes where id = $1) as trashed,
                (select type from public.notes where id = $2) as kept,
                (select note_type from public.templates where seed_key = 'protokoll') as tpl,
                (select moved from public.note_types where key = 'besprechung') as moved`,
        [trashed.id, note.id],
      ),
    );
    expect(restored).toEqual({
      trashed: "besprechung",
      kept: "journal",
      tpl: "besprechung",
      moved: null,
    });
    await asB((tx) =>
      tx.query("update public.notes set type = 'besprechung' where id = $1", [note.id]),
    );

    // ohne Typ angelegt: Idee (Migration 26)
    const plain = await asB(async (tx) => {
      const privat = await areaId(tx, "privat");
      return one<{ type: string }>(
        tx,
        "insert into public.notes (area_id, title) values ($1, 'Schnell notiert') returning type",
        [privat],
      );
    });
    expect(plain.type).toBe("idee");
    // „wissen“ ist jetzt ein normaler Typ und lässt sich löschen (und zurückholen)
    await asB((tx) => tx.query("select public.delete_note_type('wissen', 'idee')"));
    await asB((tx) => tx.query("select public.restore_note_type('wissen', '{}')"));

    // Papierkorb: endgültig löschen nur Gelöschtes, nie „wissen“
    const purged = await asB(async (tx) => {
      await tx.query("select public.delete_note_type('besprechung', 'wissen')");
      await tx.query("update public.note_types set deleted_at = now() where key = 'idee'");
      const ids = (
        await tx.query<{ id: string }>(
          "select id from public.note_types where key in ('besprechung', 'idee')",
        )
      ).rows.map((r) => r.id);
      const result = await one<{ n: number }>(
        tx,
        "select public.empty_trash('note_types', $1) as n",
        [ids],
      );
      await tx.query("update public.note_types set deleted_at = null where key = 'idee'");
      await tx.query(
        "update public.templates set note_type = 'protokoll' where seed_key = 'protokoll'",
      );
      return result.n;
    });
    expect(purged).toBe(1);
  });

  it("Notiz-Typen zählen als Wissen (Migration 39): Wissen/Anleitung an, alle anderen aus, eigener Typ aus, Schalter änderbar, Löschen/Rückgängig behält ihn", async () => {
    const flags = () =>
      asB(
        async (tx) =>
          (
            await tx.query<{ key: string; counts_as_knowledge: boolean }>(
              "select key, counts_as_knowledge from public.note_types where deleted_at is null order by sort",
            )
          ).rows,
      );
    // Bestand (B wurde vor Migration 25 angelegt) und Seeds: Wissen und Anleitung (Abläufe)
    const start = await flags();
    expect(start.filter((t) => t.counts_as_knowledge).map((t) => t.key)).toEqual([
      "wissen",
      "anleitung",
    ]);
    expect(start).toHaveLength(6);
    await asB(async (tx) => {
      // eigener Typ: Standard aus
      await tx.query(
        "insert into public.note_types (key, name, sort) values ('fahrzeuge', 'Fahrzeuge', 'a8')",
      );
      expect(
        (
          await one<{ counts_as_knowledge: boolean }>(
            tx,
            "select counts_as_knowledge from public.note_types where key = 'fahrzeuge'",
          )
        ).counts_as_knowledge,
      ).toBe(false);
      // einstellbar, auch ausschalten
      await tx.query(
        "update public.note_types set counts_as_knowledge = true where key = 'fahrzeuge'",
      );
      await tx.query(
        "update public.note_types set counts_as_knowledge = false where key = 'anleitung'",
      );
      // Löschen und Rückgängig lassen den Schalter stehen
      await tx.query("select public.delete_note_type('fahrzeuge', 'idee')");
      await tx.query("select public.restore_note_type('fahrzeuge', '{}')");
      const after = await one<{ counts_as_knowledge: boolean }>(
        tx,
        "select counts_as_knowledge from public.note_types where key = 'fahrzeuge'",
      );
      expect(after.counts_as_knowledge).toBe(true);
      // zurückstellen (die Tests teilen den Nutzer)
      await tx.query("delete from public.note_types where key = 'fahrzeuge'");
      await tx.query(
        "update public.note_types set counts_as_knowledge = true where key = 'anleitung'",
      );
    });
  });

  it("search_all: Rückblicke mit Kalenderwoche im Titel, Themen durchsuchbar (Migration 17)", async () => {
    await asA(async (tx) => {
      await tx.query(
        "insert into public.recaps (kind, period_start, period_end, themes) values ('woche', '2026-10-12', '2026-10-18', '{schlafmangel}')",
      );
      const rows = (
        await tx.query<{ kind: string; title: string }>(
          "select kind, title from public.search_all('schlaf')",
        )
      ).rows;
      expect(rows).toContainEqual({ kind: "rueckblick", title: "Wochenrückblick KW 42" });
    });
  });

  it("search_all: mehrere Wörter – ein Wort reicht, alle Wörter stehen oben (Migration 12)", async () => {
    await asA(async (tx) => {
      const fw = await areaId(tx, "beruf");
      await tx.query(
        "insert into public.projects (area_id, title, status, sort) values ($1, 'Digitale Werkstatt', 'aktiv', 'a0')",
        [fw],
      );
      await tx.query(
        "insert into public.tasks (area_id, title, sort) values ($1, 'Demo Werkstatt software ablauf', 'a0')",
        [fw],
      );
      const titles = async (q: string) =>
        (
          await tx.query<{ kind: string; title: string }>(
            "select kind, title from public.search_all($1)",
            [q],
          )
        ).rows;

      const mixed = await titles("digitale Software");
      expect(mixed).toContainEqual({ kind: "projekt", title: "Digitale Werkstatt" });
      expect(mixed).toContainEqual({ kind: "aufgabe", title: "Demo Werkstatt software ablauf" });
      // alle Wörter im selben Eintrag → ganz oben
      expect((await titles("Werkstatt Software"))[0]).toEqual({
        kind: "aufgabe",
        title: "Demo Werkstatt software ablauf",
      });
      expect((await titles("digitale werkstatt"))[0]).toEqual({
        kind: "projekt",
        title: "Digitale Werkstatt",
      });
      // Einzelbuchstaben zählen nicht
      expect(await titles("Werkstatt b")).toEqual(await titles("Werkstatt"));
    });
  });

  it("empty_trash löscht nur Einträge im Papierkorb, Notizen samt Blöcken", async () => {
    await asA(async (tx) => {
      const area = await areaId(tx, "privat");
      const live = await one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title) values ($1, 'bleibt') returning id",
        [area],
      );
      const trashed = await one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title, deleted_at) values ($1, 'weg', now()) returning id",
        [area],
      );
      await tx.query(
        "insert into public.note_blocks (note_id, content_text, sort) values ($1, 'x', 'a0')",
        [trashed.id],
      );
      const n = await one<{ n: number }>(tx, "select public.empty_trash('notes', $1) as n", [
        [live.id, trashed.id],
      ]);
      expect(n.n).toBe(1);
      const left = await one<{ notes: number; blocks: number }>(
        tx,
        "select (select count(*)::int from public.notes where id in ($1, $2)) as notes, (select count(*)::int from public.note_blocks where note_id = $2) as blocks",
        [live.id, trashed.id],
      );
      expect(left).toEqual({ notes: 1, blocks: 0 });
      await expect(tx.query("select public.empty_trash('areas', '{}')")).rejects.toThrow(
        /Unbekannter Typ/,
      );
    });
  });

  it("Kalenderquellen (Migration 30): Adresse nur https/http, Farbe als Schlüssel, Papierkorb", async () => {
    await asA(async (tx) => {
      const source = await one<{ id: string; color: string; enabled: boolean }>(
        tx,
        `insert into public.calendar_sources (name, url, sort)
           values ('Dienst', 'https://calendar.google.com/calendar/ical/x/private-1/basic.ics', 'a0')
         returning id, color, enabled`,
      );
      expect(source.color).toBe("blau");
      expect(source.enabled).toBe(true);
      // Papierkorb: empty_trash löscht nur Gelöschtes
      const kept = await one<{ n: number }>(
        tx,
        "select public.empty_trash('calendar_sources', $1) as n",
        [[source.id]],
      );
      expect(kept.n).toBe(0);
      await tx.query("update public.calendar_sources set deleted_at = now() where id = $1", [
        source.id,
      ]);
      const purged = await one<{ n: number }>(
        tx,
        "select public.empty_trash('calendar_sources', $1) as n",
        [[source.id]],
      );
      expect(purged.n).toBe(1);
    });
    // ungültige Werte (jede in eigener Transaktion: ein Fehler bricht die Transaktion ab)
    const bad = [
      "insert into public.calendar_sources (name, url, sort) values ('x', 'ftp://a.b/c.ics', 'a1')",
      "insert into public.calendar_sources (name, url, color, sort) values ('x', 'https://calendar.google.com/calendar/ical/x/y.ics', '#ff0000', 'a1')",
      "insert into public.calendar_sources (name, url, sort) values ('  ', 'https://calendar.google.com/calendar/ical/x/y.ics', 'a1')",
    ];
    for (const sql of bad) {
      await expect(
        asA((tx) => tx.query(sql)),
        sql,
      ).rejects.toThrow(/check constraint/);
    }
  });

  it("Kalenderquellen (Migration 36): Art ical/google, Google ohne Adresse, je Kalender einmal", async () => {
    const GCAL = "e2e-alex@example.com";
    await asA(async (tx) => {
      // vorhandene Zeilen sind „ical“
      const ical = await one<{ kind: string; google_calendar_id: string | null }>(
        tx,
        `insert into public.calendar_sources (name, url, sort)
           values ('iCal', 'https://calendar.google.com/calendar/ical/x/private-1/basic.ics', 'b0')
         returning kind, google_calendar_id`,
      );
      expect(ical).toEqual({ kind: "ical", google_calendar_id: null });
      const google = await one<{ url: string | null; enabled: boolean }>(
        tx,
        `insert into public.calendar_sources (kind, google_calendar_id, name, sort)
           values ('google', $1, 'Hauptkalender', 'b1') returning url, enabled`,
        [GCAL],
      );
      expect(google).toEqual({ url: null, enabled: true });
      // im Papierkorb darf derselbe Kalender ein zweites Mal liegen
      await tx.query(
        "update public.calendar_sources set deleted_at = now() where google_calendar_id = $1",
        [GCAL],
      );
      await tx.query(
        `insert into public.calendar_sources (kind, google_calendar_id, name, sort)
           values ('google', $1, 'Hauptkalender', 'b2')`,
        [GCAL],
      );
    });
    // derselbe Google-Kalender zweimal lebend → abgelehnt
    await expect(
      asA((tx) =>
        tx.query(
          `insert into public.calendar_sources (kind, google_calendar_id, name, sort)
             values ('google', $1, 'Doppelt', 'b3')`,
          [GCAL],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
    // B hat seinen eigenen Namensraum
    await asB((tx) =>
      tx.query(
        `insert into public.calendar_sources (kind, google_calendar_id, name, sort)
           values ('google', $1, 'B', 'a0')`,
        [GCAL],
      ),
    );
    expect(
      await asB((tx) =>
        one<{ n: number }>(tx, "select count(*)::int as n from public.calendar_sources"),
      ),
    ).toEqual({ n: 1 });
    // ungültige Kombinationen (jede in eigener Transaktion)
    const bad = [
      // iCal ohne Adresse
      "insert into public.calendar_sources (name, sort) values ('x', 'b4')",
      // Google ohne Kalender-ID
      "insert into public.calendar_sources (kind, name, sort) values ('google', 'x', 'b4')",
      // Google mit geheimer Adresse
      "insert into public.calendar_sources (kind, google_calendar_id, url, name, sort) values ('google', 'g@example.com', 'https://calendar.google.com/calendar/ical/x/y.ics', 'x', 'b4')",
      // iCal mit Google-ID
      "insert into public.calendar_sources (google_calendar_id, url, name, sort) values ('g@example.com', 'https://calendar.google.com/calendar/ical/x/y.ics', 'x', 'b4')",
      // unbekannte Art
      "insert into public.calendar_sources (kind, url, name, sort) values ('outlook', 'https://a.b/c.ics', 'x', 'b4')",
    ];
    for (const sql of bad) {
      await expect(
        asA((tx) => tx.query(sql)),
        sql,
      ).rejects.toThrow(/check constraint/);
    }
    await asA((tx) => tx.query("delete from public.calendar_sources where sort like 'b%'"));
    await asB((tx) => tx.query("delete from public.calendar_sources"));
  });

  it("Google-Kalender aus dem Papierkorb holen (Migration 38, G-4): Zurückholen gewinnt, die andere Zeile wandert in den Papierkorb", async () => {
    const GCAL = "g4-alex@example.com";
    const OLD = "00000000-0000-4000-8000-0000000000c1";
    const NEW = "00000000-0000-4000-8000-0000000000c2";
    const ICAL = "00000000-0000-4000-8000-0000000000c3";
    await asA(async (tx) => {
      // alte Zeile im Papierkorb, neue lebende Zeile für denselben Kalender, dazu eine iCal-Quelle
      await tx.query(
        `insert into public.calendar_sources (id, kind, google_calendar_id, name, color, sort, deleted_at)
           values ($1, 'google', $3, 'Alt', 'lila', 'g1', now() - interval '1 day'),
                  ($2, 'google', $3, 'Neu', 'blau', 'g2', null)`,
        [OLD, NEW, GCAL],
      );
      await tx.query(
        `insert into public.calendar_sources (id, name, url, sort)
           values ($1, 'iCal', 'https://calendar.google.com/calendar/ical/g4/private-1/basic.ics', 'g3')`,
        [ICAL],
      );
    });
    // vorher: Zurückholen scheiterte am Index – jetzt geht es
    await asA((tx) =>
      tx.query("update public.calendar_sources set deleted_at = null where id = $1", [OLD]),
    );
    const rows = await asA((tx) =>
      tx.query<{ id: string; deleted: boolean }>(
        `select id, deleted_at is not null as deleted from public.calendar_sources
          where id = any($1::uuid[]) order by id`,
        [[OLD, NEW, ICAL]],
      ),
    );
    expect(rows.rows).toEqual([
      { id: OLD, deleted: false },
      { id: NEW, deleted: true },
      { id: ICAL, deleted: false },
    ]);
    // und zurück: die andere zurückholen tauscht wieder (nichts geht verloren)
    await asA((tx) =>
      tx.query("update public.calendar_sources set deleted_at = null where id = $1", [NEW]),
    );
    const swapped = await asA((tx) =>
      tx.query<{ id: string; deleted: boolean }>(
        `select id, deleted_at is not null as deleted from public.calendar_sources
          where id = any($1::uuid[]) order by id`,
        [[OLD, NEW]],
      ),
    );
    expect(swapped.rows).toEqual([
      { id: OLD, deleted: true },
      { id: NEW, deleted: false },
    ]);
    // Zurückholen per Upsert (feste ID der App) wirkt genauso
    await asA((tx) =>
      tx.query(
        `insert into public.calendar_sources (id, kind, google_calendar_id, name, sort, deleted_at)
           values ($1, 'google', $2, 'Alt', 'g1', null)
         on conflict (id) do update set deleted_at = excluded.deleted_at, name = excluded.name`,
        [OLD, GCAL],
      ),
    );
    expect(
      await asA((tx) =>
        one<{ n: number }>(
          tx,
          `select count(*)::int as n from public.calendar_sources
            where google_calendar_id = $1 and deleted_at is null`,
          [GCAL],
        ),
      ),
    ).toEqual({ n: 1 });
    // B: dieselbe Kalender-ID bei einem anderen Nutzer bleibt unberührt
    const B_ROW = "00000000-0000-4000-8000-0000000000c4";
    await asB((tx) =>
      tx.query(
        `insert into public.calendar_sources (id, kind, google_calendar_id, name, sort)
           values ($1, 'google', $2, 'B', 'b0')`,
        [B_ROW, GCAL],
      ),
    );
    await asA((tx) =>
      tx.query("update public.calendar_sources set deleted_at = now() where id = $1", [OLD]),
    );
    await asA((tx) =>
      tx.query("update public.calendar_sources set deleted_at = null where id = $1", [OLD]),
    );
    expect(
      await asB((tx) =>
        one<{ deleted: boolean }>(
          tx,
          "select deleted_at is not null as deleted from public.calendar_sources where id = $1",
          [B_ROW],
        ),
      ),
    ).toEqual({ deleted: false });
    // zwei lebende Zeilen anlegen bleibt verboten
    await expect(
      asA((tx) =>
        tx.query(
          `insert into public.calendar_sources (kind, google_calendar_id, name, sort)
             values ('google', $1, 'Doppelt', 'g9')`,
          [GCAL],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
    await asA((tx) =>
      tx.query("delete from public.calendar_sources where id = any($1::uuid[])", [
        [OLD, NEW, ICAL],
      ]),
    );
    await asB((tx) => tx.query("delete from public.calendar_sources where id = $1", [B_ROW]));
  });

  it("Google-Konto (Migration 36): eine Zeile je Nutzer, Token verschlüsselt, Trennen leert ihn", async () => {
    const TOKEN = "v1:aXY:dGFn:ZGF0YQ";
    const row = await asA((tx) =>
      one<{ user_id: string; scope: string; deleted_at: Date | null }>(
        tx,
        `insert into public.google_accounts (email, refresh_token_enc, scope)
           values ('e2e-alex@example.com', $1, 'calendar.events') returning user_id, scope, deleted_at`,
        [TOKEN],
      ),
    );
    expect(row).toEqual({ user_id: A, scope: "calendar.events", deleted_at: null });
    // zweite Zeile → abgelehnt; neu verbinden = Upsert auf user_id
    await expect(
      asA((tx) =>
        tx.query(
          "insert into public.google_accounts (email, refresh_token_enc) values ('x@example.com', $1)",
          [TOKEN],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
    await asA((tx) =>
      tx.query(
        `insert into public.google_accounts (email, refresh_token_enc, scope) values ('e2e-alex@example.com', $1, 'neu')
           on conflict (user_id) do update set refresh_token_enc = excluded.refresh_token_enc, scope = excluded.scope, deleted_at = null`,
        [TOKEN],
      ),
    );
    // Klartext oder fremdes Format nimmt die Spalte nicht; lebend ohne Token geht nicht
    for (const sql of [
      "update public.google_accounts set refresh_token_enc = '1//0gKlartext-Token'",
      "update public.google_accounts set refresh_token_enc = null",
      "update public.google_accounts set email = ''",
    ]) {
      await expect(
        asA((tx) => tx.query(sql)),
        sql,
      ).rejects.toThrow(/check constraint/);
    }
    // B sieht und ändert nichts davon
    expect(
      await asB((tx) =>
        one<{ n: number }>(tx, "select count(*)::int as n from public.google_accounts"),
      ),
    ).toEqual({ n: 0 });
    const hijack = await asB((tx) =>
      tx.query("update public.google_accounts set email = 'b@example.com' where user_id = $1", [A]),
    );
    expect(hijack.affectedRows).toBe(0);
    await expect(
      asB((tx) =>
        tx.query(
          "insert into public.google_accounts (user_id, email, refresh_token_enc) values ($1, 'b@example.com', $2)",
          [A, TOKEN],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // nur mit zweitem Faktor
    const asAal1 = <T>(fn: (tx: Transaction) => Promise<T>) =>
      as(db, { role: "authenticated", userId: A, aal: "aal1" }, fn);
    expect(
      await asAal1((tx) =>
        one<{ n: number }>(tx, "select count(*)::int as n from public.google_accounts"),
      ),
    ).toEqual({ n: 0 });
    // Trennen: Token leer + deleted_at
    const disconnected = await asA((tx) =>
      tx.query(
        "update public.google_accounts set refresh_token_enc = null, deleted_at = now() where deleted_at is null",
      ),
    );
    expect(disconnected.affectedRows).toBe(1);
    await asA((tx) => tx.query("delete from public.google_accounts"));
  });

  it("Migration 31: gespeicherte Ansichten kennen den Typ „kalender“, sonst nichts Neues", async () => {
    const insert = (type: string) =>
      asA((tx) =>
        tx.query(
          "insert into public.saved_views (entity, name, view_type, sort) values ('tasks', 'Monat', $1, 'k1')",
          [type],
        ),
      );
    for (const type of ["liste", "tabelle", "board", "kalender"]) {
      expect((await insert(type)).affectedRows, type).toBe(1);
    }
    await expect(insert("karte")).rejects.toThrow(/check constraint/);
    await asA((tx) => tx.query("delete from public.saved_views where name = 'Monat'"));
  });
});

describe("Bilder in Notizen (Migration 18): privater Bucket, nur der eigene Ordner, aal2", () => {
  const insert = (tx: Transaction, name: string) =>
    tx.query("insert into storage.objects (bucket_id, name) values ('note-images', $1)", [name]);

  it("Bucket ist privat, höchstens 5 MB, nur Bildtypen", async () => {
    const bucket = await one<{
      public: boolean;
      file_size_limit: string;
      allowed_mime_types: string[];
    }>(
      db as unknown as Transaction,
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'note-images'",
    );
    expect(bucket.public).toBe(false);
    expect(Number(bucket.file_size_limit)).toBe(5 * 1024 * 1024);
    expect(bucket.allowed_mime_types).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]);
  });

  // Seit Migration 44 (R2, E41) wird nichts mehr abgelegt: Altbestand legt der Test als Eigentümer an
  it("Altbestand: A liest den eigenen Ordner, B sieht nichts; niemand legt mehr etwas ab (Migration 44)", async () => {
    await db.query(
      "insert into storage.objects (bucket_id, name) values ('note-images', $1), ('note-images', $2)",
      [`${A}/note-1/bild.png`, `${A}/note-2/bleibt.png`],
    );
    const own = await asA((tx) =>
      tx.query("select name from storage.objects where bucket_id = 'note-images'"),
    );
    expect(own.rows).toHaveLength(2);
    await expect(asA((tx) => insert(tx, `${A}/note-4/neu.png`))).rejects.toThrow(
      /row-level security/,
    );
    await expect(asB((tx) => insert(tx, `${B}/note-1/fremd.png`))).rejects.toThrow(
      /row-level security/,
    );
    const seenByB = await asB((tx) =>
      tx.query("select name from storage.objects where bucket_id = 'note-images'"),
    );
    expect(seenByB.rows).toEqual([]);
  });

  it("ohne zweiten Faktor (aal1) nichts lesbar und nichts ablegbar", async () => {
    const asAal1 = <T>(fn: (tx: Transaction) => Promise<T>) =>
      as(db, { role: "authenticated", userId: A, aal: "aal1" }, fn);
    const rows = await asAal1((tx) =>
      tx.query("select name from storage.objects where bucket_id = 'note-images'"),
    );
    expect(rows.rows).toEqual([]);
    await expect(asAal1((tx) => insert(tx, `${A}/note-3/x.png`))).rejects.toThrow(
      /row-level security/,
    );
  });
});

describe("Dateien in Notizen und Aufgaben (Migration 19): privater Bucket, eigener Ordner, aal2", () => {
  const insert = (tx: Transaction, name: string) =>
    tx.query("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [name]);

  it("Bucket ist privat, höchstens 25 MB, alle Dateitypen", async () => {
    const bucket = await one<{
      public: boolean;
      file_size_limit: string;
      allowed_mime_types: string[] | null;
    }>(
      db as unknown as Transaction,
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'attachments'",
    );
    expect(bucket.public).toBe(false);
    expect(Number(bucket.file_size_limit)).toBe(25 * 1024 * 1024);
    expect(bucket.allowed_mime_types).toBeNull();
  });

  it("Altbestand: A liest den eigenen Ordner, B sieht nichts; niemand legt mehr etwas ab (Migration 44)", async () => {
    await db.query("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [
      `${A}/task-1/plan.pdf`,
    ]);
    const own = await asA((tx) =>
      tx.query("select name from storage.objects where bucket_id = 'attachments'"),
    );
    expect(own.rows).toHaveLength(1);
    await expect(asA((tx) => insert(tx, `${A}/task-2/neu.pdf`))).rejects.toThrow(
      /row-level security/,
    );
    await expect(asB((tx) => insert(tx, `${B}/task-1/fremd.pdf`))).rejects.toThrow(
      /row-level security/,
    );
    const seenByB = await asB((tx) =>
      tx.query("select name from storage.objects where bucket_id = 'attachments'"),
    );
    expect(seenByB.rows).toEqual([]);
  });

  it("ohne zweiten Faktor (aal1) nichts lesbar und nichts ablegbar", async () => {
    const asAal1 = <T>(fn: (tx: Transaction) => Promise<T>) =>
      as(db, { role: "authenticated", userId: A, aal: "aal1" }, fn);
    const rows = await asAal1((tx) =>
      tx.query("select name from storage.objects where bucket_id = 'attachments'"),
    );
    expect(rows.rows).toEqual([]);
    await expect(asAal1((tx) => insert(tx, `${A}/note-3/x.pdf`))).rejects.toThrow(
      /row-level security/,
    );
  });
});

describe("KI-Zugänge (Migration 21, E27 Fall B): nur freigegebene, vertrauliche Clients mit Sitzung", () => {
  const CLIENT = "00000000-0000-4000-8000-0000000000c1";
  const PUBLIC_CLIENT = "00000000-0000-4000-8000-0000000000c2";
  const OTHER_CLIENT = "00000000-0000-4000-8000-0000000000c3";
  const SESSION = "00000000-0000-4000-8000-0000000000d1";
  const PUBLIC_SESSION = "00000000-0000-4000-8000-0000000000d2";
  const OTHER_SESSION = "00000000-0000-4000-8000-0000000000d3";
  // Ein Token der KI: Supabase stellt es mit aal1 aus, dazu client_id und session_id
  const asAi = <T>(fn: (tx: Transaction) => Promise<T>, clientId = CLIENT, sessionId = SESSION) =>
    as(db, { role: "authenticated", userId: A, aal: "aal1", clientId, sessionId }, fn);
  const count = (tx: Transaction, name: string) =>
    one<{ n: number }>(tx, `select count(*)::int as n from public.${name}`).then((r) => r.n);
  const asAdmin = (sql: string, params: unknown[] = []) => db.query(sql, params);

  beforeAll(async () => {
    await asAdmin(
      `insert into auth.oauth_clients (id, client_name, client_type) values
         ($1, 'Claude', 'confidential'), ($2, 'Selbst registriert', 'public'), ($3, 'Andere', 'confidential')`,
      [CLIENT, PUBLIC_CLIENT, OTHER_CLIENT],
    );
    await asAdmin(
      `insert into auth.sessions (id, user_id, oauth_client_id, aal) values
         ($1, $4, $5, 'aal1'), ($2, $4, $6, 'aal1'), ($3, $4, $7, 'aal1')`,
      [SESSION, PUBLIC_SESSION, OTHER_SESSION, A, CLIENT, PUBLIC_CLIENT, OTHER_CLIENT],
    );
  });

  it("vor der Freigabe sieht das Token nichts und kann nichts anlegen", async () => {
    expect(await asAi((tx) => count(tx, "areas"))).toBe(0);
    expect(
      await asAi((tx) => one<{ ok: boolean }>(tx, "select public.ai_client_allowed() as ok")),
    ).toEqual({
      ok: false,
    });
  });

  it("freigeben geht nur mit aal2 – nicht mit Passwort allein und nicht durch die KI selbst", async () => {
    const allow = (tx: Transaction, client: string) =>
      tx.query("insert into public.ai_clients (client_id, name) values ($1, 'Claude')", [client]);
    await expect(
      as(db, { role: "authenticated", userId: A, aal: "aal1" }, (tx) => allow(tx, CLIENT)),
    ).rejects.toThrow(/row-level security/);
    await expect(asAi((tx) => allow(tx, CLIENT))).rejects.toThrow(/row-level security/);
    await asA((tx) => allow(tx, CLIENT));
    await asA((tx) => allow(tx, PUBLIC_CLIENT));
    expect(await asAi((tx) => count(tx, "ai_clients"))).toBe(0);
  });

  it("freigegeben: liest und schreibt die Inhalte der Werkzeuge wie die App", async () => {
    expect(await asAi((tx) => count(tx, "areas"))).toBe(2);
    const area = await asA((tx) => areaId(tx, "privat"));
    const task = await asAi((tx) =>
      one<{ id: string }>(
        tx,
        "insert into public.tasks (area_id, title, sort) values ($1, 'Von der KI', 'z7') returning id",
        [area],
      ),
    );
    await asAi((tx) => tx.query("select public.complete_task($1)", [task.id]));
    const found = await asAi((tx) => tx.query("select * from public.search_all('Von der KI')"));
    expect(found.rows.length).toBeGreaterThan(0);
    // Dateien: seit Migration 44 (R2) legt auch die KI in den alten Buckets nichts mehr ab
    await expect(
      asAi((tx) =>
        tx.query("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [
          `${A}/${task.id}/beleg.pdf`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await asA((tx) => tx.query("delete from public.tasks where id = $1", [task.id]));
  });

  it("created_by: Standard 'user', Check, KI-Token legt 'ai' an, die App kann nichts fälschen (Migration 40, #69)", async () => {
    const area = await asA((tx) => areaId(tx, "privat"));
    const createdBy = (id: string) =>
      asA((tx) =>
        one<{ c: string }>(tx, "select created_by as c from public.tasks where id = $1", [id]),
      ).then((r) => r.c);
    const insert = (run: typeof asA, extra = "", values: unknown[] = []) =>
      run((tx) =>
        one<{ id: string }>(
          tx,
          `insert into public.tasks (area_id, title, sort${extra ? ", created_by" : ""})
           values ($1, 'M40', 'z6'${extra ? `, ${extra}` : ""}) returning id`,
          [area, ...values],
        ),
      );
    // Standard und Anmeldung als App
    const own = await insert(asA);
    expect(await createdBy(own.id)).toBe("user");
    // die App schickt 'ai' mit: wird ignoriert
    const forged = await insert(asA, "'ai'");
    expect(await createdBy(forged.id)).toBe("user");
    // Ändern geht nicht
    await asA((tx) =>
      tx.query("update public.tasks set created_by = 'ai' where id = $1", [own.id]),
    );
    expect(await createdBy(own.id)).toBe("user");
    // Check
    await expect(
      asAdmin(
        "insert into public.tasks (user_id, area_id, title, sort, created_by) values ($1, $2, 'M40 x', 'z6', 'robot')",
        [A, area],
      ),
    ).rejects.toThrow(/tasks_created_by_check/);
    // KI-Token: 'ai', auch wenn es 'user' mitschickt; bei Stapeln jede Zeile
    const byAi = await insert(asAi, "'user'");
    expect(await createdBy(byAi.id)).toBe("ai");
    const batch = await asAi((tx) =>
      tx.query<{ id: string }>(
        `insert into public.tasks (area_id, title, sort) values ($1, 'M40 a', 'z6'), ($1, 'M40 b', 'z6') returning id`,
        [area],
      ),
    );
    for (const row of batch.rows) expect(await createdBy(row.id)).toBe("ai");
    // die KI kann es nachträglich nicht auf 'user' setzen, die App nicht auf 'ai'
    await asAi((tx) =>
      tx.query("update public.tasks set created_by = 'user' where id = $1", [byAi.id]),
    );
    expect(await createdBy(byAi.id)).toBe("ai");
    // Folgeaufgabe erbt von der Vorlage: Aufgabe des Nutzers, von der KI abgehakt, bleibt 'user'
    const recurring = await asA((tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.tasks (area_id, title, sort, due_date, recurrence)
         values ($1, 'M40 wiederholt', 'z6', '2026-10-20', 'FREQ=WEEKLY;BYDAY=TU') returning id`,
        [area],
      ),
    );
    await asAi((tx) =>
      tx.query("select public.complete_task($1, '2026-10-27', gen_random_uuid())", [recurring.id]),
    );
    const next = await asA((tx) =>
      one<{ c: string }>(
        tx,
        "select created_by as c from public.tasks where recurrence_source_id = $1",
        [recurring.id],
      ),
    );
    expect(next.c).toBe("user");
    // M-2 (Migration 48): legt ein KI-Token selbst eine „Folgeaufgabe“ auf eine Aufgabe des Nutzers an
    // (recurrence_source_id direkt per PostgREST), erbt sie nichts – sie ist von der KI
    const forgedNext = await asAi((tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.tasks (area_id, title, sort, recurrence_source_id)
         values ($1, 'M40 gefälschte Folge', 'z6', $2) returning id`,
        [area, recurring.id],
      ),
    );
    expect(await createdBy(forgedNext.id)).toBe("ai");
    await asA((tx) => tx.query("delete from public.tasks where title like 'M40%'"));
  });

  it("Migration 40 trägt Bestand aus dem KI-Protokoll nach", async () => {
    const sql = readMigrations(path.join(REPO_ROOT, "supabase", "migrations")).find((m) =>
      m.name.includes("_40_"),
    )?.sql;
    const backfill = sql?.slice(
      sql.indexOf("alter table public.tasks disable trigger tasks_updated_at"),
      sql.indexOf("create function public.tasks_set_created_by"),
    );
    expect(backfill).toContain("update public.tasks t");
    expect(backfill).toContain("ai_activity");
    const area = await asA((tx) => areaId(tx, "privat"));
    const ids = await asA(async (tx) => {
      const project = await one<{ id: string }>(
        tx,
        "insert into public.projects (area_id, title, sort) values ($1, 'M40-Projekt', 'z9') returning id",
        [area],
      );
      const note = await one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title) values ($1, 'M40-Notiz') returning id",
        [area],
      );
      const mk = async (title: string, projectId: string | null = null, at = "now()") =>
        (
          await one<{ id: string }>(
            tx,
            `insert into public.tasks (area_id, project_id, title, sort, created_at)
             values ($1, $2, $3, 'z5', ${at}) returning id`,
            [area, projectId, title],
          )
        ).id;
      const t = {
        viaTool: await mk("M40 create_task"),
        viaNote: await mk("M40 update_note"),
        viaProject: await mk("M40 create_project", project.id),
        viaCreateNote: await mk("M40 create_note"),
        old: await mk("M40 alt, von Hand", null, "now() - interval '3 days'"),
        manual: await mk("M40 von Hand"),
      };
      // Ausgangslage vor der Migration: alles 'user'
      const log = (
        tool: string,
        entity: string,
        entityId: string | null,
        summary: string,
        undo: string | null = null,
      ) =>
        tx.query(
          `insert into public.ai_activity (client_id, tool, entity, entity_id, summary, undo)
           values ('c', $1, $2, $3, $4, $5::jsonb)`,
          [tool, entity, entityId, summary, undo],
        );
      await log("create_task", "aufgabe", t.viaTool, "Aufgabe angelegt");
      await log(
        "update_note",
        "notiz",
        note.id,
        "Notiz geändert",
        JSON.stringify({ tasks_added: [t.viaNote] }),
      );
      await log(
        "create_project",
        "projekt",
        project.id,
        "Projekt angelegt (1 Meilensteine, 1 Aufgaben)",
      );
      await log(
        "create_note",
        "notiz",
        note.id,
        "Notiz „M40-Notiz“ angelegt (3 Zeilen, 1 Aufgaben)",
      );
      return { ...t, note: note.id };
    });
    // (die Migration läuft vor dem Trigger, der das Ändern sperrt)
    await asAdmin("alter table public.tasks disable trigger tasks_created_by_update");
    await asAdmin("update public.tasks set created_by = 'user' where title like 'M40%'");
    // Stand von früher: der Nachtrag darf ihn nicht auf „jetzt“ setzen (O8)
    const OLD = "2026-01-02T03:04:05+00:00";
    await asAdmin("alter table public.tasks disable trigger tasks_updated_at");
    await asAdmin(`update public.tasks set updated_at = '${OLD}' where title like 'M40%'`);
    await asAdmin("alter table public.tasks enable trigger tasks_updated_at");
    await asAdmin(
      `update public.projects set last_activity_at = '${OLD}' where title = 'M40-Projekt'`,
    );
    await db.exec(backfill as string); // mehrere Befehle
    await asAdmin("alter table public.tasks enable trigger tasks_created_by_update");
    const kept = await asAdmin(
      `select (select count(*)::int from public.tasks where title like 'M40%' and updated_at <> '${OLD}') as tasks,
              (select count(*)::int from public.projects where title = 'M40-Projekt' and last_activity_at <> '${OLD}') as projects`,
    );
    expect(kept.rows[0]).toEqual({ tasks: 0, projects: 0 });
    // danach laufen die Trigger wieder
    await asAdmin("update public.tasks set title = title || '' where title = 'M40 von Hand'");
    const touched = await asAdmin(
      `select updated_at > '${OLD}' as later from public.tasks where title = 'M40 von Hand'`,
    );
    expect(touched.rows[0]).toEqual({ later: true });
    const rows = await asAdmin(
      "select title, created_by from public.tasks where title like 'M40%' order by title",
    );
    const by = Object.fromEntries(
      (rows.rows as { title: string; created_by: string }[]).map((r) => [r.title, r.created_by]),
    );
    expect(by).toMatchObject({
      "M40 create_task": "ai",
      "M40 update_note": "ai",
      "M40 create_project": "ai",
    });
    // create_note ist nur eine Näherung: die Aufgabe der Minute davor im selben Bereich zählt mit
    expect(by["M40 create_note"]).toBe("ai");
    expect(by["M40 alt, von Hand"]).toBe("user");
    await asA(async (tx) => {
      await tx.query("delete from public.tasks where title like 'M40%'");
      await tx.query("delete from public.notes where id = $1", [ids.note]);
      await tx.query("delete from public.projects where title = 'M40-Projekt'");
    });
    await asAdmin("delete from public.ai_activity where client_id = 'c'");
  });

  it("hakt die KI die letzte Aufgabe ab, ist der Meilenstein erreicht (Migration 35, #60)", async () => {
    const ids = await asA(async (tx) => {
      const area = await areaId(tx, "beruf");
      const p = await one<{ id: string }>(
        tx,
        "insert into public.projects (area_id, title, sort) values ($1, 'KI-Meilenstein', 'z8') returning id",
        [area],
      );
      const m = await one<{ id: string }>(
        tx,
        "insert into public.milestones (project_id, title, sort) values ($1, 'M', 'a0') returning id",
        [p.id],
      );
      const t = await one<{ id: string }>(
        tx,
        "insert into public.tasks (milestone_id, title, sort) values ($1, 'Letzte', 'a0') returning id",
        [m.id],
      );
      return { project: p.id, milestone: m.id, task: t.id };
    });
    await asAi((tx) => tx.query("select public.complete_task($1)", [ids.task]));
    const reached = await asA((tx) =>
      one<{ d: Date | null }>(tx, "select done_at as d from public.milestones where id = $1", [
        ids.milestone,
      ]),
    );
    expect(reached.d).not.toBeNull();
    await asAi((tx) => tx.query("select public.undo_complete_task($1)", [ids.task]));
    const reopened = await asA((tx) =>
      one<{ d: Date | null }>(tx, "select done_at as d from public.milestones where id = $1", [
        ids.milestone,
      ]),
    );
    expect(reopened.d).toBeNull();
    await asA((tx) => tx.query("delete from public.projects where id = $1", [ids.project]));
  });

  it("Einstellungen, Vorlagen, Ansichten und die Freigaben bleiben für die KI zu", async () => {
    for (const name of [
      "user_settings",
      "templates",
      "saved_views",
      "ai_clients",
      "calendar_sources",
      // öffentliche Freigaben (Migration 45): die KI macht nichts öffentlich
      "note_shares",
    ]) {
      expect(await asAi((tx) => count(tx, name)), name).toBe(0);
    }
    const changed = await asAi((tx) =>
      tx.query("update public.ai_clients set revoked_at = null, name = 'gekapert'"),
    );
    expect(changed.affectedRows).toBe(0);
  });

  it("endgültig löschen bleibt in der App (S-1): kein DELETE, kein empty_trash, kein Storage-Remove", async () => {
    const area = await asA((tx) => areaId(tx, "privat"));
    const task = await asAi((tx) =>
      one<{ id: string }>(
        tx,
        "insert into public.tasks (area_id, title, sort) values ($1, 'KI-Löschprobe', 'z8') returning id",
        [area],
      ),
    );
    // In den Papierkorb (Soft-Delete per Update) darf die KI
    const trashed = await asAi((tx) =>
      tx.query("update public.tasks set deleted_at = now() where id = $1", [task.id]),
    );
    expect(trashed.affectedRows).toBe(1);
    // … endgültig löschen nicht, weder direkt noch über empty_trash
    const deleted = await asAi((tx) =>
      tx.query("delete from public.tasks where id = $1", [task.id]),
    );
    expect(deleted.affectedRows).toBe(0);
    await asAi((tx) =>
      tx.query("select public.empty_trash('tasks', array[$1]::uuid[])", [task.id]),
    );
    expect(
      await asA((tx) =>
        one<{ n: number }>(tx, "select count(*)::int as n from public.tasks where id = $1", [
          task.id,
        ]),
      ),
    ).toEqual({ n: 1 });
    // Für jede Inhaltstabelle: DELETE trifft unter dem KI-Token keine Zeile
    for (const name of [
      "areas",
      "topics",
      "projects",
      "milestones",
      "tasks",
      "task_dependencies",
      "notes",
      "note_blocks",
      "recaps",
      "note_types",
    ]) {
      const before = await asA((tx) => count(tx, name));
      await asAi((tx) => tx.query(`delete from public.${name}`));
      expect(await asA((tx) => count(tx, name)), name).toBe(before);
    }
    // Dateien (alte Buckets, Migration 44): hochladen nein, entfernen nein
    for (const bucket of ["attachments", "note-images"]) {
      const name = `${A}/${task.id}/loeschprobe.bin`;
      await expect(
        asAi((tx) =>
          tx.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]),
        ),
      ).rejects.toThrow(/row-level security/);
      await db.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [
        bucket,
        name,
      ]);
      const removed = await asAi((tx) =>
        tx.query("delete from storage.objects where bucket_id = $1 and name = $2", [bucket, name]),
      );
      expect(removed.affectedRows, bucket).toBe(0);
    }
    // Die App (aal2) löscht weiterhin endgültig
    await asA((tx) => tx.query("select public.empty_trash('tasks', array[$1]::uuid[])", [task.id]));
    expect(
      await asA((tx) =>
        one<{ n: number }>(tx, "select count(*)::int as n from public.tasks where id = $1", [
          task.id,
        ]),
      ),
    ).toEqual({ n: 0 });
    // ... aber nicht mehr die alten Storage-Dateien (nur noch lesen, Migration 44)
    const appRemoved = await asA((tx) =>
      tx.query("delete from storage.objects where name = $1", [`${A}/${task.id}/loeschprobe.bin`]),
    );
    expect(appRemoved.affectedRows).toBe(0);
  });

  it("Rückblicke legt die KI an (Migration 32) und ändert sie (34), löscht aber nie endgültig", async () => {
    const recap = await asAi((tx) =>
      one<{ id: string }>(
        tx,
        "insert into public.recaps (kind, period_start, period_end, answers) values ('monat', '2031-01-01', '2031-01-31', '{\"good\": \"Von der KI\"}') returning id",
      ),
    );
    // ändern (update_recap): Antworten, Werte, Fokus, Themen
    const changed = await asAi((tx) =>
      tx.query(
        'update public.recaps set answers = \'{"good": "Von der KI, ergänzt"}\', mood = 4 where id = $1',
        [recap.id],
      ),
    );
    expect(changed.affectedRows).toBe(1);
    // M-3 (Migration 48): Art, Zeitraum, Abschluss, Statistik, Papierkorb nur mit zweitem Faktor
    for (const set of [
      "closed_at = now()",
      "kind = 'woche'",
      "period_start = '2031-01-05'",
      "period_end = '2031-02-28'",
      "stats = '{}'::jsonb",
      "deleted_at = now()",
    ]) {
      await expect(
        asAi((tx) => tx.query(`update public.recaps set ${set} where id = $1`, [recap.id])),
        set,
      ).rejects.toThrow(/nur der Nutzer in der App/);
    }
    await expect(
      asAi((tx) => tx.query("select public.close_recap($1)", [recap.id])),
    ).rejects.toThrow(/nur der Nutzer in der App/);
    // die App (aal2) schließt ab und öffnet wieder
    expect(
      (
        await asA((tx) =>
          tx.query("update public.recaps set closed_at = now() where id = $1", [recap.id]),
        )
      ).affectedRows,
    ).toBe(1);
    await asA((tx) =>
      tx.query("update public.recaps set closed_at = null where id = $1", [recap.id]),
    );
    // endgültig löschen nur in der App (recaps_delete_mfa, Migration 28)
    const removed = await asAi((tx) =>
      tx.query("delete from public.recaps where id = $1", [recap.id]),
    );
    expect(removed.affectedRows).toBe(0);
    expect(
      await asA((tx) =>
        one<{ good: string; mood: number; deleted: boolean }>(
          tx,
          "select answers ->> 'good' as good, mood, deleted_at is not null as deleted from public.recaps where id = $1",
          [recap.id],
        ),
      ),
    ).toEqual({ good: "Von der KI, ergänzt", mood: 4, deleted: false });
    // ein KI-Protokolleintrag kann auf den Rückblick zeigen
    await asAi((tx) =>
      tx.query(
        "insert into public.ai_activity (client_id, tool, entity, entity_id, summary) values ($1, 'update_recap', 'rueckblick', $2, 'Monatsrückblick geändert')",
        [CLIENT, recap.id],
      ),
    );
    await asA((tx) => tx.query("delete from public.recaps where id = $1", [recap.id]));
  });

  it("recap_set_answer ändert nur den einen Schlüssel – andere Antworten bleiben (Migration 49, V-2)", async () => {
    const recap = await asA((tx) =>
      one<{ id: string }>(
        tx,
        "insert into public.recaps (kind, period_start, period_end, answers) values ('woche', '2032-01-05', '2032-01-11', '{\"good\": \"Lauf\"}') returning id",
      ),
    );
    // die KI schreibt die Gesprächsfelder …
    const byAi = await asAi((tx) =>
      tx.query(
        'update public.recaps set answers = answers || \'{"gespraech": "Von der KI"}\' where id = $1',
        [recap.id],
      ),
    );
    expect(byAi.affectedRows).toBe(1);
    // … der Nutzer ändert gleichzeitig eine andere Antwort feldweise: beides bleibt
    await asA((tx) =>
      tx.query("select public.recap_set_answer($1, 'hard', $2::jsonb)", [recap.id, '"Schlaf"']),
    );
    expect(
      await asA((tx) =>
        one<{ answers: Record<string, unknown> }>(
          tx,
          "select answers from public.recaps where id = $1",
          [recap.id],
        ),
      ),
    ).toEqual({ answers: { good: "Lauf", hard: "Schlaf", gespraech: "Von der KI" } });
    // null leert den Schlüssel, bleibt aber als Schlüssel; fremder oder fehlender Rückblick → P0002
    await asA((tx) =>
      tx.query("select public.recap_set_answer($1, 'hard', 'null'::jsonb)", [recap.id]),
    );
    await expect(
      asB((tx) =>
        tx.query("select public.recap_set_answer($1, 'good', '\"x\"'::jsonb)", [recap.id]),
      ),
    ).rejects.toThrow(/Rückblick nicht gefunden/);
    await expect(
      asA((tx) => tx.query("select public.recap_set_answer($1, '', '\"x\"'::jsonb)", [recap.id])),
    ).rejects.toThrow(/Ungültiger Schlüssel/);
    await asA((tx) => tx.query("delete from public.recaps where id = $1", [recap.id]));
  });

  it("KI-Protokoll kennt Termine ohne UUID (Migration 37, N1d)", async () => {
    await asAi((tx) =>
      tx.query(
        `insert into public.ai_activity (client_id, tool, entity, summary, undo)
         values ($1, 'create_event', 'termin', 'Termin angelegt', '{"kind":"event_create","calendar_id":"c","event_id":"e1"}')`,
        [CLIENT],
      ),
    );
    await expect(
      asAi((tx) =>
        tx.query(
          "insert into public.ai_activity (client_id, tool, entity, summary) values ($1, 'x', 'kalender', 'falsch')",
          [CLIENT],
        ),
      ),
    ).rejects.toThrow(/ai_activity_entity_check/);
  });

  it("assignee: Standard 'user', App und KI setzen und ändern, Folgeaufgabe erbt (Migration 42, #77)", async () => {
    const area = await asA((tx) => areaId(tx, "privat"));
    const assignee = (id: string) =>
      asA((tx) =>
        one<{ a: string }>(tx, "select assignee as a from public.tasks where id = $1", [id]),
      ).then((r) => r.a);
    const own = await asA((tx) =>
      one<{ id: string }>(
        tx,
        "insert into public.tasks (area_id, title, sort) values ($1, 'M42 eigen', 'z6') returning id",
        [area],
      ),
    );
    expect(await assignee(own.id)).toBe("user");
    // die KI legt einen eigenen Arbeitsschritt an und gibt ihn dem Nutzer zurück
    const step = await asAi((tx) =>
      one<{ id: string }>(
        tx,
        "insert into public.tasks (area_id, title, sort, assignee) values ($1, 'M42 Schritt', 'z6', 'ai') returning id",
        [area],
      ),
    );
    expect(await assignee(step.id)).toBe("ai");
    await asAi((tx) =>
      tx.query("update public.tasks set assignee = 'user' where id = $1", [step.id]),
    );
    expect(await assignee(step.id)).toBe("user");
    // die App stellt um
    await asA((tx) => tx.query("update public.tasks set assignee = 'ai' where id = $1", [own.id]));
    expect(await assignee(own.id)).toBe("ai");
    await expect(
      asA((tx) => tx.query("update public.tasks set assignee = 'robot' where id = $1", [own.id])),
    ).rejects.toThrow(/tasks_assignee_check/);
    // Folgeaufgabe erbt 'ai' von der Vorlage, auch wenn der Nutzer sie abhakt
    const recurring = await asA((tx) =>
      one<{ id: string }>(
        tx,
        `insert into public.tasks (area_id, title, sort, due_date, recurrence, assignee)
         values ($1, 'M42 wiederholt', 'z6', '2026-10-20', 'FREQ=WEEKLY;BYDAY=TU', 'ai') returning id`,
        [area],
      ),
    );
    await asA((tx) =>
      tx.query("select public.complete_task($1, '2026-10-27', gen_random_uuid())", [recurring.id]),
    );
    const next = await asA((tx) =>
      one<{ a: string }>(
        tx,
        "select assignee as a from public.tasks where recurrence_source_id = $1",
        [recurring.id],
      ),
    );
    expect(next.a).toBe("ai");
    await asA((tx) => tx.query("delete from public.tasks where title like 'M42%'"));
  });

  it("event_links: Termin ↔ Aufgabe/Notiz, eindeutig, KI schreibt, löscht aber nie endgültig (Migration 43, #68)", async () => {
    const area = await asA((tx) => areaId(tx, "beruf"));
    const task = await asA((tx) =>
      one<{ id: string }>(
        tx,
        "insert into public.tasks (area_id, title, sort) values ($1, 'M43 Geräte prüfen', 'z6') returning id",
        [area],
      ),
    );
    const note = await asA((tx) =>
      one<{ id: string }>(
        tx,
        "insert into public.notes (area_id, title) values ($1, 'M43 Protokoll') returning id",
        [area],
      ),
    );
    const link = (
      run: typeof asA,
      target: { task?: string; note?: string },
      extra: { event?: string; series?: string | null; scope?: string } = {},
    ) =>
      run((tx) =>
        one<{ id: string }>(
          tx,
          `insert into public.event_links (google_calendar_id, event_id, recurring_event_id, scope,
             task_id, note_id, event_title, event_start, event_end)
           values ('kal@group.calendar.google.com', $1, $2, $3, $4, $5, 'Übungsdienst',
             '2026-10-21 17:00+00', '2026-10-21 19:00+00') returning id`,
          [
            extra.event ?? "ev1_20261021T170000Z",
            extra.series ?? null,
            extra.scope ?? "occurrence",
            target.task ?? null,
            target.note ?? null,
          ],
        ),
      );
    const toTask = await link(asA, { task: task.id });
    await link(asA, { note: note.id });
    // genau ein Ziel
    await expect(link(asA, {})).rejects.toThrow(/event_links_one_target/);
    await expect(
      asA((tx) =>
        tx.query(
          `insert into public.event_links (google_calendar_id, event_id, task_id, note_id, event_start, event_end)
           values ('k', 'e', $1, $2, now(), now())`,
          [task.id, note.id],
        ),
      ),
    ).rejects.toThrow(/event_links_one_target/);
    // Serie braucht ihre ID
    await expect(link(asA, { task: task.id }, { scope: "series" })).rejects.toThrow(
      /event_links_series_needs_id/,
    );
    // doppelt geht nicht, nach dem Lösen wieder
    await expect(link(asA, { task: task.id })).rejects.toThrow(/event_links_unique/);
    await asA((tx) =>
      tx.query("update public.event_links set deleted_at = now() where id = $1", [toTask.id]),
    );
    const relinked = await link(asA, { task: task.id });
    // M-4 (Migration 48): Rückgängig auf das Lösen – Zurückholen gewinnt, die neue Zeile wandert
    // in den Papierkorb (vorher 23505, Dauerfehler in der Warteschlange)
    expect(
      (
        await asA((tx) =>
          tx.query("update public.event_links set deleted_at = null where id = $1", [toTask.id]),
        )
      ).affectedRows,
    ).toBe(1);
    const live = await asA((tx) =>
      tx.query<{ id: string }>(
        "select id from public.event_links where task_id = $1 and event_id = $2 and deleted_at is null",
        [task.id, "ev1_20261021T170000Z"],
      ),
    );
    expect(live.rows.map((r) => r.id)).toEqual([toTask.id]);
    expect(
      await asA((tx) =>
        one<{ gone: boolean }>(
          tx,
          "select deleted_at is not null as gone from public.event_links where id = $1",
          [relinked.id],
        ),
      ),
    ).toEqual({ gone: true });
    // Serie: eindeutig je Serie, auch über verschiedene Vorkommen
    await link(asA, { task: task.id }, { event: "ev2_a", series: "ev2", scope: "series" });
    await expect(
      link(asA, { task: task.id }, { event: "ev2_b", series: "ev2", scope: "series" }),
    ).rejects.toThrow(/event_links_unique/);
    // B sieht nichts und kann nichts an A's Aufgabe hängen
    expect(
      await asB((tx) =>
        one<{ n: number }>(tx, "select count(*)::int as n from public.event_links"),
      ).then((r) => r.n),
    ).toBe(0);
    // aal1 ohne KI-Freigabe: nichts
    expect(
      await as(db, { role: "authenticated", userId: A, aal: "aal1" }, (tx) =>
        one<{ n: number }>(tx, "select count(*)::int as n from public.event_links"),
      ).then((r) => r.n),
    ).toBe(0);
    // KI: liest, legt an, löst (Soft-Delete) – endgültig löschen nicht
    const byAi = await link(asAi, { note: note.id }, { event: "ev3" });
    expect(
      (
        await asAi((tx) =>
          tx.query("update public.event_links set deleted_at = now() where id = $1", [byAi.id]),
        )
      ).affectedRows,
    ).toBe(1);
    expect(
      (await asAi((tx) => tx.query("delete from public.event_links where id = $1", [byAi.id])))
        .affectedRows,
    ).toBe(0);
    // Aufgabe endgültig gelöscht → ihre Verknüpfungen gehen mit
    await asA((tx) => tx.query("delete from public.tasks where id = $1", [task.id]));
    expect(
      await asA((tx) =>
        one<{ n: number }>(
          tx,
          "select count(*)::int as n from public.event_links where task_id is not null",
        ),
      ).then((r) => r.n),
    ).toBe(0);
    await asA((tx) => tx.query("delete from public.event_links"));
    await asA((tx) => tx.query("delete from public.notes where title like 'M43%'"));
  });

  it("Notiz-Typen und Abhängigkeiten liest die KI nur (S-1)", async () => {
    await expect(
      asAi((tx) =>
        tx.query("insert into public.note_types (key, name, sort) values ('ki-typ', 'KI', 'z9')"),
      ),
    ).rejects.toThrow(/row-level security/);
    const area = await asA((tx) => areaId(tx, "privat"));
    const [t1, t2] = await asA(async (tx) => {
      const r = await tx.query<{ id: string }>(
        "insert into public.tasks (area_id, title, sort) values ($1, 'Abh. 1', 'z1'), ($1, 'Abh. 2', 'z2') returning id",
        [area],
      );
      return r.rows.map((row) => row.id);
    });
    await expect(
      asAi((tx) =>
        tx.query(
          "insert into public.task_dependencies (task_id, blocked_by_task_id) values ($1, $2)",
          [t1, t2],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await asAi((tx) => count(tx, "note_types"))).toBeGreaterThan(0);
    const renamed = await asAi((tx) =>
      tx.query("update public.note_types set name = 'Gekapert' where key = 'idee'"),
    );
    expect(renamed.affectedRows).toBe(0);
    await asA((tx) => tx.query("delete from public.tasks where id = any($1::uuid[])", [[t1, t2]]));
  });

  it("Google-Konto liest die KI nur (Migration 36): verbinden, trennen, löschen bleiben in der App", async () => {
    const TOKEN = "v1:aXY:dGFn:ZGF0YQ";
    await asA((tx) =>
      tx.query(
        "insert into public.google_accounts (email, refresh_token_enc) values ('e2e-alex@example.com', $1)",
        [TOKEN],
      ),
    );
    // lesen (für die Termin-Werkzeuge, N1d) – der Token bleibt verschlüsselt
    const seen = await asAi((tx) =>
      one<{ email: string; refresh_token_enc: string }>(
        tx,
        "select email, refresh_token_enc from public.google_accounts",
      ),
    );
    expect(seen).toEqual({ email: "e2e-alex@example.com", refresh_token_enc: TOKEN });
    // anlegen, ändern (auch trennen), löschen: nein
    const changed = await asAi((tx) =>
      tx.query("update public.google_accounts set refresh_token_enc = null, deleted_at = now()"),
    );
    expect(changed.affectedRows).toBe(0);
    const deleted = await asAi((tx) => tx.query("delete from public.google_accounts"));
    expect(deleted.affectedRows).toBe(0);
    await asA((tx) => tx.query("delete from public.google_accounts"));
    await expect(
      asAi((tx) =>
        tx.query(
          "insert into public.google_accounts (email, refresh_token_enc) values ('ki@example.com', $1)",
          [TOKEN],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // ein nicht freigegebener Client sieht die Zeile nicht
    await asA((tx) =>
      tx.query(
        "insert into public.google_accounts (email, refresh_token_enc) values ('e2e-alex@example.com', $1)",
        [TOKEN],
      ),
    );
    expect(await asAi((tx) => count(tx, "google_accounts"), OTHER_CLIENT, OTHER_SESSION)).toBe(0);
    await asA((tx) => tx.query("delete from public.google_accounts"));
  });

  it("KI-Protokoll: client_id kommt aus dem Token, nicht vom Aufrufer (S-7)", async () => {
    const row = await asAi((tx) =>
      one<{ client_id: string }>(
        tx,
        "insert into public.ai_activity (client_id, tool, entity, summary) values ($1, 'capture', 'aufgabe', 'Gefälscht') returning client_id",
        [OTHER_CLIENT],
      ),
    );
    expect(row.client_id).toBe(CLIENT);
  });

  it("KI-Protokoll: die KI trägt ein und liest, ändern und löschen nur in der App (aal2)", async () => {
    const row = await asAi((tx) =>
      one<{ id: string }>(
        tx,
        "insert into public.ai_activity (client_id, tool, entity, summary) values ($1, 'capture', 'aufgabe', 'KI-Probe') returning id",
        [CLIENT],
      ),
    );
    expect(await asAi((tx) => count(tx, "ai_activity"))).toBeGreaterThan(0);
    const updated = await asAi((tx) =>
      tx.query("update public.ai_activity set summary = 'verwischt' where id = $1", [row.id]),
    );
    expect(updated.affectedRows).toBe(0);
    const deleted = await asAi((tx) =>
      tx.query("delete from public.ai_activity where id = $1", [row.id]),
    );
    expect(deleted.affectedRows).toBe(0);
    const undone = await asA((tx) =>
      tx.query("update public.ai_activity set undone_at = now() where id = $1", [row.id]),
    );
    expect(undone.affectedRows).toBe(1);
  });

  it("öffentlicher Client (ohne Geheimnis) zählt nie, auch freigegeben nicht", async () => {
    expect(await asAi((tx) => count(tx, "areas"), PUBLIC_CLIENT, PUBLIC_SESSION)).toBe(0);
  });

  it("nicht freigegebener Client, fremde Sitzung oder Sitzung weg → nichts", async () => {
    expect(await asAi((tx) => count(tx, "areas"), OTHER_CLIENT, OTHER_SESSION)).toBe(0);
    // Sitzung eines anderen Clients mit der Client-ID von Claude
    expect(await asAi((tx) => count(tx, "areas"), CLIENT, OTHER_SESSION)).toBe(0);
    // Sitzung unbekannt (z. B. nach „Trennen“ gelöscht)
    expect(
      await asAi((tx) => count(tx, "areas"), CLIENT, "00000000-0000-4000-8000-0000000000d9"),
    ).toBe(0);
  });

  it("B kann A's Freigabe nicht nutzen", async () => {
    const asBWithClient = <T>(fn: (tx: Transaction) => Promise<T>) =>
      as(
        db,
        { role: "authenticated", userId: B, aal: "aal1", clientId: CLIENT, sessionId: SESSION },
        fn,
      );
    expect(await asBWithClient((tx) => count(tx, "areas"))).toBe(0);
  });

  it("Trennen (revoked_at) sperrt sofort; erneut erlauben öffnet wieder", async () => {
    await asA((tx) =>
      tx.query("update public.ai_clients set revoked_at = now() where client_id = $1", [CLIENT]),
    );
    expect(await asAi((tx) => count(tx, "areas"))).toBe(0);
    await asA((tx) =>
      tx.query("update public.ai_clients set revoked_at = null where client_id = $1", [CLIENT]),
    );
    expect(await asAi((tx) => count(tx, "areas"))).toBe(2);
  });

  it("die App (aal2, ohne client_id) arbeitet unverändert", async () => {
    expect(await asA((tx) => count(tx, "areas"))).toBe(2);
    expect(await asA((tx) => count(tx, "user_settings"))).toBe(1);
  });

  it("Migration 41 ergänzt Gesprächsfelder additiv in Vorlage und offenen Rückblicken, wiederholbar (#66)", async () => {
    const sql = readMigrations(path.join(REPO_ROOT, "supabase", "migrations")).find((m) =>
      m.name.includes("_41_"),
    )?.sql as string;
    const custom = JSON.stringify([
      { key: "good", label: "Mein Gutes", type: "text" },
      { key: "hypothesis", label: "Meine Hypothese", type: "text" },
    ]);
    await asA(async (tx) => {
      await tx.query(
        "update public.templates set body = jsonb_build_object('questions', $1::jsonb) where kind = 'rueckblick'",
        [custom],
      );
      await tx.query(
        `insert into public.recaps (kind, period_start, period_end, questions, closed_at) values
           ('woche', '2031-01-06', '2031-01-12', $1::jsonb, null),
           ('woche', '2031-01-13', '2031-01-19', $1::jsonb, now()),
           ('monat', '2031-02-01', '2031-02-28', $1::jsonb, null),
           ('woche', '2031-01-20', '2031-01-26', '[]'::jsonb, null)`,
        [custom],
      );
    });
    await db.exec(sql);
    await db.exec(sql); // wiederholbar: nichts doppelt
    const rows = await asA((tx) =>
      tx.query<{
        q: { key: string; label: string; section?: string }[];
        kind: string;
        start: string;
      }>(
        "select questions as q, kind, period_start::text as start from public.recaps where period_start >= '2031-01-01' order by period_start",
      ),
    );
    const keys = (r: { q: { key: string }[] }) => r.q.map((x) => x.key);
    const full = [
      "good",
      "hypothesis",
      "conversation",
      "counter_hypothesis",
      "plain_talk",
      "last_week",
    ];
    const [open, closed, empty, month] = rows.rows as [
      (typeof rows.rows)[number],
      (typeof rows.rows)[number],
      (typeof rows.rows)[number],
      (typeof rows.rows)[number],
    ];
    expect(keys(open)).toEqual(full);
    expect(open.q[1]?.label).toBe("Meine Hypothese"); // eigene Beschriftung bleibt
    expect(open.q.at(-1)).toMatchObject({ label: "Bezug zur Vorwoche", section: "Gespräch" });
    expect(keys(closed)).toEqual(["good", "hypothesis"]); // abgeschlossen: unverändert
    expect(month.q.at(-1)?.label).toBe("Bezug zum Vormonat");
    expect(empty.q).toEqual([]); // ohne Schnappschuss: eingebaute Fragen der App
    const tpl = await asA((tx) =>
      one<{ q: { key: string }[] }>(
        tx,
        "select body -> 'questions' as q from public.templates where kind = 'rueckblick'",
      ),
    );
    expect(keys(tpl)).toEqual(full);
    await asA((tx) => tx.query("delete from public.recaps where period_start >= '2031-01-01'"));
  });
});

describe("Öffentliche Freigabe (Migration 45, #94, E42): anon liest nur per Token, nur diese Notiz", () => {
  const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
  const OTHER = "Zbcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
  const asAnon = <T>(fn: (tx: Transaction) => Promise<T>) => as(db, { role: "anon" }, fn);
  const shared = (token: string) =>
    asAnon((tx) =>
      one<{ v: { title: string; blocks: Array<Record<string, unknown>> } | null }>(
        tx,
        "select public.shared_note($1) as v",
        [token],
      ),
    ).then((r) => r.v);
  const file = (token: string, path: string) =>
    asAnon((tx) =>
      one<{ v: string | null }>(tx, "select public.shared_note_file($1, $2) as v", [token, path]),
    ).then((r) => r.v);
  let note = "";
  let linked = "";
  let task = "";
  let shareId = "";
  let image = "";
  let attachment = "";
  let hiddenPath = "";

  beforeAll(async () => {
    const area = await asA((tx) => areaId(tx, "privat"));
    await asA(async (tx) => {
      note = (
        await one<{ id: string }>(
          tx,
          "insert into public.notes (area_id, title, tags, type) values ($1, 'M45 Geteilt', '{privat}', 'wissen') returning id",
          [area],
        )
      ).id;
      linked = (
        await one<{ id: string }>(
          tx,
          "insert into public.notes (area_id, title) values ($1, 'M45 Geheim verlinkt') returning id",
          [area],
        )
      ).id;
      task = (
        await one<{ id: string }>(
          tx,
          "insert into public.tasks (area_id, title, sort, status) values ($1, 'M45 Punkt', 'z1', 'erledigt') returning id",
          [area],
        )
      ).id;
      image = `${A}/${note}/11111111-1111-4111-8111-111111111111.png`;
      attachment = `${A}/${note}/22222222-2222-4222-8222-222222222222.pdf`;
      hiddenPath = `${A}/${note}/33333333-3333-4333-8333-333333333333.png`;
      const block = (sort: string, content: unknown, extra = "") =>
        tx.query(
          `insert into public.note_blocks (note_id, sort, content, content_text${extra ? ", task_id" : ""})
           values ($1, $2, $3::jsonb, 'Titel [[M45 Geheim verlinkt]]'${extra ? ", $4" : ""})`,
          extra
            ? [note, sort, JSON.stringify(content), extra]
            : [note, sort, JSON.stringify(content)],
        );
      await block("a0", {
        type: "paragraph",
        content: [
          { type: "text", text: "Siehe " },
          { type: "noteLink", attrs: { noteId: linked } },
          { type: "text", text: " und " },
          { type: "tag", attrs: { name: "beruf" } },
        ],
      });
      await block("a1", {
        type: "paragraph",
        content: [
          { type: "noteImage", attrs: { path: image, alt: "Plan" } },
          {
            type: "noteFile",
            attrs: { path: attachment, name: "Plan.pdf", mime: "application/pdf" },
          },
        ],
      });
      await block("a2", { type: "paragraph", content: [{ type: "text", text: "Erledigt" }] }, task);
      // gelöschter Block: weder sichtbar noch seine Datei abrufbar
      await tx.query(
        `insert into public.note_blocks (note_id, sort, content, deleted_at)
         values ($1, 'a3', $2::jsonb, now())`,
        [
          note,
          JSON.stringify({
            type: "paragraph",
            content: [{ type: "noteImage", attrs: { path: hiddenPath, alt: "weg" } }],
          }),
        ],
      );
      shareId = (
        await one<{ id: string }>(
          tx,
          "insert into public.note_shares (note_id, token) values ($1, $2) returning id",
          [note, TOKEN],
        )
      ).id;
    });
  });

  afterAll(async () => {
    await asA((tx) => tx.query("delete from public.notes where title like 'M45%'"));
    await asA((tx) => tx.query("delete from public.tasks where title like 'M45%'"));
  });

  it("anon kann note_shares weder lesen noch schreiben; die Funktion liefert Titel und Blöcke", async () => {
    await expect(asAnon((tx) => tx.query("select * from public.note_shares"))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asAnon((tx) =>
        tx.query("insert into public.note_shares (note_id, token) values ($1, $2)", [note, OTHER]),
      ),
    ).rejects.toThrow(/permission denied/);
    const result = await shared(TOKEN);
    expect(result?.title).toBe("M45 Geteilt");
    expect(Object.keys(result ?? {}).sort()).toEqual(["blocks", "title"]);
    expect(result?.blocks.map((b) => b.sort)).toEqual(["a0", "a1", "a2"]);
    expect(Object.keys(result?.blocks[0] ?? {}).sort()).toEqual([
      "collapsed",
      "content",
      "id",
      "parent_id",
      "sort",
      "task_done",
    ]);
    // nichts von Eigenschaften, Suchtext oder verlinkten Notizen
    const raw = JSON.stringify(result);
    for (const secret of ["privat", "wissen", "Geheim", linked, task, "content_text"]) {
      expect(raw, secret).not.toContain(secret);
    }
    expect(result?.blocks[0]?.content).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Siehe " },
        { type: "noteLink" },
        { type: "text", text: " und " },
        { type: "tag", attrs: { name: "beruf" } },
      ],
    });
    expect(result?.blocks.map((b) => b.task_done)).toEqual([null, null, true]);
  });

  it("Aufgabe wieder offen → task_done false; Aufgabe im Papierkorb → false", async () => {
    await asA((tx) => tx.query("update public.tasks set status = 'offen' where id = $1", [task]));
    expect((await shared(TOKEN))?.blocks[2]?.task_done).toBe(false);
    await asA((tx) =>
      tx.query("update public.tasks set status = 'erledigt', deleted_at = now() where id = $1", [
        task,
      ]),
    );
    expect((await shared(TOKEN))?.blocks[2]?.task_done).toBe(false);
    await asA((tx) => tx.query("update public.tasks set deleted_at = null where id = $1", [task]));
  });

  it("Dateien: nur Bild/Datei aus einem nicht gelöschten Block, nur im Ordner des Besitzers", async () => {
    expect(await file(TOKEN, image)).toBe("note-images");
    expect(await file(TOKEN, attachment)).toBe("attachments");
    expect(await file(TOKEN, hiddenPath)).toBeNull();
    expect(await file(TOKEN, `${A}/${note}/44444444-4444-4444-8444-444444444444.png`)).toBeNull();
    expect(await file(TOKEN, `${B}/${note}/11111111-1111-4111-8111-111111111111.png`)).toBeNull();
    expect(await file(OTHER, image)).toBeNull();
    expect(await file("kurz", image)).toBeNull();
  });

  it("falsches Format, unbekannt, beendet, Notiz im Papierkorb → null; zurückgeholt → wieder da", async () => {
    for (const bad of ["", "kurz", `${TOKEN}x`, `${TOKEN.slice(0, 42)}!`, OTHER]) {
      expect(await shared(bad), bad).toBeNull();
    }
    await asA((tx) => tx.query("update public.notes set deleted_at = now() where id = $1", [note]));
    expect(await shared(TOKEN)).toBeNull();
    expect(await file(TOKEN, image)).toBeNull();
    await asA((tx) => tx.query("update public.notes set deleted_at = null where id = $1", [note]));
    expect((await shared(TOKEN))?.title).toBe("M45 Geteilt");
    await asA((tx) =>
      tx.query("update public.note_shares set revoked_at = now() where id = $1", [shareId]),
    );
    expect(await shared(TOKEN)).toBeNull();
    expect(await file(TOKEN, image)).toBeNull();
    // neue Freigabe: neuer Token, der alte bleibt tot
    await asA((tx) =>
      tx.query("insert into public.note_shares (note_id, token) values ($1, $2)", [note, OTHER]),
    );
    expect((await shared(OTHER))?.title).toBe("M45 Geteilt");
    expect(await shared(TOKEN)).toBeNull();
  });

  it("eine aktive Freigabe je Notiz, Token-Format per check, Token eindeutig", async () => {
    await expect(
      asA((tx) =>
        tx.query("insert into public.note_shares (note_id, token) values ($1, $2)", [
          note,
          `Q${OTHER.slice(1)}`,
        ]),
      ),
    ).rejects.toThrow(/note_shares_one_active/);
    await expect(
      asA((tx) =>
        tx.query("insert into public.note_shares (note_id, token) values ($1, 'zu-kurz')", [
          linked,
        ]),
      ),
    ).rejects.toThrow(/note_shares_token_format/);
    await expect(
      asA((tx) =>
        tx.query("insert into public.note_shares (note_id, token) values ($1, $2)", [
          linked,
          OTHER,
        ]),
      ),
    ).rejects.toThrow(/note_shares_token_unique/);
  });

  it("B sieht As Freigaben nicht, kann keine fremde Notiz freigeben; aal1 (auch KI-Tokens) sieht nichts", async () => {
    expect(
      await asB((tx) =>
        one<{ n: number }>(tx, "select count(*)::int as n from public.note_shares"),
      ).then((r) => r.n),
    ).toBe(0);
    await expect(
      asB((tx) =>
        tx.query("insert into public.note_shares (note_id, token) values ($1, $2)", [
          linked,
          `B${OTHER.slice(1)}`,
        ]),
      ),
    ).rejects.toThrow(/Notiz gehört nicht zum Nutzer/);
    expect(
      await as(db, { role: "authenticated", userId: A, aal: "aal1" }, (tx) =>
        one<{ n: number }>(tx, "select count(*)::int as n from public.note_shares"),
      ).then((r) => r.n),
    ).toBe(0);
  });

  it("auch an RLS vorbei angelegt: eine Freigabe von B auf As Notiz liefert nichts", async () => {
    // als Eigentümer der Datenbank (wie ein Restore ohne Trigger): die Funktion prüft selbst
    await db.exec("set session_replication_role = replica");
    try {
      await db.query(
        "insert into public.note_shares (user_id, note_id, token) values ($1, $2, $3)",
        [B, linked, `C${OTHER.slice(1)}`],
      );
    } finally {
      await db.exec("set session_replication_role = origin");
    }
    expect(await shared(`C${OTHER.slice(1)}`)).toBeNull();
    expect(await file(`C${OTHER.slice(1)}`, image)).toBeNull();
    await db.query("delete from public.note_shares where user_id = $1", [B]);
  });

  it("endgültig gelöschte Notiz nimmt ihre Freigaben mit", async () => {
    await asA((tx) => tx.query("delete from public.notes where id = $1", [note]));
    expect(
      await asA((tx) =>
        one<{ n: number }>(
          tx,
          "select count(*)::int as n from public.note_shares where note_id = $1",
          [note],
        ),
      ).then((r) => r.n),
    ).toBe(0);
  });
});

describe("Freigabe härten (Migration 46): KI-Tokens ändern keine freigegebene Notiz, Inhalt nur per Positivliste", () => {
  const TOKEN = "Hbcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
  const CLIENT = "00000000-0000-4000-8000-0000000000e1";
  const SESSION = "00000000-0000-4000-8000-0000000000e2";
  const LOCKED = /Diese Notiz ist öffentlich freigegeben – die KI kann sie nicht ändern/;
  const asAi = <T>(fn: (tx: Transaction) => Promise<T>) =>
    as(
      db,
      { role: "authenticated", userId: A, aal: "aal1", clientId: CLIENT, sessionId: SESSION },
      fn,
    );
  const asAal1 = <T>(fn: (tx: Transaction) => Promise<T>) =>
    as(db, { role: "authenticated", userId: A, aal: "aal1" }, fn);
  const active = (run: typeof asA, noteId: string) =>
    run((tx) => one<{ v: boolean }>(tx, "select public.note_share_active($1) as v", [noteId])).then(
      (r) => r.v,
    );
  let shared = "";
  let plain = "";
  let block = "";

  beforeAll(async () => {
    await db.query(
      "insert into auth.oauth_clients (id, client_name, client_type) values ($1, 'Claude M46', 'confidential')",
      [CLIENT],
    );
    await db.query(
      "insert into auth.sessions (id, user_id, oauth_client_id, aal) values ($1, $2, $3, 'aal1')",
      [SESSION, A, CLIENT],
    );
    const area = await asA((tx) => areaId(tx, "privat"));
    await asA(async (tx) => {
      await tx.query("insert into public.ai_clients (client_id, name) values ($1, 'Claude M46')", [
        CLIENT,
      ]);
      shared = (
        await one<{ id: string }>(
          tx,
          "insert into public.notes (area_id, title) values ($1, 'M46 Einsatzplan') returning id",
          [area],
        )
      ).id;
      plain = (
        await one<{ id: string }>(
          tx,
          "insert into public.notes (area_id, title) values ($1, 'M46 Privat') returning id",
          [area],
        )
      ).id;
      block = (
        await one<{ id: string }>(
          tx,
          "insert into public.note_blocks (note_id, sort, content) values ($1, 'a0', $2::jsonb) returning id",
          [
            shared,
            JSON.stringify({ type: "paragraph", content: [{ type: "text", text: "Plan" }] }),
          ],
        )
      ).id;
      await tx.query("insert into public.note_shares (note_id, token) values ($1, $2)", [
        shared,
        TOKEN,
      ]);
    });
  });

  afterAll(async () => {
    await asA((tx) => tx.query("delete from public.notes where title like 'M46%'"));
    await asA((tx) => tx.query("delete from public.ai_clients where client_id = $1", [CLIENT]));
  });

  it("note_share_active: ja/nein nur für eigene Notizen, nur mit aal2 oder KI-Zugang, nicht für anon", async () => {
    expect(await active(asA, shared)).toBe(true);
    expect(await active(asA, plain)).toBe(false);
    expect(await active(asAi, shared)).toBe(true);
    expect(await active(asB, shared)).toBe(false);
    expect(await active(asAal1, shared)).toBe(false);
    await expect(
      as(db, { role: "anon" }, (tx) => tx.query("select public.note_share_active($1)", [shared])),
    ).rejects.toThrow(/permission denied/);
  });

  it("KI-Token: freigegebene Notiz – weder Titel noch Blöcke (anlegen, ändern, löschen); Eigenschaften gehen", async () => {
    await expect(
      asAi((tx) => tx.query("update public.notes set title = 'Gekapert' where id = $1", [shared])),
    ).rejects.toThrow(LOCKED);
    await expect(
      asAi((tx) =>
        tx.query("insert into public.note_blocks (note_id, sort, content) values ($1, 'a1', $2)", [
          shared,
          JSON.stringify({ type: "paragraph", content: [{ type: "text", text: "Zugangsdaten" }] }),
        ]),
      ),
    ).rejects.toThrow(LOCKED);
    await expect(
      asAi((tx) =>
        tx.query("update public.note_blocks set deleted_at = now() where id = $1", [block]),
      ),
    ).rejects.toThrow(LOCKED);
    // Block in eine andere Notiz verschieben bzw. aus einer anderen hineinholen: beides gesperrt
    await expect(
      asAi((tx) =>
        tx.query("update public.note_blocks set note_id = $1 where id = $2", [plain, block]),
      ),
    ).rejects.toThrow(LOCKED);
    // Typ, Tags (nicht öffentlich) bleiben änderbar
    const tags = await asAi((tx) =>
      tx.query("update public.notes set tags = '{ki}' where id = $1", [shared]),
    );
    expect(tags.affectedRows).toBe(1);
    expect((await shared_title(shared)).title).toBe("M46 Einsatzplan");
  });

  it("KI-Token: freigegebene Notiz darf in den Papierkorb, kommt aber nicht zurück (Migration 47, K-3)", async () => {
    // in den Papierkorb legen bleibt erlaubt (Konzept Freigabe; trash/convert weisen darauf hin)
    const trashed = await asAi((tx) =>
      tx.query("update public.notes set deleted_at = now() where id = $1", [shared]),
    );
    expect(trashed.affectedRows).toBe(1);
    // zurückholen nicht: sie wäre sofort wieder öffentlich
    await expect(
      asAi((tx) => tx.query("update public.notes set deleted_at = null where id = $1", [shared])),
    ).rejects.toThrow(LOCKED);
    // die App (aal2) holt sie zurück
    const restored = await asA((tx) =>
      tx.query("update public.notes set deleted_at = null where id = $1", [shared]),
    );
    expect(restored.affectedRows).toBe(1);
    // nicht freigegebene Notiz: die KI holt sie wie bisher zurück
    await asAi((tx) =>
      tx.query("update public.notes set deleted_at = now() where id = $1", [plain]),
    );
    const back = await asAi((tx) =>
      tx.query("update public.notes set deleted_at = null where id = $1", [plain]),
    );
    expect(back.affectedRows).toBe(1);
  });

  it("KI-Token: nicht freigegebene Notiz ändert die KI wie bisher; die App (aal2) auch freigegebene", async () => {
    const renamed = await asAi((tx) =>
      tx.query("update public.notes set title = 'M46 Privat neu' where id = $1", [plain]),
    );
    expect(renamed.affectedRows).toBe(1);
    await asAi((tx) =>
      tx.query("insert into public.note_blocks (note_id, sort, content) values ($1, 'a0', $2)", [
        plain,
        JSON.stringify({ type: "paragraph" }),
      ]),
    );
    const app = await asA((tx) =>
      tx.query("update public.notes set title = 'M46 Einsatzplan 2' where id = $1", [shared]),
    );
    expect(app.affectedRows).toBe(1);
    await asA((tx) =>
      tx.query("insert into public.note_blocks (note_id, sort, content) values ($1, 'a1', $2)", [
        shared,
        JSON.stringify({ type: "paragraph" }),
      ]),
    );
    // Freigabe beendet → die KI darf wieder
    await asA((tx) =>
      tx.query("update public.note_shares set revoked_at = now() where note_id = $1", [shared]),
    );
    const after = await asAi((tx) =>
      tx.query("update public.notes set title = 'M46 Einsatzplan 3' where id = $1", [shared]),
    );
    expect(after.affectedRows).toBe(1);
  });

  it("Positivliste: unbekannte Knoten, Marken, Attribute und Werte fallen weg", async () => {
    const result = await db.query<{ v: unknown }>("select public.shared_block_content($1) as v", [
      JSON.stringify({
        type: "heading",
        attrs: { kind: "h2", secret: "x", level: 9 },
        content: [
          {
            type: "text",
            text: "Hallo",
            secret: "x",
            marks: [
              { type: "bold", attrs: { secret: "x" } },
              { type: "link", attrs: { href: "https://example.com", target: "_self", class: "x" } },
              { type: "textColor", attrs: { color: "red;x" } },
              { type: "textColor", attrs: { color: "blau" } },
              { type: "marker", attrs: { color: "pink" } },
              { type: "underline" },
              { type: "comment", attrs: { body: "geheim" } },
            ],
          },
          { type: "text", text: 42 },
          { type: "noteLink", attrs: { noteId: "x", title: "Geheim" } },
          { type: "tag", attrs: { name: "einsatz", color: "x" } },
          {
            type: "noteImage",
            attrs: { path: "u/n/f.png", alt: "Plan", width: 50, crop: { x: 1 }, secret: "x" },
          },
          { type: "noteImage", attrs: { path: { evil: true } } },
          {
            type: "noteFile",
            attrs: {
              path: "u/n/f.pdf",
              name: "Plan.pdf",
              mime: "application/pdf",
              size: 3,
              view: "evil",
            },
          },
          { type: "mermaid", attrs: { code: "graph TD", theme: "x" } },
          { type: "hardBreak", attrs: { secret: "x" } },
          { type: "embed", attrs: { html: "<script>" } },
          { type: "secretNode", content: [{ type: "text", text: "versteckt" }] },
        ],
      }),
    ]);
    expect(result.rows[0]?.v).toEqual({
      type: "paragraph",
      attrs: { kind: "h2" },
      content: [
        {
          type: "text",
          text: "Hallo",
          marks: [
            { type: "bold" },
            { type: "link", attrs: { href: "https://example.com" } },
            { type: "textColor", attrs: { color: "blau" } },
            { type: "marker", attrs: { color: "gelb" } },
          ],
        },
        { type: "noteLink" },
        { type: "tag", attrs: { name: "einsatz" } },
        { type: "noteImage", attrs: { path: "u/n/f.png", alt: "Plan", width: 50 } },
        {
          type: "noteFile",
          attrs: { path: "u/n/f.pdf", name: "Plan.pdf", mime: "application/pdf", size: 3 },
        },
        { type: "mermaid", attrs: { code: "graph TD" } },
        { type: "hardBreak" },
      ],
    });
    const empty = await db.query<{ v: unknown }>("select public.shared_block_content($1) as v", [
      JSON.stringify({ type: "paragraph", attrs: { kind: "fett" }, content: "kaputt" }),
    ]);
    expect(empty.rows[0]?.v).toEqual({ type: "paragraph" });
    // nur über shared_note erreichbar, nicht direkt
    await expect(
      as(db, { role: "anon" }, (tx) => tx.query("select public.shared_block_content('{}')")),
    ).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx.query("select public.shared_block_content('{}')"))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("shared_note liefert den Inhalt über die Positivliste", async () => {
    await asA(async (tx) => {
      await tx.query("update public.note_shares set revoked_at = now() where note_id = $1", [
        shared,
      ]);
      await tx.query("insert into public.note_shares (note_id, token) values ($1, $2)", [
        shared,
        `J${TOKEN.slice(1)}`,
      ]);
      await tx.query("update public.note_blocks set content = $1 where id = $2", [
        JSON.stringify({
          type: "paragraph",
          content: [
            { type: "text", text: "Plan", marks: [{ type: "comment", attrs: { body: "geheim" } }] },
          ],
        }),
        block,
      ]);
    });
    const note = await as(db, { role: "anon" }, (tx) =>
      one<{ v: { blocks: Array<{ content: unknown }> } }>(
        tx,
        "select public.shared_note($1) as v",
        [`J${TOKEN.slice(1)}`],
      ),
    );
    expect(JSON.stringify(note.v)).not.toContain("geheim");
    expect(note.v.blocks[0]?.content).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Plan" }],
    });
  });

  it("Funktionen: security definer genau die Allowlist, öffentliche stable, alle mit leerem search_path", async () => {
    const rows = await db.query<{
      name: string;
      definer: boolean;
      volatile: string;
      config: string[] | null;
    }>(
      `select p.proname as name, p.prosecdef as definer, p.provolatile as volatile, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' order by 1`,
    );
    const definers = rows.rows
      .filter((r) => r.definer)
      .map((r) => r.name)
      .sort();
    expect(definers).toEqual([...SECURITY_DEFINER_ALLOWLIST, ...PUBLIC_RPC_ALLOWLIST].sort());
    for (const name of PUBLIC_RPC_ALLOWLIST) {
      expect(rows.rows.find((r) => r.name === name)?.volatile, name).toBe("s");
    }
    for (const row of rows.rows) {
      expect(row.config ?? [], row.name).toContain('search_path=""');
    }
  });
});

async function shared_title(id: string) {
  return as(db, { role: "authenticated", userId: A }, (tx) =>
    one<{ title: string }>(tx, "select title from public.notes where id = $1", [id]),
  );
}
