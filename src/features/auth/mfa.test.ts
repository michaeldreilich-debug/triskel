import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createMfaApi, formatSecret, MfaError, mfaErrorMessage, normalizeCode } from "./mfa";

describe("Eingaben", () => {
  it("Code: nur Ziffern, höchstens 6", () => {
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("12a3-4")).toBe("1234");
    expect(normalizeCode("12345678")).toBe("123456");
    expect(normalizeCode("")).toBe("");
  });

  it("Geheimnis in Vierergruppen", () => {
    expect(formatSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
    expect(formatSecret("ABCDEF")).toBe("ABCD EF");
    expect(formatSecret("")).toBe("");
  });
});

describe("Fehlermeldungen", () => {
  it("falscher Code, abgelaufen, Rate-Limit, ausgeschaltet", () => {
    expect(mfaErrorMessage({ code: "mfa_verification_failed", message: "x" })).toMatch(
      /Code stimmt nicht/,
    );
    expect(mfaErrorMessage({ code: "mfa_challenge_expired", message: "x" })).toMatch(/abgelaufen/);
    expect(mfaErrorMessage({ code: "mfa_factor_not_found", message: "x" })).toMatch(
      /Seite neu laden/,
    );
    expect(mfaErrorMessage({ status: 429, message: "x" })).toMatch(/Zu viele Versuche/);
    expect(mfaErrorMessage({ code: "mfa_totp_enroll_not_enabled", message: "x" })).toMatch(
      /ausgeschaltet/,
    );
    expect(mfaErrorMessage({ message: "Netz weg" })).toBe("Das hat nicht geklappt: Netz weg");
    // Bestätigung auf einem anderen Gerät beendet andere aal1-Sitzungen (Supabase)
    expect(
      mfaErrorMessage({
        name: "AuthSessionMissingError",
        status: 400,
        message: "Auth session missing!",
      }),
    ).toMatch(/Anmeldung ist abgelaufen/);
    expect(mfaErrorMessage({ code: "session_not_found", message: "x" })).toMatch(/abgelaufen/);
  });
});

function fakeSupabase(factors: Array<{ id: string; status: string }>) {
  const mfa = {
    listFactors: vi.fn(async () => ({
      data: {
        all: factors,
        totp: factors.filter((f) => f.status === "verified"),
      },
      error: null,
    })),
    unenroll: vi.fn(async (_arg: { factorId: string }) => ({ data: {}, error: null })),
    enroll: vi.fn(async () => ({
      data: { id: "neu", type: "totp", totp: { qr_code: "data:qr", secret: "GEHEIM", uri: "" } },
      error: null,
    })),
    challengeAndVerify: vi.fn(async ({ code }: { code: string }) =>
      code === "123456"
        ? { data: {}, error: null }
        : { data: null, error: { code: "mfa_verification_failed", status: 422, message: "x" } },
    ),
  };
  const signOut = vi.fn(async () => ({ error: null }));
  return { client: { auth: { mfa, signOut } } as unknown as SupabaseClient, mfa, signOut };
}

describe("createMfaApi", () => {
  it("Einrichten entfernt abgebrochene (unbestätigte) Faktoren und legt einen neuen an", async () => {
    const { client, mfa } = fakeSupabase([
      { id: "alt-1", status: "unverified" },
      { id: "alt-2", status: "unverified" },
    ]);
    const enrollment = await createMfaApi(client).enroll();
    expect(mfa.unenroll.mock.calls.map(([arg]) => arg)).toEqual([
      { factorId: "alt-1" },
      { factorId: "alt-2" },
    ]);
    expect(mfa.enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Authenticator",
      issuer: "Triskel",
    });
    expect(enrollment).toEqual({ factorId: "neu", qrCode: "data:qr", secret: "GEHEIM" });
  });

  it("bestätigter Faktor wird gefunden, falscher Code wirft MfaError mit Meldung", async () => {
    const { client } = fakeSupabase([{ id: "f1", status: "verified" }]);
    const api = createMfaApi(client);
    expect(await api.verifiedFactorId()).toBe("f1");
    await expect(api.verify("f1", "123456")).resolves.toBeUndefined();
    const failure = api.verify("f1", "000000");
    await expect(failure).rejects.toBeInstanceOf(MfaError);
    await expect(failure).rejects.toThrow(/Code stimmt nicht/);
  });

  it("ohne bestätigten Faktor: null; Abmelden nur lokal", async () => {
    const { client, signOut } = fakeSupabase([{ id: "x", status: "unverified" }]);
    const api = createMfaApi(client);
    expect(await api.verifiedFactorId()).toBeNull();
    await api.signOut();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
