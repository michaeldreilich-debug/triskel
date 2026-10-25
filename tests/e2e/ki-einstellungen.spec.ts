/**
 * Einstellungen › KI-Zugänge (#33): Adresse und Anleitung, Protokoll der KI-Änderungen mit Link
 * und „Rückgängig“ (über die Speicher-Warteschlange), erteilte Zugänge mit Trennen (Rückfrage
 * inline). Die Änderung „der KI“ legt der Test direkt in der Datenbank an.
 */
import { expect, test } from "@playwright/test";
import { newShareToken } from "@/features/share/token";
import { assertTestBackend } from "../guard";
import { consent, oauthMetadata, pkce, registerClient, startAuthorization } from "../support/oauth";
import { userClient } from "../support/supabase-node";
import { expectNoA11yViolations, expectNoHorizontalOverflow } from "./helpers";
import { AUTH_FILE, uniqueName } from "./support/auth";
import { storedAccessToken } from "./support/session";

test.use({ storageState: AUTH_FILE });

test("Adresse, Anleitung, Protokoll mit Link und Rückgängig; axe, kein Überlauf", async ({
  page,
  baseURL,
}) => {
  const db = userClient(await storedAccessToken());
  const area = (await db.from("areas").select("id").is("deleted_at", null).limit(1).single()).data;
  const title = uniqueName("KI-Notiz");
  const noteId = crypto.randomUUID();
  const added = crypto.randomUUID();
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  expect(
    (await db.from("notes").insert({ id: noteId, title, area_id: area?.id as string })).error,
  ).toBeNull();
  const blocks = await db.from("note_blocks").insert([
    {
      id: crypto.randomUUID(),
      note_id: noteId,
      sort: "a0",
      content: paragraph("Vorher"),
      content_text: "Vorher",
    },
    {
      id: added,
      note_id: noteId,
      sort: "a1",
      content: paragraph("Von der KI"),
      content_text: "Von der KI",
    },
  ]);
  expect(blocks.error).toBeNull();
  const summary = `Notiz „${title}“ geändert · 1 Zeilen angehängt`;
  const log = await db.from("ai_activity").insert({
    client_id: "e2e-client",
    tool: "update_note",
    entity: "notiz",
    entity_id: noteId,
    summary,
    undo: { kind: "append", note_id: noteId, added: [added] },
  });
  expect(log.error).toBeNull();

  await page.goto("/einstellungen#ki");
  const section = page.getByRole("region", { name: "KI-Zugänge" });
  await expect(section.getByLabel("Adresse", { exact: true })).toHaveValue(`${baseURL}/api/mcp`);
  await section.getByText("So verbindest du Claude und ChatGPT").click();
  await expect(section.getByText(/Use your own OAuth client/)).toBeVisible();
  await expect(section.getByText(/claude mcp add --transport http --client-id/)).toBeVisible();

  const row = section.getByTestId("ai-activity").getByRole("listitem").filter({ hasText: title });
  await expect(row.getByRole("link", { name: summary })).toHaveAttribute(
    "href",
    `/wissen/${noteId}`,
  );
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);

  await row.getByRole("button", { name: `Rückgängig: ${summary}` }).click();
  await expect(row.getByText("zurückgeholt")).toBeVisible();
  const block = (await db.from("note_blocks").select("deleted_at").eq("id", added).single()).data;
  expect(block?.deleted_at).toBeTruthy();
});

test("Rückgängig fragt nach, wenn seitdem selbst geändert, und lässt sich zurücknehmen (D-8)", async ({
  page,
}) => {
  const db = userClient(await storedAccessToken());
  const area = (await db.from("areas").select("id").is("deleted_at", null).limit(1).single()).data;
  const taskId = crypto.randomUUID();
  const name = uniqueName("KI-Aufgabe");
  const later = `${name} – später selbst`;
  expect(
    (
      await db
        .from("tasks")
        .insert({ id: taskId, title: later, area_id: area?.id as string, sort: "a0" })
    ).error,
  ).toBeNull();
  const summary = `Aufgabe „${name} – KI“ geändert (title)`;
  expect(
    (
      await db.from("ai_activity").insert({
        client_id: "e2e-client",
        tool: "update_task",
        entity: "aufgabe",
        entity_id: taskId,
        summary,
        undo: {
          kind: "update",
          table: "tasks",
          id: taskId,
          before: { title: `${name} – vorher` },
          after: { title: `${name} – KI` },
        },
      })
    ).error,
  ).toBeNull();

  await page.goto("/einstellungen#ki");
  const row = page.getByTestId("ai-activity").getByRole("listitem").filter({ hasText: summary });
  await row.getByRole("button", { name: `Rückgängig: ${summary}` }).click();
  const conflict = row.getByTestId("ai-undo-conflict");
  await expect(conflict).toContainText("Seitdem selbst geändert: Titel");
  const titleOf = async () =>
    (await db.from("tasks").select("title").eq("id", taskId).single()).data?.title;
  expect(await titleOf()).toBe(later);

  await conflict.getByRole("button", { name: "Trotzdem zurücksetzen" }).click();
  await expect(row.getByText("zurückgeholt")).toBeVisible();
  await expect.poll(titleOf).toBe(`${name} – vorher`);
  // das Überschriebene kommt per „Rückgängig“ im Hinweis zurück
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect.poll(titleOf).toBe(later);
  // der Eintrag ist danach wieder rückgängig zu machen – weg damit, sonst stünde in parallel
  // laufenden Tests der Einstellungen ein zweiter Knopf „Rückgängig“
  await expect(row.getByRole("button", { name: `Rückgängig: ${summary}` })).toBeVisible();
  expect((await db.from("ai_activity").delete().eq("entity_id", taskId)).error).toBeNull();
});

