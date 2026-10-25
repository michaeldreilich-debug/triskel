import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ current: null as null | { userId: string; aal: string } }));

vi.mock("@/lib/supabase/user", () => ({ currentAuth: async () => auth.current }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({}) }));

import { openFileRequest } from "./access";

const R2_ENV = {
  R2_ACCOUNT_ID: "abcdef0123456789abcdef0123456789",
  R2_BUCKET: "triskel-dateien-test",
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secretexample",
};

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://app.example/api/dateien/links", { method: "POST", body, headers });

describe("openFileRequest (Zugang der App-Routen)", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(R2_ENV)) vi.stubEnv(name, value);
    auth.current = { userId: "0b1f7a3e-1111-4222-8333-444455556666", aal: "aal2" };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("aal2 mit eigener Origin und JSON: durchgelassen, actor app", async () => {
    const result = await openFileRequest(post("{}", { origin: "https://app.example" }));
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;
    expect(result.context.actor).toBe("app");
  });

  it("nur aal1: 403 (zweiter Faktor fehlt)", async () => {
    auth.current = { userId: "0b1f7a3e-1111-4222-8333-444455556666", aal: "aal1" };
    const result = await openFileRequest(post("{}"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("ohne Sitzung: 401", async () => {
    auth.current = null;
    expect(((await openFileRequest(post("{}"))) as Response).status).toBe(401);
  });

  it("fremde Origin: 403; kaputtes JSON: 400", async () => {
    const foreign = await openFileRequest(post("{}", { origin: "https://evil.example" }));
    expect((foreign as Response).status).toBe(403);
    expect(((await openFileRequest(post("{nope"))) as Response).status).toBe(400);
  });

  it("ohne R2-Werte oder mit Prod-Bucket im Test: 503", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "");
    expect(((await openFileRequest(post("{}"))) as Response).status).toBe(503);
    vi.stubEnv("R2_ACCOUNT_ID", R2_ENV.R2_ACCOUNT_ID);
    vi.stubEnv("R2_BUCKET", "triskel-dateien");
    expect(((await openFileRequest(post("{}"))) as Response).status).toBe(503);
  });
});
