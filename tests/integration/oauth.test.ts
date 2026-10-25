/**
 * KI-Zugang (#33, E27) gegen das Testprojekt: der echte OAuth-Ablauf des Supabase-OAuth-Servers
 * (Beta) – Client registrieren, freigeben und erlauben, Tokens tauschen und erneuern, damit über
 * die MCP-Route arbeiten, Zugang trennen. Hält fest, worauf das Sicherheitsmodell baut
 * (Fall B, Migration 21): Supabase stellt KI-Tokens mit aal1 aus und lässt das Erlauben schon mit
 * dem Passwort zu – Daten sieht ein Token deshalb nur mit Freigabe in ai_clients (nur mit TOTP
 * möglich), von einem vertraulichen Client (Geheimnis) und solange seine Sitzung besteht.
 * Schlägt an, falls Supabase das ändert. Ist der OAuth-Server im Projekt aus, läuft nur der
 * Hinweis. Im Testprojekt ist die Selbst-Registrierung an (nur für diese Tests), in Prod aus.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { SHARED_NOTE_LOCKED } from "@/features/ai/server/shares";
import { newShareToken } from "@/features/share/token";
import { assertTestBackend } from "../guard";
import { removeR2Folders, testR2Config } from "../support/media";
import {
  type AsMetadata,
  allowClient,
  authorizationDetails,
  blockClient,
  claimsOf,
  connectClient,
  consent,
  exchangeCode,
  headerOf,
  listGrants,
  oauthMetadata,
  pkce,
  refreshTokens,
  registerClient,
  revokeGrant,
  startAuthorization,
} from "../support/oauth";
import { anonClient, runMarker, userClient } from "../support/supabase-node";

const env = assertTestBackend();
const meta = await oauthMetadata(env);
const sessionA = inject("sessionA");
const marker = runMarker();
const REDIRECT = "http://localhost:3100/oauth-test-callback";
const APP = "http://localhost:3999";

it.runIf(meta === null)(
  "OAuth-Server ist im Testprojekt aus – KI-Zugang wird nicht geprüft (Authentication › OAuth Server einschalten)",
  () => {},
);

describe.runIf(meta !== null)("KI-Zugang über den Supabase-OAuth-Server (E27 Fall B)", () => {
  const as = meta as AsMetadata;
  const clients: string[] = [];
  const app = userClient(sessionA);
  let tokens: { access_token: string; refresh_token: string } | null = null;
  let clientId = "";
  let clientSecret: string | undefined;

  /** Tokens aus einem Schritt, der sie liefern muss. */
  const must = <T>(value: T | null | undefined): T => {
    expect(value).toBeTruthy();
    return value as T;
  };
  const areasWith = async (token: string) =>
    (await userClient({ accessToken: token }).from("areas").select("id")).data ?? [];

  const route = async () => {
    const mod = await import("@/app/api/mcp/route");
    return async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const handler =
        request.method === "GET" ? mod.GET : request.method === "DELETE" ? mod.DELETE : mod.POST;
      return handler(request);
    };
  };
  const listToolsRaw = async (token: string) =>
    (await route())(`${APP}/api/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

  beforeAll(async () => {
    // Die Route liest die Supabase-Variablen aus der Umgebung (wie auf Vercel)
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.publishableKey;
    // … und die R2-Werte des Test-Buckets (E41, R3: Dateien der KI liegen in R2)
    const r2 = testR2Config();
    expect(r2, "R2-Werte fehlen in .env.test.local").not.toBeNull();
    process.env.R2_ACCOUNT_ID = r2?.accountId;
    process.env.R2_BUCKET = r2?.bucket;
    process.env.R2_ACCESS_KEY_ID = r2?.accessKeyId;
    process.env.R2_SECRET_ACCESS_KEY = r2?.secretAccessKey;
  });

  afterAll(async () => {
    for (const name of ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
      delete process.env[name];
    }
    for (const id of clients) await revokeGrant(env, sessionA.accessToken, id);
    await app.from("tasks").delete().like("title", `${marker}%`);
    await app.from("notes").delete().like("title", `${marker}%`);
    if (clients.length > 0) {
      await app.from("ai_activity").delete().in("client_id", clients);
      await app.from("ai_clients").delete().in("client_id", clients);
    }
  });

  it("Metadaten: Selbst-Registrierung (nur Testprojekt) und PKCE (S256) sind an", () => {
    expect(as.issuer).toBe(`${new URL(env.url).origin}/auth/v1`);
    expect(as.registration_endpoint).toBeTruthy();
    expect(as.code_challenge_methods_supported).toContain("S256");
  });

  it("freigegeben und erlaubt → Token mit client_id und aal1 (Fall B), das wie die App liest", async () => {
    const connected = await connectClient(env, as, sessionA.accessToken, {
      name: `${marker} Claude-Test`,
      redirectUri: REDIRECT,
    });
    clientId = connected.clientId;
    clientSecret = connected.clientSecret;
    clients.push(clientId);
    expect(clientSecret, "vertraulicher Client bekommt ein Geheimnis").toBeTruthy();
    expect(connected.allowed).toBe(201);
    expect(connected.approved.status, JSON.stringify(connected.approved.body)).toBe(200);
    expect(connected.redirect?.searchParams.get("state")).toBe(connected.state);
    tokens = must(connected.tokens);
    const claims = claimsOf(tokens.access_token);
    expect(claims.client_id).toBe(clientId);
    expect(claims.sub).toBe(sessionA.userId);
    expect(claims.session_id).toBeTruthy();
    expect(headerOf(tokens.access_token).alg).toBe("ES256");
    // Grundlage von Migration 21: Supabase gibt die TOTP-Stufe nicht an KI-Tokens weiter
    expect(
      claims.aal,
      "Supabase gibt jetzt aal2 weiter – E27 (Fall B) überdenken, Freigabe bleibt trotzdem nötig",
    ).toBe("aal1");
    expect((await areasWith(tokens.access_token)).length).toBeGreaterThan(0);
    const allowed = await userClient({ accessToken: tokens.access_token }).rpc("ai_client_allowed");
    expect(allowed.data).toBe(true);
  });

  it("ohne Geheimnis gibt es kein Token", async () => {
    const { clientId: id } = await registerClient(as, `${marker} Ohne Geheimnis`, REDIRECT);
    clients.push(id);
    const { verifier, challenge } = pkce();
    const { authorizationId } = await startAuthorization(as, {
      clientId: id,
      redirectUri: REDIRECT,
      challenge,
      state: "s",
    });
    const approved = await consent(env, sessionA.accessToken, authorizationId);
    const code = must(new URL(must(approved.body.redirect_url)).searchParams.get("code"));
    const exchanged = await exchangeCode(as, {
      clientId: id,
      code,
      verifier,
      redirectUri: REDIRECT,
    });
    expect(exchanged.status).toBeGreaterThanOrEqual(400);
  });

  it("freigegebene Notiz (#94, Migration 46): das KI-Token ändert weder Titel noch Inhalt; andere Notizen und die App schon", async () => {
    const ai = userClient({ accessToken: must(tokens).access_token });
    const { data: area } = await app.from("areas").select("id").order("sort").limit(1).single();
    const sharedId = crypto.randomUUID();
    const plainId = crypto.randomUUID();
    const notes = await app.from("notes").insert([
      { id: sharedId, title: `${marker} Freigabe KI`, area_id: area?.id ?? "" },
      { id: plainId, title: `${marker} Privat KI`, area_id: area?.id ?? "" },
    ]);
    expect(notes.error).toBeNull();
    const blockId = crypto.randomUUID();
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    expect(
      (
        await app
          .from("note_blocks")
          .insert({ id: blockId, note_id: sharedId, sort: "a0", content: paragraph("Plan") })
      ).error,
    ).toBeNull();
    expect(
      (await app.from("note_shares").insert({ note_id: sharedId, token: newShareToken() })).error,
    ).toBeNull();

    // die KI sieht die Freigabe selbst nicht, nur ja/nein für ihre Werkzeuge
    expect((await ai.from("note_shares").select("id")).data).toEqual([]);
    expect((await ai.rpc("note_share_active", { p_note_id: sharedId })).data).toBe(true);
    expect((await ai.rpc("note_share_active", { p_note_id: plainId })).data).toBe(false);
    // Passwort allein (ohne KI-Freigabe) erfährt nichts, anon darf gar nicht fragen
    const aal1 = userClient({ accessToken: sessionA.aal1AccessToken });
    expect((await aal1.rpc("note_share_active", { p_note_id: sharedId })).data).toBe(false);
    const anon = await anonClient().rpc("note_share_active", { p_note_id: sharedId });
    expect(anon.error?.code).toBe("42501");

    const locked = (error: { code?: string; message?: string } | null) => {
      expect(error?.code).toBe("42501");
      expect(error?.message).toBe(SHARED_NOTE_LOCKED);
    };
    locked(
      (await ai.from("notes").update({ title: "Gekapert" }).eq("id", sharedId).select("id")).error,
    );
    locked(
      (
        await ai
          .from("note_blocks")
          .insert({ note_id: sharedId, sort: "a1", content: paragraph("Zugangsdaten") })
          .select("id")
      ).error,
    );
    locked(
      (
        await ai
          .from("note_blocks")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", blockId)
          .select("id")
      ).error,
    );
    // nicht öffentliche Eigenschaften bleiben änderbar, andere Notizen ganz
    const tags = await ai
      .from("notes")
      .update({ tags: ["ki"] })
      .eq("id", sharedId)
      .select("id");
    expect(tags.error).toBeNull();
    expect(tags.data).toHaveLength(1);
    const renamed = await ai
      .from("notes")
      .update({ title: `${marker} Privat neu` })
      .eq("id", plainId)
      .select("id");
    expect(renamed.data).toHaveLength(1);
    const added = await ai
      .from("note_blocks")
      .insert({ note_id: plainId, sort: "a0", content: paragraph("KI") })
      .select("id");
    expect(added.error).toBeNull();
    // die App (aal2) ändert die freigegebene Notiz wie bisher
    const byApp = await app
      .from("notes")
      .update({ title: `${marker} Freigabe App` })
      .eq("id", sharedId)
      .select("id");
    expect(byApp.data).toHaveLength(1);
    const title = await app.from("notes").select("title").eq("id", sharedId).single();
    expect(title.data?.title).toBe(`${marker} Freigabe App`);
  });

  it("Erneuern behält client_id, Sitzung und Zugriff", async () => {
    const before = claimsOf(must(tokens).access_token);
    const refreshed = await refreshTokens(as, clientId, must(tokens).refresh_token, clientSecret);
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    const claims = claimsOf(refreshed.body.access_token);
    expect(claims.client_id).toBe(clientId);
    expect(claims.session_id).toBe(before.session_id);
    expect((await areasWith(refreshed.body.access_token)).length).toBeGreaterThan(0);
    tokens = refreshed.body;
  });

  it("erlaubt, aber nicht freigegeben → nichts lesbar, die MCP-Route lehnt ab", async () => {
    const connected = await connectClient(env, as, sessionA.accessToken, {
      name: `${marker} Nicht freigegeben`,
      redirectUri: REDIRECT,
      allow: false,
    });
    clients.push(connected.clientId);
    const token = must(connected.tokens).access_token;
    expect(await areasWith(token)).toEqual([]);
    const response = await listToolsRaw(token);
    expect(response.status).toBe(401);
  });

  it("nur mit Passwort (aal1): freigeben scheitert, das Token sieht nichts", async () => {
    const { clientId: id, clientSecret: secret } = await registerClient(
      as,
      `${marker} Angreifer`,
      REDIRECT,
    );
    clients.push(id);
    expect(
      await allowClient(env, sessionA.aal1AccessToken, id, "Angreifer"),
    ).toBeGreaterThanOrEqual(400);
    const { verifier, challenge } = pkce();
    const { authorizationId } = await startAuthorization(as, {
      clientId: id,
      redirectUri: REDIRECT,
      challenge,
      state: "s",
    });
    // Supabase lässt das Erlauben mit aal1 zu – deshalb hängt alles an der Freigabe
    const approved = await consent(env, sessionA.aal1AccessToken, authorizationId);
    const code = approved.body.redirect_url
      ? new URL(approved.body.redirect_url).searchParams.get("code")
      : null;
    if (!code) return; // Supabase lehnt schon das Erlauben ab – noch besser
    const exchanged = await exchangeCode(as, {
      clientId: id,
      clientSecret: secret,
      code,
      verifier,
      redirectUri: REDIRECT,
    });
    if (exchanged.status !== 200) return;
    expect(await areasWith(exchanged.body.access_token)).toEqual([]);
  });

  it("öffentlicher Client (ohne Geheimnis) zählt nie, auch freigegeben nicht", async () => {
    const connected = await connectClient(env, as, sessionA.accessToken, {
      name: `${marker} Öffentlich`,
      redirectUri: REDIRECT,
      confidential: false,
    });
    clients.push(connected.clientId);
    expect(connected.allowed).toBe(201);
    expect(await areasWith(must(connected.tokens).access_token)).toEqual([]);
  });

  it("Freigabe-Seite: Details nennen den Client; die Liste der Zugänge enthält ihn", async () => {
    const { clientId: id } = await registerClient(as, `${marker} Details`, REDIRECT);
    clients.push(id);
    const { challenge } = pkce();
    const { authorizationId } = await startAuthorization(as, {
      clientId: id,
      redirectUri: REDIRECT,
      challenge,
      state: "s",
    });
    const details = await authorizationDetails(env, sessionA.accessToken, authorizationId);
    expect(details.status).toBe(200);
    expect(details.body).toMatchObject({
      authorization_id: authorizationId,
      client: expect.objectContaining({ id, name: `${marker} Details` }),
    });
    const grants = await listGrants(env, sessionA.accessToken);
    expect(grants.map((g) => g.client.id)).toContain(clientId);
  });

  it("MCP-Route: mit dem Token arbeiten (Trigger, RPC, Protokoll); Sitzungs-Token der App abgelehnt", async () => {
    const routeFetch = await route();
    const client = new Client({ name: "spike", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${APP}/api/mcp`), {
        fetch: routeFetch,
        requestInit: { headers: { Authorization: `Bearer ${must(tokens).access_token}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("overview");
    const overview = await client.callTool({ name: "overview", arguments: {} });
    expect(JSON.stringify(overview.content)).toContain("Bereiche");

    const captured = await client.callTool({
      name: "capture",
      arguments: { text: `${marker} vom Spike` },
    });
    expect(captured.isError, JSON.stringify(captured.content)).not.toBe(true);
    const taskId = (captured.structuredContent as { id: string }).id;
    const done = await client.callTool({
      name: "update_task",
      arguments: { id: taskId, status: "erledigt" },
    });
    expect(done.isError, JSON.stringify(done.content)).not.toBe(true);
    const note = await client.callTool({
      name: "create_note",
      arguments: {
        titel: `${marker} Notiz vom Spike`,
        inhalt: `Erster Punkt #spike\n\n- [ ] ${marker} nachfassen`,
        bereich: "Privat",
      },
    });
    expect(note.isError, JSON.stringify(note.content)).not.toBe(true);
    await client.close();

    const task = await app.from("tasks").select("status, created_by").eq("id", taskId).single();
    expect(task.data?.status).toBe("erledigt");
    // #69 (Migration 40): vom KI-Token angelegt → 'ai', auch die Checkbox-Aufgabe aus der Notiz
    expect(task.data?.created_by).toBe("ai");
    const fromNote = await app
      .from("tasks")
      .select("created_by")
      .like("title", `${marker} nachfassen%`)
      .single();
    expect(fromNote.data?.created_by).toBe("ai");
    // die App kann 'ai' nicht vortäuschen und nichts umstellen
    const area = await app.from("areas").select("id").limit(1).single();
    const own = await app
      .from("tasks")
      .insert({ title: `${marker} von Hand`, area_id: area.data?.id, sort: "z8", created_by: "ai" })
      .select("id, created_by")
      .single();
    expect(own.data?.created_by).toBe("user");
    const flipped = await app
      .from("tasks")
      .update({ created_by: "ai" })
      .eq("id", String(own.data?.id))
      .select("created_by")
      .single();
    expect(flipped.data?.created_by).toBe("user");
    const log = await app
      .from("ai_activity")
      .select("tool")
      .eq("client_id", clientId)
      .order("created_at");
    expect(log.data?.map((r) => r.tool)).toEqual(["capture", "update_task", "create_note"]);

    const plain = await listToolsRaw(sessionA.accessToken);
    expect(plain.status).toBe(401);
  });

  it("die KI kommt nicht an Freigaben, Einstellungen und Vorlagen und ändert das Protokoll nicht", async () => {
    const ai = userClient({ accessToken: must(tokens).access_token });
    for (const table of ["ai_clients", "user_settings", "templates", "saved_views"] as const) {
      const { data } = await ai.from(table).select("id");
      expect(data ?? [], table).toEqual([]);
    }
    const reopened = await ai
      .from("ai_clients")
      .update({ revoked_at: null })
      .eq("client_id", clientId)
      .select("id");
    expect(reopened.data ?? []).toEqual([]);
    const wiped = await ai
      .from("ai_activity")
      .update({ summary: "verwischt" })
      .eq("client_id", clientId)
      .select("id");
    expect(wiped.data ?? []).toEqual([]);
    const removed = await ai.from("ai_activity").delete().eq("client_id", clientId).select("id");
    expect(removed.data ?? []).toEqual([]);
    const log = await app.from("ai_activity").select("summary").eq("client_id", clientId);
    expect(log.data?.length).toBe(3);
    expect(log.data?.map((r) => r.summary)).not.toContain("verwischt");
  });

  it("die KI löscht auch direkt nie endgültig (Migration 28, S-1); Papierkorb geht", async () => {
    const ai = userClient({ accessToken: must(tokens).access_token });
    const task = await app.from("tasks").select("id").eq("title", `${marker} vom Spike`).single();
    const id = must(task.data).id;
    const trashed = await ai
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    expect(trashed.data ?? []).toHaveLength(1);
    const removed = await ai.from("tasks").delete().eq("id", id).select("id");
    expect(removed.data ?? []).toEqual([]);
    await ai.rpc("empty_trash", { p_entity: "tasks", p_ids: [id] });
    const still = await app.from("tasks").select("id").eq("id", id);
    expect(still.data ?? []).toHaveLength(1);
    // S-7: client_id kommt aus dem Token
    const forged = await ai
      .from("ai_activity")
      .insert({ client_id: "fremd", tool: "probe", entity: "aufgabe", summary: `${marker} Probe` })
      .select("client_id")
      .single();
    expect(forged.data?.client_id).toBe(clientId);
  });

  it("MCP-Route (#71): Bild aus dem Chat anhängen, fetch und get_attachment liefern es als Bildinhalt – mit aal1-Token und über HTTP serialisiert", async () => {
    const routeFetch = await route();
    const client = new Client({ name: "bilder", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${APP}/api/mcp`), {
        fetch: routeFetch,
        requestInit: { headers: { Authorization: `Bearer ${must(tokens).access_token}` } },
      }),
    );
    const paths: string[] = [];
    try {
      const note = await client.callTool({
        name: "create_note",
        arguments: { titel: `${marker} Bild per KI`, bereich: "Privat" },
      });
      expect(note.isError, JSON.stringify(note.content)).not.toBe(true);
      const noteId = (note.structuredContent as { id: string }).id;
      // 2000 × 1000 px: fetch verkleinert auf 1600 × 800 (JPEG)
      const image = (
        await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#2e86de" } })
          .png()
          .toBuffer()
      ).toString("base64");
      const attached = await client.callTool({
        name: "attach_file",
        arguments: { ziel: noteId, inhalt_base64: image, name: "Übersicht Fahrzeuge.png" },
      });
      expect(attached.isError, JSON.stringify(attached.content)).not.toBe(true);
      const block = await app.from("note_blocks").select("content").eq("note_id", noteId).single();
      const paragraph = block.data?.content as
        | { content: Array<{ attrs: { path: string } }> }
        | undefined;
      const node = paragraph?.content[0];
      const path = String(node?.attrs.path);
      paths.push(path);
      expect(path.startsWith(`${sessionA.userId}/${noteId}/`)).toBe(true);

      type Block = { type: string; data?: string; mimeType?: string; text?: string };
      const fetched = await client.callTool({ name: "fetch", arguments: { id: noteId } });
      const content = fetched.content as Block[];
      const images = content.filter((c) => c.type === "image");
      expect(images).toHaveLength(1);
      expect(images[0]?.mimeType).toBe("image/jpeg");
      const meta = await sharp(Buffer.from(String(images[0]?.data), "base64")).metadata();
      expect([meta.width, meta.height]).toEqual([1600, 800]);
      const got = await client.callTool({
        name: "get_attachment",
        arguments: { eintrag: noteId, datei: `![[${path.split("/").pop()}]]` },
      });
      expect(got.isError, JSON.stringify(got.content)).not.toBe(true);
      expect((got.content as Block[]).find((c) => c.type === "image")?.mimeType).toBe("image/jpeg");
      expect((got.content as Block[])[0]?.text).toContain("verkleinert von 2000×1000");
      const log = await app
        .from("ai_activity")
        .select("tool")
        .eq("client_id", clientId)
        .eq("entity_id", noteId);
      expect(log.data?.map((r) => r.tool).sort()).toEqual(["attach_file", "create_note"]);
    } finally {
      await client.close();
      const r2 = testR2Config();
      if (r2 && paths.length) {
        const owners = [...new Set(paths.map((p) => p.split("/")[1] as string))];
        await removeR2Folders(r2, "note-images", sessionA.userId, owners);
      }
    }
  });

  it("Trennen: Freigabe zurück sperrt sofort (auch direkt); danach Erneuern scheitert, Route 401", async () => {
    const token = must(tokens).access_token;
    expect(await blockClient(env, sessionA.accessToken, clientId)).toBeLessThan(300);
    expect(await areasWith(token)).toEqual([]);
    expect((await listToolsRaw(token)).status).toBe(401);
    expect(await revokeGrant(env, sessionA.accessToken, clientId)).toBeLessThan(300);
    const refreshed = await refreshTokens(as, clientId, must(tokens).refresh_token, clientSecret);
    expect(refreshed.status).toBeGreaterThanOrEqual(400);
    const response = await listToolsRaw(token);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("Zugang beim Auth-Server getrennt (Sitzung weg) → sofort gesperrt, auch direkt", async () => {
    const connected = await connectClient(env, as, sessionA.accessToken, {
      name: `${marker} Sitzung weg`,
      redirectUri: REDIRECT,
    });
    clients.push(connected.clientId);
    const token = must(connected.tokens).access_token;
    expect((await areasWith(token)).length).toBeGreaterThan(0);
    expect(await revokeGrant(env, sessionA.accessToken, connected.clientId)).toBeLessThan(300);
    expect(await areasWith(token)).toEqual([]);
  });
});