test("Verbunden: Zugang erscheint nach dem Erlauben, Trennen mit Rückfrage", async ({
  page,
  baseURL,
}) => {
  const env = assertTestBackend();
  const meta = await oauthMetadata(env);
  test.skip(!meta, "OAuth-Server im Testprojekt aus");
  if (!meta) return;
  const name = uniqueName("Verbunden");
  const redirectUri = `${baseURL}/oauth-test-callback`;
  const { clientId } = await registerClient(meta, name, redirectUri);
  const { authorizationId } = await startAuthorization(meta, {
    clientId,
    redirectUri,
    challenge: pkce().challenge,
    state: "e2e",
  });
  await page.goto(`/ki-zugang?authorization_id=${authorizationId}`);
  await page.getByRole("button", { name: "Erlauben" }).click();
  await page.waitForURL(/oauth-test-callback\?.*code=/);

  await page.goto("/einstellungen#ki");
  const grants = page.getByTestId("ai-grants");
  const row = grants.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `„${name}“ trennen` }).click();
  await expect(row.getByText("Wirklich trennen?")).toBeVisible();
  await row.getByRole("button", { name: "Trennen", exact: true }).click();
  await expect(grants.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
  // Trennen nimmt auch die Freigabe zurück (sperrt sofort in der Datenbank)
  const db = userClient(await storedAccessToken());
  const allowed = await db.from("ai_clients").select("revoked_at").eq("client_id", clientId);
  expect(allowed.data?.[0]?.revoked_at).toBeTruthy();
});

test("Zugang ohne Freigabe (nicht auf /ki-zugang erlaubt) wird markiert", async ({
  page,
  baseURL,
}) => {
  const env = assertTestBackend();
  const meta = await oauthMetadata(env);
  test.skip(!meta, "OAuth-Server im Testprojekt aus");
  if (!meta) return;
  const name = uniqueName("Ohne Freigabe");
  const redirectUri = `${baseURL}/oauth-test-callback`;
  const { clientId } = await registerClient(meta, name, redirectUri);
  const { authorizationId } = await startAuthorization(meta, {
    clientId,
    redirectUri,
    challenge: pkce().challenge,
    state: "e2e",
  });
  // direkt beim Auth-Server erlaubt, an der Freigabe-Seite vorbei (wie mit Passwort allein)
  const { accessToken } = await storedAccessToken();
  expect((await consent(env, accessToken, authorizationId)).status).toBe(200);

  await page.goto("/einstellungen#ki");
  const row = page.getByTestId("ai-grants").getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText(/Ohne Freigabe – kein Zugriff/)).toBeVisible();
  await expectNoA11yViolations(page);

  // „Trennen“ halb gescheitert: Freigabe zurückgenommen, Zustimmung noch da (S-5)
  const db = userClient(await storedAccessToken());
  expect(
    (
      await db
        .from("ai_clients")
        .insert({ client_id: clientId, name, revoked_at: new Date().toISOString() })
    ).error,
  ).toBeNull();
  await page.reload();
  await expect(row.getByText(/Trennen unvollständig/)).toBeVisible();
  await row.getByRole("button", { name: `„${name}“ wieder freigeben` }).click();
  await expect(row.getByText(/^seit /)).toBeVisible();
  const allowed = (
    await db.from("ai_clients").select("revoked_at").eq("client_id", clientId).single()
  ).data;
  expect(allowed?.revoked_at).toBeNull();
  await db.from("ai_clients").delete().eq("client_id", clientId);
});

test("Rückgängig fragt nach, wenn die Notiz öffentlich freigegeben ist (Review Teil B, M-1/K-4)", async ({
  page,
}) => {
  const db = userClient(await storedAccessToken());
  const area = (await db.from("areas").select("id").is("deleted_at", null).limit(1).single()).data;
  const noteId = crypto.randomUUID();
  const name = uniqueName("KI-Notiz öffentlich");
  expect(
    (await db.from("notes").insert({ id: noteId, title: name, area_id: area?.id as string })).error,
  ).toBeNull();
  expect(
    (await db.from("note_shares").insert({ note_id: noteId, token: newShareToken() })).error,
  ).toBeNull();
  const summary = `Notiz „${name}“ geändert (title)`;
  expect(
    (
      await db.from("ai_activity").insert({
        client_id: "e2e-client",
        tool: "update_note",
        entity: "notiz",
        entity_id: noteId,
        summary,
        undo: {
          kind: "update",
          table: "notes",
          id: noteId,
          before: { title: `${name} – vorher` },
          after: { title: name },
        },
      })
    ).error,
  ).toBeNull();
  try {
    await page.goto("/einstellungen#ki");
    const row = page.getByTestId("ai-activity").getByRole("listitem").filter({ hasText: summary });
    await row.getByRole("button", { name: `Rückgängig: ${summary}` }).click();
    const conflict = row.getByTestId("ai-undo-conflict");
    await expect(conflict).toContainText("Die Notiz ist öffentlich freigegeben");
    await expect(conflict).not.toContainText("Seitdem selbst geändert");
    // Abbrechen ändert nichts
    await conflict.getByRole("button", { name: "Abbrechen" }).click();
    await expect(row.getByRole("button", { name: `Rückgängig: ${summary}` })).toBeVisible();
    expect((await db.from("notes").select("title").eq("id", noteId).single()).data?.title).toBe(
      name,
    );
  } finally {
    await db.from("ai_activity").delete().eq("entity_id", noteId);
    await db.from("note_shares").delete().eq("note_id", noteId);
    await db.from("notes").delete().eq("id", noteId);
  }
});
