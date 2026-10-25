// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ConsentApi, ConsentError } from "../consent";
import { ConsentView } from "./consent-screen";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

afterEach(cleanup);

const details = {
  authorizationId: "a1",
  clientId: "c1",
  clientName: "Claude",
  clientUri: null,
  redirectHost: "claude.ai",
  scopes: [],
};

function stubLocation() {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, assign },
    writable: true,
  });
  return assign;
}

describe("Freigabe-Seite (#33)", () => {
  it("zeigt Client, Ziel, was er darf und nicht darf; Erlauben leitet weiter", async () => {
    const assign = stubLocation();
    const decide = vi.fn(async () => "https://claude.ai/cb?code=1");
    const api: ConsentApi = { load: async () => ({ kind: "details", details }), decide };
    render(<ConsentView api={api} authorizationId="a1" />);
    expect((await screen.findByTestId("consent-client")).textContent).toBe(
      "Claude möchte mit deinem Triskel arbeiten und kehrt danach zu claude.ai zurück.",
    );
    expect(screen.getByRole("list", { name: "Darf" }).textContent).toContain("Papierkorb");
    expect(screen.getByRole("list", { name: "Darf" }).textContent).toContain("Endgültig löschen");
    fireEvent.click(screen.getByRole("button", { name: "Erlauben" }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Weiter zu claude.ai …",
    );
    expect(decide).toHaveBeenCalledWith(details, true);
    expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=1");
  });

  it("unbekanntes Ziel: deutliche Warnung, Erlauben erst nach Bestätigung (S-2)", async () => {
    stubLocation();
    const decide = vi.fn(async () => "https://evil.example/cb?code=1");
    const api: ConsentApi = {
      load: async () => ({
        kind: "details",
        details: { ...details, redirectHost: "evil.example" },
      }),
      decide,
    };
    render(<ConsentView api={api} authorizationId="a1" />);
    expect((await screen.findByTestId("consent-unknown-host")).textContent).toContain(
      "evil.example",
    );
    const allow = screen.getByRole("button", { name: "Erlauben" });
    expect(allow).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: /selbst eingerichtet/ }));
    expect(allow).toHaveProperty("disabled", false);
    fireEvent.click(allow);
    await screen.findByRole("status");
    expect(decide).toHaveBeenCalled();
  });

  it("bekannte Ziele (Claude, ChatGPT, lokal) ohne Warnung", async () => {
    for (const host of ["claude.ai", "chatgpt.com", "localhost:8080", "127.0.0.1:3100"]) {
      const api: ConsentApi = {
        load: async () => ({ kind: "details", details: { ...details, redirectHost: host } }),
        decide: vi.fn(),
      };
      render(<ConsentView api={api} authorizationId="a1" />);
      await screen.findByTestId("consent-client");
      expect(screen.queryByTestId("consent-unknown-host"), host).toBeNull();
      cleanup();
    }
  });

  it("Ablehnen geht ebenfalls zurück zum Client", async () => {
    const assign = stubLocation();
    const api: ConsentApi = {
      load: async () => ({ kind: "details", details }),
      decide: async (_details, allow) =>
        `https://claude.ai/cb?${allow ? "code=1" : "error=access_denied"}`,
    };
    render(<ConsentView api={api} authorizationId="a1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ablehnen" }));
    await screen.findByRole("status");
    expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?error=access_denied");
  });

  it("schon erlaubt → ohne Rückfrage weiter; ohne authorization_id oder bei Fehler → Hinweis", async () => {
    const assign = stubLocation();
    const api: ConsentApi = {
      load: async (id) => {
        if (id === "alt") return { kind: "redirect", url: "https://claude.ai/cb?code=9" };
        throw new ConsentError("Die Anfrage ist abgelaufen.");
      },
      decide: vi.fn(),
    };
    const { unmount } = render(<ConsentView api={api} authorizationId="alt" />);
    await screen.findByRole("status");
    expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=9");
    unmount();
    render(<ConsentView api={api} authorizationId="weg" />);
    expect(await screen.findByText("Die Anfrage ist abgelaufen.")).toBeTruthy();
    cleanup();
    render(<ConsentView api={api} authorizationId={null} />);
    expect(await screen.findByText(/öffnet sich, wenn du in Claude/)).toBeTruthy();
  });
});
