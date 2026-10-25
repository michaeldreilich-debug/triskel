import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, createNonce, SECURITY_HEADERS, SHARE_HEADERS } from "./headers";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1);

describe("Content-Security-Policy", () => {
  const csp = contentSecurityPolicy({
    nonce: "abc123==",
    supabaseUrl: "https://projekt.supabase.co/",
    dev: false,
  });

  it("Skripte nur mit Nonce, ohne unsafe-inline und (im Build) ohne unsafe-eval", () => {
    expect(directive(csp, "script-src")).toBe("'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "script-src")).not.toContain("unsafe-inline");
  });

  it("Manifest nur von der eigenen Seite: default-src 'self' deckt manifest-src (E44)", () => {
    expect(directive(csp, "default-src")).toBe("'self'");
    expect(directive(csp, "manifest-src")).toBeUndefined();
  });

  it("Verbindungen nur zur eigenen Seite und zum Supabase-Ursprung", () => {
    expect(directive(csp, "connect-src")).toBe("'self' https://projekt.supabase.co");
  });

  it("R2-Ursprung nur, wenn eingerichtet – genau ein zusätzlicher Ursprung (E41)", () => {
    const r2 = "https://abc123def456.eu.r2.cloudflarestorage.com";
    const withR2 = contentSecurityPolicy({
      nonce: "n",
      supabaseUrl: "https://projekt.supabase.co",
      r2Origin: `${r2}/triskel-dateien`,
      dev: false,
    });
    expect(directive(withR2, "connect-src")).toBe(`'self' https://projekt.supabase.co ${r2}`);
    expect(directive(withR2, "img-src")).toBe(directive(csp, "img-src"));
    expect(directive(csp, "connect-src")).not.toContain("r2");
  });

  it("R2 als Bildquelle nur auf der öffentlichen Freigabe (#94) und nur, wenn eingerichtet", () => {
    const r2 = "https://abc123def456.eu.r2.cloudflarestorage.com";
    const share = contentSecurityPolicy({ nonce: "n", r2Origin: r2, r2Images: true, dev: false });
    expect(directive(share, "img-src")).toBe(`'self' data: blob: ${r2}`);
    const app = contentSecurityPolicy({ nonce: "n", r2Origin: r2, dev: false });
    expect(directive(app, "img-src")).toBe("'self' data: blob:");
    const none = contentSecurityPolicy({ nonce: "n", r2Images: true, dev: false });
    expect(directive(none, "img-src")).toBe("'self' data: blob:");
  });

  it("Freigabe-Kopfzeilen: noindex, kein Referer, nichts zwischenspeichern (#94)", () => {
    expect(Object.fromEntries(SHARE_HEADERS.map((h) => [h.key, h.value]))).toEqual({
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
    });
  });

  it("kein Einbetten, keine Plugins, kein <base>, Formulare nur an die eigene Seite", () => {
    expect(directive(csp, "frame-ancestors")).toBe("'none'");
    expect(directive(csp, "object-src")).toBe("'none'");
    expect(directive(csp, "base-uri")).toBe("'none'");
    expect(directive(csp, "form-action")).toBe("'self'");
    expect(directive(csp, "default-src")).toBe("'self'");
  });

  it("Worker nur von der eigenen Seite (pdf.js, #27)", () => {
    expect(directive(csp, "worker-src")).toBe("'self' blob:");
  });

  it("QR-Code als data:-Bild erlaubt", () => {
    expect(directive(csp, "img-src")).toContain("data:");
  });

  it("Entwicklung: unsafe-eval für React; ohne Supabase-URL nur 'self'", () => {
    const dev = contentSecurityPolicy({ nonce: "n", supabaseUrl: undefined, dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toBe("'self'");
    expect(
      directive(
        contentSecurityPolicy({ nonce: "n", supabaseUrl: "javascript:x", dev: false }),
        "connect-src",
      ),
    ).toBe("'self'");
  });

  it("Nonce ist je Aufruf neu und Base64", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("feste Sicherheits-Header", () => {
  const header = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

  it("HSTS, nosniff, kein Einbetten, Referrer- und Permissions-Policy", () => {
    expect(header("Strict-Transport-Security")).toMatch(/max-age=\d{8,}/);
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Referrer-Policy")).toBe("same-origin");
    expect(header("Permissions-Policy")).toContain("camera=()");
  });
});
