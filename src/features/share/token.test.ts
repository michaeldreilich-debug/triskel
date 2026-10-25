import { describe, expect, it, vi } from "vitest";
import { isShareToken, newShareToken, SHARE_TOKEN } from "./token";

describe("Token der öffentlichen Freigabe (#94)", () => {
  it("43 Zeichen base64url (32 Zufallsbytes), passend zum check der Datenbank", () => {
    for (let i = 0; i < 50; i++) {
      const token = newShareToken();
      expect(token).toHaveLength(43);
      expect(SHARE_TOKEN.test(token)).toBe(true);
      expect(isShareToken(token)).toBe(true);
    }
  });

  it("jedes Mal neu", () => {
    const tokens = new Set(Array.from({ length: 200 }, newShareToken));
    expect(tokens.size).toBe(200);
  });

  it("nutzt crypto.getRandomValues (32 Bytes)", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    newShareToken();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0] as [Uint8Array])[0].length).toBe(32);
  });

  it("isShareToken: nur genau das Format", () => {
    const good = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
    expect(isShareToken(good)).toBe(true);
    for (const bad of [
      "",
      good.slice(1),
      `${good}x`,
      `${good.slice(0, 42)}=`,
      `${good.slice(0, 42)}+`,
      `${good.slice(0, 42)}/`,
      `${good.slice(0, 42)}.`,
      ` ${good.slice(1)}`,
      null,
      42,
    ]) {
      expect(isShareToken(bad), String(bad)).toBe(false);
    }
  });
});
