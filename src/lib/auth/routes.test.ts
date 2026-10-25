import { describe, expect, it } from "vitest";
import {
  decideRoute,
  isMfaPath,
  isPublicPath,
  isSharePath,
  needsFactorStatus,
  type RouteInput,
  safeNextPath,
} from "./routes";

const aal2 = { authenticated: true, aal: "aal2" } as const;
const withFactor = { authenticated: true, aal: "aal1", hasVerifiedFactor: true } as const;
const withoutFactor = { authenticated: true, aal: "aal1", hasVerifiedFactor: false } as const;
const route = (pathname: string, search: string, auth: Omit<RouteInput, "pathname" | "search">) =>
  decideRoute({ pathname, search, ...auth });

describe("Routenschutz", () => {
  it("leitet Abgemeldete von geschützten Seiten auf /login mit Rücksprung", () => {
    expect(decideRoute({ pathname: "/heute", search: "", authenticated: false })).toEqual({
      type: "redirect",
      to: "/login?next=%2Fheute",
    });
    expect(decideRoute({ pathname: "/wissen/abc", search: "?x=1", authenticated: false })).toEqual({
      type: "redirect",
      to: "/login?next=%2Fwissen%2Fabc%3Fx%3D1",
    });
    expect(decideRoute({ pathname: "/", search: "", authenticated: false })).toEqual({
      type: "redirect",
      to: "/login",
    });
  });

  it("lässt Angemeldete mit zweitem Faktor (aal2) durch und schickt sie von /login weiter", () => {
    expect(route("/heute", "", aal2)).toEqual({ type: "next" });
    expect(route("/login", "?next=%2Finbox", aal2)).toEqual({ type: "redirect", to: "/inbox" });
    expect(route("/login", "", aal2)).toEqual({ type: "redirect", to: "/heute" });
  });

  it("öffentliche Seiten: /login und /dev/*", () => {
    expect(decideRoute({ pathname: "/login", search: "", authenticated: false })).toEqual({
      type: "next",
    });
    expect(decideRoute({ pathname: "/dev/ui", search: "", authenticated: false })).toEqual({
      type: "next",
    });
    expect(isPublicPath("/development")).toBe(false);
    expect(isPublicPath("/login-x")).toBe(false);
    // KI-Schnittstelle (#33): prüft ihr OAuth-Token selbst, keine Weiterleitung zum Login
    for (const path of [
      "/api/mcp",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ]) {
      expect(decideRoute({ pathname: path, search: "", authenticated: false })).toEqual({
        type: "next",
      });
    }
    // Datenschutzerklärung (#64): ohne Anmeldung, auch angemeldet ohne Umweg
    expect(decideRoute({ pathname: "/datenschutz", search: "", authenticated: false })).toEqual({
      type: "next",
    });
    expect(
      decideRoute({ pathname: "/datenschutz", search: "", authenticated: true, aal: "aal1" }),
    ).toEqual({ type: "next" });
    // Symbol und Icons (Triskel, O7): auf Anmelde- und MFA-Seiten ohne Umleitung
    for (const path of ["/triskel.png", "/icon.png", "/apple-icon.png", "/manifest.webmanifest"]) {
      expect(decideRoute({ pathname: path, search: "", authenticated: false }), path).toEqual({
        type: "next",
      });
    }
    for (const path of ["/triskel.png/x", "/wissen/icon.png", "/x.png", "/icon.pngx"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
    for (const path of [
      "/manifest.webmanifest/x",
      "/wissen/manifest.webmanifest",
      "/manifest.json",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
    expect(isPublicPath("/datenschutz-x")).toBe(false);
    // öffentliche Freigabe (#94): Seite und Dateien ohne Anmeldung, angemeldet ohne Umweg
    const token = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
    for (const path of [`/freigabe/${token}`, `/api/freigabe/${token}/datei`]) {
      expect(
        decideRoute({ pathname: path, search: "?pfad=x", authenticated: false }),
        path,
      ).toEqual({ type: "next" });
      expect(
        decideRoute({ pathname: path, search: "", authenticated: true, aal: "aal1" }),
        path,
      ).toEqual({ type: "next" });
      expect(
        needsFactorStatus({ pathname: path, search: "", authenticated: true, aal: "aal1" }),
      ).toBe(false);
      expect(isSharePath(path), path).toBe(true);
    }
    for (const path of ["/freigaben", "/api/freigaben/x", "/einstellungen", "/api/dateien/links"]) {
      expect(isPublicPath(path), path).toBe(false);
      expect(isSharePath(path), path).toBe(false);
    }
    expect(isPublicPath("/api/mcp-x")).toBe(false);
    expect(isPublicPath("/api")).toBe(false);
    // die Freigabe-Seite selbst ist geschützt (Login + TOTP)
    expect(isPublicPath("/ki-zugang")).toBe(false);
    // Google verbinden (#64, N1a): Start und Rückkehr brauchen die Sitzung mit zweitem Faktor –
    // Google leitet mit dem Sitzungs-Cookie zurück (SameSite=Lax); ohne aal2 erst zur Abfrage
    for (const path of ["/api/google/start", "/api/google/callback", "/api/google/status"]) {
      expect(isPublicPath(path), path).toBe(false);
      expect(
        decideRoute({ pathname: path, search: "?code=x", authenticated: true, aal: "aal1" }),
      ).toEqual({
        type: "redirect",
        to: `/mfa?next=${encodeURIComponent(`${path}?code=x`)}`,
      });
    }
    // der Google-Ersatz für Tests liegt unter /dev (in Produktion 404)
    expect(isPublicPath("/dev/google/oauth/token")).toBe(true);
    expect(isMfaPath("/mfa")).toBe(true);
    expect(isMfaPath("/mfa/einrichten")).toBe(true);
    expect(isMfaPath("/mfa-x")).toBe(false);
  });

  it("verhindert offene Weiterleitungen und Schleifen über Login/MFA", () => {
    expect(safeNextPath("https://boese.example")).toBe("/heute");
    expect(safeNextPath("//boese.example")).toBe("/heute");
    expect(safeNextPath("/\\boese.example")).toBe("/heute");
    expect(safeNextPath("/login?next=/login")).toBe("/heute");
    expect(safeNextPath("/mfa")).toBe("/heute");
    expect(safeNextPath("/mfa/einrichten?next=/x")).toBe("/heute");
    expect(safeNextPath(null)).toBe("/heute");
    expect(safeNextPath("/wissen?q=1")).toBe("/wissen?q=1");
  });

  it("Steuerzeichen und Backslash umgehen die Prüfung nicht (Security-Review 15.10.2026)", () => {
    // URLSearchParams dekodiert %09/%0a/%0d; der URL-Parser entfernt sie → „//evil.example“
    for (const raw of ["/%09/evil.example", "/%0a/evil.example", "/%0d/evil.example"]) {
      const next = new URLSearchParams(`next=${raw}`).get("next");
      expect(safeNextPath(next)).toBe("/heute");
    }
    expect(safeNextPath("/\t\\evil.example")).toBe("/heute");
    expect(safeNextPath("/ /evil.example")).toBe("/heute");
    expect(safeNextPath("/\u0000/evil.example")).toBe("/heute");
    // aufgelöst, nicht über Präfixe: Login/MFA auch auf Umwegen kein Ziel
    expect(safeNextPath("/x/../login")).toBe("/heute");
    expect(safeNextPath("/./mfa/einrichten")).toBe("/heute");
    // gültige Ziele bleiben (normalisiert), samt Suche und Anker
    expect(safeNextPath("/wissen/abc?x=1#b")).toBe("/wissen/abc?x=1#b");
    expect(safeNextPath("/dev/../heute")).toBe("/heute");
    expect(safeNextPath("/aufgaben?aufgabe=1&q=a%20b")).toBe("/aufgaben?aufgabe=1&q=a%20b");
  });

  it("die Weiterleitungen tragen keine unsicheren Ziele weiter", () => {
    const evil = `?next=${encodeURIComponent("/\t/evil.example")}`;
    expect(route("/login", evil, aal2)).toEqual({ type: "redirect", to: "/heute" });
    expect(route("/mfa", evil, aal2)).toEqual({ type: "redirect", to: "/heute" });
    expect(route("/login", evil, withFactor)).toEqual({ type: "redirect", to: "/mfa" });
    expect(route("/mfa/einrichten", evil, withFactor)).toEqual({ type: "redirect", to: "/mfa" });
    expect(decideRoute({ pathname: "/mfa", search: evil, authenticated: false })).toEqual({
      type: "redirect",
      to: "/login",
    });
  });
});

describe("Routenschutz mit zweitem Faktor (B16)", () => {
  it("kein Weg in die App ohne aal2: mit Faktor → Abfrage, ohne Faktor → Einrichtung", () => {
    for (const path of ["/heute", "/wissen/abc", "/inbox", "/projekte/1"]) {
      expect(route(path, "", withFactor)).toEqual({
        type: "redirect",
        to: `/mfa?next=${encodeURIComponent(path)}`,
      });
      expect(route(path, "", withoutFactor)).toEqual({
        type: "redirect",
        to: `/mfa/einrichten?next=${encodeURIComponent(path)}`,
      });
    }
    // Startseite ohne Rücksprung, Suche bleibt erhalten
    expect(route("/heute", "", withFactor)).toEqual({ type: "redirect", to: "/mfa?next=%2Fheute" });
    expect(route("/aufgaben", "?aufgabe=1", withFactor)).toEqual({
      type: "redirect",
      to: "/mfa?next=%2Faufgaben%3Faufgabe%3D1",
    });
  });

  it("fehlende oder unbekannte Stufe zählt als nur Passwort", () => {
    expect(route("/heute", "", { authenticated: true })).toEqual({
      type: "redirect",
      to: "/mfa?next=%2Fheute",
    });
    expect(
      route("/heute", "", { authenticated: true, aal: null, hasVerifiedFactor: false }),
    ).toEqual({ type: "redirect", to: "/mfa/einrichten?next=%2Fheute" });
  });

  it("zeigt genau die passende MFA-Seite", () => {
    expect(route("/mfa", "?next=%2Fwissen", withFactor)).toEqual({ type: "next" });
    expect(route("/mfa/einrichten", "?next=%2Fwissen", withFactor)).toEqual({
      type: "redirect",
      to: "/mfa?next=%2Fwissen",
    });
    expect(route("/mfa/einrichten", "", withoutFactor)).toEqual({ type: "next" });
    expect(route("/mfa", "?next=%2Fwissen", withoutFactor)).toEqual({
      type: "redirect",
      to: "/mfa/einrichten?next=%2Fwissen",
    });
    // Faktor-Status unbekannt (Auth-Server nicht erreichbar): Abfrage, nie Einrichtung
    expect(route("/mfa/einrichten", "", { authenticated: true, aal: "aal1" })).toEqual({
      type: "redirect",
      to: "/mfa",
    });
  });

  it("MFA-Seiten: abgemeldet → /login (Rücksprung bleibt), mit aal2 → Rücksprungziel", () => {
    expect(decideRoute({ pathname: "/mfa", search: "", authenticated: false })).toEqual({
      type: "redirect",
      to: "/login",
    });
    expect(
      decideRoute({ pathname: "/mfa", search: "?next=%2Fwissen%2Fabc", authenticated: false }),
    ).toEqual({ type: "redirect", to: "/login?next=%2Fwissen%2Fabc" });
    expect(route("/mfa", "?next=%2Finbox", aal2)).toEqual({ type: "redirect", to: "/inbox" });
    expect(route("/mfa/einrichten", "?next=https%3A%2F%2Fboese.example", aal2)).toEqual({
      type: "redirect",
      to: "/heute",
    });
  });

  it("/login mit aal1 → MFA-Seite mit Rücksprung", () => {
    expect(route("/login", "?next=%2Fwissen", withFactor)).toEqual({
      type: "redirect",
      to: "/mfa?next=%2Fwissen",
    });
    expect(route("/login", "", withoutFactor)).toEqual({ type: "redirect", to: "/mfa/einrichten" });
  });

  it("Dev-Seiten bleiben öffentlich, auch mit aal1", () => {
    expect(route("/dev/ui", "", withFactor)).toEqual({ type: "next" });
  });

  it("Faktor-Status wird nur bei aal1 außerhalb von /dev gebraucht", () => {
    const base = { pathname: "/heute", search: "" };
    expect(needsFactorStatus({ ...base, authenticated: false })).toBe(false);
    expect(needsFactorStatus({ ...base, authenticated: true, aal: "aal2" })).toBe(false);
    expect(needsFactorStatus({ ...base, authenticated: true, aal: "aal1" })).toBe(true);
    expect(
      needsFactorStatus({ pathname: "/login", search: "", authenticated: true, aal: "aal1" }),
    ).toBe(true);
    expect(
      needsFactorStatus({ pathname: "/dev/ui", search: "", authenticated: true, aal: "aal1" }),
    ).toBe(false);
  });
});
