import { describe, expect, it } from "vitest";
import { connectAi } from "../../../../tests/support/mcp";
import type { AiContext } from "./context";
import { aiInstructions } from "./server";
import { idFromLink } from "./tools/schema";

const ctx = {
  db: {} as AiContext["db"],
  userId: "u1",
  clientId: "c1",
  origin: "https://app.example",
  now: () => new Date("2026-10-17T10:00:00Z"),
} satisfies AiContext;

describe("MCP-Server (#33)", () => {
  it("bietet Lesen, Anlegen, Ändern und den Papierkorb an – aber kein endgültiges Löschen", async () => {
    const ai = await connectAi(ctx);
    const { tools } = await ai.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "attach_file",
      "capture",
      "convert",
      "create_event",
      "create_note",
      "create_project",
      "create_recap",
      "create_task",
      "delete_event",
      "fetch",
      "get_attachment",
      "link_event",
      "list_events",
      "list_notes",
      "list_projects",
      "list_recaps",
      "list_tasks",
      "overview",
      "prepare_upload",
      "search",
      "trash",
      "unlink_event",
      "update_event",
      "update_note",
      "update_project",
      "update_recap",
      "update_task",
    ]);
    // endgültig löschen gibt es nie; „delete_event“ löscht einen Google-Termin (Googles Papierkorb)
    expect(names.some((n) => /remove|purge|empty/.test(n))).toBe(false);
    expect(names.filter((n) => n.includes("delete"))).toEqual(["delete_event"]);
    // Papierkorb: zerstörerisch markiert, damit Claude bzw. ChatGPT vor jedem Aufruf fragen
    const trash = tools.find((t) => t.name === "trash");
    expect(trash?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(trash?.inputSchema.required?.sort()).toEqual(["id", "typ"]);
    // Termine: Löschen und Ändern zerstörerisch (Rückfrage vor jedem Aufruf), Lesen nur lesend
    for (const name of ["delete_event", "update_event"]) {
      expect(tools.find((t) => t.name === name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
    }
    expect(tools.find((t) => t.name === "create_event")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly.sort()).toEqual([
      "fetch",
      "get_attachment",
      "list_events",
      "list_notes",
      "list_projects",
      "list_recaps",
      "list_tasks",
      "overview",
      "search",
    ]);
    const create = tools.find((t) => t.name === "create_note");
    expect(create?.inputSchema.required).toContain("titel");
    expect(Object.keys(create?.inputSchema.properties ?? {})).toContain("inhalt");
    await ai.close();
  });

  it("Anleitung für die KI nennt Überblick zuerst und Papierkorb nur nach Bestätigung", () => {
    const instructions = aiInstructions(ctx.origin);
    expect(instructions).toContain("Zuerst „overview“");
    expect(instructions).toContain("erst nach seiner Bestätigung im Chat");
    expect(instructions).toContain("endgültig löschen geht nur in der App");
    // Termine: Anleitung nennt die Werkzeuge und die Rückfrage vor dem Löschen
    expect(instructions).toContain("„list_events“");
    expect(instructions).toContain(
      "„delete_event“ löscht – wie „trash“ ausschließlich, wenn der Nutzer es ausdrücklich will",
    );
    // #71: Bilder kommen mit fetch/get_attachment, Dateien aus dem Chat per inhalt_base64
    expect(instructions).toContain("„fetch“ liefert die Bilder");
    expect(instructions).toContain("holt „get_attachment“");
    expect(instructions).toContain("„attach_file“ und „inhalt_base64“ (Inhalt als Base64");
    expect(instructions).toContain("bis 2,5 MB");
    expect(instructions).toContain("aus Claudes Cloud-Umgebung gesperrt");
    // R2: kein Supabase-Host mehr, Größe Pflicht, Ablage bis 100 MB
    expect(instructions).not.toContain("supabase.co");
    expect(instructions).toContain("Cloudflare R2");
    expect(instructions).toContain("„groesse“");
    expect(instructions).toContain("bis 100 MB");
  });

  it("#71: get_attachment ist nur lesend, attach_file nimmt inhalt_base64, prepare_upload nennt die Grenze", async () => {
    const ai = await connectAi(ctx);
    const { tools } = await ai.client.listTools();
    const get = tools.find((t) => t.name === "get_attachment");
    expect(get?.annotations).toMatchObject({ readOnlyHint: true });
    expect(get?.inputSchema.required?.sort()).toEqual(["datei", "eintrag"]);
    const attach = tools.find((t) => t.name === "attach_file");
    expect(Object.keys(attach?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["inhalt_base64", "content_type", "url", "upload", "name"]),
    );
    expect(attach?.description).toContain("„inhalt_base64“");
    expect(tools.find((t) => t.name === "prepare_upload")?.description).toContain(
      "„inhalt_base64“",
    );
    const prepare = tools.find((t) => t.name === "prepare_upload");
    expect(prepare?.inputSchema.required).toEqual(
      expect.arrayContaining(["ziel", "name", "groesse"]),
    );
    expect(prepare?.description).not.toContain("supabase.co");
    const fetch = tools.find((t) => t.name === "fetch");
    expect(fetch?.description).toContain("„get_attachment“");
    expect(Object.keys(fetch?.inputSchema.properties ?? {})).toEqual(["id", "bilder"]);
    await ai.close();
  });

  it("App-Links: Anleitung und „fetch“ nennen die Adresse der App – lesen, nicht im Browser öffnen", async () => {
    expect(aiInstructions(ctx.origin)).toContain("Links auf app.example");
    expect(aiInstructions(ctx.origin)).toContain("Nie im Browser");

    const ai = await connectAi(ctx);
    expect(ai.client.getInstructions()).toContain("Links auf app.example");
    const { tools } = await ai.client.listTools();
    const fetch = tools.find((t) => t.name === "fetch");
    expect(fetch?.description).toContain("app.example/…");
    expect(fetch?.description).toContain("nie im Browser");
    await ai.close();
  });

  it("ungültige Eingaben weist das Schema ab, bevor etwas passiert", async () => {
    const ai = await connectAi(ctx);
    const result = await ai.call("fetch", { id: "keine-uuid" });
    expect(result.isError).toBe(true);
    await ai.close();
  });

  it("IDs auch als kopierter App-Link (#47); das Schema nennt beides", async () => {
    const uuid = "3f6c1d2e-8a4b-4c5d-9e6f-0a1b2c3d4e5f";
    expect(idFromLink(`https://app.example/wissen/${uuid}`)).toBe(uuid);
    expect(idFromLink(`https://app.example/projekte/${uuid.toUpperCase()}`)).toBe(uuid);
    expect(idFromLink(`https://app.example/aufgaben?aufgabe=${uuid}`)).toBe(uuid);
    expect(idFromLink(`https://app.example/heute?aufgabe=${uuid}&x=1`)).toBe(uuid);
    expect(idFromLink(`https://app.example/rueckblicke/${uuid}`)).toBe(uuid);
    expect(idFromLink(` ${uuid} `)).toBe(uuid);
    expect(idFromLink("https://app.example/wissen")).toBe("https://app.example/wissen");

    const ai = await connectAi(ctx);
    const { tools } = await ai.client.listTools();
    const fetch = tools.find((t) => t.name === "fetch");
    const props = fetch?.inputSchema.properties as { id?: { description?: string } } | undefined;
    const prop = props?.id;
    expect(prop?.description).toContain("Link aus der App");
    await ai.close();
  });
});
