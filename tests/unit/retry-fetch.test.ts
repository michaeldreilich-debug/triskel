import { describe, expect, it, vi } from "vitest";
import { isConnectError, retryingFetch } from "../support/retry-fetch";

/** So meldet Node einen abgelehnten Verbindungsaufbau (Happy Eyeballs: AggregateError). */
const refused = () => {
  const cause = Object.assign(new AggregateError([], ""), {
    code: "ECONNREFUSED",
    errors: [Object.assign(new Error("connect"), { code: "ECONNREFUSED" })],
  });
  return new TypeError("fetch failed", { cause });
};

describe("retryingFetch (E2E-Seeds, N4)", () => {
  it("erkennt nur Fehler beim Verbindungsaufbau", () => {
    expect(isConnectError(refused())).toBe(true);
    expect(
      isConnectError(new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })),
    ).toBe(true);
    // nach dem Senden (Antwort abgebrochen) oder ohne Ursache: keine Wiederholung
    expect(isConnectError(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }))).toBe(
      false,
    );
    expect(isConnectError(new TypeError("fetch failed"))).toBe(false);
    expect(isConnectError(new Error("anders"))).toBe(false);
  });

  it("wiederholt einen abgelehnten Verbindungsaufbau und liefert dann die Antwort", async () => {
    const ok = new Response("[]", { status: 200 });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(refused()).mockResolvedValue(ok);
    const response = await retryingFetch({ fetchImpl, delayMs: 1 })("https://x.test/rest", {
      method: "POST",
      body: "{}",
    });
    expect(response).toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]).toEqual([
      "https://x.test/rest",
      { method: "POST", body: "{}" },
    ]);
  });

  it("gibt nach drei Versuchen auf; Fehlerstatus und andere Fehler gehen sofort durch", async () => {
    const always = vi.fn<typeof fetch>().mockRejectedValue(refused());
    await expect(
      retryingFetch({ fetchImpl: always, delayMs: 1 })("https://x.test"),
    ).rejects.toThrow("fetch failed");
    expect(always).toHaveBeenCalledTimes(3);

    const status = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 }));
    expect((await retryingFetch({ fetchImpl: status, delayMs: 1 })("https://x.test")).status).toBe(
      503,
    );
    expect(status).toHaveBeenCalledTimes(1);

    const reset = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }));
    await expect(
      retryingFetch({ fetchImpl: reset, delayMs: 1 })("https://x.test"),
    ).rejects.toThrow();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
